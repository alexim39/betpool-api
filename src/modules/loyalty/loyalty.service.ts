import { StakeModel, IStake } from '../../models/stake.model';
import { WalletModel } from '../../models/wallet.model';
import { TransactionModel } from '../../models/transaction.model';
import { walletService } from '../../services/wallet.service';
import { createInAppNotification } from '../../services/notification.service';
import { LoyaltyProfileModel, LoyaltyTier } from './loyalty.model';

export const LOYALTY_ENABLED = process.env.LOYALTY_ENABLED !== 'disabled';
const CASHBACK_PERCENT = Math.min(20, Math.max(0, parseFloat(process.env.CASHBACK_PERCENT || '2')));
const CASHBACK_LOSS_STREAK = Math.max(1, parseInt(process.env.CASHBACK_LOSS_STREAK || '3', 10));
const CASHBACK_MIN_AMOUNT = 10;

const TIER_THRESHOLDS: Array<{ tier: LoyaltyTier; threshold: number }> = [
  { tier: 'platinum', threshold: 500_000 },
  { tier: 'gold', threshold: 100_000 },
  { tier: 'silver', threshold: 25_000 },
  { tier: 'bronze', threshold: 0 },
];

export interface LoyaltySnapshot {
  tier: LoyaltyTier;
  points: number;
  currentStreak: number;
  lossStreak: number;
  totalStaked: number;
  nextTier: LoyaltyTier | null;
  progressPct: number;
  cashbackTotal: number;
  cashbackPercent: number;
  cashbackLossStreak: number;
}

function sameDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

function dayBefore(a: Date, b: Date): boolean {
  const prev = new Date(b);
  prev.setUTCDate(prev.getUTCDate() - 1);
  return a.toISOString().slice(0, 10) === prev.toISOString().slice(0, 10);
}

export class LoyaltyService {
  private tierFor(totalStaked: number): LoyaltyTier {
    for (const t of TIER_THRESHOLDS) {
      if (totalStaked >= t.threshold) return t.tier;
    }
    return 'bronze';
  }

  async snapshot(userId: string): Promise<LoyaltySnapshot> {
    const balance = await walletService.getBalance(userId);
    const totalStaked = balance?.totalStaked ?? 0;

    const profile = await LoyaltyProfileModel.findOneAndUpdate(
      { user: userId },
      { $setOnInsert: { points: 0 } },
      { upsert: true, new: true }
    ).lean();

    const tier = this.tierFor(totalStaked);
    const idx = TIER_THRESHOLDS.findIndex(t => t.tier === tier);
    const next = idx > 0 ? TIER_THRESHOLDS[idx - 1] : null;
    const prev = idx < TIER_THRESHOLDS.length - 1 ? TIER_THRESHOLDS[idx + 1].threshold : 0;
    const progressPct = next
      ? Math.min(100, Math.round(((totalStaked - prev) / (next.threshold - prev)) * 100))
      : 100;

    return {
      tier,
      points: profile.points,
      currentStreak: profile.currentStreak,
      lossStreak: profile.lossStreak,
      totalStaked,
      nextTier: next ? next.tier : null,
      progressPct,
      cashbackTotal: profile.cashbackTotal,
      cashbackPercent: CASHBACK_PERCENT,
      cashbackLossStreak: CASHBACK_LOSS_STREAK,
    };
  }

  async onStakePlaced(userId: string, stakeAmount: number): Promise<void> {
    if (!LOYALTY_ENABLED) return;
    try {
      const now = new Date();
      let profile = await LoyaltyProfileModel.findOne({ user: userId });
      if (!profile) {
        profile = await LoyaltyProfileModel.create({ user: userId, points: 0 });
      }

      if (profile.lastStakeAt) {
        if (!sameDay(profile.lastStakeAt, now)) {
          profile.currentStreak = dayBefore(profile.lastStakeAt, now) ? profile.currentStreak + 1 : 1;
        }
      } else {
        profile.currentStreak = 1;
      }

      profile.lastStakeAt = now;
      profile.points += Math.max(1, Math.round(stakeAmount / 100));
      const balance = await walletService.getBalance(userId);
      profile.tier = this.tierFor(balance?.totalStaked ?? 0);
      await profile.save();
    } catch (err) {
      console.error('Loyalty onStakePlaced error', err);
    }
  }

  async maybeCreditCashback(stake: IStake): Promise<void> {
    if (!LOYALTY_ENABLED) return;
    try {
      const stakeId = (stake._id as any).toString();
      const exists = await TransactionModel.exists({ reference: `CB_${stakeId}` });
      if (exists) return;

      const userId = (stake.user as any).toString();
      const lossStreak = await this.countLossStreak(userId, stakeId);
      if (lossStreak < CASHBACK_LOSS_STREAK) return;

      const amount = Math.round(stake.stakeAmount * (CASHBACK_PERCENT / 100));
      if (amount < CASHBACK_MIN_AMOUNT) return;

      const wallet = await WalletModel.findOneAndUpdate(
        { user: userId },
        { $inc: { balance: amount }, $set: { lastTransactionAt: new Date() } },
        { new: true }
      );
      if (!wallet) return;

      await TransactionModel.create({
        user: userId,
        wallet: wallet._id,
        type: 'bonus',
        status: 'completed',
        amount,
        fee: 0,
        netAmount: amount,
        balanceBefore: wallet.balance - amount,
        balanceAfter: wallet.balance,
        currency: 'NGN',
        reference: `CB_${stakeId}`,
        provider: 'internal',
        relatedStake: stake._id,
        relatedPod: stake.pod,
        metadata: { description: 'Losing-streak cashback', cashback: true, stakeId },
        processedAt: new Date(),
      });

      await LoyaltyProfileModel.findOneAndUpdate(
        { user: userId },
        { $inc: { cashbackTotal: amount }, $set: { cashbackCreditedAt: new Date() } },
        { upsert: true }
      );

      await createInAppNotification(userId, 'system', 'Cashback credited',
        `You received ₦${amount.toLocaleString()} cashback for your losing streak. It has been added to your wallet.`,
        { cashback: true });
    } catch (err) {
      console.error('Loyalty cashback error', err);
    }
  }

  private async countLossStreak(userId: string, excludeStakeId: string): Promise<number> {
    const recent = await StakeModel.find({ user: userId, settledAt: { $ne: null } })
      .select('status')
      .sort({ settledAt: -1 })
      .limit(15)
      .lean();
    let streak = 0;
    for (const s of recent) {
      const id = (s._id as any).toString();
      if (id === excludeStakeId) continue;
      if (s.status === 'lost') streak += 1;
      else break;
    }
    return streak;
  }
}

export const loyaltyService = new LoyaltyService();
