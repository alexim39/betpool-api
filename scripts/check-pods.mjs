import mongoose from 'mongoose';
import 'dotenv/config';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const pods = db.collection('pods');
  const all = await pods.find({}).sort({ createdAt: -1 }).limit(50).toArray();
  console.log(`Total pods found: ${all.length}`);
  for (const p of all) {
    console.log(`${p.title} | marketType: ${p.marketType} | selection: ${p.selection} | gainsMultiplier: ${p.gainsMultiplier}x | marketOdds: ${p.marketOdds}x | refundPercent: ${p.refundPercent}% | source: ${p.metadata?.source || 'manual'}`);
  }
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
