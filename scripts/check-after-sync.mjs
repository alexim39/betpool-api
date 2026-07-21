import mongoose from 'mongoose';
import 'dotenv/config';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const pods = db.collection('pods');
  const total = await pods.countDocuments({ 'metadata.source': 'bsd' });
  console.log(`BSD pods: ${total}`);

  const types = {};
  const all = await pods.find({ 'metadata.source': 'bsd' }).toArray();
  for (const p of all) {
    const mt = p.marketType || '?';
    types[mt] = (types[mt] || 0) + 1;
  }
  for (const [k, v] of Object.entries(types)) {
    console.log(`  ${k}: ${v}`);
  }

  // Show newest
  const newest = await pods.find({ 'metadata.source': 'bsd' }).sort({ createdAt: -1 }).limit(10).toArray();
  console.log('\nNewest pods:');
  for (const p of newest) {
    console.log(`  ${p.title} | ${p.marketType} | ${p.selection} | adj:${p.gainsMultiplier}x | odds:${p.marketOdds}x | refund:${p.refundPercent}%`);
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
