import mongoose from 'mongoose';
import 'dotenv/config';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const pods = db.collection('pods');

  // Check for specific fixtures that had odds
  const searches = ['Rapid Bucure', 'Botev Plovdiv', 'Örgryte', 'Kalmar'];
  for (const s of searches) {
    const found = await pods.find({ title: { $regex: s, $options: 'i' } }).toArray();
    console.log(`"${s}" -> ${found.length} pods`);
    for (const p of found.slice(0, 3)) {
      console.log(`  ${p.marketType} | ${p.selection} | ${p.gainsMultiplier}x | marketOdds: ${p.marketOdds}x | refund: ${p.refundPercent}%`);
    }
  }

  // Check if ANY pod has marketOdds !== null/undefined
  const withOdds = await pods.find({ marketOdds: { $ne: null, $exists: true } }).limit(10).toArray();
  console.log(`\nPods WITH marketOdds: ${withOdds.length}`);
  for (const p of withOdds.slice(0, 5)) {
    console.log(`  ${p.title} | ${p.marketType} | ${p.selection} | marketOdds: ${p.marketOdds}`);
  }

  // Count pods with/without marketOdds
  const total = await pods.countDocuments();
  const noOdds = await pods.countDocuments({ $or: [{ marketOdds: null }, { marketOdds: { $exists: false } }] });
  console.log(`\nTotal: ${total}, no marketOdds: ${noOdds}, with marketOdds: ${total - noOdds}`);

  // Check what marketTypes exist
  const types = await pods.distinct('marketType');
  console.log('Market types in DB:', types);

  // Check a specific fixture that we know has odds
  // Check the /events/ results — first event without league filter
  // Let's check what fixtures the sync actually processed
  const bsdPods = await pods.find({ 'metadata.source': 'bsd' }).sort({ createdAt: -1 }).limit(5).toArray();
  console.log('\nLast 5 bsd pods:');
  for (const p of bsdPods) {
    console.log(`  ${p.createdAt?.toISOString()} | fixture:${p.metadata?.fixtureId} | ${p.marketType} | ${p.selection} | odds:${p.marketOdds}`);
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
