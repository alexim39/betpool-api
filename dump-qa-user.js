const fs = require('fs');
const mongoose = require('mongoose');
const env = fs.readFileSync(__dirname + '/.env', 'utf8');
const uri = env.split('\n').find(l => l.startsWith('MONGODB_URI=')).slice('MONGODB_URI='.length).trim();
(async () => {
  await mongoose.connect(uri);
  const user = await mongoose.connection.collection('users').findOne({ _id: new mongoose.Types.ObjectId('6a636f7e56d229889e187565') });
  if (!user) { console.error('user not found'); process.exit(1); }
  delete user.password;
  delete user.passwordHash;
  fs.writeFileSync(process.env.OUT || 'C:/Users/SLG048~1/AppData/Local/Temp/opencode/qa-user.json', JSON.stringify(user));
  console.log('written');
  await mongoose.disconnect();
  process.exit(0);
})();
