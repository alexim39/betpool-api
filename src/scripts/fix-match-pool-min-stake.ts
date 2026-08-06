import 'dotenv/config';
import mongoose from 'mongoose';
import { MatchPoolModel } from '../modules/match-pools/match-pool.model';

async function run(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');

  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  });

  const affected = await MatchPoolModel.find({ minStake: { $ne: 100 } }, { eventTitle: 1, minStake: 1 });
  console.log(`[FixMinStake] ${affected.length} pool(s) with minStake != 100`);

  if (process.argv.includes('--apply')) {
    await MatchPoolModel.updateMany({ minStake: { $ne: 100 } }, { $set: { minStake: 100 } });
    const remaining = await MatchPoolModel.countDocuments({ minStake: { $ne: 100 } });
    console.log(`[FixMinStake] applied; remaining non-100: ${remaining}`);
  }

  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});