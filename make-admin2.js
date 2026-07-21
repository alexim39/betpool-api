const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || (() => { throw new Error('MONGODB_URI is required'); })();

async function makeAdmin() {
  try {
    await mongoose.connect(uri);
    const User = mongoose.model('User', new mongoose.Schema({ email: String, role: String, phone: String }));
    
    // Update admin@betpool.tech to admin role
    const user = await User.findOneAndUpdate(
      { email: 'admin@betpool.tech' },
      { role: 'admin' },
      { new: true }
    );
    console.log('Updated user:', user);
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

makeAdmin();
