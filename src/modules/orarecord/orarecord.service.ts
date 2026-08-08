import mongoose from 'mongoose';
import crypto from 'crypto';
import { StakeModel } from '../../models/stake.model';
import { TransactionModel } from '../../models/transaction.model';
import { PickOutcomeModel } from '../../models/pick-outcome.model';
import { curationAccuracyService } from '../ai/curation-accuracy.service';

export interface OraLeagueStat {
  league: string;
  played: number;
  won: number;
  winRate: number;
  sample: 'sufficient' | 'low';
}

export interface OraDailyStat {
  day: string;
  played: number;
  won: number;
  lost: number;
  winRate: number;
}

export interface OraRecord {
  byLeague: OraLeagueStat[];
  daily: OraDailyStat[];
  overall: { played: number; won: number; winRate: number } | null;
  settledPots30d: number;
  avgSettlementMs: number | null;
  payouts30d: number;
  avgPayoutMs: number | null;
  payoutRatio30d: number | null;
  sampledAt: string;
  signature: string;
  signatureAlgo: string;
}

const TTL_MS = 60_000;
const MIN_SAMPLE = parseInt(process.env.CURATION_ACCURACY_MIN_SAMPLE || '5', 10);
const MAX_LEAGUES = 20;

export interface OraRecordQuery {
  league?: string;
  limit?: number;
  refresh?: boolean;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export class OraRecordService {
  private cache: { at: number; data: OraRecord } | null = null;

  async getRecord(force = false, query: OraRecordQuery = {}): Promise<OraRecord> {
    const league = String(query.league ?? '').trim().slice(0, 120).toLowerCase();
    const limit = clampInt(query.limit, MAX_LEAGUES, 1, MAX_LEAGUES);
    const now = Date.now();
    const cacheable = !force && !league;
    if (cacheable && this.cache && now - this.cache.at < TTL_MS) return this.cache.data;

    const start = new Date(Date.now() - 30 * 86400000);
    const accuracy = await curationAccuracyService.getStats();

    const [settlementAgg, payoutAgg, dailyAgg] = await Promise.all([
      StakeModel.aggregate([
        { $match: { settledAt: { $gte: start }, status: { $in: ['won', 'lost', 'void'] } } },
        { $group: { _id: null, count: { $sum: 1 }, avgMs: { $avg: { $subtract: ['$settledAt', '$createdAt'] } } } },
      ]),
      TransactionModel.aggregate([
        { $match: { type: 'payout', status: 'completed', completedAt: { $gte: start } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$netAmount' }, avgMs: { $avg: { $subtract: ['$completedAt', '$createdAt'] } } } },
      ]),
      PickOutcomeModel.aggregate([
        { $match: { outcome: { $in: ['won', 'lost'] }, settledAt: { $gte: start } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$settledAt', timezone: 'UTC' } },
            played: { $sum: 1 },
            won: { $sum: { $cond: [{ $eq: ['$outcome', 'won'] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const settlement = settlementAgg[0] || null;
    const payout = payoutAgg[0] || null;
    const totalStaked = settlement?.count ?? 0;

    const byLeague: OraLeagueStat[] = (accuracy?.byLeague || [])
      .filter(l => l.played > 0 && (!league || String(l.key).toLowerCase() === league))
      .map(l => ({
        league: l.key,
        played: l.played,
        won: l.won,
        winRate: l.winRate,
        sample: (l.played >= MIN_SAMPLE ? 'sufficient' : 'low') as 'sufficient' | 'low',
      }))
      .sort((a, b) => b.played - a.played)
      .slice(0, limit);

    const overall = accuracy && accuracy.played > 0
      ? { played: accuracy.played, won: accuracy.won, winRate: accuracy.winRate }
      : null;

    const dailyMap = new Map<string, { played: number; won: number }>(
      dailyAgg.map(r => [r._id, { played: r.played || 0, won: r.won || 0 }]),
    );
    const daily: OraDailyStat[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const row = dailyMap.get(day);
      const played = row?.played ?? 0;
      const won = row?.won ?? 0;
      daily.push({
        day,
        played,
        won,
        lost: played - won,
        winRate: played ? Math.round((won / played) * 100) : 0,
      });
    }

    const record: OraRecord = {
      byLeague,
      daily,
      overall,
      settledPots30d: totalStaked,
      avgSettlementMs: settlement ? Math.round(settlement.avgMs) : null,
      payouts30d: payout ? payout.count : 0,
      avgPayoutMs: payout ? Math.round(payout.avgMs) : null,
      payoutRatio30d: totalStaked > 0 ? Number(((payout?.total ?? 0) / (totalStaked * 1000)).toFixed(4)) : null,
      sampledAt: new Date().toISOString(),
      signature: '',
      signatureAlgo: 'hmac-sha256',
    };

    record.signature = this.sign(record);
    if (cacheable) this.cache = { at: now, data: record };
    return record;
  }

  private sign(record: OraRecord): string {
    const secret = process.env.JWT_SECRET || 'betpool-record-signature';
    const payload = JSON.stringify({
      overall: record.overall,
      byLeague: record.byLeague,
      daily: record.daily,
      settledPots30d: record.settledPots30d,
      avgSettlementMs: record.avgSettlementMs,
      payouts30d: record.payouts30d,
      avgPayoutMs: record.avgPayoutMs,
      sampledAt: record.sampledAt,
    });
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  static toObjectId(id: string): mongoose.Types.ObjectId {
    return new mongoose.Types.ObjectId(id);
  }
}

export const oraRecordService = new OraRecordService();
