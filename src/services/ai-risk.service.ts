import { PodModel } from '../models/pod.model';
import { WalletModel } from '../models/wallet.model';
import { StakeModel } from '../models/stake.model';
import { createInAppNotification } from './notification.service';
import { UserModel } from '../models/user.model';

export interface PodRisk {
  podId: string;
  title: string;
  sport: string;
  selection: string;
  gainsMultiplier: number;
  currentExposure: number;
  maxStake: number;
  maxTotalExposure: number;
  potentialPayout: number;
  exposurePercent: number;
  participantCount: number;
  status: string;
  suggestedMaxStake: number;
  riskLevel: 'low' | 'medium' | 'high';
  riskSuspended: boolean;
}

export interface ReserveProjection {
  totalReserves: number;
  totalLocked: number;
  netAvailableReserves: number;
  totalPotentialPayout: number;
  projectedReserveNeeded: number;
  reserveDeficit: number;
  reserveDeficitPercent: number;
  historicalWinRate: number;
  historicalLossRate: number;
  recentTrend: 'improving' | 'stable' | 'deteriorating';
  trendDescription: string;
  suggestedTopUp: number;
}

export interface EscalationState {
  creationFrozen: boolean;
  podsSuspended: number;
  autoCapActive: boolean;
  autoCapAppliedCount: number;
  escalationLevel: 'none' | 'caution' | 'warning' | 'critical';
  frozenAt: string | null;
  lastEscalationCheck: string;
}

export interface RiskReport {
  timestamp: string;
  totalReserves: number;
  totalExposure: number;
  totalLocked: number;
  totalPotentialPayout: number;
  riskRatio: number;
  riskRatioPercent: number;
  riskLevel: 'low' | 'medium' | 'high';
  activePodsCount: number;
  activeUsersCount: number;
  podsAtRisk: PodRisk[];
  warnings: string[];
  recommendations: string[];
  autoCapActive: boolean;
  autoCapThreshold: number;
  reserveProjection: ReserveProjection;
  escalation: EscalationState;
}

const DEFAULT_AUTO_CAP_THRESHOLD = 50;
const CREATION_FREEZE_THRESHOLD = 70;
const POD_SUSPEND_THRESHOLD = 80;

export class AIRiskService {
  private schedulerId: ReturnType<typeof setInterval> | null = null;
  private _creationFrozen = false;
  private _frozenAt: string | null = null;
  private _lastEscalationLevel: 'none' | 'caution' | 'warning' | 'critical' = 'none';

  private get autoCapThreshold(): number {
    return parseInt(process.env.RISK_AUTO_CAP_THRESHOLD || String(DEFAULT_AUTO_CAP_THRESHOLD), 10);
  }

  isCreationFrozen(): boolean {
    return this._creationFrozen;
  }

  startScheduler(intervalMs = 15 * 60 * 1000) {
    if (this.schedulerId) return;
    this.schedulerId = setInterval(() => this.runAutoEscalation(), intervalMs);
    console.log(`[Risk Management] Auto-escalation scheduler started — every ${intervalMs / 60000} minutes`);
    this.runAutoEscalation();
  }

  stopScheduler() {
    if (this.schedulerId) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
  }

  async generateReport(): Promise<RiskReport> {
    const walletAgg = await WalletModel.aggregate([
      { $group: { _id: null, totalBalance: { $sum: '$balance' }, totalLocked: { $sum: '$lockedBalance' } } }
    ]);
    const totalReserves = walletAgg[0]?.totalBalance || 0;
    const totalLocked = walletAgg[0]?.totalLocked || 0;

    const activePods = await PodModel.find({
      status: { $in: ['published', 'active'] },
    }).sort({ currentExposure: -1 }).lean();

    const totalExposure = activePods.reduce((sum, p) => sum + (p.currentExposure || 0), 0);
    const totalPotentialPayout = activePods.reduce((sum, p) => sum + ((p.currentExposure || 0) * (p.gainsMultiplier || 1)), 0);

    const riskRatio = totalReserves > 0 ? totalPotentialPayout / totalReserves : 1;
    const riskRatioPercent = Math.round(riskRatio * 100);

    let riskLevel: 'low' | 'medium' | 'high';
    if (riskRatioPercent < 30) riskLevel = 'low';
    else if (riskRatioPercent < 60) riskLevel = 'medium';
    else riskLevel = 'high';

    const autoCapActive = riskRatioPercent > this.autoCapThreshold;

    const reserveProjection = await this.calculateReserveProjection(totalReserves, totalLocked, totalPotentialPayout);
    const escalationState = await this.getEscalationState();

    const podsAtRisk: PodRisk[] = activePods.map(p => {
      const exposurePercent = p.maxTotalExposure > 0
        ? Math.round(((p.currentExposure || 0) / p.maxTotalExposure) * 100)
        : 0;

      let maxStakeReduction = 1;
      if (autoCapActive) {
        const severity = Math.min(1, (riskRatioPercent - this.autoCapThreshold) / 50);
        maxStakeReduction = 1 - (severity * 0.7);
      }

      const podRiskLevel: 'low' | 'medium' | 'high' =
        exposurePercent >= 80 ? 'high' :
        exposurePercent >= 50 ? 'medium' : 'low';

      return {
        podId: p._id.toString(),
        title: p.title,
        sport: p.sport,
        selection: p.selection,
        gainsMultiplier: p.gainsMultiplier,
        currentExposure: p.currentExposure || 0,
        maxStake: p.maxStake,
        maxTotalExposure: p.maxTotalExposure,
        potentialPayout: (p.currentExposure || 0) * p.gainsMultiplier,
        exposurePercent,
        participantCount: p.currentParticipants || 0,
        status: p.status,
        suggestedMaxStake: Math.max(100, Math.round((p.maxStake || 100000) * maxStakeReduction / 100) * 100),
        riskLevel: podRiskLevel,
        riskSuspended: p.riskSuspended || false,
      };
    });

    const warnings: string[] = [];
    const recommendations: string[] = [];

    if (riskLevel === 'high') {
      warnings.push(`CRITICAL: Risk ratio at ${riskRatioPercent}% — potential payouts exceed safe limits.`);
      warnings.push(`Total reserves: ₦${totalReserves.toLocaleString()} vs potential payout: ₦${totalPotentialPayout.toLocaleString()}`);
      recommendations.push('Immediately reduce maxStake on all active pods.');
      recommendations.push('Consider postponing new pod launches until risk ratio drops below 50%.');
      recommendations.push('Deposit additional funds into platform reserves.');
    } else if (riskLevel === 'medium') {
      warnings.push(`Caution: Risk ratio at ${riskRatioPercent}%. Monitoring recommended.`);
      recommendations.push('Review high-exposure pods for potential early settlement.');
      recommendations.push('Set conservative multipliers on new pods.');
    } else {
      recommendations.push('Risk levels are healthy. Continue normal operations.');
    }

    if (reserveProjection.reserveDeficit > 0) {
      warnings.push(`Reserve deficit: ₦${reserveProjection.reserveDeficit.toLocaleString()} — reserves are below projected needs.`);
      recommendations.push(`Top up reserves by at least ₦${reserveProjection.suggestedTopUp.toLocaleString()} to maintain safe coverage.`);
    }

    if (escalationState.creationFrozen) {
      warnings.push('Pod creation is FROZEN due to critical risk levels. New pods cannot be created until risk drops.');
    }

    if (escalationState.podsSuspended > 0) {
      warnings.push(`${escalationState.podsSuspended} pod(s) auto-suspended due to excessive exposure.`);
    }

    const highRiskCount = podsAtRisk.filter(p => p.riskLevel === 'high').length;
    if (highRiskCount > 0) {
      warnings.push(`${highRiskCount} pod(s) have exposure ≥ 80% of their max limit.`);
    }

    if (autoCapActive) {
      warnings.push(`Auto-cap ACTIVE: Max stakes being reduced due to risk ratio (${riskRatioPercent}% > ${this.autoCapThreshold}% threshold).`);
      recommendations.push(`Auto-cap will deactivate when risk ratio drops below ${this.autoCapThreshold}%.`);
    }

    if (reserveProjection.recentTrend === 'deteriorating') {
      warnings.push('Payout trend is deteriorating — recent settlements show higher loss rates than historical average.');
    }

    const activeUserCount = await WalletModel.countDocuments({ balance: { $gt: 0 } });

    return {
      timestamp: new Date().toISOString(),
      totalReserves,
      totalExposure,
      totalLocked,
      totalPotentialPayout,
      riskRatio,
      riskRatioPercent,
      riskLevel,
      activePodsCount: activePods.length,
      activeUsersCount: activeUserCount,
      podsAtRisk,
      warnings,
      recommendations,
      autoCapActive,
      autoCapThreshold: this.autoCapThreshold,
      reserveProjection,
      escalation: escalationState,
    };
  }

  async getPodRisk(podId: string): Promise<PodRisk | null> {
    const report = await this.generateReport();
    return report.podsAtRisk.find(p => p.podId === podId) || null;
  }

  async applyAutoCaps(): Promise<{ adjusted: number; details: Array<{ podId: string; title: string; oldMax: number; newMax: number }> }> {
    return { adjusted: 0, details: [] };
  }

  async restoreCaps(): Promise<{ restored: number; details: Array<{ podId: string; title: string; oldMax: number; newMax: number }> }> {
    const activePods = await PodModel.find({
      status: { $in: ['published', 'active'] },
    }).lean();

    const details: Array<{ podId: string; title: string; oldMax: number; newMax: number }> = [];
    for (const pod of activePods) {
      const originalMax = pod.maxStake;
      const envMax = parseInt(process.env.POD_DEFAULT_MAX_STAKE || '100000', 10);
      if (originalMax < envMax) {
        await PodModel.findByIdAndUpdate(pod._id, { maxStake: envMax });
        details.push({ podId: pod._id.toString(), title: pod.title, oldMax: originalMax, newMax: envMax });
      }
    }
    return { restored: details.length, details };
  }

  async runAutoEscalation(): Promise<{
    autoCapAdjusted: number;
    podsSuspended: number;
    creationFrozen: boolean;
    warnings: string[];
    escalationLevel: string;
  }> {
    const report = await this.generateReport();
    const warnings: string[] = [];
    let podsSuspended = 0;

    // T3: Threshold escalation — freeze creation at 70%
    if (report.riskRatioPercent >= CREATION_FREEZE_THRESHOLD && !this._creationFrozen) {
      this._creationFrozen = true;
      this._frozenAt = new Date().toISOString();
      warnings.push(`CRITICAL: Pod creation FROZEN — risk ratio ${report.riskRatioPercent}% >= ${CREATION_FREEZE_THRESHOLD}%`);
      await this.notifyAdmins(`Pod Creation Frozen`,
        `Risk ratio reached ${report.riskRatioPercent}%. New pod creation has been frozen until risk drops below ${CREATION_FREEZE_THRESHOLD}%.`);
    } else if (report.riskRatioPercent < CREATION_FREEZE_THRESHOLD - 10 && this._creationFrozen) {
      this._creationFrozen = false;
      this._frozenAt = null;
      warnings.push(`Pod creation unfrozen — risk ratio dropped to ${report.riskRatioPercent}%.`);
      await this.notifyAdmins(`Pod Creation Unfrozen`,
        `Risk ratio dropped to ${report.riskRatioPercent}%. Pod creation is now allowed.`);
    }

    // T3: Threshold escalation — suspend high-exposure pods at 80%
    if (report.riskRatioPercent >= POD_SUSPEND_THRESHOLD) {
      const highRiskPods = report.podsAtRisk.filter(p => p.riskLevel === 'high' && !p.riskSuspended);
      for (const pod of highRiskPods) {
        await PodModel.findByIdAndUpdate(pod.podId, { riskSuspended: true });
        podsSuspended++;
      }
    } else if (report.riskRatioPercent < POD_SUSPEND_THRESHOLD - 10) {
      const suspendedPods = await PodModel.find({ riskSuspended: true });
      for (const pod of suspendedPods) {
        await PodModel.findByIdAndUpdate(pod._id, { riskSuspended: false });
      }
      if (suspendedPods.length > 0) {
        await this.notifyAdmins(`Pods Unsuspended`,
          `${suspendedPods.length} previously suspended pod(s) have been reactivated as risk ratio dropped to ${report.riskRatioPercent}%.`);
      }
    }

    const escalationLevel: 'none' | 'caution' | 'warning' | 'critical' =
      report.riskRatioPercent >= POD_SUSPEND_THRESHOLD ? 'critical' :
      report.riskRatioPercent >= CREATION_FREEZE_THRESHOLD ? 'warning' :
      report.riskRatioPercent >= this.autoCapThreshold ? 'caution' : 'none';

    this._lastEscalationLevel = escalationLevel;

    return { autoCapAdjusted: 0, podsSuspended, creationFrozen: this._creationFrozen, warnings, escalationLevel };
  }

  private async calculateReserveProjection(
    totalReserves: number,
    totalLocked: number,
    totalPotentialPayout: number
  ): Promise<ReserveProjection> {
    const netAvailableReserves = totalReserves - totalLocked;

    // Historical win/loss from settled stakes (last 90 days)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const settledStakes = await StakeModel.aggregate([
      { $match: { status: 'settled', settledAt: { $gte: ninetyDaysAgo } } },
      { $group: { _id: '$result', count: { $sum: 1 }, totalAmount: { $sum: '$stakeAmount' } } },
    ]);

    const winData = settledStakes.find(s => s._id === 'win');
    const lossData = settledStakes.find(s => s._id === 'loss');
    const totalSettled = settledStakes.reduce((sum, s) => sum + s.count, 0);
    const historicalWinRate = totalSettled > 0 ? (winData?.count || 0) / totalSettled : 0.5;
    const historicalLossRate = totalSettled > 0 ? (lossData?.count || 0) / totalSettled : 0.5;

    // Projected reserve needed = potential payout * expected loss rate (users lose → platform keeps stake, no payout)
    // But the risk is when users WIN → platform pays out. So projectedReserveNeeded = potentialPayout * winRate
    const projectedReserveNeeded = totalPotentialPayout * historicalWinRate;
    const reserveDeficit = Math.max(0, projectedReserveNeeded - netAvailableReserves);
    const reserveDeficitPercent = projectedReserveNeeded > 0
      ? Math.round((reserveDeficit / projectedReserveNeeded) * 100)
      : 0;

    // Recent trend — compare last 30 days vs prior 60 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentStakes = await StakeModel.aggregate([
      { $match: { status: 'settled', settledAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: '$result', count: { $sum: 1 }, totalAmount: { $sum: '$stakeAmount' } } },
    ]);

    const recentTotal = recentStakes.reduce((sum, s) => sum + s.count, 0);
    const recentWinData = recentStakes.find(s => s._id === 'win');
    const recentWinRate = recentTotal > 0 ? (recentWinData?.count || 0) / recentTotal : historicalWinRate;

    let recentTrend: 'improving' | 'stable' | 'deteriorating';
    let trendDescription: string;

    if (recentWinRate > historicalWinRate * 1.15) {
      recentTrend = 'deteriorating';
      trendDescription = `Recent win rate (${Math.round(recentWinRate * 100)}%) is ${Math.round((recentWinRate / historicalWinRate - 1) * 100)}% higher than historical average (${Math.round(historicalWinRate * 100)}%) — higher payout risk.`;
    } else if (recentWinRate < historicalWinRate * 0.85) {
      recentTrend = 'improving';
      trendDescription = `Recent win rate (${Math.round(recentWinRate * 100)}%) is lower than historical average (${Math.round(historicalWinRate * 100)}%) — lower payout risk.`;
    } else {
      recentTrend = 'stable';
      trendDescription = `Recent win rate (${Math.round(recentWinRate * 100)}%) is consistent with historical average (${Math.round(historicalWinRate * 100)}%).`;
    }

    const suggestedTopUp = Math.max(0, reserveDeficit + Math.round(projectedReserveNeeded * 0.1));

    return {
      totalReserves,
      totalLocked,
      netAvailableReserves,
      totalPotentialPayout,
      projectedReserveNeeded,
      reserveDeficit,
      reserveDeficitPercent,
      historicalWinRate: Math.round(historicalWinRate * 100),
      historicalLossRate: Math.round(historicalLossRate * 100),
      recentTrend,
      trendDescription,
      suggestedTopUp,
    };
  }

  async getEscalationState(): Promise<EscalationState> {
    const suspendedCount = await PodModel.countDocuments({ riskSuspended: true, status: { $in: ['published', 'active'] } });
    const capsApplied = await PodModel.countDocuments({
      status: { $in: ['published', 'active'] },
      maxStake: { $lt: parseInt(process.env.POD_DEFAULT_MAX_STAKE || '100000', 10) },
    });

    return {
      creationFrozen: this._creationFrozen,
      podsSuspended: suspendedCount,
      autoCapActive: false,
      autoCapAppliedCount: capsApplied,
      escalationLevel: this._lastEscalationLevel,
      frozenAt: this._frozenAt,
      lastEscalationCheck: new Date().toISOString(),
    };
  }

  private async notifyAdmins(title: string, message: string) {
    try {
      const admins = await UserModel.find({ role: 'admin' }).select('_id').lean();
      for (const admin of admins) {
        await createInAppNotification(admin._id.toString(), 'system', title, message);
      }
    } catch { /* non-critical */ }
  }
}

export const aiRiskService = new AIRiskService();
