const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || (() => { throw new Error('MONGODB_URI is required'); })();

async function dropIndexes() {
  try {
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    const wallets = db.collection('wallets');
    
    // List all indexes
    const indexes = await wallets.indexes();
    console.log('Current indexes:', JSON.stringify(indexes, null, 2));
    
    // Drop all indexes except _id
    for (const index of indexes) {
      if (index.name !== '_id_') {
        console.log('Dropping index:', index.name);
        await wallets.dropIndex(index.name);
      }
    }
    
    console.log('All non-_id indexes dropped');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

dropIndexes();
