import mongoose from 'mongoose';

const Schema = mongoose.Schema;

export type TransferStatus = 'pending' | 'completed' | 'failed' | 'reversed';

export interface ITransfer extends mongoose.Document {
  sender: mongoose.Types.ObjectId;
  recipient: mongoose.Types.ObjectId;
  amount: number;
  fee: number;
  netAmount: number;
  status: TransferStatus;
  reference: string;
  senderBalanceBefore: number;
  senderBalanceAfter: number;
  recipientBalanceBefore: number;
  recipientBalanceAfter: number;
  senderTransactionId?: mongoose.Types.ObjectId;
  recipientTransactionId?: mongoose.Types.ObjectId;
  narration?: string;
  recipientName?: string;
  recipientPhone?: string;
  senderName?: string;
  senderPhone?: string;
  failureReason?: string;
  metadata?: { ipAddress?: string; userAgent?: string };
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TransferSchema = new Schema({
  sender: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  recipient: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
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
    required: true
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'completed', 'failed', 'reversed'],
    default: 'completed',
    index: true
  },
  reference: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  // Ledger snapshot — both wallets' balances before/after the transfer so any
  // record can be independently audited without live wallet reads.
  senderBalanceBefore: { type: Number, required: true, min: 0 },
  senderBalanceAfter: { type: Number, required: true, min: 0 },
  recipientBalanceBefore: { type: Number, required: true, min: 0 },
  recipientBalanceAfter: { type: Number, required: true, min: 0 },
  senderTransactionId: { type: Schema.Types.ObjectId, ref: 'Transaction' },
  recipientTransactionId: { type: Schema.Types.ObjectId, ref: 'Transaction' },
  narration: { type: String, trim: true, maxlength: 140 },
  // Denormalized counterparty snapshot for fast, index-free search on history
  recipientName: { type: String, trim: true },
  recipientPhone: { type: String, trim: true },
  senderName: { type: String, trim: true },
  senderPhone: { type: String, trim: true },
  failureReason: { type: String },
  metadata: {
    ipAddress: { type: String },
    userAgent: { type: String }
  },
  completedAt: { type: Date }
}, {
  timestamps: true
});

// Timestamp + read-path indexes — history is always scoped to one participant
TransferSchema.index({ sender: 1, createdAt: -1 });
TransferSchema.index({ recipient: 1, createdAt: -1 });
TransferSchema.index({ sender: 1, status: 1, createdAt: -1 });
TransferSchema.index({ recipient: 1, status: 1, createdAt: -1 });
TransferSchema.index({ status: 1, createdAt: -1 });

TransferSchema.set('toJSON', { virtuals: true });
TransferSchema.set('toObject', { virtuals: true });

export const TransferModel = mongoose.model<ITransfer>('Transfer', TransferSchema);
