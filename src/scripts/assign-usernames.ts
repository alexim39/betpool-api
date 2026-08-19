import 'dotenv/config';
import mongoose from 'mongoose';
import { UserModel } from '../models/user.model';
import { generateUsername } from '../services/username.service';

/**
 * Backfill script — assigns a unique auto-generated username to every user
 * that does not have one yet. Idempotent: users with a username are skipped.
 *
 * Usage:
 *   npx ts-node src/scripts/assign-usernames.ts [--confirm] [--batch 500]
 *
 * Without --confirm it prints what WOULD be assigned and exits (dry run).
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

  const [ora, pending, assignedTotal] = await Promise.all([
    UserModel.findOne({ username: 'ora' }).select('_id').lean(),
    UserModel.countDocuments({ $or: [{ username: { $exists: false } }, { username: null }, { username: '' }] }),
    UserModel.countDocuments({ username: { $exists: true, $nin: [null, ''] } })
  ]);
  console.log(`[AssignUsernames] Users missing a username: ${pending}; already assigned: ${assignedTotal}${ora ? '; "ora" taken' : ''}`);

  const taken = new Set<string>();
  const existing = await UserModel.find({ username: { $exists: true, $nin: [null, ''] } }).select('username').lean();
  for (const u of existing) taken.add(String(u.username));

  let oraReserved = !ora;
  let assigned = 0;
  let skipped = 0;

  for (let skip = 0; ; skip += batchSize) {
    const users = await UserModel.find({ $or: [{ username: { $exists: false } }, { username: null }, { username: '' }] })
      .select('_id fullName role')
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(batchSize)
      .lean();

    if (users.length === 0) break;

    const ops: { updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> } }[] = [];
    for (const user of users) {
      let candidate: string;
      if (oraReserved && user.role === 'admin') {
        candidate = 'ora';
        oraReserved = false;
      } else {
        let attempts = 0;
        do {
          candidate = generateUsername(user.fullName);
          attempts++;
        } while (taken.has(candidate) && attempts < 8);
        if (taken.has(candidate)) {
          console.log(`[AssignUsernames] SKIP ${user._id} — could not reserve a unique username for "${user.fullName}"`);
          skipped++;
          continue;
        }
      }
      taken.add(candidate);
      assigned++;
      console.log(`[AssignUsernames] ${dryRun ? 'WOULD assign' : 'Assigning'} @${candidate} <- ${user._id} (${user.fullName})`);
      ops.push({ updateOne: { filter: { _id: user._id }, update: { $set: { username: candidate } } } });
    }

    if (ops.length > 0 && !dryRun) {
      const result = await UserModel.bulkWrite(ops);
      console.log(`[AssignUsernames] Batch done: ${result.modifiedCount} updated`);
    }
  }

  console.log(`[AssignUsernames] ${dryRun ? 'DRY RUN — nothing written.' : 'Done.'} Assigned: ${assigned}, skipped: ${skipped}`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('[AssignUsernames] Failed:', err);
  process.exit(1);
});