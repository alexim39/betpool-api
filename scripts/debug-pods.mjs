import mongoose from 'mongoose';
import 'dotenv/config';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const pods = db.collection('pods');

  // Get old and new pods to compare
  const oldPods = await pods.find({ 'metadata.source': 'bsd', marketOdds: { $exists: false } }).sort({ createdAt: 1 }).limit(3).toArray();
  console.log('OLD pods (no marketOdds):');
  for (const p of oldPods) {
    console.log(`  title: ${p.title}`);
    console.log(`  gainsMultiplier: ${JSON.stringify(p.gainsMultiplier)} (type: ${typeof p.gainsMultiplier})`);
    console.log(`  marketOdds: ${JSON.stringify(p.marketOdds)}`);
    console.log(`  selection: ${p.selection}`);
    console.log(`  marketType: ${p.marketType}`);
    console.log(`  createdAt: ${p.createdAt}`);
    console.log();
  }

  const newPods = await pods.find({ marketOdds: { $ne: null, $exists: true }, 'metadata.source': 'bsd' }).sort({ createdAt: -1 }).limit(3).toArray();
  console.log('NEW pods (with marketOdds):');
  for (const p of newPods) {
    console.log(`  title: ${p.title}`);
    console.log(`  gainsMultiplier: ${JSON.stringify(p.gainsMultiplier)} (type: ${typeof p.gainsMultiplier})`);
    console.log(`  marketOdds: ${JSON.stringify(p.marketOdds)}`);
    console.log(`  selection: ${p.selection}`);
    console.log(`  marketType: ${p.marketType}`);
    console.log(`  createdAt: ${p.createdAt}`);
    console.log();
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
