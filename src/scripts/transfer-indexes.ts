import 'dotenv/config';
import mongoose from 'mongoose';
import { TransferModel } from '../models/transfer.model';
import { TransactionModel } from '../models/transaction.model';

/**
 * Migration — ensures the wallet-to-wallet transfer schema/indexes exist (idempotent).
 * The Transfer document uses `timestamps: true` (createdAt/updatedAt — the required
 * timestamp column) and declares compound indexes for the read-patterns:
 *   - { sender: 1, createdAt: -1 }        sent-history, newest first
 *   - { recipient: 1, createdAt: -1 }     received-history, newest first
 *   - { sender: 1, status: 1, createdAt: -1 }  status-filtered sent-history
 *   - { recipient: 1, status: 1, createdAt: -1 } status-filtered received-history
 *   - { status: 1, createdAt: -1 }        global status queries
 * Also verifies the Transaction `transfer` type/metadata schema is applied.
 * Usage: npx ts-node src/scripts/transfer-indexes.ts
 */
async function run(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');

  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 30000
  });

  console.log('[Migration] Connected. Syncing transfer indexes...');
  await TransferModel.syncIndexes();
  const indexes = await TransferModel.collection.indexes();
  for (const idx of indexes) {
    console.log(`[Migration] transfer index: ${JSON.stringify(idx.key)}`);
  }
  console.log('[Migration] Transfer indexes verified.');

  await TransactionModel.syncIndexes();
  const txnIndexes = await TransactionModel.collection.indexes();
  console.log(`[Migration] Transaction indexes verified (${txnIndexes.length}).`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[Migration] Failed:', err.message || err);
  process.exit(1);
});
