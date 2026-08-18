import 'dotenv/config';
import mongoose from 'mongoose';
import { PodModel } from '../models/pod.model';
import { UserModel } from '../models/user.model';
import { AdminService } from '../modules/admin/admin.service';
import { aiSettlementService } from '../modules/ai/ai-settlement.service';

/**
 * Corrective migration — re-verifies every pod that was settled as LOSS and
 * re-opens + re-settles any whose stored result no longer matches the verified
 * final score (fixes the mid-match settlement bug where Over/Under pods were
 * settled as loss before the final whistle).
 *
 * Only finished, high-confidence (>= 90), non-disputed checks are auto-corrected.
 * Anything unclear is reported for manual settlement via the admin UI.
 *
 * Usage:
 *   npx ts-node src/scripts/re-settle-pods.ts            # dry run (preview only)
 *   npx ts-node src/scripts/re-settle-pods.ts --confirm  # apply corrections
 */
async function run(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');

  const dryRun = !process.argv.includes('--confirm');

  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 30000
  });

  const admin = await UserModel.findOne({ role: 'admin' }).sort({ createdAt: 1 }).select('_id').lean();
  if (!admin) {
    console.error('[ReSettle] No admin user found — aborting.');
    process.exit(1);
  }
  const adminService = new AdminService();

  const pods = await PodModel.find({
    status: 'settled',
    result: 'loss',
  }).select('_id title homeTeam awayTeam selection result').lean();

  console.log(`[ReSettle] Found ${pods.length} pod(s) settled as LOSS. Verifying against final scores...`);
  if (dryRun) console.log('[ReSettle] DRY RUN — nothing will change. Re-run with --confirm to apply.');

  let corrected = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const pod of pods) {
    const label = `"${pod.title}" (${pod.homeTeam} vs ${pod.awayTeam})`;

    let check;
    try {
      check = await aiSettlementService.checkPod(pod._id.toString());
    } catch (err: any) {
      console.log(`SKIP  ${label}: check failed (${err.message})`);
      skipped++;
      continue;
    }

    const rec = check.recommendedResult;

    if (check.disputed || check.matchStatus !== 'finished' || check.confidence < 90) {
      console.log(`SKIP  ${label}: status=${check.matchStatus} rec=${rec} conf=${check.confidence}${check.disputed ? ' disputed' : ''} — ${check.reasoning?.slice(0, 140) || 'no reasoning'}`);
      skipped++;
      continue;
    }

    if (rec !== 'win' && rec !== 'loss' && rec !== 'void') {
      console.log(`SKIP  ${label}: cannot determine — ${check.reasoning?.slice(0, 140) || 'no reasoning'}`);
      skipped++;
      continue;
    }

    if (rec === 'loss') {
      unchanged++;
      continue;
    }

    const note = `Auto-corrected by re-settle script: was ${pod.result}, verified ${rec} (${check.homeScore ?? '?'}-${check.awayScore ?? '?'}) — ${check.reasoning?.slice(0, 200)}`;

    if (dryRun) {
      console.log(`FIX   ${label}: ${pod.result} -> ${rec} @ ${check.homeScore ?? '?'}-${check.awayScore ?? '?'} (conf ${check.confidence})`);
      corrected++;
      continue;
    }

    try {
      await adminService.unsettlePod(pod._id.toString(), admin._id.toString(), note);
      await adminService.settlePod(pod._id.toString(), rec, admin._id.toString(), note, check.homeScore ?? undefined, check.awayScore ?? undefined);
      console.log(`FIXED ${label}: ${pod.result} -> ${rec} @ ${check.homeScore ?? '?'}-${check.awayScore ?? '?'}`);
      corrected++;
    } catch (err: any) {
      console.log(`ERROR ${label}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`[ReSettle] Done: ${corrected} corrected, ${unchanged} unchanged, ${skipped} skipped.${dryRun ? ' DRY RUN — re-run with --confirm to apply.' : ''}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[ReSettle] Failed:', err.message || err);
  process.exit(1);
});