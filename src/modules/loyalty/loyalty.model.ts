import mongoose from 'mongoose';

export type LoyaltyTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface ILoyaltyProfile {
  user: mongoose.Types.ObjectId;
  points: number;
  tier: LoyaltyTier;
  lastStakeAt: Date | null;
  currentStreak: number;
  lossStreak: number;
  cashbackTotal: number;
  cashbackCreditedAt: Date | null;
  updatedAt: Date;
}

const schema = new mongoose.Schema<ILoyaltyProfile>(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    points: { type: Number, default: 0 },
    tier: { type: String, enum: ['bronze', 'silver', 'gold', 'platinum'], default: 'bronze' },
    lastStakeAt: { type: Date, default: null },
    currentStreak: { type: Number, default: 0 },
    lossStreak: { type: Number, default: 0 },
    cashbackTotal: { type: Number, default: 0 },
    cashbackCreditedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const LoyaltyProfileModel = mongoose.model<ILoyaltyProfile>('LoyaltyProfile', schema);
