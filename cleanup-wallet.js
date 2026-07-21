const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || (() => { throw new Error('MONGODB_URI is required'); })();

async function cleanup() {
  try {
    await mongoose.connect(uri);
    const Wallet = mongoose.model('Wallet', new mongoose.Schema({ user: mongoose.Schema.Types.ObjectId }));
    const result = await Wallet.deleteOne({ user: null });
    console.log('Deleted wallet with null user:', result);
    
    // Also check if there are any other null wallets
    const wallets = await Wallet.find({ user: null });
    console.log('Remaining null wallets:', wallets.length);
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

cleanup();
