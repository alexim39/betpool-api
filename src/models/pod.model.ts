import mongoose from 'mongoose';

const Schema = mongoose.Schema;

export type PodStatus = 'draft' | 'published' | 'active' | 'settled' | 'cancelled' | 'void';

export type SettlementStatus = 'pending' | 'settled' | 'disputed' | 'reviewed' | 'stuck';

export interface PodLeg {
  homeTeam: string;
  awayTeam: string;
  matchDate: Date;
  league?: string;
}

export interface IPod extends mongoose.Document {
  title: string;
  description?: string;
  sport: string;
  league?: string;
  homeTeam: string;
  awayTeam: string;
  matchDate: Date;
  marketType: string;
  selection: string;
  gainsMultiplier: number;
  marketOdds?: number;
  impliedProbability: number;
  refundPercent: number;
  minStake: number;
  maxStake: number;
  maxPayout: number;
  maxTotalExposure: number;
  currentExposure: number;
  currentParticipants: number;
  status: PodStatus;
  opensAt: Date;
  stakingClosesAt: Date;
  settlementEstimateLabel: string;
  settlementEstimateAt: Date;
  homeScore?: number;
  awayScore?: number;
  settledAt?: Date;
  result?: 'win' | 'loss' | 'void';
  resultNotes?: string;
  settlementStatus: SettlementStatus;
  settlementDisputed: boolean;
  settlementDisputedReason?: string;
  settlementStuckReason?: string;
  settlementReviewedBy?: mongoose.Types.ObjectId;
  settlementReviewNote?: string;
  settlementReviewedAt?: Date;
  riskSuspended: boolean;
  bookedExternally: boolean;
  bookedAt?: Date;
  bookedBy?: mongoose.Types.ObjectId;
  isLive: boolean;
  displayOrder: number;
  tags?: string[];
  metadata?: Record<string, any>;
  legs: PodLeg[];
  createdBy: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  settledBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PodLegSchema = new Schema({
  homeTeam: { type: String, required: true, trim: true },
  awayTeam: { type: String, required: true, trim: true },
  matchDate: { type: Date, required: true },
  league: { type: String, trim: true }
}, { _id: false });

const PodSchema = new Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  sport: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  league: {
    type: String,
    trim: true,
    index: true
  },
  homeTeam: {
    type: String,
    required: true,
    trim: true
  },
  awayTeam: {
    type: String,
    required: true,
    trim: true
  },
  matchDate: {
    type: Date,
    required: true,
    index: true
  },
  marketType: {
    type: String,
    required: true,
    trim: true
  },
  selection: {
    type: String,
    required: true,
    trim: true
  },
  gainsMultiplier: {
    type: Number,
    required: true,
    min: 1.01,
    max: 1000
  },
  marketOdds: {
    type: Number,
    min: 1.01
  },
  impliedProbability: {
    type: Number,
    required: true,
    min: 0,
    max: 1
  },
  refundPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  minStake: {
    type: Number,
    required: true,
    default: 100,
    min: 10
  },
  maxStake: {
    type: Number,
    required: true,
    default: 100000,
    min: 100
  },
  maxPayout: {
    type: Number,
    required: true,
    default: 5000000,
    min: 1000
  },
  maxTotalExposure: {
    type: Number,
    required: true,
    default: 10000000,
    min: 10000
  },
  currentExposure: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  currentParticipants: {
    type: Number,
    default: 0,
    min: 0
  },
  status: {
    type: String,
    required: true,
    enum: ['draft', 'published', 'active', 'settled', 'cancelled', 'void'],
    default: 'draft',
    index: true
  },
  opensAt: {
    type: Date,
    required: true,
    index: true
  },
  stakingClosesAt: {
    type: Date,
    required: true,
    index: true
  },
  settlementEstimateLabel: {
    type: String,
    default: 'Pending'
  },
  settlementEstimateAt: {
    type: Date
  },
  homeScore: { type: Number },
  awayScore: { type: Number },
  settledAt: { type: Date },
  result: {
    type: String,
    enum: ['win', 'loss', 'void']
  },
  resultNotes: { type: String, trim: true },
  settlementStatus: {
    type: String,
    enum: ['pending', 'settled', 'disputed', 'reviewed', 'stuck'],
    default: 'pending',
    index: true
  },
  settlementDisputed: { type: Boolean, default: false, index: true },
  settlementDisputedReason: { type: String, trim: true },
  settlementStuckReason: { type: String, trim: true },
  settlementReviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  settlementReviewNote: { type: String, trim: true },
  settlementReviewedAt: { type: Date },
  riskSuspended: { type: Boolean, default: false, index: true },
  bookedExternally: { type: Boolean, default: false, index: true },
  bookedAt: { type: Date },
  bookedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  isLive: {
    type: Boolean,
    default: false,
    index: true
  },
  displayOrder: {
    type: Number,
    default: 0
  },
  tags: [{ type: String, trim: true }],
  metadata: { type: Schema.Types.Mixed },
  legs: [PodLegSchema],
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  settledBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

PodSchema.index({ status: 1, opensAt: 1, stakingClosesAt: 1 });
PodSchema.index({ sport: 1, status: 1, opensAt: 1 });
PodSchema.index({ matchDate: 1, status: 1 });
PodSchema.index({ isLive: 1, status: 1 });

PodSchema.virtual('timeRemaining').get(function(this: IPod) {
  const now = new Date();
  if (!this.opensAt || !this.stakingClosesAt) return 0;
  if (now < this.opensAt) return Math.max(0, this.opensAt.getTime() - now.getTime());
  if (now > this.stakingClosesAt) return 0;
  return Math.max(0, this.stakingClosesAt.getTime() - now.getTime());
});

PodSchema.virtual('isOpen').get(function(this: IPod) {
  const now = new Date();
  return !!this.opensAt && !!this.stakingClosesAt && now >= this.opensAt && now <= this.stakingClosesAt && this.status === 'active';
});

PodSchema.virtual('potentialPayout').get(function(this: IPod) {
  return (stake: number) => Math.floor(stake * this.gainsMultiplier);
});

PodSchema.set('toJSON', { virtuals: true });
PodSchema.set('toObject', { virtuals: true });

export const PodModel = mongoose.model<IPod>('Pod', PodSchema);
