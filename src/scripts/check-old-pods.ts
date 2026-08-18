import 'dotenv/config';
import mongoose from 'mongoose';
import { PodModel } from '../models/pod.model';
import { UserModel } from '../models/user.model';

async function run(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');
  await mongoose.connect(process.env.MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 5000, socketTimeoutMS: 30000 });
  const adminIds = (await UserModel.find({ role: 'admin' }).select('_id').lean()).map(a => a._id.toString());
  const vis = await PodModel.countDocuments({ visibility: { $exists: true } });
  const up = await PodModel.countDocuments({ 'metadata.source': 'user-pick' });
  const nonAdmin = await PodModel.countDocuments({ createdBy: { $nin: adminIds } });
  const visActive = await PodModel.countDocuments({ visibility: { $exists: true }, status: 'active' });
  const visSettled = await PodModel.countDocuments({ visibility: { $exists: true }, status: 'settled' });
  const visOther = await PodModel.countDocuments({ visibility: { $exists: true }, status: { $nin: ['active', 'settled'] } });
  console.log(`visibility set: ${vis} (active=${visActive}, settled=${visSettled}, other=${visOther})`);
  console.log(`metadata.source=user-pick: ${up}`);
  console.log(`non-admin createdBy: ${nonAdmin}`);
  await mongoose.disconnect();
}
run().catch(err => { console.error('FAILED:', err.message || err); process.exit(1); });
