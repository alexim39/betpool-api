import { StakeModel } from '../../models/stake.model';
import { stakeService } from './stake.service';
import { logger } from '../../services/logger.service';

export class AutoCashoutScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastRunAt: Date | null = null;
  private lastResult: { evaluated: number; fired: number; errors: number } | null = null;

  start(intervalMs?: number) {
    if (this.intervalId) return;
    const ms = intervalMs ?? parseInt(process.env.AUTO_CASHOUT_TICK_MS || '30000', 10);
    this.intervalId = setInterval(() => this.tick(), ms);
    logger.info(`Auto-cashout scheduler started — tick every ${ms / 1000}s`);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    this.lastRunAt = null;
  }

  getStatus() {
    return {
      enabled: this.intervalId !== null,
      running: this.running,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult
    };
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    this.lastRunAt = new Date();
    let fired = 0;
    let errors = 0;

    try {
      const maxPerTick = parseInt(process.env.AUTO_CASHOUT_MAX_PER_TICK || '50', 10);
      const stakes = await StakeModel.find({
        status: 'confirmed',
        'autoCashout.enabled': true
      }).limit(maxPerTick);

      for (const stake of stakes) {
        try {
          const quote = await stakeService.resolveAutoCashoutQuote(stake as any);
          if (quote <= 0) continue;
          if (quote < (stake.autoCashout?.targetAmount || Infinity)) continue;

          const fee = Math.max(0, stake.stakeAmount - quote);
          const executed = await stakeService.executeCashout(
            stake as any,
            quote,
            fee,
            true,
            stake.autoCashout?.targetAmount || null
          );
          if (executed) {
            fired++;
            logger.info(`[Auto-cashout] Fired for stake ${stake._id} at ₦${quote.toLocaleString()}`);
          }
        } catch (e) {
          errors++;
          console.error(`Auto-cashout error for stake ${stake._id}:`, e);
        }
      }

      this.lastResult = { evaluated: stakes.length, fired, errors };
    } catch (e) {
      this.lastResult = { evaluated: 0, fired, errors: errors + 1 };
      console.error('[Auto-cashout] Tick failed:', e);
    } finally {
      this.running = false;
    }
  }
}

export const autoCashoutScheduler = new AutoCashoutScheduler();
