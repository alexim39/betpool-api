import { aiCurationService } from './ai-curation.service';
import { aiSettlementService } from './ai-settlement.service';
import { aiRiskService } from './ai-risk.service';
import { adminService } from './admin.service';
import { PodModel } from '../models/pod.model';
import { StakeModel } from '../models/stake.model';
import { logger } from './logger.service';

export class AIAutomationService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start(intervalMs = 6 * 60 * 60 * 1000) {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.runCycle(), intervalMs);
    logger.info(`Ora Automation started — cycle every ${intervalMs / 60000} minutes`);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
  }

  async runCycle(): Promise<{
    curation: { recommended: number; created: number };
    settlement: { settled: number; errors: string[] };
  }> {
    if (this.running) {
      return { curation: { recommended: 0, created: 0 }, settlement: { settled: 0, errors: ['Already running'] } };
    }
    this.running = true;

    const result = { curation: { recommended: 0, created: 0 }, settlement: { settled: 0, errors: [] as string[] } };

    try {
      // Step 1: Curate + create pods — DISABLED
      // const adminUser = await this.getSystemAdmin();
      // const activePodCount = await PodModel.countDocuments({ status: 'active' });
      // if (activePodCount >= 15) {
      //   console.log(`[Ora Automation] Curation SKIPPED — ${activePodCount} active pods already (max 15)`);
      //   result.settlement.errors.push(`Pod creation skipped: ${activePodCount} active pods already live (max 15)`);
      // } else {
      //   console.log('[Ora Automation] Starting curation...');
      //   const curation = await aiCurationService.curate();
      //   console.log(`[Ora Automation] Curation: ${curation.recommended} recommended, ${curation.skipped} skipped`);
      //   if (aiRiskService.isCreationFrozen()) {
      //     console.log('[Ora Automation] Pod creation SKIPPED — risk management has frozen new pod creation');
      //     result.settlement.errors.push('Pod creation frozen by risk management — risk ratio too high');
      //   } else if (adminUser && curation.recommended > 0) {
      //     const systemWallet = await import('../models/wallet.model').then(m => m.WalletModel.findOne({}).sort({ balance: -1 }).lean());
      //     const systemFunds = (systemWallet as any)?.balance || 50000000;
      //     const riskFactor = 0.15;
      //     const dynamicMaxExposure = Math.floor(systemFunds / Math.max(activePodCount + 1, 1) * riskFactor);
      //     const getRefundPercent = (multiplier: number): number => {
      //       if (multiplier >= 1.9) return 5;
      //       if (multiplier >= 1.7) return 20;
      //       if (multiplier >= 1.5) return 35;
      //       return 0;
      //     };
      //     for (const f of curation.fixtures) {
      //       if (f.verdict !== 'RECOMMEND' || !f.selection || !f.multiplier) continue;
      //       try {
      //         const matchDate = new Date(f.matchDate);
      //         const stakingClosesAt = new Date(matchDate.getTime() - 24 * 60 * 60 * 1000);
      //         const settlementEstimateAt = new Date(matchDate.getTime() + 24 * 60 * 60 * 1000);
      //         const leg = { homeTeam: f.homeTeam, awayTeam: f.awayTeam, matchDate: f.matchDate, league: f.league };
      //         const payload: any = {
      //           title: `${f.homeTeam} vs ${f.awayTeam}`,
      //           sport: 'Football', league: f.league,
      //           homeTeam: f.homeTeam, awayTeam: f.awayTeam,
      //           matchDate: f.matchDate,
      //           marketType: f.isCombined ? 'Parlay' : '1X2',
      //           selection: f.selection,
      //           marketOdds: f.multiplier,
      //           gainsMultiplier: Math.round(f.multiplier * 0.85 * 100) / 100,
      //           refundPercent: getRefundPercent(Math.round(f.multiplier * 0.85 * 100) / 100),
      //           minStake: 100, maxStake: 100000,
      //           maxTotalExposure: dynamicMaxExposure,
      //           stakingClosesAt, settlementEstimateAt,
      //           settlementEstimateLabel: settlementEstimateAt.toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' }),
      //           status: 'active',
      //           legs: f.isCombined ? [leg, leg] : [leg],
      //           metadata: {
      //             oraCurated: true,
      //             oraConfidence: f.recommendations?.[0]?.confidence || 0,
      //             fixtureId: f.fixtureId,
      //             ...(f.isCombined && f.combinedLegs ? {
      //               combined: true,
      //               legMarkets: f.combinedLegs.map(l => l.marketType),
      //               legSelections: f.combinedLegs.map(l => l.selection),
      //             } : {}),
      //           },
      //         };
      //         await adminService.createPod(payload, adminUser);
      //         result.curation.created++;
      //       } catch (err: any) {
      //         result.settlement.errors.push(`Failed to create pod for ${f.homeTeam} vs ${f.awayTeam}: ${err.message}`);
      //       }
      //     }
      //   }
      //   console.log(`[Ora Automation] Created ${result.curation.created} pods`);
      // }

      // Step 2: Settle finished pods — DISABLED (manual settlement only)
      // logger.info('Ora Automation starting settlement');
      // const settleAdmin = await this.getSystemAdmin();
      // const settleResult = await aiSettlementService.settleAllSettleable(settleAdmin);
      // result.settlement = { settled: settleResult.settled, errors: settleResult.errors };
      // logger.info('Ora Automation settlement complete', { settled: settleResult.settled, errors: settleResult.errors.length });

    } catch (err: any) {
      logger.error('Ora Automation cycle error', err.message);
      result.settlement.errors.push(`Cycle error: ${err.message}`);
    } finally {
      this.running = false;
    }

    return result;
  }

  private async getSystemAdmin(): Promise<string> {
    try {
      const { UserModel } = await import('../models/user.model');
      const admin = await UserModel.findOne({ role: 'admin' }).sort({ createdAt: 1 }).lean();
      return admin?._id?.toString() || '';
    } catch {
      return '';
    }
  }
}

export const aiAutomationService = new AIAutomationService();
