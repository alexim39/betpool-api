import mongoose from 'mongoose';
import { betManagerService, POOL_WALLET_IDS } from './bet-manager.service';
import { BetManagerCycleModel } from '../../models/bet-manager-cycle.model';
import { BetManagerTier } from '../../models/bet-manager-account.model';
import { logger } from '../../services/logger.service';

const TIERS: BetManagerTier[] = ['goalkeeper', 'defender', 'midfielder', 'striker'];

export class BetManagerScheduler {
  private schedulerId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  async runCycle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const unlocked = await betManagerService.unlockDeposits();
      if (unlocked > 0) logger.info('[Bet Manager] Deposits unlocked', { count: unlocked });

      await betManagerService.reconcileAllocations();

      for (const tier of TIERS) {
        try {
          const cycle = await BetManagerCycleModel.findOne({ tier, status: 'active' }).sort({ cycleNumber: -1 });
          if (cycle && cycle.endDate && cycle.endDate <= new Date()) {
            await betManagerService.settleCycle(tier);
            logger.info('[Bet Manager] Cycle settled', { tier });
          }
        } catch (err) {
          logger.error('[Bet Manager] Cycle settlement failed', { tier, error: err });
        }
      }

      await betManagerService.allocateDaily();
      logger.info('[Bet Manager] Scheduler cycle complete');
    } catch (err) {
      logger.error('[Bet Manager] Scheduler cycle error', err);
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = 2 * 60 * 60 * 1000): void {
    if (this.schedulerId) return;
    this.schedulerId = setInterval(() => {
      this.runCycle().catch(err => logger.error('[Bet Manager] Scheduler tick error', err));
    }, intervalMs);
    logger.info(`[Bet Manager] Scheduler started — every ${intervalMs / (60 * 60 * 1000)}h`);
    this.runCycle().catch(err => logger.error('[Bet Manager] Scheduler boot run error', err));
  }

  stop(): void {
    if (this.schedulerId) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
  }
}

export const betManagerScheduler = new BetManagerScheduler();

export function ensurePoolWallets(): Promise<mongoose.Types.ObjectId[]> {
  return Promise.all(TIERS.map(tier => betManagerService.getOrCreatePoolWallet(tier)));
}

export async function ensureSystemWallets(): Promise<void> {
  await Promise.all(TIERS.map(tier => betManagerService.getOrCreatePoolWallet(tier)));
  await betManagerService.seedGuaranteeReserve();
}

export { POOL_WALLET_IDS };
