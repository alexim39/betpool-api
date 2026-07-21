import mongoose from 'mongoose';
import 'dotenv/config';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const adminId = '6a5ca71e65ad7eebaf025990';

  // Dynamic import of the sync service
  const { podSyncService } = await import('../dist/services/pod-sync.service.js');
  const result = await podSyncService.sync(adminId, { daysAhead: 2 });

  console.log(`Sync result:`);
  console.log(`  created: ${result.created}`);
  console.log(`  skipped: ${result.skipped}`);
  console.log(`  success: ${result.success}`);
  console.log(`  details:`, result.details);
  if (result.errors.length) console.log(`  errors:`, result.errors);
  if (result.successes.length) {
    for (const s of result.successes) {
      console.log(`  ${s.homeTeam} vs ${s.awayTeam}: ${s.pods} pods`);
    }
  } else {
    console.log(`  (no new pods created)`);
  }

  // Now check what's in the DB
  const pods = await mongoose.connection.db.collection('pods')
    .find({ 'metadata.source': 'bsd' })
    .sort({ createdAt: -1 })
    .limit(60)
    .toArray();

  const marketTypes = {};
  for (const p of pods) {
    const mt = p.marketType || 'unknown';
    marketTypes[mt] = (marketTypes[mt] || 0) + 1;
  }

  console.log(`\nDB pod market type breakdown:`);
  for (const [k, v] of Object.entries(marketTypes)) {
    console.log(`  ${k}: ${v}`);
  }

  // Show a few non-1X2 pods
  const non1x2 = pods.filter(p => (p.marketType || '') !== '1X2').slice(0, 5);
  if (non1x2.length) {
    console.log(`\nNon-1X2 pods created:`);
    for (const p of non1x2) {
      console.log(`  ${p.title} | ${p.marketType} | ${p.selection} | ${p.gainsMultiplier}x | marketOdds: ${p.marketOdds}x | refund: ${p.refundPercent}%`);
    }
  } else {
    console.log(`\nNo non-1X2 pods created.`);
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
