const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || (() => { throw new Error('MONGODB_URI is required'); })();

async function checkAdmin() {
  try {
    await mongoose.connect(uri);
    const User = mongoose.model('User', new mongoose.Schema({ email: String, role: String, phone: String }));
    
    const user = await User.findOne({ email: 'admin@betpool.tech' });
    console.log('User:', user);
    
    // Also check the test admin user
    const user2 = await User.findOne({ email: 'testadmin6@example.com' });
    console.log('Test admin user:', user2);
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkAdmin();
