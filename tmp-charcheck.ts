import 'dotenv/config';
import mongoose from 'mongoose';
import { GameAnalysisModel } from './src/models/game-analysis.model';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI!, { serverSelectionTimeoutMS: 10000 });
  const docs = await GameAnalysisModel.find({}).select('homeTeam awayTeam league').limit(3).lean();
  for (const d of docs as any[]) {
    const s = `${d.homeTeam}|${d.league}`;
    console.log(JSON.stringify(s), '=>', Array.from(s).map(c => `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' '));
  }
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });