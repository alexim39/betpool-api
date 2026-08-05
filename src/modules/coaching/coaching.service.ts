import { StakeModel } from '../../models/stake.model';
import { walletService } from '../../services/wallet.service';
import { createInAppNotification } from '../../services/notification.service';
import Notification from '../../models/notification.model';

export type RiskLevel = 'ok' | 'caution' | 'high';

export interface CoachingInsights {
  bankroll: number;
  staked24h: number;
  stakes24h: number;
  lossStreak: number;
  winRate30d: number | null;
  riskLevel: RiskLevel;
  nudges: string[];
  tip: string;
}

const COACHING_ENABLED = process.env.COACHING_ENABLED !== 'disabled';
const RISK_NOTIFY_COOLDOWN_MS = 24 * 3600 * 1000;

export class CoachingService {
  async insights(userId: string): Promise<CoachingInsights> {
    const balance = await walletService.getBalance(userId);
    const bankroll = balance?.available ?? balance?.balance ?? 0;

    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const dayAgg = await StakeModel.aggregate([
      { $match: { user: userId, createdAt: { $gte: since } } },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$stakeAmount' } } },
    ]);

    const staked24h = dayAgg[0]?.total ?? 0;
    const stakes24h = dayAgg[0]?.count ?? 0;

    const lossStreak = await this.countLossStreak(userId);
    const recent = await StakeModel.find({ user: userId, settledAt: { $ne: null } })
      .select('status')
      .sort({ settledAt: -1 })
      .limit(30)
      .lean();
    const settled = recent.filter(s => s.status === 'won' || s.status === 'lost');
    const wins = settled.filter(s => s.status === 'won').length;
    const winRate30d = settled.length > 0 ? Math.round((wins / settled.length) * 100) : null;

    const riskLevel: RiskLevel = this.riskLevel(bankroll, staked24h, stakes24h, lossStreak);
    const nudges = this.nudgesFor(riskLevel, bankroll, staked24h, stakes24h, lossStreak, winRate30d);

    return {
      bankroll: Math.round(bankroll),
      staked24h: Math.round(staked24h),
      stakes24h,
      lossStreak,
      winRate30d,
      riskLevel,
      nudges,
      tip: this.tipFor(bankroll),
    };
  }

  async flagIfHighRisk(userId: string): Promise<void> {
    if (!COACHING_ENABLED) return;
    try {
      const i = await this.insights(userId);
      if (i.riskLevel !== 'high') return;

      const recent = await Notification.findOne({
        user: userId,
        type: 'system',
        'data.coaching': true,
        createdAt: { $gte: new Date(Date.now() - RISK_NOTIFY_COOLDOWN_MS) },
      })
        .select('_id')
        .lean();
      if (recent) return;

      await createInAppNotification(userId, 'system', 'A quick check from Ora',
        'I noticed your recent staking pace is getting aggressive. Consider pausing and reviewing your bankroll plan in the Coaching tab.',
        { coaching: true });
    } catch (err) {
      console.error('Coaching flag error', err);
    }
  }

  private riskLevel(bankroll: number, staked24h: number, stakes24h: number, lossStreak: number): RiskLevel {
    const ratio = bankroll > 0 ? staked24h / bankroll : staked24h > 0 ? 1 : 0;
    if (ratio >= 0.5 || stakes24h >= 5 || lossStreak >= 3) return 'high';
    if (ratio >= 0.3 || stakes24h >= 3 || lossStreak >= 2) return 'caution';
    return 'ok';
  }

  private nudgesFor(
    level: RiskLevel,
    bankroll: number,
    staked24h: number,
    stakes24h: number,
    lossStreak: number,
    winRate30d: number | null
  ): string[] {
    const nudges: string[] = [];
    const ratio = bankroll > 0 ? Math.round((staked24h / bankroll) * 100) : 0;

    if (level === 'high') {
      nudges.push(`You staked ${ratio}% of your bankroll in the last 24h — that is aggressive. Take a pause before the next stake.`);
      if (stakes24h >= 5) nudges.push(`${stakes24h} stakes in 24h is a lot. Slow down to one or two quality picks per day.`);
      if (lossStreak >= 3) nudges.push(`You are on a ${lossStreak} losing streak. The next stake should be your minimum size or none at all.`);
    } else if (level === 'caution') {
      nudges.push(`You have staked ${ratio}% of your bankroll in 24h. Consider keeping single stakes under 10% of bankroll.`);
      if (lossStreak >= 2) nudges.push(`You are on a ${lossStreak} losing streak. Reassess the pick before chasing.`);
    } else {
      nudges.push('Good pace. Keep stakes under 10% of bankroll and you stay in control.');
    }

    if (winRate30d !== null && winRate30d < 40) {
      nudges.push(`Your 30-day win rate is ${winRate30d}%. Favor higher-confidence Ora picks until it recovers.`);
    }
    return nudges;
  }

  private tipFor(bankroll: number): string {
    const unit = Math.max(100, Math.round(bankroll * 0.05));
    return `Try keeping a single stake at or below ₦${unit.toLocaleString()} (about 5% of your bankroll).`;
  }

  private async countLossStreak(userId: string): Promise<number> {
    const recent = await StakeModel.find({ user: userId, settledAt: { $ne: null } })
      .select('status')
      .sort({ settledAt: -1 })
      .limit(15)
      .lean();
    let streak = 0;
    for (const s of recent) {
      if (s.status === 'lost') streak += 1;
      else break;
    }
    return streak;
  }
}

export const coachingService = new CoachingService();
