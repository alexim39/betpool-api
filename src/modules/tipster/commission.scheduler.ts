import { commissionService } from './commission.service';
import { logger } from '../../services/logger.service';

/**
 * Nightly creator-commission payout. Idempotent by construction (unique
 * stakeId rows, unique per-creator-per-day payout references), so restarts
 * and overlapping ticks are safe to re-run.
 */
export class CommissionScheduler {
  private schedulerId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  async runCycle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const res = await commissionService.runCycle();
      if (res.processed > 0 || res.creatorsPaid > 0) {
        logger.info(`[Creator Commission] recorded=${res.processed} creatorsPaid=${res.creatorsPaid} paidOut=₦${res.paidOut}`);
      }
      for (const e of res.errors) logger.error('[Creator Commission] cycle error', e);
    } catch (err) {
      logger.error('[Creator Commission] cycle failed', err);
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = 24 * 60 * 60 * 1000): void {
    if (this.schedulerId) return;
    this.schedulerId = setInterval(() => {
      this.runCycle().catch(err => logger.error('[Creator Commission] Scheduler tick error', err));
    }, intervalMs);
    logger.info('[Creator Commission] Nightly payout scheduler started — every 24h');
    this.runCycle().catch(err => logger.error('[Creator Commission] Scheduler boot run error', err));
  }

  stop(): void {
    if (this.schedulerId) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
  }
}

export const commissionScheduler = new CommissionScheduler();
