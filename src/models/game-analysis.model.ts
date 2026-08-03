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
  matchStatus?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  statusSyncedAt?: Date;
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
  matchStatus: { type: String, default: 'notstarted' },
  homeScore: { type: Number, default: null },
  awayScore: { type: Number, default: null },
  statusSyncedAt: { type: Date, default: null },
}, {
  timestamps: true,
});

// Query-supporting compound indexes (large dataset / server-side paging friendly)
GameAnalysisSchema.index({ matchDate: 1, confidence: -1 });
GameAnalysisSchema.index({ matchDate: 1, podId: 1 });
GameAnalysisSchema.index({ league: 1, matchDate: 1 });
GameAnalysisSchema.index({ analyzedAt: -1 });
GameAnalysisSchema.index({ matchStatus: 1, matchDate: 1 });

export const GameAnalysisModel = mongoose.model<IGameAnalysis>('GameAnalysis', GameAnalysisSchema);
