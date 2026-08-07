import mongoose, { Schema, Document } from 'mongoose';

export interface IBetManagerCycle extends Document {
  tier: 'defender' | 'midfielder' | 'striker' | 'goalkeeper';
  cycleNumber: number;
  startDate: Date;
  endDate: Date;
  startingNav: number;
  endingNav: number | null;
  startingUnits: number;
  cashBalance: number;
  totalStaked: number;
  netProfit: number;
  platformFee: number;
  performanceFee: number;
  feePaid: boolean;
  guaranteeTopUp: number;
  guaranteeShortfall: number;
  excessCap: number;
  guaranteePaid: boolean;
  status: 'active' | 'settled';
  settledAt: Date | null;
  createdAt: Date;
}

const BetManagerCycleSchema = new Schema<IBetManagerCycle>({
  tier: { type: String, enum: ['defender', 'midfielder', 'striker', 'goalkeeper'], required: true },
  cycleNumber: { type: Number, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  startingNav: { type: Number, required: true },
  endingNav: { type: Number, default: null },
  startingUnits: { type: Number, default: 0 },
  cashBalance: { type: Number, default: 0 },
  totalStaked: { type: Number, default: 0 },
  netProfit: { type: Number, default: 0 },
  platformFee: { type: Number, default: 0 },
  performanceFee: { type: Number, default: 0 },
  feePaid: { type: Boolean, default: false },
  guaranteeTopUp: { type: Number, default: 0 },
  guaranteeShortfall: { type: Number, default: 0 },
  excessCap: { type: Number, default: 0 },
  guaranteePaid: { type: Boolean, default: false },
  status: { type: String, enum: ['active', 'settled'], default: 'active' },
  settledAt: { type: Date, default: null },
}, { timestamps: true });

BetManagerCycleSchema.index({ tier: 1, cycleNumber: -1 });
BetManagerCycleSchema.index({ tier: 1, status: 1 });

export const BetManagerCycleModel = mongoose.model<IBetManagerCycle>('BetManagerCycle', BetManagerCycleSchema);
