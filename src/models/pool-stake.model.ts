import mongoose, { Schema, Document } from 'mongoose';

export interface IPoolStake extends Document {
  userId: mongoose.Types.ObjectId;
  matchPoolId: mongoose.Types.ObjectId;
  marketId: string;
  amount: number;
  status: 'confirmed' | 'won' | 'lost' | 'cancelled_refunded';
  payoutAmount: number;
  createdAt: Date;
  settledAt?: Date;
}

const PoolStakeSchema = new Schema<IPoolStake>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  matchPoolId: { type: Schema.Types.ObjectId, ref: 'MatchPool', required: true, index: true },
  marketId: { type: String, required: true },
  amount: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['confirmed', 'won', 'lost', 'cancelled_refunded'], default: 'confirmed', index: true },
  payoutAmount: { type: Number, default: 0 },
  settledAt: { type: Date }
}, { timestamps: true });

PoolStakeSchema.index({ userId: 1, matchPoolId: 1 }, { unique: true });
PoolStakeSchema.index({ matchPoolId: 1, marketId: 1 });
PoolStakeSchema.set('toJSON', { virtuals: true });
PoolStakeSchema.set('toObject', { virtuals: true });

export const PoolStakeModel = mongoose.model<IPoolStake>('PoolStake', PoolStakeSchema);
