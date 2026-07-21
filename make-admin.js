const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || (() => { throw new Error('MONGODB_URI is required'); })();

async function makeAdmin() {
  try {
    await mongoose.connect(uri);
    const User = mongoose.model('User', new mongoose.Schema({ role: String, email: String, phone: String }));
    
    // Find user by email
    const user = await User.findOne({ email: 'testadmin6@example.com' });
    if (user) {
      user.role = 'admin';
      await user.save();
      console.log('User updated to admin:', user);
    } else {
      console.log('User not found by email');
    }
    
    // Also try by phone
    const user2 = await User.findOne({ phone: '2345556665555' });
    if (user2) {
      user2.role = 'admin';
      await user2.save();
      console.log('User updated to admin by phone:', user2);
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

makeAdmin();
