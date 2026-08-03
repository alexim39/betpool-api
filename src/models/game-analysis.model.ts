import mongoose from 'mongoose';

const Schema = mongoose.Schema;

export interface IGameAnalysis extends mongoose.Document {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: Date;
  pick: string;
  marketType: string;
  gainsMultiplier: number;
  confidence: number;
  reasoning: string;
  availableOdds: number;
  podId?: mongoose.Types.ObjectId;
  analyzedAt: Date;
}

const GameAnalysisSchema = new Schema<IGameAnalysis>({
  fixtureId: { type: Number, required: true, unique: true, index: true },
  homeTeam: { type: String, required: true },
  awayTeam: { type: String, required: true },
  league: { type: String, default: '' },
  matchDate: { type: Date, required: true, index: true },
  pick: { type: String, default: '' },
  marketType: { type: String, default: '' },
  gainsMultiplier: { type: Number, default: 0 },
  confidence: { type: Number, default: 0 },
  reasoning: { type: String, default: '' },
  availableOdds: { type: Number, default: 0 },
  podId: { type: Schema.Types.ObjectId, ref: 'Pod', default: null },
  analyzedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
});

export const GameAnalysisModel = mongoose.model<IGameAnalysis>('GameAnalysis', GameAnalysisSchema);
