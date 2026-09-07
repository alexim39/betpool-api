import 'dotenv/config';
import mongoose from 'mongoose';
import { aiSettlementService } from '../modules/ai/ai-settlement.service';

/**
 * Operational runner for the stale-stake sweeper.
 *
 * - Dry run (default): lists stakes pinned active by long-concluded fixtures
 *   (missing pods, voided/postponed legs that never resolved, etc.).
 * - Apply: resolves each blocking leg through the normal determination rules
 *   (finished+scores → win/loss, postponed/cancelled/abandoned/gone fixture
 *   → void) via AdminService.settleStakeLeg. Indeterminable legs are left
 *   pending and reported — never force-settled.
 *
 * Usage:
 *   npx ts-node src/scripts/sweep-stale-stakes.ts [--days N] [--apply]
 *
 * WARNING: --apply moves real money (payouts/refunds) exactly as normal
 * settlement would. Review the dry-run list first.
 */
function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function run(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');

  const days = Math.min(365, Math.max(1, parseInt(flagValue('--days') || '7', 10) || 7));
  const apply = hasFlag('--apply');
  // System actor for settlement audit trail (must be a valid ObjectId string).
  const actor = flagValue('--actor') || process.env.SWEEP_ACTOR || '000000000000000000000001';

  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 60000,
  });

  const stuck = await aiSettlementService.listStuckStakes(days, 200);
  console.log(`[Sweep] stakes older than ${days}d with pending legs on concluded/gone fixtures: ${stuck.length}`);
  for (const s of stuck) {
    console.log(`[Sweep] STAKE ${s.stakeId} | user=${s.user} | age=${s.ageDays}d | status=${s.status}`);
    for (const leg of s.legs) {
      console.log(`[Sweep]   leg ${leg.index + 1} pod=${leg.podId || 'MISSING'} "${leg.podTitle}" [${leg.podStatus || 'gone'}] — ${leg.reason}`);
    }
  }

  if (!apply) {
    console.log('[Sweep] DRY RUN — nothing changed. Re-run with --apply to resolve.');
    await mongoose.disconnect();
    return;
  }

  const result = await aiSettlementService.sweepStaleStakes(actor, days);
  console.log(`[Sweep] APPLIED — scanned=${result.scanned} resolved=${result.resolved} stillStuck=${result.stillStuck.length} skippedInternal=${result.skippedInternal} (bet-manager pool stakes, manual review only)`);
  for (const e of result.errors) console.log(`[Sweep]   ERROR: ${e}`);
  for (const s of result.stillStuck) {
    console.log(`[Sweep] STILL STUCK ${s.stakeId} user=${s.user}`);
    for (const leg of s.legs) console.log(`[Sweep]   leg ${leg.index + 1}: ${leg.reason}`);
  }
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[Sweep] Failed:', err.message || err);
  process.exit(1);
});
