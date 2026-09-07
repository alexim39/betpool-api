import 'dotenv/config';
import mongoose from 'mongoose';
import { WalletModel } from '../models/wallet.model';
import { POOL_WALLET_IDS, GUARANTEE_RESERVE_WALLET_ID, BUSINESS_WALLET_ID } from '../modules/bet-manager/bet-manager.service';

const APPLY = process.argv.includes('--apply');

/**
 * Heals Bet Manager pool/system wallet docs created before `Wallet.user`
 * became required. Any such doc breaks EVERY later `.save()` on it with
 * "Wallet validation failed: user: Path `user` is required." — this is what
 * broke defender deposits (pool wallet 0000...0001 had no `user`).
 *
 * Usage:
 *   npx ts-node ./src/scripts/backfill-pool-wallet-users.ts          # dry run
 *   npx ts-node ./src/scripts/backfill-pool-wallet-users.ts --apply  # apply
 */
async function run(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');

  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

  const targets: Array<{ label: string; id: mongoose.Types.ObjectId }> = [
    ...Object.entries(POOL_WALLET_IDS).map(([tier, id]) => ({ label: `pool:${tier}`, id })),
    { label: 'guarantee-reserve', id: GUARANTEE_RESERVE_WALLET_ID },
    { label: 'business', id: BUSINESS_WALLET_ID },
  ];

  const mode = APPLY ? 'APPLY' : 'DRY-RUN';
  console.log(`[Backfill] mode=${mode} — checking ${targets.length} system wallet(s)`);

  let missing = 0;
  let healed = 0;
  let alreadyOk = 0;

  for (const { label, id } of targets) {
    const doc = await WalletModel.findById(id).lean();
    if (!doc) {
      missing++;
      console.log(`[Backfill] ${label} (${id}) — MISSING (will be created on next deposit/scheduler run)`);
      continue;
    }
    if ((doc as any).user) {
      alreadyOk++;
      console.log(`[Backfill] ${label} (${id}) — OK (user present)`);
      continue;
    }
    console.log(`[Backfill] ${label} (${id}) — LEGACY, missing user${APPLY ? ' — healing' : ' — would heal'}`);
    if (APPLY) {
      await WalletModel.updateOne({ _id: id }, { $set: { user: id } });
      healed++;
    } else {
      healed++;
    }
  }

  await mongoose.disconnect();
  console.log(`[Backfill] DONE (${mode}) — ok=${alreadyOk} missing=${missing} ${APPLY ? 'healed' : 'would heal'}=${healed}`);
}

run().catch((err) => {
  console.error('[Backfill] Failed:', err.message || err);
  process.exit(1);
});
