import 'dotenv/config';
import mongoose from 'mongoose';
import { UserModel } from '../models/user.model';
import { WalletModel } from '../models/wallet.model';
import { TransactionModel } from '../models/transaction.model';
import { TransferModel } from '../models/transfer.model';
import { StakeModel } from '../models/stake.model';
import { PickOutcomeModel } from '../models/pick-outcome.model';
import { PodModel } from '../models/pod.model';
import { NotificationModel } from '../models/notification.model';
import { BankAccountModel } from '../models/bank-account.model';
import { BookingCodeModel } from '../models/booking-code.model';
import { BetManagerAccountModel } from '../models/bet-manager-account.model';
import { BetManagerDepositModel } from '../models/bet-manager-deposit.model';
import { BetManagerAllocationModel } from '../models/bet-manager-allocation.model';
import { DigestSendLogModel } from '../models/digest-send-log.model';
import { GameAnalysisModel } from '../models/game-analysis.model';
import { SocialFollowModel, SocialLikeModel, SocialSaveModel, SocialCommentModel, SocialActivityModel } from '../modules/social/social.model';
import { LoyaltyModel } from '../modules/loyalty/loyalty.model';
import { ChatConversationModel } from '../modules/ai/chat-conversation.model';
import { LoanModel } from '../modules/admin/loan.model';
import { PoolStakeModel } from '../modules/match-pools/pool-stake.model';
import { MatchPoolModel } from '../modules/match-pools/match-pool.model';
import { VirtualGamesModel } from '../modules/virtual-games/virtual-games.model';
import { FeaturedBannerModel } from '../modules/featured-banners/featured-banner.model';
import { AbTestEventModel } from '../modules/abtest/abtest-event.model';

/**
 * Destructive utility — deletes a user and every record that references them,
 * across all collections (wallet, transactions, transfers, stakes, pods they
 * created, social follows/likes/saves/comments/activity, notifications,
 * bet-manager data, booking codes, loyalty, loans, match-pool stakes, etc.).
 *
 * Usage:
 *   npx ts-node src/scripts/delete-user.ts <userId | phone> [--confirm]
 *
 * Without --confirm it prints what WOULD be deleted and exits (dry run).
 * Admin accounts (incl. the Ora creator) are protected: deleting one requires
 * BOTH --confirm and --force, and is almost never what you want.
 */
function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function countAndDelete(model: mongoose.Model<any>, filter: Record<string, unknown>, dryRun: boolean, label: string): Promise<void> {
  const count = await model.countDocuments(filter);
  if (count > 0) {
    console.log(`[DeleteUser] ${dryRun ? 'WOULD DELETE' : 'DELETED'} ${label}: ${count}`);
    if (!dryRun) await model.deleteMany(filter);
  }
}

async function nullify(model: mongoose.Model<any>, filter: Record<string, unknown>, field: string, label: string): Promise<void> {
  const count = await model.countDocuments(filter);
  if (count > 0) {
    console.log(`[DeleteUser] ${label}: ${count} (field '${field}' set to null)`);
    await model.updateMany(filter, { $set: { [field]: null } });
  }
}

async function run(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');

  const target = process.argv[2];
  if (!target) {
    console.error('[DeleteUser] Usage: npx ts-node src/scripts/delete-user.ts <userId | phone> [--confirm]');
    process.exit(1);
  }
  const dryRun = !hasFlag('--confirm');
  const force = hasFlag('--force');

  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 30000
  });

  const isObjectId = /^[0-9a-fA-F]{24}$/.test(target);
  const user = isObjectId
    ? await UserModel.findById(target).select('_id phone fullName role isActive isSuspended').lean()
    : await UserModel.findOne({ phone: target }).select('_id phone fullName role isActive isSuspended').lean();

  if (!user) {
    console.error(`[DeleteUser] No user found for: ${target}`);
    process.exit(1);
  }

  const userId = user._id.toString();
  console.log(`[DeleteUser] Target: ${user.fullName} (${user.phone}) id=${userId} role=${user.role}`);

  if (user.role === 'admin' && !force) {
    console.error('[DeleteUser] Refusing to delete an admin account (this may be the Ora curator). Re-run with --force to override.');
    process.exit(1);
  }
  if (dryRun) console.log('[DeleteUser] DRY RUN — no changes made. Re-run with --confirm to execute.');

  const userFilter = { user: userId };
  const userIdFilter = { userId };

  await countAndDelete(WalletModel, userFilter, dryRun, 'wallets');
  await countAndDelete(TransactionModel, {
    $or: [{ user: userId }, { senderUserId: userId }, { recipientUserId: userId }]
  }, dryRun, 'transactions');
  await countAndDelete(TransferModel, { $or: [{ sender: userId }, { recipient: userId }] }, dryRun, 'transfers');

  const userStakes = await StakeModel.find(userFilter).select('_id').lean();
  const userStakeIds = userStakes.map(s => s._id);
  await countAndDelete(StakeModel, userFilter, dryRun, 'stakes');
  if (userStakeIds.length > 0) {
    await countAndDelete(BetManagerAllocationModel, { stakeId: { $in: userStakeIds } }, dryRun, 'bet-manager allocations (via user stakes)');
  }
  await countAndDelete(PickOutcomeModel, userFilter, dryRun, 'pick outcomes');

  const userPods = await PodModel.find({ createdBy: userId }).select('_id').lean();
  const userPodIds = userPods.map(p => p._id);
  await countAndDelete(PodModel, { createdBy: userId }, dryRun, 'pods (created by user)');
  if (userPodIds.length > 0) {
    await countAndDelete(SocialLikeModel, { pod: { $in: userPodIds } }, dryRun, 'social likes on user pods');
    await countAndDelete(SocialSaveModel, { pod: { $in: userPodIds } }, dryRun, 'social saves on user pods');
    await countAndDelete(SocialCommentModel, { pod: { $in: userPodIds } }, dryRun, 'social comments on user pods');
    await countAndDelete(GameAnalysisModel, { podId: { $in: userPodIds } }, dryRun, 'game analyses on user pods');
    await countAndDelete(BetManagerAllocationModel, { podId: { $in: userPodIds } }, dryRun, 'bet-manager allocations (via user pods)');
  }
  await nullify(PodModel, { updatedBy: userId }, 'updatedBy', 'pods updated by user');
  await nullify(PodModel, { settledBy: userId }, 'settledBy', 'pods settled by user');
  await nullify(PodModel, { bookedBy: userId }, 'bookedBy', 'pods booked by user');

  await countAndDelete(SocialFollowModel, { $or: [{ follower: userId }, { followee: userId }] }, dryRun, 'social follows (in + out)');
  await countAndDelete(SocialLikeModel, userFilter, dryRun, 'social likes by user');
  await countAndDelete(SocialSaveModel, userFilter, dryRun, 'social saves by user');
  await countAndDelete(SocialCommentModel, userFilter, dryRun, 'social comments by user');
  await countAndDelete(SocialActivityModel, { actor: userId }, dryRun, 'social activities');

  await countAndDelete(NotificationModel, userFilter, dryRun, 'notifications');
  await countAndDelete(BankAccountModel, userIdFilter, dryRun, 'bank accounts');
  await countAndDelete(BookingCodeModel, userIdFilter, dryRun, 'booking codes');
  await countAndDelete(DigestSendLogModel, userIdFilter, dryRun, 'digest send logs');
  await countAndDelete(LoyaltyModel, userFilter, dryRun, 'loyalty records');
  await countAndDelete(ChatConversationModel, userFilter, dryRun, 'chat conversations');
  await countAndDelete(LoanModel, { user: userId }, dryRun, 'loans');
  await nullify(LoanModel, { approvedBy: userId }, 'approvedBy', 'loans approved by user');
  await countAndDelete(PoolStakeModel, userIdFilter, dryRun, 'match-pool stakes');
  await nullify(MatchPoolModel, { createdByAdminId: userId }, 'createdByAdminId', 'match pools created by user');
  await countAndDelete(VirtualGamesModel, userFilter, dryRun, 'virtual-games records');
  await nullify(FeaturedBannerModel, { createdBy: userId }, 'createdBy', 'featured banners created by user');
  await countAndDelete(AbTestEventModel, { userId: target }, dryRun, 'ab-test events');

  const userBetManagerAccounts = await BetManagerAccountModel.find(userIdFilter).select('_id').lean();
  const userAccountIds = userBetManagerAccounts.map(a => a._id);
  await countAndDelete(BetManagerAccountModel, userIdFilter, dryRun, 'bet-manager accounts');
  if (userAccountIds.length > 0) {
    await countAndDelete(BetManagerDepositModel, { $or: [{ userId }, { accountId: { $in: userAccountIds } }] }, dryRun, 'bet-manager deposits');
  } else {
    await countAndDelete(BetManagerDepositModel, userIdFilter, dryRun, 'bet-manager deposits');
  }

  await nullify(UserModel, { referredBy: userId }, 'referredBy', 'users referred by user');
  await countAndDelete(UserModel, { _id: userId }, dryRun, 'user record');

  console.log(`[DeleteUser] ${dryRun ? 'Dry run complete — nothing changed.' : 'User deletion complete.'}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[DeleteUser] Failed:', err.message || err);
  process.exit(1);
});