import mongoose from 'mongoose';
import 'dotenv/config';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const admins = await db.collection('users').find({ role: 'admin' }).toArray();
  console.log(`Found ${admins.length} admins:`);
  for (const a of admins) {
    console.log(`  _id: ${a._id}, email: ${a.email || '(none)'}, phone: ${a.phone || '(none)'}, fullName: ${a.fullName || '(none)'}`);
  }
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
