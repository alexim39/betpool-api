import mongoose from 'mongoose';
import 'dotenv/config';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const pods = db.collection('pods');

  // Count by marketType
  const pipeline = [
    { $group: { _id: '$marketType', count: { $sum: 1 }, sample: { $first: '$$ROOT' } } },
    { $sort: { _id: 1 } }
  ];
  const groups = await pods.aggregate(pipeline).toArray();
  console.log('Pod market type breakdown:');
  for (const g of groups) {
    const s = g.sample;
    console.log(`  ${g._id}: ${g.count}`);
    console.log(`     eg: ${s.title} | ${s.selection} | ${s.gainsMultiplier}x | odds: ${s.marketOdds}x | refund: ${s.refundPercent}% | source: ${s.metadata?.source || '?'}`);
  }

  // Check total count
  const total = await pods.countDocuments();
  console.log(`\nTotal pods: ${total}`);

  // Show newest pods
  const newest = await pods.find().sort({ createdAt: -1 }).limit(10).toArray();
  console.log('\nNewest 10 pods:');
  for (const p of newest) {
    console.log(`  ${p.createdAt?.toISOString().slice(0,19)} | ${p.marketType} | ${p.selection} | ${p.title} | odds:${p.marketOdds || '?'}x | src:${p.metadata?.source || '?'}`);
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
