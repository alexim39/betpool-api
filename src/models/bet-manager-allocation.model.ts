import mongoose, { Schema, Document } from 'mongoose';

export interface IBetManagerAllocation extends Document {
  cycleId: mongoose.Types.ObjectId;
  tier: 'defender' | 'midfielder' | 'striker';
  stakeId: mongoose.Types.ObjectId;
  podId: mongoose.Types.ObjectId;
  amount: number;
  expectedMultiplier: number;
  status: 'active' | 'won' | 'lost' | 'void' | 'refunded';
  returns: number;
  settledAt: Date | null;
  createdAt: Date;
}

const BetManagerAllocationSchema = new Schema<IBetManagerAllocation>({
  cycleId: { type: Schema.Types.ObjectId, ref: 'BetManagerCycle', required: true },
  tier: { type: String, enum: ['defender', 'midfielder', 'striker'], required: true },
  stakeId: { type: Schema.Types.ObjectId, ref: 'Stake', required: true, unique: true },
  podId: { type: Schema.Types.ObjectId, ref: 'Pod', required: true },
  amount: { type: Number, required: true, min: 0 },
  expectedMultiplier: { type: Number, required: true },
  status: { type: String, enum: ['active', 'won', 'lost', 'void', 'refunded'], default: 'active' },
  returns: { type: Number, default: 0 },
  settledAt: { type: Date, default: null },
}, { timestamps: true });

BetManagerAllocationSchema.index({ cycleId: 1, status: 1 });
BetManagerAllocationSchema.index({ stakeId: 1 }, { unique: true });

export const BetManagerAllocationModel = mongoose.model<IBetManagerAllocation>('BetManagerAllocation', BetManagerAllocationSchema);
