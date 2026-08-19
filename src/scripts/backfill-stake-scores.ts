import 'dotenv/config';
import mongoose from 'mongoose';
import { StakeModel, IStakeItem } from '../models/stake.model';
import { PodModel } from '../models/pod.model';
import { GameAnalysisModel } from '../models/game-analysis.model';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI environment variable is required');
  await mongoose.connect(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 15000, socketTimeoutMS: 60000 });

  const confirm = process.argv.includes('--confirm');
  console.log(`mode: ${confirm ? 'WRITE' : 'DRY-RUN (add --confirm to write)'}`);

  // 1. Stakes with settled items missing scores
  const stakes = await StakeModel.find({
    status: { $in: ['won', 'lost', 'void', 'refunded', 'cashed_out', 'pending', 'confirmed'] }
  })
    .select('_id user status items')
    .lean();

  const podIds = new Set<string>();
  for (const s of stakes as any[]) {
    for (const it of s.items || []) if (it.pod) podIds.add(String(it.pod));
  }
  const pods = await PodModel.find({ _id: { $in: [...podIds] } })
    .select('_id homeScore awayScore')
    .lean();
  const podScore = new Map(pods.map(p => [String(p._id), { hs: p.homeScore, as: p.awayScore }]));

  const missing: Array<{ stakeId: string; item: any; podExists: boolean }> = [];
  for (const s of stakes as any[]) {
    for (const it of s.items || []) {
      if (it.status === 'pending' || it.status === 'void') continue;
      if (it.homeScore != null && it.awayScore != null) continue;
      const ps = it.pod ? podScore.get(String(it.pod)) : undefined;
      if (ps && ps.hs != null && ps.as != null) continue; // pod has scores; read-time attach covers it
      missing.push({ stakeId: String(s._id), item: it, podExists: !!ps });
    }
  }

  console.log(`Stakes scanned: ${stakes.length}`);
  console.log(`Items needing score backfill: ${missing.length}`);

  // 2. Build GameAnalysis lookup by normalized team pair
  const norm = (t: string) => t?.toLowerCase().trim().replace(/\s+/g, ' ') ?? '';
  const gameDocs = await GameAnalysisModel.find({
    matchStatus: 'finished',
    homeScore: { $ne: null },
    awayScore: { $ne: null }
  })
    .select('homeTeam awayTeam homeScore awayScore matchStatus')
    .lean();
  const byPair = new Map<string, { hs: number; as: number }>();
  for (const g of gameDocs) {
    const key = `${norm(g.homeTeam)}|${norm(g.awayTeam)}`;
    byPair.set(key, { hs: g.homeScore as number, as: g.awayScore as number });
  }
  console.log(`GameAnalysis finished matches with scores: ${gameDocs.length}`);

  let matched = 0;
  let updated = 0;
  for (const m of missing) {
    const key = `${norm(m.item.homeTeam)}|${norm(m.item.awayTeam)}`;
    const revKey = `${norm(m.item.awayTeam)}|${norm(m.item.homeTeam)}`;
    const found = byPair.get(key) || byPair.get(revKey);
    if (!found) {
      console.log(`  NO MATCH: ${m.item.homeTeam} vs ${m.item.awayTeam} (stake ${m.stakeId}, status ${m.item.status}, podExists=${m.podExists})`);
      continue;
    }
    matched++;
    if (confirm) {
      const res = await StakeModel.updateOne(
        { _id: m.stakeId, 'items.pod': m.item.pod },
        {
          $set: {
            'items.$.homeScore': found.hs,
            'items.$.awayScore': found.as
          }
        }
      );
      if (res.modifiedCount > 0) updated++;
      console.log(`  FIXED: ${m.item.homeTeam} vs ${m.item.awayTeam} -> ${found.hs}:${found.as} (stake ${m.stakeId}, status ${m.item.status})`);
    } else {
      console.log(`  MATCH: ${m.item.homeTeam} vs ${m.item.awayTeam} -> ${found.hs}:${found.as} (stake ${m.stakeId}, status ${m.item.status})`);
    }
  }

  // 3. Single stakes referencing deleted pods (no items to attach scores to)
  const singleStakes = await StakeModel.find({
    items: { $in: [null, []] },
    pod: { $nin: [...podIds] }
  })
    .select('_id pod status')
    .lean();
  if (singleStakes.length > 0) {
    console.log(`\nSingle stakes referencing deleted pods: ${singleStakes.length}`);
    for (const s of singleStakes.slice(0, 10)) {
      console.log(`  ${s._id} pod=${s.pod} status=${s.status}`);
    }
  } else {
    console.log('\nNo single stakes reference deleted pods.');
  }

  console.log(`\nBackfill complete: matched=${matched} updated=${updated} of ${missing.length} missing.`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });