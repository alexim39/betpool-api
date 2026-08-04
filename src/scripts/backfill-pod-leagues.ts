import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';
import { PodModel } from '../models/pod.model';
import { LEAGUE_NAMES } from '../modules/ai/ai-curation.service';

const GENERIC_RE = /^League\s+(\d+)$/i;
const BATCH = 200;
const LOG_EVERY = 500;

const APPLY = process.argv.includes('--apply');
const LIMIT_IDX = process.argv.indexOf('--limit');
const LIMIT = LIMIT_IDX >= 0 ? Math.max(0, parseInt(process.argv[LIMIT_IDX + 1] || '0', 10) || 0) : 0;

const baseUrl = (process.env.SPORTSAPI_BASE_URL || 'https://sports.bzzoiro.com/api/v2').replace(/\/+$/, '');
const apiKey = process.env.SPORTSAPI_KEY || '';

const leagueNameCache = new Map<string, string>();

async function resolveFromApi(leagueId: string): Promise<string | null> {
  if (!apiKey || apiKey === 'your_api_key_here') return null;
  const example: any = await PodModel.findOne(
    { league: new RegExp(`^League\\s+${leagueId}$`, 'i'), 'metadata.fixtureId': { $exists: true } },
    { 'metadata.fixtureId': 1, _id: 0 }
  ).lean();
  const fixtureId = example?.metadata?.fixtureId;
  if (!fixtureId) return null;
  try {
    const res = await axios.get(`${baseUrl}/events/${fixtureId}/odds/comparison/`, {
      headers: { Authorization: `Token ${apiKey}` },
      timeout: 10000,
    });
    const name = res.data?.league_name || res.data?.league?.name;
    if (name && typeof name === 'string') return String(name);
  } catch {
    return null;
  }
  return null;
}

async function resolveLeague(leagueId: string): Promise<string | null> {
  if (leagueNameCache.has(leagueId)) return leagueNameCache.get(leagueId) || null;
  const mapped = LEAGUE_NAMES[parseInt(leagueId, 10)];
  if (mapped) {
    leagueNameCache.set(leagueId, mapped);
    return mapped;
  }
  const real = await resolveFromApi(leagueId);
  if (real) leagueNameCache.set(leagueId, real);
  return real;
}

async function run(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');

  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

  const distinct = await PodModel.distinct('league', { league: { $regex: GENERIC_RE } });
  const leagueIds = Array.from(new Set(
    distinct.map(l => (GENERIC_RE.exec(String(l)) || [])[1]).filter(Boolean)
  ));
  console.log(`[Backfill] ${distinct.length} pod(s) with generic top-level league (${leagueIds.length} unique league ids)`);

  for (const id of leagueIds) {
    await resolveLeague(id);
    console.log(`[Backfill] league ${id} -> ${leagueNameCache.get(id) || 'UNRESOLVED'}`);
  }

  const mode = APPLY ? 'APPLY' : 'DRY-RUN';
  console.log(`[Backfill] mode=${mode}${LIMIT > 0 ? ` limit=${LIMIT}` : ''}`);

  let scanned = 0;
  let updated = 0;
  let unresolved = 0;
  let ops: mongoose.AnyBulkWriteOperation<unknown>[] = [];

  const flush = async (): Promise<void> => {
    if (!ops.length) return;
    if (APPLY) await PodModel.bulkWrite(ops, { ordered: false });
    updated += ops.length;
    ops = [];
  };

  const processDoc = (doc: any): void => {
    const m = GENERIC_RE.exec(doc.league || '');
    if (!m) return;
    const name = leagueNameCache.get(m[1]);
    if (!name) {
      unresolved++;
      return;
    }
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { league: name, 'legs.$[lg].league': name } },
        arrayFilters: [{ 'lg.league': { $regex: GENERIC_RE } }],
      },
    });
  };

  const cursor = PodModel.find({ league: { $regex: GENERIC_RE } })
    .select({ _id: 1, league: 1, legs: 1 })
    .cursor({ batchSize: BATCH });

  for await (const doc of cursor) {
    if (LIMIT > 0 && scanned >= LIMIT) break;
    scanned++;
    processDoc(doc);
    if (ops.length >= BATCH) await flush();
    if (scanned % LOG_EVERY === 0) console.log(`[Backfill] scanned ${scanned} | updated ${updated} | unresolved ${unresolved}`);
  }
  await flush();

  const legCursor = PodModel.find({ 'legs.league': { $regex: GENERIC_RE }, league: { $not: GENERIC_RE } })
    .select({ _id: 1, legs: 1 })
    .cursor({ batchSize: BATCH });

  for await (const doc of legCursor) {
    if (LIMIT > 0 && scanned >= LIMIT) break;
    scanned++;
    const legIds = Array.from(new Set((doc.legs || []).map((lg: any) => (GENERIC_RE.exec(lg?.league || '') || [])[1]).filter(Boolean)));
    const resolved = legIds.map(id => leagueNameCache.get(id)).filter(Boolean);
    if (resolved.length === 0) {
      unresolved += legIds.length;
      continue;
    }
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { 'legs.$[lg].league': leagueNameCache.get(legIds[0])! } },
        arrayFilters: [{ 'lg.league': { $regex: GENERIC_RE } }],
      },
    });
    if (ops.length >= BATCH) await flush();
  }
  await flush();

  await mongoose.disconnect();
  console.log(`[Backfill] DONE (${mode}) — scanned ${scanned}, ${APPLY ? 'updated' : 'would update'} ${updated}, unresolved ${unresolved}`);
}

run().catch((err) => {
  console.error('[Backfill] Failed:', err.message || err);
  process.exit(1);
});
