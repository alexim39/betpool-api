import mongoose from 'mongoose';

const Schema = mongoose.Schema;

export type StakeStatus = 'pending' | 'confirmed' | 'won' | 'lost' | 'void' | 'refunded' | 'cancelled' | 'cashed_out';

export interface IStakeItem {
  pod: mongoose.Types.ObjectId;
  homeTeam: string;
  awayTeam: string;
  selection: string;
  gainsMultiplier: number;
  matchDate: string;
  status: 'pending' | 'won' | 'lost' | 'void';
  settledAt?: Date;
}

export interface IStake extends mongoose.Document {
  user: mongoose.Types.ObjectId;
  pod: mongoose.Types.ObjectId;
  items?: IStakeItem[];
  combinedMultiplier?: number;
  stakeAmount: number;
  potentialPayout: number;
  netPayout: number;
  platformFee: number;
  feePercent: number;
  refundPercent: number;
  refundAmount: number;
  status: StakeStatus;
  settledAt?: Date;
  settledBy?: mongoose.Types.ObjectId;
  settlementNotes?: string;
  settledOdds?: number;
  cashoutRequested: boolean;
  cashoutAmount?: number;
  cashoutAt?: Date;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  
  // Virtual properties
  isActive: boolean;
  isSettled: boolean;
  isParlay: boolean;
  profit: number;
}

const StakeItemSchema = new Schema({
  pod: { type: Schema.Types.ObjectId, ref: 'Pod', required: true },
  homeTeam: { type: String, required: true },
  awayTeam: { type: String, required: true },
  selection: { type: String, required: true },
  gainsMultiplier: { type: Number, required: true, min: 1.01 },
  matchDate: { type: String, required: true },
  status: { type: String, enum: ['pending', 'won', 'lost', 'void'], default: 'pending' },
  settledAt: { type: Date }
}, { _id: false });

const StakeSchema = new Schema({
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
  items: { type: [StakeItemSchema], default: undefined },
  combinedMultiplier: { type: Number, min: 1.01 },
  stakeAmount: {
    type: Number,
    required: true,
    min: 10
  },
  potentialPayout: {
    type: Number,
    required: true,
    min: 0
  },
  netPayout: {
    type: Number,
    required: true,
    min: 0
  },
  platformFee: {
    type: Number,
    required: true,
    min: 0
  },
  feePercent: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  refundPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  refundAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'confirmed', 'won', 'lost', 'void', 'refunded', 'cancelled', 'cashed_out'],
    default: 'pending',
    index: true
  },
  settledAt: { type: Date },
  settledBy: { type: Schema.Types.ObjectId, ref: 'User' },
  settlementNotes: { type: String, trim: true },
  settledOdds: { type: Number, min: 1.01 },
  cashoutRequested: { type: Boolean, default: false },
  cashoutAmount: { type: Number, min: 0 },
  cashoutAt: { type: Date },
  metadata: { type: Schema.Types.Mixed }
}, {
  timestamps: true
});

StakeSchema.index({ user: 1, status: 1, createdAt: -1 });
StakeSchema.index({ pod: 1, status: 1 });
StakeSchema.index({ status: 1, createdAt: -1 });
StakeSchema.index({ user: 1, pod: 1 });
StakeSchema.index({ 'items.pod': 1 });

StakeSchema.virtual('isActive').get(function(this: IStake) {
  return ['pending', 'confirmed'].includes(this.status);
});

StakeSchema.virtual('isSettled').get(function(this: IStake) {
  return ['won', 'lost', 'void', 'refunded', 'cashed_out'].includes(this.status);
});

StakeSchema.virtual('isParlay').get(function(this: IStake) {
  return Array.isArray(this.items) && this.items.length > 1;
});

StakeSchema.virtual('profit').get(function(this: IStake) {
  if (this.status === 'won') return this.netPayout - this.stakeAmount;
  if (this.status === 'lost') return (this.refundAmount || 0) - this.stakeAmount;
  return 0;
});

StakeSchema.virtual('maxLoss').get(function(this: IStake) {
  return this.stakeAmount - (this.refundAmount || 0);
});

StakeSchema.set('toJSON', { virtuals: true });
StakeSchema.set('toObject', { virtuals: true });

export const StakeModel = mongoose.model<IStake>('Stake', StakeSchema);