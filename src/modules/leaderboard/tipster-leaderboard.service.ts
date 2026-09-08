import mongoose from 'mongoose';
import { StakeModel } from '../../models/stake.model';
import { UserModel } from '../../models/user.model';
import { tierForStats } from '../tipster/tipster-badge.service';
import { maskName } from './leaderboard.service';

export type TipsterSortField = 'roi' | 'winRate' | 'settled' | 'profit';

export interface TipsterBoardEntry {
  rank: number;
  userId: string;
  displayName: string;
  tier: string;
  settled: number;
  won: number;
  winRate: number;
  roi: number;
  profit: number;
  totalStaked: number;
}

export interface TipsterBoardPage {
  period: 'week' | 'month' | 'all';
  page: number;
  limit: number;
  total: number;
  minSettled: number;
  items: TipsterBoardEntry[];
}

const MAX_PAGE = 10000;
const TTL_MS = 60_000;

const SORT_FIELDS = new Set(['roi', 'winRate', 'settled', 'profit']);

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function escapeRegex(s: string): string {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function periodStart(period: 'week' | 'month' | 'all'): Date | null {
  if (period === 'week') return new Date(Date.now() - 7 * 86400000);
  if (period === 'month') return new Date(Date.now() - 30 * 86400000);
  return null;
}

/**
 * Tipster ROI board. Ranks creators by what followers earned copying them —
 * rate-based (ROI/win rate), never absolute volume, so whales and spammers
 * can't buy the top. Only copied stakes count (`creatorId`, written at
 * placement; self-copies store null and are excluded by construction).
 * Voids, refunds and unsettled stakes are excluded from sample and math.
 */
export class TipsterLeaderboardService {
  private cache = new Map<string, { at: number; data: TipsterBoardPage }>();

  async getBoard(
    period: 'week' | 'month' | 'all' = 'month',
    page = 1,
    limit = 25,
    options: { search?: string; sortField?: string; sortOrder?: 'asc' | 'desc'; minSettled?: number; minAvgOdds?: number } = {}
  ): Promise<TipsterBoardPage> {
    page = clampInt(page, 1, 1, MAX_PAGE);
    limit = clampInt(limit, 25, 5, 100);
    const search = String(options.search ?? '').trim().slice(0, 120);
    const sortField: TipsterSortField = SORT_FIELDS.has(String(options.sortField)) ? String(options.sortField) as TipsterSortField : 'roi';
    const sortDir: 1 | -1 = options.sortOrder === 'asc' ? 1 : -1;
    const minSettled = clampInt(options.minSettled, 20, 1, 500);
    const minAvgOdds = Number(options.minAvgOdds) > 0 ? Number(options.minAvgOdds) : 0;
    const cacheKey = `tipsters:${period}:${page}:${limit}:${search}:${sortField}:${sortDir}:${minSettled}:${minAvgOdds}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

    const start = periodStart(period);
    const match: any = {
      creatorId: { $exists: true, $ne: null },
      status: { $in: ['won', 'lost'] }
    };
    // Windows measure when copies SETTLED (not placed): active-but-unsettled
    // stakes must never pollute rankings.
    if (start) match.settledAt = { $gte: start };

    const group: any = {
      $group: {
        _id: '$creatorId',
        settled: { $sum: 1 },
        won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
        staked: { $sum: '$stakeAmount' },
        profit: {
          $sum: {
            $cond: [
              { $eq: ['$status', 'won'] },
              { $subtract: ['$netPayout', '$stakeAmount'] },
              { $multiply: ['$stakeAmount', -1] }
            ]
          }
        },
        avgOdds: { $avg: '$combinedMultiplier' }
      }
    };
    const floor: any[] = [{ $match: { settled: { $gte: minSettled } } }];
    if (minAvgOdds > 0) floor.push({ $match: { avgOdds: { $gte: minAvgOdds } } });

    const lookup: any[] = [];
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      lookup.push(
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
        { $unwind: { path: '$u', preserveNullAndEmptyArrays: true } },
        { $match: { $or: [{ 'u.fullName': rx }, { 'u.phone': rx }] } }
      );
    }

    const [rows, total] = await Promise.all([
      StakeModel.aggregate([
        { $match: match },
        group,
        ...floor,
        ...lookup,
        { $sort: { [sortField]: sortDir } },
        { $skip: (page - 1) * limit },
        { $limit: limit }
      ]),
      StakeModel.aggregate([
        { $match: match },
        group,
        ...floor,
        ...lookup,
        { $count: 'count' }
      ])
    ]);

    const userMap = await this.resolveUsers(rows.map((r: any) => r._id));

    const items: TipsterBoardEntry[] = rows.map((row: any, i: number) => {
      const u = userMap.get(row._id.toString()) || { fullName: '', phone: '' };
      const winRate = row.settled > 0 ? Math.round((row.won / row.settled) * 1000) / 10 : 0;
      const roi = row.staked > 0 ? Math.round((row.profit / row.staked) * 1000) / 10 : 0;
      return {
        rank: (page - 1) * limit + i + 1,
        userId: row._id.toString(),
        displayName: maskName(u.fullName, u.phone),
        tier: tierForStats(row.settled, winRate),
        settled: row.settled,
        won: row.won,
        winRate,
        roi,
        profit: Math.round(row.profit),
        totalStaked: Math.round(row.staked)
      };
    });

    const data: TipsterBoardPage = {
      period,
      page,
      limit,
      total: total[0]?.count ?? 0,
      minSettled,
      items
    };
    this.cache.set(cacheKey, { at: Date.now(), data });
    return data;
  }

  private async resolveUsers(ids: mongoose.Types.ObjectId[]): Promise<Map<string, { fullName: string; phone: string }>> {
    if (!ids.length) return new Map();
    const users = await UserModel.find({ _id: { $in: ids } })
      .select('fullName phone')
      .lean();
    return new Map(users.map(u => [u._id.toString(), { fullName: u.fullName || '', phone: u.phone || '' }]));
  }
}

export const tipsterLeaderboardService = new TipsterLeaderboardService();
