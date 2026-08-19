import 'dotenv/config';
import mongoose from 'mongoose';
import { UserModel } from '../models/user.model';

/**
 * Backfill script — seeds lastActiveAt from lastLoginAt (or createdAt when the
 * user never logged in) so the admin "Last Active" column is populated
 * immediately for existing accounts. Idempotent.
 *
 * Usage:
 *   npx ts-node src/scripts/backfill-last-active.ts [--confirm] [--batch 500]
 *
 * Without --confirm it prints what WOULD be updated and exits (dry run).
 */
function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string, fallback: number): number {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  const value = Number(process.argv[idx + 1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

async function run(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');

  const dryRun = !hasFlag('--confirm');
  const batchSize = argValue('--batch', 500);

  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 30000
  });

  const pending = await UserModel.countDocuments({
    $or: [{ lastActiveAt: { $exists: false } }, { lastActiveAt: null }]
  });
  console.log(`[BackfillLastActive] Users missing lastActiveAt: ${pending}`);

  const cursor = UserModel.find({
    $or: [{ lastActiveAt: { $exists: false } }, { lastActiveAt: null }]
  })
    .select('lastLoginAt createdAt')
    .cursor();

  let updated = 0;
  let batch: { updateOne: { filter: { _id: any }; update: { $set: { lastActiveAt: Date } } } }[] = [];

  for await (const user of cursor) {
    const fallback = user.lastLoginAt || user.createdAt;
    if (!fallback) continue;
    batch.push({
      updateOne: {
        filter: { _id: user._id },
        update: { $set: { lastActiveAt: fallback } }
      }
    });
    if (batch.length >= batchSize) {
      if (!dryRun) {
        await UserModel.bulkWrite(batch);
        console.log(`[BackfillLastActive] Batch done: ${batch.length} updated`);
      } else {
        console.log(`[BackfillLastActive] WOULD update ${batch.length} (e.g. ${user._id} -> ${fallback.toISOString()})`);
      }
      updated += batch.length;
      batch = [];
    }
  }
  if (batch.length > 0) {
    if (!dryRun) {
      await UserModel.bulkWrite(batch);
      console.log(`[BackfillLastActive] Batch done: ${batch.length} updated`);
    } else {
      console.log(`[BackfillLastActive] WOULD update ${batch.length}`);
    }
    updated += batch.length;
  }

  await mongoose.disconnect();
  console.log(`[BackfillLastActive] ${dryRun ? 'DRY RUN — nothing written. ' : ''}Updated: ${updated}`);
}

run().catch((err) => {
  console.error('[BackfillLastActive] Failed:', err);
  process.exit(1);
});
