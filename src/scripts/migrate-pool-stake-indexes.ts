import 'dotenv/config';
import mongoose from 'mongoose';
import { PoolStakeModel } from '../modules/match-pools/pool-stake.model';

/**
 * Migration — ensures the match-pool stake schema indexes exist (idempotent).
 * Compounded filters used by the admin stakers listing (paginated, latest first):
 *   - { matchPoolId: 1, marketId: 1, createdAt: -1 }  stakers by pool + market, newest first
 * Usage: npx ts-node src/scripts/migrate-pool-stake-indexes.ts
 */
async function run(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');

  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 30000
  });

  console.log('[Migration] Connected. Syncing pool-stake indexes...');
  await PoolStakeModel.syncIndexes();
  const indexes = await PoolStakeModel.collection.indexes();
  for (const idx of indexes) {
    console.log(`[Migration] index: ${JSON.stringify(idx.key)}`);
  }
  console.log('[Migration] Pool-stake indexes verified.');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[Migration] Failed:', err.message || err);
  process.exit(1);
});