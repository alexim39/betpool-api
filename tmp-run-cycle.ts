require('C:/Projects/betpool/api/node_modules/dotenv').config({ path: 'C:/Projects/betpool/api/.env' });
const mongoose = require('C:/Projects/betpool/api/node_modules/mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  // @ts-ignore
  const { aiAutomationService } = require('./src/modules/ai/ai-automation.service');
  const result = await aiAutomationService.runCycle();
  console.log('CYCLE RESULT:', JSON.stringify(result, null, 2));
  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error('CYCLE ERROR:', e.message); process.exit(1); });