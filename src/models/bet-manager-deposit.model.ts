import mongoose, { Schema, Document } from 'mongoose';

export interface IBetManagerDeposit extends Document {
  userId: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  type: 'deposit' | 'withdrawal';
  amount: number;
  units: number;
  navAtExecution: number;
  depositedAt: Date;
  withdrawableAt: Date | null;
  status: 'locked' | 'unlocked' | 'withdrawn';
  createdAt: Date;
}

const BetManagerDepositSchema = new Schema<IBetManagerDeposit>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  accountId: { type: Schema.Types.ObjectId, ref: 'BetManagerAccount', required: true },
  type: { type: String, enum: ['deposit', 'withdrawal'], required: true },
  amount: { type: Number, required: true, min: 0 },
  units: { type: Number, required: true },
  navAtExecution: { type: Number, required: true },
  depositedAt: { type: Date, default: Date.now },
  withdrawableAt: { type: Date, default: null },
  status: { type: String, enum: ['locked', 'unlocked', 'withdrawn'], default: 'locked' },
}, { timestamps: true });

BetManagerDepositSchema.index({ accountId: 1, status: 1 });
BetManagerDepositSchema.index({ userId: 1, createdAt: -1 });

export const BetManagerDepositModel = mongoose.model<IBetManagerDeposit>('BetManagerDeposit', BetManagerDepositSchema);
