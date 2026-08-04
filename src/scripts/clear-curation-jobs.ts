import 'dotenv/config';
import mongoose from 'mongoose';
import { CurationJobModel } from '../modules/ai/curation-job.model';

async function run(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');

  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

  const before = await CurationJobModel.countDocuments();
  const deleted = await CurationJobModel.deleteMany({});
  console.log(`[ClearCurationJobs] before=${before} deleted=${deleted.deletedCount}`);

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('[ClearCurationJobs] FAILED:', err.message);
  process.exit(1);
});
