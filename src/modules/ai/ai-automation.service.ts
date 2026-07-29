import { aiCurationService } from './ai-curation.service';
import { aiSettlementService } from './ai-settlement.service';
import { aiRiskService } from './ai-risk.service';
import { adminService } from '../admin/admin.service';
import { PodModel } from '../../models/pod.model';
import { logger } from '../../services/logger.service';
import { betManagerService } from '../bet-manager/bet-manager.service';

export class AIAutomationService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private startedAt: Date | null = null;
  private lastRunAt: Date | null = null;
  private lastResult: { curation: { recommended: number; created: number }; settlement: { settled: number; errors: string[] } } | null = null;

  start(intervalMs = 6 * 60 * 60 * 1000) {
    if (this.intervalId) return;
    this.startedAt = new Date();
    this.lastRunAt = null;
    this.lastResult = null;
    this.intervalId = setInterval(() => this.runCycle(), intervalMs);
    logger.info(`Ora Automation started — cycle every ${intervalMs / 60000} minutes`);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    this.startedAt = null;
  }

  getStatus() {
    return {
      enabled: this.intervalId !== null,
      running: this.running,
      startedAt: this.startedAt,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
      intervalMs: this.intervalId ? 2 * 60 * 60 * 1000 : null,
    };
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
      // Step 1: Curate + create + publish pods
      const adminUser = await this.getSystemAdmin();
      const activePodCount = await PodModel.countDocuments({ status: 'active' });
      const maxActivePods = parseInt(process.env.MAX_ACTIVE_PODS || '300', 10);
      if (activePodCount >= maxActivePods) {
        logger.info(`[Ora Automation] Curation SKIPPED — ${activePodCount} active pods already (max ${maxActivePods})`);
        result.settlement.errors.push(`Pod creation skipped: ${activePodCount} active pods already live (max ${maxActivePods})`);
      } else if (!adminUser) {
        logger.warn('[Ora Automation] Curation SKIPPED — no admin user found');
        result.settlement.errors.push('Pod creation skipped: no admin user found');
      } else {
        logger.info('[Ora Automation] Starting curation...');
        const curation = await aiCurationService.curate();
        logger.info(`[Ora Automation] Curation: ${curation.recommended} recommended, ${curation.skipped} skipped of ${curation.total}`);

        if (aiRiskService.isCreationFrozen()) {
          logger.info('[Ora Automation] Pod creation SKIPPED — risk management has frozen new pod creation');
          result.settlement.errors.push('Pod creation frozen by risk management — risk ratio too high');
        } else if (curation.recommended > 0) {
          for (const fixture of curation.fixtures) {
            if (fixture.verdict !== 'RECOMMEND') continue;

            const bestPick = fixture.recommendations.reduce(
              (best, r) => (r.confidence > (best?.confidence || 0) ? r : best),
              fixture.recommendations[0]
            );
            if (!bestPick) continue;

            try {
              const matchDate = new Date(fixture.matchDate);
              const stakingClosesAt = new Date(matchDate.getTime() - 24 * 60 * 60 * 1000);
              const settlementEstimateAt = new Date(matchDate.getTime() + 24 * 60 * 60 * 1000);

              await adminService.createPod({
                title: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
                sport: 'football',
                league: fixture.league,
                homeTeam: fixture.homeTeam,
                awayTeam: fixture.awayTeam,
                matchDate,
                marketType: fixture.isCombined ? 'parlay' as const : '1X2' as const,
                selection: bestPick.selection || fixture.selection || '',
                gainsMultiplier: fixture.multiplier || bestPick.recommendedMultiplier || 1.5,
                minStake: 1000,
                maxStake: 100000,
                maxTotalExposure: 500000,
                opensAt: new Date(),
                stakingClosesAt,
                settlementEstimateAt,
                settlementEstimateLabel: settlementEstimateAt.toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' }),
                status: 'active' as const,
                legs: [{ homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, matchDate, league: fixture.league }],
                metadata: {
                  oraCurated: true,
                  oraConfidence: bestPick.confidence,
                  fixtureId: fixture.fixtureId,
                  combined: fixture.isCombined,
                  legMarkets: fixture.combinedLegs?.map(l => l.marketType),
                  legSelections: fixture.combinedLegs?.map(l => l.selection),
                },
              }, adminUser);

              result.curation.created++;
            } catch (err: any) {
              result.settlement.errors.push(`Failed to create pod for ${fixture.homeTeam} vs ${fixture.awayTeam}: ${err.message}`);
            }
          }
          logger.info(`[Ora Automation] Published ${result.curation.created} pods`);
        }

        // Retry: if DeepSeek was unreachable, re-run with odds-based evaluation as fallback
        if (result.curation.created < 3 && curation.errors.some((e: string) => e.includes('DeepSeek'))) {
          logger.info(`[Ora Automation] Retry with odds-based fallback — DeepSeek unreachable`);
          const fallbackResult = await aiCurationService.basicFallbackCurate();
          if (fallbackResult.recommended > 0) {
            for (const fixture of fallbackResult.fixtures) {
              if (fixture.verdict !== 'RECOMMEND') continue;
              const bestPick = fixture.recommendations[0];
              if (!bestPick) continue;
              try {
                const matchDate = new Date(fixture.matchDate);
                const stakingClosesAt = new Date(matchDate.getTime() - 24 * 60 * 60 * 1000);
                const settlementEstimateAt = new Date(matchDate.getTime() + 24 * 60 * 60 * 1000);
                await adminService.createPod({
                  title: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
                  sport: 'football', league: fixture.league,
                  homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, matchDate,
                  marketType: '1X2', selection: bestPick.selection,
                  gainsMultiplier: bestPick.recommendedMultiplier,
                  minStake: 1000, maxStake: 100000, maxTotalExposure: 500000,
                  opensAt: new Date(), stakingClosesAt, settlementEstimateAt,
                  settlementEstimateLabel: settlementEstimateAt.toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' }),
                  status: 'active', legs: [], metadata: { oraCurated: true, fallback: 'odds-based', fixtureId: fixture.fixtureId },
                }, adminUser);
                result.curation.created++;
              } catch (err: any) {
                result.settlement.errors.push(`Fallback pod create error: ${err.message}`);
              }
            }
            logger.info(`[Ora Automation] Fallback: ${fallbackResult.recommended} odds-based pods published`);
          }
        }
      }

      // Step 2: Bet Manager operations
      try {
        const unlocked = await betManagerService.unlockDeposits();
        if (unlocked > 0) logger.info('BetManager deposits unlocked', { count: unlocked });
        await betManagerService.reconcileAllocations();
        for (const tier of ['goalkeeper', 'defender', 'midfielder', 'striker'] as const) {
          await betManagerService.settleCycle(tier);
        }
        await betManagerService.allocateDaily();
      } catch (err: any) {
        logger.error('BetManager automation error', err.message);
        result.settlement.errors.push(`BetManager: ${err.message}`);
      }

    } catch (err: any) {
      logger.error('Ora Automation cycle error', err.message);
      result.settlement.errors.push(`Cycle error: ${err.message}`);
    } finally {
      this.running = false;
    }

    this.lastRunAt = new Date();
    this.lastResult = {
      curation: { ...result.curation },
      settlement: { ...result.settlement, errors: [...result.settlement.errors] },
    };

    return result;
  }

  private async getSystemAdmin(): Promise<string> {
    try {
      const { UserModel } = await import('../../models/user.model');
      const admin = await UserModel.findOne({ role: 'admin' }).sort({ createdAt: 1 }).lean();
      return admin?._id?.toString() || '';
    } catch {
      return '';
    }
  }
}

export const aiAutomationService = new AIAutomationService();

