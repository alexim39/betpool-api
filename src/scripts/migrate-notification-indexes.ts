import 'dotenv/config';
import mongoose from 'mongoose';
import Notification from '../models/notification.model';

/**
 * Migration — ensures the notifications schema indexes exist (idempotent).
 * The notification document uses `timestamps: true` (createdAt/updatedAt) and
 * declares compound indexes for the common read-patterns:
 *   - { user: 1, createdAt: -1 }        list by user, newest first
 *   - { user: 1, type: 1, createdAt: -1 }  type-filtered list
 *   - { user: 1, read: 1, createdAt: -1 }  unread/read-filtered list
 * Usage: npx ts-node src/scripts/migrate-notification-indexes.ts
 */
async function run(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');

  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 30000
  });

  console.log('[Migration] Connected. Syncing notification indexes...');
  await Notification.syncIndexes();
  const indexes = await Notification.collection.indexes();
  for (const idx of indexes) {
    console.log(`[Migration] index: ${JSON.stringify(idx.key)}`);
  }
  console.log('[Migration] Notifications indexes verified.');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[Migration] Failed:', err.message || err);
  process.exit(1);
});
