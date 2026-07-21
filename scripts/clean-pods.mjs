import mongoose from 'mongoose';
import 'dotenv/config';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const pods = db.collection('pods');

  // Delete BSD pods that are broken:
  // 1. No marketOdds field (undefined) - these have wrong gainsMultiplier and no real odds
  // 2. marketOdds == 2 or 3.5 (the default multipliers) - also wrong, from old sync
  const result = await pods.deleteMany({
    'metadata.source': 'bsd',
    $or: [
      { marketOdds: { $exists: false } },
      { marketOdds: null },
      { marketOdds: { $in: [2, 3.5] } }
    ]
  });
  console.log(`Deleted ${result.deletedCount} broken pods`);

  const remaining = await pods.countDocuments({ 'metadata.source': 'bsd' });
  console.log(`Remaining BSD pods: ${remaining}`);

  // Show what's left
  const good = await pods.find({ 'metadata.source': 'bsd' }).toArray();
  for (const p of good) {
    console.log(`  ${p.title} | ${p.marketType} | ${p.selection} | adj:${p.gainsMultiplier}x | odds:${p.marketOdds}x | refund:${p.refundPercent}%`);
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
