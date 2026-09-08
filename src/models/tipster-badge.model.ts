import mongoose from 'mongoose';

const Schema = mongoose.Schema;

export type TipsterBadgeTier = 'Rookie' | 'Rising' | 'Pro' | 'Legend';

export interface ITipsterBadge extends mongoose.Document {
  user: mongoose.Types.ObjectId;
  tier: TipsterBadgeTier;
  /** Copied stakes settled (won + lost only; voids/refunds excluded). */
  settled: number;
  won: number;
  winRate: number;
  /** Profit over staked on settled copies (can be negative). */
  roi: number;
  computedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TipsterBadgeSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  tier: {
    type: String,
    enum: ['Rookie', 'Rising', 'Pro', 'Legend'],
    required: true,
    default: 'Rookie',
    index: true
  },
  settled: { type: Number, required: true, default: 0, min: 0 },
  won: { type: Number, required: true, default: 0, min: 0 },
  winRate: { type: Number, required: true, default: 0, min: 0, max: 100 },
  roi: { type: Number, required: true, default: 0 },
  computedAt: { type: Date, required: true, default: Date.now }
}, {
  timestamps: true
});

export const TipsterBadgeModel = mongoose.model<ITipsterBadge>('TipsterBadge', TipsterBadgeSchema);
