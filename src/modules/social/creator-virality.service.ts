import mongoose from 'mongoose';
import { StakeModel } from '../../models/stake.model';
import BookingCodeModel from '../../models/booking-code.model';
import { UserModel } from '../../models/user.model';
import { cacheService } from '../../services/cache.service';

export interface LeaderboardEntry {
  id: string;
  fullName: string;
  score: number;
  codesShared: number;
  stakesPlaced: number;
  wins: number;
  badge: string;
  isTopCreator: boolean;
}

export interface CreatorVirality {
  score: number;
  codesShared: number;
  stakesPlaced: number;
  wins: number;
  badge: string;
  isTopCreator: boolean;
  rank: number | null;
}

const LEADERBOARD_CACHE_KEY = 'virality:leaderboard';
const LEADERBOARD_TTL_MS = 5 * 60 * 1000;
const TOP_CREATOR_COUNT = 10;

/**
 * Reputation-only virality engine for booking-code creators. A creator's score
 * is the total winnings (netPayout) won by followers on stakes placed through
 * their booking codes. No money moves to creators — score drives rank, badges
 * and feed boost only.
 */
export class CreatorViralityService {
  private badgeForWinnings(winnings: number): string {
    if (winnings >= 1_000_000) return 'Legend';
    if (winnings >= 100_000) return 'Pro';
    if (winnings >= 10_000) return 'Sharp';
    if (winnings >= 1_000) return 'Rising';
    return 'Rookie';
  }

  private async aggregate(userId: string): Promise<{ score: number; codesShared: number; stakesPlaced: number; wins: number }> {
    const userIdObj = new mongoose.Types.ObjectId(userId);
    const [scoreRow, codesShared, stakesRow] = await Promise.all([
      StakeModel.aggregate<{ score: number; wins: number }>([
        { $match: { bookingCode: { $exists: true, $ne: null }, status: 'won' } },
        {
          $lookup: {
            from: 'bookingcodes',
            localField: 'bookingCode',
            foreignField: 'code',
            as: 'code'
          }
        },
        { $match: { 'code.userId': userIdObj } },
        { $group: { _id: null, score: { $sum: '$netPayout' }, wins: { $sum: 1 } } }
      ]),
      BookingCodeModel.countDocuments({ userId: userIdObj }),
      StakeModel.aggregate<{ count: number }>([
        { $match: { bookingCode: { $exists: true, $ne: null } } },
        {
          $lookup: {
            from: 'bookingcodes',
            localField: 'bookingCode',
            foreignField: 'code',
            as: 'code'
          }
        },
        { $match: { 'code.userId': userIdObj } },
        { $count: 'count' }
      ])
    ]);
    return {
      score: scoreRow[0]?.score ?? 0,
      wins: scoreRow[0]?.wins ?? 0,
      codesShared,
      stakesPlaced: stakesRow[0]?.count ?? 0
    };
  }

  async getVirality(userId: string): Promise<CreatorVirality> {
    const cacheKey = `virality:user:${userId}`;
    const cached = cacheService.get<CreatorVirality>(cacheKey);
    if (cached) return cached;
    const [agg, leaderboard] = await Promise.all([
      this.aggregate(userId),
      this.getLeaderboard(TOP_CREATOR_COUNT)
    ]);
    const rank = leaderboard.findIndex(e => e.id === userId);
    const isTopCreator = rank >= 0 && rank < TOP_CREATOR_COUNT;
    const result: CreatorVirality = {
      ...agg,
      badge: this.badgeForWinnings(agg.score),
      isTopCreator,
      rank: rank >= 0 ? rank + 1 : null
    };
    cacheService.set(cacheKey, result, 60_000);
    return result;
  }

  async getLeaderboard(limit = 20): Promise<LeaderboardEntry[]> {
    const safeLimit = Math.min(50, Math.max(1, limit || 20));
    const cached = cacheService.get<LeaderboardEntry[]>('virality:leaderboard');
    if (cached) return cached.slice(0, safeLimit);

    const rows = await StakeModel.aggregate<{ _id: mongoose.Types.ObjectId; score: number; wins: number }>([
      { $match: { bookingCode: { $exists: true, $ne: null }, status: 'won' } },
      {
        $lookup: {
          from: 'bookingcodes',
          localField: 'bookingCode',
          foreignField: 'code',
          as: 'code'
        }
      },
      { $match: { 'code.0': { $exists: true } } },
      { $unwind: '$code' },
      {
        $group: {
          _id: '$code.userId',
          score: { $sum: '$netPayout' },
          wins: { $sum: 1 }
        }
      },
      { $sort: { score: -1 } },
      { $limit: Math.max(safeLimit * 4, TOP_CREATOR_COUNT * 4) }
    ]);

    const ids = rows.map(r => r._id);
    type CountRow = { _id: mongoose.Types.ObjectId; count: number };
    const [users, codesCounts, stakeCounts] = (await Promise.all([
      ids.length
        ? UserModel.find({ _id: { $in: ids } }).select('_id fullName').lean()
        : [],
      ids.length ? BookingCodeModel.aggregate<CountRow>([
        { $match: { userId: { $in: ids } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } }
      ]) : [],
      ids.length ? StakeModel.aggregate<CountRow>([
        { $match: { bookingCode: { $exists: true, $ne: null } } },
        {
          $lookup: {
            from: 'bookingcodes',
            localField: 'bookingCode',
            foreignField: 'code',
            as: 'code'
          }
        },
        { $match: { 'code.userId': { $in: ids } } },
        { $group: { _id: '$code.userId', count: { $sum: 1 } } }
      ]) : []
    ])) as [Array<{ _id: mongoose.Types.ObjectId; fullName?: string }>, CountRow[], CountRow[]];

    const names = new Map<string, string>(
      users.map(u => [String(u._id), u.fullName || 'BetPool user'] as [string, string])
    );
    const codesMap = new Map<string, number>(
      codesCounts.map(r => [String(r._id), r.count] as [string, number])
    );
    const stakesMap = new Map<string, number>(
      stakeCounts.map(r => [String(r._id), r.count] as [string, number])
    );

    const entries: LeaderboardEntry[] = rows
      .filter(r => names.has(String(r._id)))
      .map((r, i) => ({
        id: String(r._id),
        fullName: names.get(String(r._id))!,
        score: r.score,
        codesShared: codesMap.get(String(r._id)) || 0,
        stakesPlaced: stakesMap.get(String(r._id)) || 0,
        wins: r.wins,
        badge: this.badgeForWinnings(r.score),
        isTopCreator: i < TOP_CREATOR_COUNT
      }));

    cacheService.set(LEADERBOARD_CACHE_KEY, entries, LEADERBOARD_TTL_MS);
    return entries.slice(0, safeLimit);
  }

  async isTopCreator(userId: string): Promise<boolean> {
    const top = await this.getLeaderboard(TOP_CREATOR_COUNT);
    return top.some(e => e.id === userId);
  }
}

export const creatorViralityService = new CreatorViralityService();