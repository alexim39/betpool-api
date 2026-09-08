import 'dotenv/config';
import mongoose from 'mongoose';
import { StakeModel } from '../models/stake.model';
import BookingCodeModel from '../models/booking-code.model';

const APPLY = process.argv.includes('--apply');
const BATCH = 200;

/**
 * Backfills Stake.creatorId for copied stakes placed before attribution was
 * recorded at placement time. Joins stake.bookingCode -> booking-codes.code
 * to recover the owning creator.
 *
 * Rules mirror live placement: stakes whose code owner is the staker
 * themselves (self-copies) are left unattributed (creatorId unset), and
 * stakes whose code document is gone (expired/rotated 48h TTL) are reported
 * as unattributable — they keep working, they just can't earn commission.
 *
 * Usage:
 *   npx ts-node src/scripts/backfill-stake-creator.ts          # dry run
 *   npx ts-node src/scripts/backfill-stake-creator.ts --apply  # apply
 */
async function run(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');

  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 60000,
  });

  const mode = APPLY ? 'APPLY' : 'DRY-RUN';
  console.log(`[Backfill] mode=${mode} — attributing copied stakes to creators`);

  let scanned = 0;
  let attributed = 0;
  let selfCopies = 0;
  let orphaned = 0;
  let ops: mongoose.AnyBulkWriteOperation<unknown>[] = [];

  const flush = async (): Promise<void> => {
    if (!ops.length) return;
    if (APPLY) await StakeModel.bulkWrite(ops, { ordered: false });
    attributed += ops.length;
    ops = [];
  };

  const cursor = StakeModel.find({
    bookingCode: { $exists: true, $ne: null },
    creatorId: { $exists: false },
  })
    .select({ _id: 1, user: 1, bookingCode: 1 })
    .cursor({ batchSize: BATCH });

  for await (const stake of cursor as any) {
    scanned++;
    const booking: any = await BookingCodeModel.findOne({ code: stake.bookingCode })
      .select({ userId: 1 })
      .lean();
    if (!booking?.userId) {
      orphaned++;
      continue;
    }
    if (String(booking.userId) === String(stake.user)) {
      selfCopies++;
      continue;
    }
    ops.push({
      updateOne: {
        filter: { _id: stake._id },
        update: { $set: { creatorId: new mongoose.Types.ObjectId(String(booking.userId)) } },
      },
    });
    if (ops.length >= BATCH) await flush();
    if (scanned % 1000 === 0) console.log(`[Backfill] scanned=${scanned} attributed=${attributed} self=${selfCopies} orphaned=${orphaned}`);
  }
  await flush();

  await mongoose.disconnect();
  console.log(`[Backfill] DONE (${mode}) — scanned=${scanned} ${APPLY ? 'attributed' : 'would attribute'}=${attributed} selfCopies=${selfCopies} orphaned=${orphaned}`);
}

run().catch((err) => {
  console.error('[Backfill] Failed:', err.message || err);
  process.exit(1);
});
