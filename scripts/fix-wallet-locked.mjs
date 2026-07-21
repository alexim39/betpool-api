import mongoose from 'mongoose';
import 'dotenv/config';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/investbetz';

const stakeSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  stakeAmount: Number,
  status: String,
}, { collection: 'stakes' });

const walletSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  balance: Number,
  lockedBalance: Number,
}, { collection: 'wallets' });

const Stake = mongoose.model('Stake', stakeSchema);
const Wallet = mongoose.model('Wallet', walletSchema);

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  // Find all confirmed stakes grouped by user
  const confirmedStakes = await Stake.aggregate([
    { $match: { status: 'confirmed' } },
    { $group: { _id: '$user', totalLocked: { $sum: '$stakeAmount' }, count: { $sum: 1 } } }
  ]);

  console.log(`Found ${confirmedStakes.length} users with ${confirmedStakes.reduce((s, g) => s + g.count, 0)} total confirmed stakes`);

  let fixedWallets = 0;
  let totalAmountFixed = 0;

  for (const group of confirmedStakes) {
    const wallet = await Wallet.findOne({ user: group._id });
    if (!wallet) {
      console.log(`  SKIP user ${group._id}: no wallet found`);
      continue;
    }

    const oldLocked = wallet.lockedBalance || 0;
    const toRemove = group.totalLocked;

    if (oldLocked < toRemove) {
      console.log(`  WARN user ${group._id}: locked=${oldLocked} < confirmStakes=${toRemove} (capping to 0)`);
    }

    const newLocked = Math.max(0, oldLocked - toRemove);
    const available = wallet.balance - oldLocked;
    const newAvailable = wallet.balance - newLocked;

    console.log(
      `  User ${group._id}: bal=${wallet.balance}, locked ${oldLocked}→${newLocked}, ` +
      `available ${available}→${newAvailable} (${group.count} stakes, ₦${toRemove.toLocaleString()} locked)`
    );

    wallet.lockedBalance = newLocked;
    await wallet.save();

    fixedWallets++;
    totalAmountFixed += toRemove;
  }

  // Final verification: find any wallets still with negative available balance
  const allWallets = await Wallet.find({});
  const negativeWallets = allWallets.filter(w => (w.balance - (w.lockedBalance || 0)) < 0);

  console.log(`\nFixed ${fixedWallets} wallets, removed ₦${totalAmountFixed.toLocaleString()} in incorrect locked balance`);
  console.log(`Wallets with negative available after fix: ${negativeWallets.length}`);

  if (negativeWallets.length > 0) {
    for (const w of negativeWallets) {
      console.log(`  NEGATIVE User ${w.user}: bal=${w.balance}, locked=${w.lockedBalance}, available=${w.balance - (w.lockedBalance || 0)}`);
    }
  } else {
    console.log('All wallets have non-negative available balance ✓');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
