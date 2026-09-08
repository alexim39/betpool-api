import mongoose from 'mongoose';
import { StakeModel } from '../../models/stake.model';
import { WalletModel } from '../../models/wallet.model';
import { TransactionModel } from '../../models/transaction.model';
import { CreatorCommissionModel } from '../../models/creator-commission.model';
import { tipsterBadgeService, commissionPctForTier } from './tipster-badge.service';
import { createInAppNotification } from '../../services/notification.service';
import { runTransaction } from '../../utils/transaction';
import { logger } from '../../services/logger.service';

const BATCH = 500;

export function minPayout(): number {
  const v = parseInt(process.env.CREATOR_MIN_PAYOUT || '100', 10);
  return Number.isFinite(v) && v > 0 ? v : 100;
}

export interface CommissionRunResult {
  processed: number;
  creatorsPaid: number;
  paidOut: number;
  errors: string[];
}

/**
 * Creator revenue share (Phase 2 money). Rules, all locked:
 * - Computed at SETTLEMENT on WINS ONLY. Losses/voids/refunds pay nothing,
 *   so there is never anything to claw back (no cashouts, no disputes).
 * - Base is the stake's recorded `platformFee` (realized revenue).
 * - Rate is the creator's CURRENT badge tier at payout time
 *   (Rising 10 / Pro 15 / Legend 20, Rookie 0) — past wins count once a
 *   creator qualifies.
 * - One ledger row per winning copied stake (`stakeId` unique: re-runs and
 *   double-settlements can never double-pay).
 * - Wallet credit happens only when a creator's pending total reaches the
 *   payout threshold, at most once per creator per day (unique payout
 *   reference doubles as the concurrency guard inside the transaction).
 */
class CommissionService {
  /** Records ledger rows for newly-won copied stakes lacking them. */
  async recordNewWins(limit = BATCH): Promise<number> {
    const candidates = await StakeModel.aggregate<{ _id: mongoose.Types.ObjectId }>([
      { $match: { creatorId: { $exists: true, $ne: null }, status: 'won' } },
      {
        $lookup: {
          from: 'creatorcommissions',
          localField: '_id',
          foreignField: 'stakeId',
          as: 'commission'
        }
      },
      { $match: { 'commission.0': { $exists: false } } },
      { $sort: { settledAt: 1 } },
      { $limit: Math.max(1, Math.min(limit, BATCH)) }
    ]);
    if (candidates.length === 0) return 0;

    const stakes = await StakeModel.find({ _id: { $in: candidates.map(c => c._id) } })
      .select('_id user creatorId bookingCode stakeAmount platformFee settledAt')
      .lean();
    if (stakes.length === 0) return 0;

    const creatorIds = [...new Set(stakes.map(s => String((s as any).creatorId)).filter(Boolean))];
    const badges = await tipsterBadgeService.getBadges(creatorIds);

    const ops = stakes.map(s => {
      const creatorId = String((s as any).creatorId);
      const badge = badges.get(creatorId);
      const tier = badge && badge.tier !== 'Rookie' ? badge.tier : 'Rookie';
      const ratePct = commissionPctForTier(tier);
      const platformFee = Number((s as any).platformFee) || 0;
      return {
        updateOne: {
          filter: { stakeId: (s as any)._id },
          update: {
            $setOnInsert: {
              creatorId: (s as any).creatorId,
              stakeId: (s as any)._id,
              bookingCode: (s as any).bookingCode || undefined,
              tier,
              ratePct,
              stakeAmount: Number((s as any).stakeAmount) || 0,
              platformFee,
              amount: Math.floor(platformFee * (ratePct / 100)),
              status: 'pending' as const
            }
          },
          upsert: true
        }
      };
    });
    try {
      await CreatorCommissionModel.bulkWrite(ops, { ordered: false });
    } catch (err: any) {
      // Duplicate stakeId rows from a concurrent run are expected — ignore.
      if (err?.code !== 11000) throw err;
    }
    return stakes.length;
  }

  /** Pays every creator whose pending total reached the threshold. */
  async payOut(): Promise<{ creatorsPaid: number; paidOut: number; errors: string[] }> {
    const threshold = minPayout();
    const totals = await CreatorCommissionModel.aggregate<{ _id: mongoose.Types.ObjectId; total: number }>([
      { $match: { status: 'pending', amount: { $gt: 0 } } },
      { $group: { _id: '$creatorId', total: { $sum: '$amount' } } },
      { $match: { total: { $gte: threshold } } }
    ]);
    let creatorsPaid = 0;
    let paidOut = 0;
    const errors: string[] = [];
    for (const row of totals) {
      try {
        const paid = await this.payCreator(String(row._id));
        if (paid > 0) {
          creatorsPaid++;
          paidOut += paid;
        }
      } catch (err: any) {
        // Duplicate payoutRef (concurrent run already paid today) is benign.
        if (err?.code === 11000) continue;
        errors.push(`Creator ${row._id}: ${err.message || err}`);
      }
    }
    return { creatorsPaid, paidOut, errors };
  }

  private async payCreator(creatorId: string): Promise<number> {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const payoutRef = `COM_${creatorId.slice(-6).toUpperCase()}_${day}`;
    return runTransaction(async (session) => {
      const pending = await CreatorCommissionModel.find({
        creatorId: new mongoose.Types.ObjectId(creatorId),
        status: 'pending'
      }).session(session);
      if (pending.length === 0) return 0;

      // Re-rate at the CURRENT tier: wins from before qualification count.
      const badge = await tipsterBadgeService.getBadge(creatorId);
      const ratePct = commissionPctForTier(badge.tier);
      if (ratePct <= 0) return 0;
      let total = 0;
      const rated: Array<{ id: unknown; amount: number }> = [];
      for (const row of pending as any[]) {
        const amount = Math.floor((Number(row.platformFee) || 0) * (ratePct / 100));
        if (amount <= 0) continue;
        total += amount;
        rated.push({ id: row._id, amount });
      }
      if (total < minPayout()) return 0;

      const wallet = await WalletModel.findOneAndUpdate(
        { user: new mongoose.Types.ObjectId(creatorId) },
        { $inc: { balance: total }, $set: { lastTransactionAt: new Date() } },
        { new: true, session }
      );
      if (!wallet) throw new Error('Creator wallet not found');

      await TransactionModel.create([{
        user: new mongoose.Types.ObjectId(creatorId),
        wallet: wallet._id,
        type: 'commission',
        status: 'completed',
        amount: total,
        fee: 0,
        netAmount: total,
        balanceBefore: wallet.balance - total,
        balanceAfter: wallet.balance,
        currency: 'NGN',
        reference: payoutRef,
        provider: 'internal',
        metadata: {
          description: `Creator commission (${badge.tier} ${ratePct}%) — ${rated.length} winning copie(s)`,
          tier: badge.tier,
          ratePct,
          stakeCount: rated.length
        },
        processedAt: new Date()
      }], { session });

      // One bulk write: per-row re-rated amounts + paid flip together. The
      // status guard means a concurrent run matches zero rows instead of
      // double-paying (backed by the unique payout reference on the txn).
      const paidAt = new Date();
      await CreatorCommissionModel.bulkWrite(
        rated.map(r => ({
          updateOne: {
            filter: { _id: r.id, status: 'pending' },
            update: { $set: { amount: r.amount, status: 'paid' as const, tier: badge.tier, ratePct, payoutRef, paidAt } }
          }
        })),
        { ordered: false, session } as any
      );

      createInAppNotification(
        creatorId,
        'system',
        'Commission paid',
        `You earned ₦${total.toLocaleString()} copy commission (${badge.tier} ${ratePct}%) across ${rated.length} winning copie(s). It has been added to your wallet.`,
        { commission: true, amount: total }
      ).catch(e => logger.error('Commission notification error', e));

      return total;
    });
  }

  async runCycle(): Promise<CommissionRunResult> {
    const result: CommissionRunResult = { processed: 0, creatorsPaid: 0, paidOut: 0, errors: [] };
    try {
      result.processed = await this.recordNewWins();
    } catch (err: any) {
      result.errors.push(`record: ${err.message || err}`);
      return result;
    }
    try {
      const payout = await this.payOut();
      result.creatorsPaid = payout.creatorsPaid;
      result.paidOut = payout.paidOut;
      result.errors.push(...payout.errors);
    } catch (err: any) {
      result.errors.push(`payout: ${err.message || err}`);
    }
    logger.info(`[Creator Commission] recorded=${result.processed} creatorsPaid=${result.creatorsPaid} paidOut=₦${result.paidOut}`);
    return result;
  }
}

export const commissionService = new CommissionService();
