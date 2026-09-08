import mongoose from 'mongoose';
import { StakeModel } from '../../models/stake.model';
import { TipsterBadgeModel, TipsterBadgeTier } from '../../models/tipster-badge.model';
import { logger } from '../../services/logger.service';

/**
 * Locked commission schedule: % of each REALIZED win-fee paid to the copying
 * creator (Phase 2 money reads this map). Rookie is below the sample floors
 * and earns 0. Rates change only by deliberate config change with a changelog
 * entry — never ad hoc. Prospective application only.
 */
export const TIPSTER_COMMISSION_PCT: Record<Exclude<TipsterBadgeTier, 'Rookie'>, number> = {
  Rising: 10,
  Pro: 15,
  Legend: 20,
};

export function commissionPctForTier(tier: string): number {
  return (TIPSTER_COMMISSION_PCT as Record<string, number>)[tier] ?? 0;
}

// Sample floors — a badge must be earned on settled copies, never on vibes.
const RISING_MIN_SETTLED = 20;
const PRO_MIN_SETTLED = 100;
const PRO_MIN_WIN_RATE = 50;
const LEGEND_MIN_SETTLED = 500;
const LEGEND_MIN_WIN_RATE = 52;

export function tierForStats(settled: number, winRate: number): TipsterBadgeTier {
  if (settled >= LEGEND_MIN_SETTLED && winRate >= LEGEND_MIN_WIN_RATE) return 'Legend';
  if (settled >= PRO_MIN_SETTLED && winRate >= PRO_MIN_WIN_RATE) return 'Pro';
  if (settled >= RISING_MIN_SETTLED) return 'Rising';
  return 'Rookie';
}

export interface TipsterBadgeView {
  tier: TipsterBadgeTier;
  settled: number;
  won: number;
  winRate: number;
  roi: number;
  computedAt: string | null;
}

export const ROOKIE_BADGE: TipsterBadgeView = {
  tier: 'Rookie',
  settled: 0,
  won: 0,
  winRate: 0,
  roi: 0,
  computedAt: null,
};

interface CreatorRow {
  _id: mongoose.Types.ObjectId;
  settled: number;
  won: number;
  staked: number;
  profit: number;
}

/**
 * Settled-data tipster badges. Source of truth is copied stakes only
 * (`stake.creatorId`, written at placement in W1): a creator's badge reflects
 * what happened when followers staked their codes — won/lost only, voids and
 * refunds excluded from both sample and win rate.
 */
class TipsterBadgeService {
  private async aggregateCreators(userId?: string): Promise<CreatorRow[]> {
    return StakeModel.aggregate<CreatorRow>([
      {
        $match: {
          creatorId: userId
            ? new mongoose.Types.ObjectId(userId)
            : { $exists: true, $ne: null },
          status: { $in: ['won', 'lost'] }
        }
      },
      {
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
          }
        }
      }
    ]);
  }

  private toView(row: CreatorRow | undefined, computedAt: Date | null): TipsterBadgeView {
    if (!row || row.settled === 0) return { ...ROOKIE_BADGE };
    const winRate = Math.round((row.won / row.settled) * 1000) / 10;
    const roi = row.staked > 0 ? Math.round((row.profit / row.staked) * 1000) / 10 : 0;
    return {
      tier: tierForStats(row.settled, winRate),
      settled: row.settled,
      won: row.won,
      winRate,
      roi,
      computedAt: computedAt ? computedAt.toISOString() : new Date().toISOString()
    };
  }

  async computeForUser(userId: string): Promise<TipsterBadgeView> {
    const rows = await this.aggregateCreators(userId);
    const view = this.toView(rows[0], null);
    await TipsterBadgeModel.findOneAndUpdate(
      { user: new mongoose.Types.ObjectId(userId) },
      {
        $set: {
          tier: view.tier,
          settled: view.settled,
          won: view.won,
          winRate: view.winRate,
          roi: view.roi,
          computedAt: new Date()
        }
      },
      { upsert: true, new: true }
    );
    return view;
  }

  /** Recomputes every attributed creator in one aggregation + bulk upsert. Idempotent — safe to re-run. */
  async computeAll(): Promise<{ computed: number }> {
    const rows = await this.aggregateCreators();
    if (rows.length === 0) return { computed: 0 };
    const now = new Date();
    const ops = rows.map(r => {
      const view = this.toView(r, now);
      return {
        updateOne: {
          filter: { user: r._id },
          update: {
            $set: {
              tier: view.tier,
              settled: view.settled,
              won: view.won,
              winRate: view.winRate,
              roi: view.roi,
              computedAt: now
            }
          },
          upsert: true
        }
      };
    });
    const BATCH = 500;
    for (let i = 0; i < ops.length; i += BATCH) {
      await TipsterBadgeModel.bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
    }
    return { computed: rows.length };
  }

  async getBadge(userId: string): Promise<TipsterBadgeView> {
    try {
      if (!userId || !mongoose.isValidObjectId(userId)) return { ...ROOKIE_BADGE };
      const doc = await TipsterBadgeModel.findOne({ user: new mongoose.Types.ObjectId(userId) }).lean();
      if (!doc) return { ...ROOKIE_BADGE };
      return {
        tier: doc.tier,
        settled: doc.settled,
        won: doc.won,
        winRate: doc.winRate,
        roi: doc.roi,
        computedAt: doc.computedAt ? new Date(doc.computedAt).toISOString() : null
      };
    } catch (err) {
      logger.error('Tipster getBadge failed', err);
      return { ...ROOKIE_BADGE };
    }
  }

  /** Batched read for feed/profile lists — one query, Rookie default for missing. */
  async getBadges(userIds: string[]): Promise<Map<string, TipsterBadgeView>> {
    const ids = [...new Set((userIds || []).filter(id => id && mongoose.isValidObjectId(id)))];
    const out = new Map<string, TipsterBadgeView>(ids.map(id => [String(id), { ...ROOKIE_BADGE }]));
    if (ids.length === 0) return out;
    try {
      const docs = await TipsterBadgeModel.find({
        user: { $in: ids.map(id => new mongoose.Types.ObjectId(id)) }
      }).lean();
      for (const d of docs as any[]) {
        out.set(String(d.user), {
          tier: d.tier,
          settled: d.settled,
          won: d.won,
          winRate: d.winRate,
          roi: d.roi,
          computedAt: d.computedAt ? new Date(d.computedAt).toISOString() : null
        });
      }
    } catch (err) {
      logger.error('Tipster getBadges failed', err);
    }
    return out;
  }
}

export const tipsterBadgeService = new TipsterBadgeService();
