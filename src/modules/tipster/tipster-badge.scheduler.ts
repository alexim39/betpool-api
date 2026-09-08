import { tipsterBadgeService } from './tipster-badge.service';
import { logger } from '../../services/logger.service';

/**
 * Nightly tipster-badge recompute. Idempotent bulk upserts — safe to re-run
 * after restarts. Read-only against live paths; a failed run only leaves
 * badges one day staler (each badge carries its computedAt date).
 */
export class TipsterBadgeScheduler {
  private schedulerId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  async runCycle(): Promise<{ computed: number }> {
    if (this.running) return { computed: 0 };
    this.running = true;
    try {
      const { computed } = await tipsterBadgeService.computeAll();
      logger.info(`[Tipster Badges] Recomputed ${computed} creator badge(s)`);
      return { computed };
    } catch (err) {
      logger.error('[Tipster Badges] Recompute failed', err);
      return { computed: 0 };
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = 24 * 60 * 60 * 1000): void {
    if (this.schedulerId) return;
    this.schedulerId = setInterval(() => {
      this.runCycle().catch(err => logger.error('[Tipster Badges] Scheduler tick error', err));
    }, intervalMs);
    logger.info('[Tipster Badges] Nightly recompute scheduler started — every 24h');
    // Boot run keeps staging/dev fresh and heals any missed night.
    this.runCycle().catch(err => logger.error('[Tipster Badges] Scheduler boot run error', err));
  }

  stop(): void {
    if (this.schedulerId) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
  }
}

export const tipsterBadgeScheduler = new TipsterBadgeScheduler();
