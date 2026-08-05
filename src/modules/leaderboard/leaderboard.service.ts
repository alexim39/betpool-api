import mongoose from 'mongoose';
import { StakeModel } from '../../models/stake.model';
import { PodModel } from '../../models/pod.model';
import { UserModel } from '../../models/user.model';

export type LeaderboardPeriod = 'week' | 'month' | 'all';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  totalStaked: number;
  stakeCount: number;
  totalWon: number;
  lastWinAt: string | null;
}

export interface LeaderboardPage {
  period: LeaderboardPeriod;
  page: number;
  limit: number;
  total: number;
  items: LeaderboardEntry[];
}

const MAX_PAGE = 10000;
const TTL_MS = 60_000;

function periodStart(period: LeaderboardPeriod): Date | null {
  if (period === 'week') return new Date(Date.now() - 7 * 86400000);
  if (period === 'month') return new Date(Date.now() - 30 * 86400000);
  return null;
}

function maskName(fullName: string, phone: string): string {
  const name = (fullName || '').trim();
  if (name.length >= 3) {
    return name.slice(0, 1) + '***' + name.slice(-1);
  }
  if (phone && phone.length >= 6) {
    return phone.slice(0, 3) + '***' + phone.slice(-2);
  }
  return 'Ora User';
}

export class LeaderboardService {
  private cache = new Map<string, { at: number; data: LeaderboardPage | LeaderboardEntry | null }>();

  async getLeaderboard(
    userId: string,
    period: LeaderboardPeriod = 'month',
    page = 1,
    limit = 25
  ): Promise<LeaderboardPage> {
    page = Math.max(1, Math.min(MAX_PAGE, page));
    limit = Math.max(5, Math.min(100, limit));
    const cacheKey = `board:${period}:${page}:${limit}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.data as LeaderboardPage;

    const start = periodStart(period);
    const match: Record<string, any> = { status: { $in: ['won', 'lost', 'void'] } };
    if (start) match.createdAt = { $gte: start };

    const [rows, total] = await Promise.all([
      StakeModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$user',
            totalStaked: { $sum: '$stakeAmount' },
            stakeCount: { $sum: 1 },
            totalWon: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, '$netPayout', 0] } },
            lastWinAt: { $max: { $cond: [{ $eq: ['$status', 'won'] }, '$settledAt', null] } },
          },
        },
        { $sort: { totalStaked: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ]),
      StakeModel.aggregate([{ $match: match }, { $group: { _id: null, count: { $sum: 1 } } }]),
    ]);

    const userMap = await this.resolveUsers(rows.map(r => r._id));

    const items: LeaderboardEntry[] = rows.map((row, i) => {
      const u = userMap.get(row._id.toString()) || { fullName: '', phone: '' };
      return {
        rank: (page - 1) * limit + i + 1,
        userId: row._id.toString(),
        displayName: maskName(u.fullName, u.phone),
        totalStaked: Math.round(row.totalStaked),
        stakeCount: row.stakeCount,
        totalWon: Math.round(row.totalWon),
        lastWinAt: row.lastWinAt ? new Date(row.lastWinAt).toISOString() : null,
      };
    });

    const me = items.find(i => i.userId === userId) || (await this.myRank(userId, period));
    const data: LeaderboardPage = {
      period,
      page,
      limit,
      total: (total[0]?.count ?? 0) / 1,
      items,
    };
    if (me) {
      data.items = [me, ...data.items.filter(i => i.userId !== userId)];
      if (data.items.length > limit) data.items.pop();
    }
    this.cache.set(cacheKey, { at: Date.now(), data });
    return data;
  }

  async myRank(userId: string, period: LeaderboardPeriod = 'month'): Promise<LeaderboardEntry | null> {
    const start = periodStart(period);
    const match: Record<string, any> = { status: { $in: ['won', 'lost', 'void'] } };
    if (start) match.createdAt = { $gte: start };

    const rows = await StakeModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$user',
          totalStaked: { $sum: '$stakeAmount' },
          stakeCount: { $sum: 1 },
          totalWon: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, '$netPayout', 0] } },
          lastWinAt: { $max: { $cond: [{ $eq: ['$status', 'won'] }, '$settledAt', null] } },
        },
      },
      { $sort: { totalStaked: -1 } },
    ]);

    const idx = rows.findIndex(r => r._id.toString() === userId);
    if (idx === -1) return null;
    const row = rows[idx];
    const u = (await this.resolveUsers([row._id])).get(userId);
    return {
      rank: idx + 1,
      userId,
      displayName: maskName(u?.fullName || '', u?.phone || ''),
      totalStaked: Math.round(row.totalStaked),
      stakeCount: row.stakeCount,
      totalWon: Math.round(row.totalWon),
      lastWinAt: row.lastWinAt ? new Date(row.lastWinAt).toISOString() : null,
    };
  }

  async lastWin(userId: string): Promise<{
    podTitle: string;
    netPayout: number;
    multiplier: number;
    settledAt: string;
  } | null> {
    const stake = await StakeModel.findOne({ user: userId, status: 'won', settledAt: { $ne: null } })
      .sort({ settledAt: -1 })
      .select('netPayout settledOdds pod settledAt')
      .lean();
    if (!stake) return null;

    let podTitle = 'Stake';
    if (stake.pod) {
      const pod = await PodModel.findById(stake.pod).select('title').lean();
      if (pod?.title) podTitle = pod.title;
    }

    return {
      podTitle,
      netPayout: Math.round(stake.netPayout),
      multiplier: stake.settledOdds || 0,
      settledAt: new Date(stake.settledAt).toISOString(),
    };
  }

  private async resolveUsers(ids: mongoose.Types.ObjectId[]): Promise<Map<string, { fullName: string; phone: string }>> {
    if (!ids.length) return new Map();
    const users = await UserModel.find({ _id: { $in: ids } })
      .select('fullName phone')
      .lean();
    return new Map(users.map(u => [u._id.toString(), { fullName: u.fullName || '', phone: u.phone || '' }]));
  }
}

export const leaderboardService = new LeaderboardService();
