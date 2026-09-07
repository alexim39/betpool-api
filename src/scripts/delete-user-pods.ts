import 'dotenv/config';
import mongoose from 'mongoose';
import { PodModel } from '../models/pod.model';
import { UserModel } from '../models/user.model';
import { StakeModel } from '../models/stake.model';
import { PickOutcomeModel } from '../models/pick-outcome.model';
import { GameAnalysisModel } from '../models/game-analysis.model';
import { BetManagerAllocationModel } from '../models/bet-manager-allocation.model';
import { SocialLikeModel, SocialSaveModel, SocialCommentModel, SocialActivityModel } from '../modules/social/social.model';
import { adminService } from '../modules/admin/admin.service';

/**
 * Destructive utility — deletes every pod created through the old user
 * "publish a pick" flow: pods that set a `visibility` (public/followers) or
 * carry `metadata.source === 'user-pick'`, plus any pod whose creator is not
 * an admin/Ora account. Fixture-synced / Ora-curated pods (source 'bsd',
 * oraCurated) are left untouched.
 *
 * Active/published pods are cancelled first so all pending stakes are refunded
 * (wallets credited + refund transactions recorded), then the pod and all of
 * its related records are removed (social likes/saves/comments/activity, pick
 * outcomes, game analyses, bet-manager allocations).
 *
 * Usage:
 *   npx ts-node src/scripts/delete-user-pods.ts [--confirm]
 *
 * Without --confirm it prints what WOULD happen and exits (dry run).
 * Pods whose stakes were already settled (won/lost/void) are deleted too, but
 * their stake/transaction history is preserved for accounting.
 */
function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

const totals: Record<string, number> = {};

async function countAndDelete(model: mongoose.Model<any>, filter: Record<string, unknown>, dryRun: boolean, label: string): Promise<void> {
  const count = await model.countDocuments(filter);
  if (count > 0) {
    totals[label] = (totals[label] || 0) + count;
    if (!dryRun) await model.deleteMany(filter);
  }
}

async function run(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');

  const dryRun = !hasFlag('--confirm');

  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 30000
  });

  const adminIds = (await UserModel.find({ role: 'admin' }).select('_id').lean())
    .map(a => a._id.toString());
  console.log(`[DeleteUserPods] Admin accounts (Ora + staff): ${adminIds.length} — ${adminIds.join(', ') || 'none'}`);

  const pods = await PodModel.find({
    $or: [
      { 'metadata.source': 'user-pick' },
      { visibility: { $exists: true } },
      { createdBy: { $nin: adminIds } }
    ]
  })
    .select('_id title status homeTeam awayTeam createdBy currentParticipants')
    .sort({ createdAt: 1 })
    .lean();

  if (pods.length === 0) {
    console.log('[DeleteUserPods] No user-created pods found — nothing to do.');
    await mongoose.disconnect();
    return;
  }

  const cancelledBy = adminIds[0] || '000000000000000000000000';
  let toRefund = 0;
  let alreadySettled = 0;
  let skippedLiveStakes = 0;

  const countActiveStakes = (podId: string) => StakeModel.countDocuments({
    $or: [{ pod: podId }, { 'items.pod': podId }],
    status: { $in: ['pending', 'confirmed'] }
  });

  for (const pod of pods) {
    const podId = String(pod._id);
    const refundable = pod.status === 'active' || pod.status === 'published';
    const activeStakes = await countActiveStakes(podId);

    if (refundable) {
      toRefund++;
      console.log(`[DeleteUserPods] ${dryRun ? 'WOULD CANCEL' : 'CANCELLED'} pod ${podId} "${pod.title}" (${pod.status}, ${activeStakes} active stake(s)) — refunding stakers`);
      if (!dryRun) {
        try {
          await adminService.cancelPod(podId, cancelledBy);
        } catch (err: any) {
          console.error(`[DeleteUserPods]  !! cancelPod failed for ${podId}: ${err.message}`);
        }
      }
    } else {
      alreadySettled++;
    }

    // SAFETY: never delete a pod document while live stakes still reference
    // it — orphan legs can never resolve through settlePod and pin whole
    // parlays "active" forever (this stranded real user bets in the past).
    // Re-count after the cancel attempt: cancelPod voids pending legs, so a
    // correct cancel leaves zero active stakes behind.
    const remaining = dryRun ? activeStakes : await countActiveStakes(podId);
    if (remaining > 0) {
      skippedLiveStakes++;
      console.error(`[DeleteUserPods] !! SKIPPED pod ${podId} "${pod.title}" — ${remaining} active stake(s) still reference it. Settle/void those legs first, then re-run.`);
      continue;
    }

    await countAndDelete(PickOutcomeModel, { pod: podId }, dryRun, `pick outcomes for pod ${podId}`);
    await countAndDelete(SocialLikeModel, { pod: podId }, dryRun, `social likes on pod ${podId}`);
    await countAndDelete(SocialSaveModel, { pod: podId }, dryRun, `social saves on pod ${podId}`);
    await countAndDelete(SocialCommentModel, { pod: podId }, dryRun, `social comments on pod ${podId}`);
    await countAndDelete(SocialActivityModel, { pod: podId }, dryRun, `social activities for pod ${podId}`);
    await countAndDelete(GameAnalysisModel, { podId }, dryRun, `game analyses for pod ${podId}`);
    await countAndDelete(BetManagerAllocationModel, { podId }, dryRun, `bet-manager allocations for pod ${podId}`);

    await countAndDelete(PodModel, { _id: podId }, dryRun, `pod ${podId}`);
  }

  if (dryRun) {
    console.log('[DeleteUserPods] DRY RUN — nothing changed.');
  } else {
    console.log('[DeleteUserPods] Done.');
  }
  console.log(`[DeleteUserPods] ${pods.length} old-design pods found (${toRefund} cancelled with refunds, ${alreadySettled} already settled, ${skippedLiveStakes} SKIPPED with live stakes).`);
  const summarized: Record<string, number> = {};
  for (const [key, value] of Object.entries(totals)) {
    const label = key.split(' for ')[0].replace(/s$/, '');
    summarized[label] = (summarized[label] || 0) + value;
  }
  console.log('[DeleteUserPods] Related records removed:', JSON.stringify(summarized, null, 2));
  console.log('[DeleteUserPods] Re-run with --confirm to execute. Restart the API after executing so the feed cache picks up the change.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[DeleteUserPods] Failed:', err.message || err);
  process.exit(1);
});
