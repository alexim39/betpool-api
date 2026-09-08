import mongoose from 'mongoose';

const Schema = mongoose.Schema;

export type CreatorCommissionStatus = 'pending' | 'paid';

/**
 * One row per winning copied stake. The row is the idempotency record:
 * `stakeId` is unique, so re-runs and double-settlements can never pay twice.
 *
 * Rate semantics (locked): the % applied is the creator's badge tier AT PAYOUT
 * TIME (Rising 10 / Pro 15 / Legend 20, Rookie 0), so past wins count once a
 * creator qualifies. Rows accrue as pending until the creator's pending total
 * reaches the payout threshold; payout itself is at most once per creator per
 * day (unique payout reference), which doubles as the concurrency guard.
 */
export interface ICreatorCommission extends mongoose.Document {
  creatorId: mongoose.Types.ObjectId;
  stakeId: mongoose.Types.ObjectId;
  bookingCode?: string;
  tier: string;
  ratePct: number;
  stakeAmount: number;
  platformFee: number;
  amount: number;
  status: CreatorCommissionStatus;
  payoutRef?: string;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CreatorCommissionSchema = new Schema({
  creatorId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  stakeId: {
    type: Schema.Types.ObjectId,
    ref: 'Stake',
    required: true,
    unique: true
  },
  bookingCode: {
    type: String,
    trim: true,
    uppercase: true
  },
  tier: {
    type: String,
    required: true,
    default: 'Rookie'
  },
  ratePct: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
    max: 100
  },
  stakeAmount: {
    type: Number,
    required: true,
    min: 0
  },
  platformFee: {
    type: Number,
    required: true,
    min: 0
  },
  amount: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  status: {
    type: String,
    enum: ['pending', 'paid'],
    required: true,
    default: 'pending',
    index: true
  },
  payoutRef: {
    type: String,
    sparse: true
  },
  paidAt: { type: Date }
}, {
  timestamps: true
});

CreatorCommissionSchema.index({ creatorId: 1, status: 1 });
CreatorCommissionSchema.index({ status: 1, createdAt: 1 });

export const CreatorCommissionModel = mongoose.model<ICreatorCommission>('CreatorCommission', CreatorCommissionSchema);
