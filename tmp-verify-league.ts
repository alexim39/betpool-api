require('C:/Projects/betpool/api/node_modules/dotenv').config({ path: 'C:/Projects/betpool/api/.env' });
const mongoose = require('C:/Projects/betpool/api/node_modules/mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });

  // 1) Pod-sync path: delete fixture 46419's sync pods, re-run sync, inspect new leagues
  const PodModel = require('C:/Projects/betpool/api/src/models/pod.model.ts').PodModel;
  const demoFixture = 46419;
  const removed = await PodModel.deleteMany({ 'metadata.source': 'bsd', 'metadata.fixtureId': demoFixture });
  console.log('deleted old pods for', demoFixture, ':', removed.deletedCount);

  const { podSyncService } = require('./src/modules/pods/pod-sync.service');
  const syncResult = await podSyncService.sync('6a636f7e56d229889e187565', { daysAhead: 1 });
  console.log('sync: created', syncResult.created, 'skipped', syncResult.skipped);

  const newPods = await PodModel.find({ 'metadata.source': 'bsd', 'metadata.fixtureId': demoFixture })
    .select('selection league').lean();
  console.log('demo fixture new pods:', newPods.length);
  for (const p of newPods) console.log('  sel:', p.selection, '| league:', JSON.stringify(p.league));

  // 2) Curation path: run daily fallback curation (odds-based) and sample leagues
  console.log('running basicFallbackCurate...');
  const { aiCurationService } = require('./src/modules/ai/ai-curation.service');
  const cur = await aiCurationService.basicFallbackCurate();
  console.log('curation: total', cur.total, 'recommended', cur.recommended, 'skipped', cur.skipped);
  const sampled = [...cur.fixtures].slice(0, 12).map(f => `${f.homeTeam} | ${f.league} | ${f.verdict}`);
  console.log('sample leagues:\n' + sampled.join('\n'));

  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });