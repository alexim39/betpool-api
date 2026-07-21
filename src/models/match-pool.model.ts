import mongoose, { Schema, Document } from 'mongoose';

export interface IMarket {
  marketId: string;
  label: string;
  totalStaked: number;
}

export interface IMatchPool extends Document {
  eventTitle: string;
  markets: IMarket[];
  stakingClosesAt: Date;
  status: 'open' | 'staking_closed' | 'settled' | 'cancelled';
  winningMarketId?: string;
  totalPool: number;
  platformFeeAmount: number;
  distributableAmount: number;
  minStake: number;
  maxStake: number;
  createdByAdminId: mongoose.Types.ObjectId;
  createdAt: Date;
  settledAt?: Date;
  cancelledAt?: Date;
}

const MarketSchema = new Schema<IMarket>({
  marketId: { type: String, required: true },
  label: { type: String, required: true },
  totalStaked: { type: Number, default: 0 }
}, { _id: false });

const MatchPoolSchema = new Schema<IMatchPool>({
  eventTitle: { type: String, required: true, trim: true, maxlength: 200 },
  markets: { type: [MarketSchema], required: true, validate: [arr => arr.length >= 2, 'At least 2 markets required'] },
  stakingClosesAt: { type: Date, required: true },
  status: { type: String, enum: ['open', 'staking_closed', 'settled', 'cancelled'], default: 'open', index: true },
  winningMarketId: { type: String },
  totalPool: { type: Number, default: 0 },
  platformFeeAmount: { type: Number, default: 0 },
  distributableAmount: { type: Number, default: 0 },
  minStake: { type: Number, default: 100 },
  maxStake: { type: Number, default: 100000 },
  createdByAdminId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  settledAt: { type: Date },
  cancelledAt: { type: Date }
}, { timestamps: true });

MatchPoolSchema.index({ status: 1, stakingClosesAt: 1 });
MatchPoolSchema.set('toJSON', { virtuals: true });
MatchPoolSchema.set('toObject', { virtuals: true });

export const MatchPoolModel = mongoose.model<IMatchPool>('MatchPool', MatchPoolSchema);
