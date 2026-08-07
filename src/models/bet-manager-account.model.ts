import mongoose, { Schema, Document } from 'mongoose';

export type BetManagerTier = 'defender' | 'midfielder' | 'striker' | 'goalkeeper';

export interface IBetManagerAccount extends Document {
  userId: mongoose.Types.ObjectId;
  tier: BetManagerTier;
  units: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalProfit: number;
  status: 'active' | 'frozen';
  createdAt: Date;
  updatedAt: Date;
}

const BetManagerAccountSchema = new Schema<IBetManagerAccount>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  tier: { type: String, enum: ['defender', 'midfielder', 'striker', 'goalkeeper'], required: true },
  units: { type: Number, default: 0, min: 0 },
  totalDeposited: { type: Number, default: 0, min: 0 },
  totalWithdrawn: { type: Number, default: 0, min: 0 },
  totalProfit: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'frozen'], default: 'active' },
}, { timestamps: true });

BetManagerAccountSchema.index({ userId: 1, tier: 1 }, { unique: true });
BetManagerAccountSchema.index({ tier: 1, status: 1, createdAt: -1 });

export const BetManagerAccountModel = mongoose.model<IBetManagerAccount>('BetManagerAccount', BetManagerAccountSchema);
