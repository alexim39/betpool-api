import mongoose from 'mongoose';
import crypto from 'crypto';
import { StakeModel } from '../../models/stake.model';
import { TransactionModel } from '../../models/transaction.model';
import { curationAccuracyService } from '../ai/curation-accuracy.service';

export interface OraLeagueStat {
  league: string;
  played: number;
  won: number;
  winRate: number;
  sample: 'sufficient' | 'low';
}

export interface OraRecord {
  byLeague: OraLeagueStat[];
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

export class OraRecordService {
  private cache: { at: number; data: OraRecord } | null = null;

  async getRecord(force = false): Promise<OraRecord> {
    const now = Date.now();
    if (!force && this.cache && now - this.cache.at < TTL_MS) return this.cache.data;

    const start = new Date(Date.now() - 30 * 86400000);
    const accuracy = await curationAccuracyService.getStats();

    const [settlementAgg, payoutAgg] = await Promise.all([
      StakeModel.aggregate([
        { $match: { settledAt: { $gte: start }, status: { $in: ['won', 'lost', 'void'] } } },
        { $group: { _id: null, count: { $sum: 1 }, avgMs: { $avg: { $subtract: ['$settledAt', '$createdAt'] } } } },
      ]),
      TransactionModel.aggregate([
        { $match: { type: 'payout', status: 'completed', completedAt: { $gte: start } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$netAmount' }, avgMs: { $avg: { $subtract: ['$completedAt', '$createdAt'] } } } },
      ]),
    ]);

    const settlement = settlementAgg[0] || null;
    const payout = payoutAgg[0] || null;
    const totalStaked = settlement?.count ?? 0;

    const byLeague: OraLeagueStat[] = (accuracy?.byLeague || [])
      .filter(l => l.played > 0)
      .map(l => ({
        league: l.key,
        played: l.played,
        won: l.won,
        winRate: l.winRate,
        sample: (l.played >= MIN_SAMPLE ? 'sufficient' : 'low') as 'sufficient' | 'low',
      }))
      .sort((a, b) => b.played - a.played)
      .slice(0, 20);

    const overall = accuracy && accuracy.played > 0
      ? { played: accuracy.played, won: accuracy.won, winRate: accuracy.winRate }
      : null;

    const record: OraRecord = {
      byLeague,
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
    this.cache = { at: now, data: record };
    return record;
  }

  private sign(record: OraRecord): string {
    const secret = process.env.JWT_SECRET || 'betpool-record-signature';
    const payload = JSON.stringify({
      overall: record.overall,
      byLeague: record.byLeague,
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
