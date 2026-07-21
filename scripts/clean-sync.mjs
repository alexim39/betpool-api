import mongoose from 'mongoose';
import 'dotenv/config';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const admin = await db.collection('users').findOne({ role: 'admin' });
  if (!admin) { console.error('No admin found'); process.exit(1); }
  console.log(`Admin: ${admin._id}`);

  // Dynamic import of compiled sync service
  const { PodModel } = await import('../dist/models/pod.model.js');
  const { podSyncService } = await import('../dist/services/pod-sync.service.js');

  const result = await podSyncService.sync(admin._id.toString());
  console.log(`Sync result:`);
  console.log(`  created: ${result.created}`);
  console.log(`  skipped: ${result.skipped}`);
  console.log(`  details:`, result.details);
  if (result.errors.length) console.log(`  errors:`, result.errors);
  if (result.successes.length) {
    for (const s of result.successes) {
      console.log(`  ${s.homeTeam} vs ${s.awayTeam}: ${s.pods} pods`);
    }
  }

  // Check results
  const pods = await db.collection('pods').find({ 'metadata.source': 'bsd' }).toArray();
  console.log(`\nTotal BSD pods after sync: ${pods.length}`);
  const types = {};
  for (const p of pods) {
    const mt = p.marketType || '?';
    types[mt] = (types[mt] || 0) + 1;
  }
  for (const [k, v] of Object.entries(types)) {
    console.log(`  ${k}: ${v}`);
  }

  // Show a sample
  for (const p of pods.slice(0, 8)) {
    console.log(`  ${p.title} | ${p.marketType} | ${p.selection} | adj:${p.gainsMultiplier}x | odds:${p.marketOdds}x | refund:${p.refundPercent}%`);
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
