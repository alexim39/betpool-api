import mongoose from 'mongoose';
import 'dotenv/config';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const pods = db.collection('pods');

  // Check recent pods
  const recent = await pods.find().sort({ createdAt: -1 }).limit(10).toArray();
  console.log('Recent pods:');
  for (const p of recent) {
    console.log(`  ${p.title} | mult:${p.gainsMultiplier}x | mktOdds:${p.marketOdds}x | sel:${p.selection} | mktType:${p.marketType} | src:${p.metadata?.source || '?'}`);
  }

  // Stats
  const total = await pods.countDocuments();
  const withOdds = await pods.countDocuments({ marketOdds: { $ne: null, $exists: true } });
  const noOdds = await pods.countDocuments({ $or: [{ marketOdds: null }, { marketOdds: { $exists: false } }] });
  console.log(`\nTotal: ${total}, with marketOdds: ${withOdds}, no marketOdds: ${noOdds}`);

  // Check if any non-1X2 pods exist
  const non1x2 = await pods.countDocuments({ marketType: { $ne: '1X2' } });
  console.log(`Non-1X2 pods: ${non1x2}`);

  // Show distinct marketTypes
  const types = await pods.distinct('marketType');
  console.log('Market types:', types);

  // Check gainsMultiplier values
  const mults = await pods.distinct('gainsMultiplier');
  console.log('gainsMultiplier values:', mults.sort());

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
