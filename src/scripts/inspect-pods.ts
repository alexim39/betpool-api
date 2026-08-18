import 'dotenv/config';
import mongoose from 'mongoose';
import { PodModel } from '../models/pod.model';

async function run(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');
  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 30000
  });

  const target = new mongoose.Types.ObjectId(process.argv[2] || '6a636f7e56d229889e187565');
  const pods = await PodModel.find({ createdBy: target })
    .select('title status createdAt opensAt matchDate visibility metadata legs homeTeam awayTeam sport league selection gainsMultiplier')
    .sort({ createdAt: 1 })
    .lean();

  console.log(`Total pods created by ${target}: ${pods.length}`);
  const byMarker: Record<string, number> = {};
  for (const p of pods) {
    const hasFixture = !!(p.metadata as any)?.fixtureId;
    const hasVisibility = !!p.visibility;
    const legsCount = (p.legs || []).length;
    const marker = `${hasFixture ? 'fixture' : 'nofixture'}|${hasVisibility ? 'vis' : 'novis'}|legs=${legsCount}|${p.status}`;
    byMarker[marker] = (byMarker[marker] || 0) + 1;
    console.log(
      `${String(p._id)} | ${p.createdAt?.toISOString?.() || p.createdAt} | ${p.status} | ${marker} | "${p.title}" | ${p.homeTeam} vs ${p.awayTeam}`
    );
  }
  console.log('\nBy marker:', JSON.stringify(byMarker, null, 2));
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('[InspectPods] Failed:', err.message || err);
  process.exit(1);
});