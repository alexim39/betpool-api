import mongoose from 'mongoose';

const Schema = mongoose.Schema;

export type TransactionType = 
  | 'deposit'
  | 'withdrawal'
  | 'stake'
  | 'payout'
  | 'refund'
  | 'bonus'
  | 'fee'
  | 'adjustment';

export type TransactionStatus = 
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'reversed';

export interface ITransaction extends mongoose.Document {
  user: mongoose.Types.ObjectId;
  wallet: mongoose.Types.ObjectId;
  type: TransactionType;
  status: TransactionStatus;
  amount: number;
  fee: number;
  netAmount: number;
  balanceBefore: number;
  balanceAfter: number;
  currency: string;
  reference: string;
  externalReference?: string;
  provider?: 'paystack' | 'bank_transfer' | 'internal';
  providerData?: Record<string, any>;
  metadata?: {
    podId?: mongoose.Types.ObjectId;
    oddsOfferId?: mongoose.Types.ObjectId;
    stakeId?: mongoose.Types.ObjectId;
    description?: string;
    ipAddress?: string;
    userAgent?: string;
  };
  completedAt?: Date;
  failedAt?: Date;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  wallet: {
    type: Schema.Types.ObjectId,
    ref: 'Wallet',
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: ['deposit', 'withdrawal', 'stake', 'payout', 'refund', 'bonus', 'fee', 'adjustment'],
    index: true
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed'],
    default: 'pending',
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  fee: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  netAmount: {
    type: Number,
    required: true,
    min: 0
  },
  balanceBefore: {
    type: Number,
    required: true,
    min: 0
  },
  balanceAfter: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    default: 'NGN'
  },
  reference: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  externalReference: {
    type: String,
    trim: true,
    sparse: true,
    index: true
  },
  provider: {
    type: String,
    enum: ['paystack', 'bank_transfer', 'internal']
  },
  providerData: {
    type: Schema.Types.Mixed
  },
  metadata: {
    oddsOfferId: { type: Schema.Types.ObjectId, ref: 'OddsOffer' },
    stakeId: { type: Schema.Types.ObjectId, ref: 'Stake' },
    description: { type: String, trim: true },
    ipAddress: { type: String },
    userAgent: { type: String }
  },
  completedAt: { type: Date },
  failedAt: { type: Date },
  failureReason: { type: String }
}, {
  timestamps: true
});

TransactionSchema.index({ user: 1, createdAt: -1 });
TransactionSchema.index({ user: 1, type: 1, status: 1 });
TransactionSchema.index({ status: 1, createdAt: -1 });

TransactionSchema.set('toJSON', { virtuals: true });
TransactionSchema.set('toObject', { virtuals: true });

export const TransactionModel = mongoose.model<ITransaction>('Transaction', TransactionSchema);