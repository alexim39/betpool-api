import mongoose from 'mongoose';

const Schema = mongoose.Schema;

export type PickOutcomeStatus = 'won' | 'lost' | 'skip';

export interface IPickOutcome extends mongoose.Document {
  user: mongoose.Types.ObjectId;
  pod: mongoose.Types.ObjectId;
  sport: string;
  league?: string;
  homeTeam: string;
  awayTeam: string;
  selection: string;
  marketType: string;
  gainsMultiplier: number;
  refundPercent: number;
  stakeAmount: number;
  isParlay: boolean;
  outcome: PickOutcomeStatus;
  settledAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PickOutcomeSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  pod: {
    type: Schema.Types.ObjectId,
    ref: 'Pod',
    required: true,
    index: true
  },
  sport: { type: String, required: true, trim: true, index: true },
  league: { type: String, trim: true, index: true },
  homeTeam: { type: String, required: true, trim: true },
  awayTeam: { type: String, required: true, trim: true },
  selection: { type: String, required: true, trim: true },
  marketType: { type: String, required: true, trim: true },
  gainsMultiplier: { type: Number, required: true, min: 1.01 },
  refundPercent: { type: Number, default: 0, min: 0, max: 100 },
  stakeAmount: { type: Number, required: true, min: 0 },
  isParlay: { type: Boolean, default: false },
  outcome: {
    type: String,
    required: true,
    enum: ['won', 'lost', 'skip'],
    index: true
  },
  settledAt: { type: Date, required: true, index: true }
}, {
  timestamps: true
});

PickOutcomeSchema.index({ user: 1, settledAt: -1 });
PickOutcomeSchema.index({ user: 1, outcome: 1, settledAt: -1 });
PickOutcomeSchema.index({ pod: 1, user: 1 });

export const PickOutcomeModel = mongoose.model<IPickOutcome>('PickOutcome', PickOutcomeSchema);
