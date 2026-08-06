import mongoose, { Schema, Document } from 'mongoose';

export type VirtualGameId = 'coin_flip' | 'dice' | 'color_wheel';

export interface IVirtualGamePlay extends Document {
  user: mongoose.Types.ObjectId;
  game: VirtualGameId;
  stakeAmount: number;
  multiplier: number;
  result: 'win' | 'loss';
  payoutAmount: number;
  outcome: string;
  choice: string;
  seed: string;
  verificationHash: string;
  status: 'completed';
  metadata: Record<string, any>;
  playedAt: Date;
}

const VirtualGamePlaySchema = new Schema<IVirtualGamePlay>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    game: { type: String, enum: ['coin_flip', 'dice', 'color_wheel'], required: true, index: true },
    stakeAmount: { type: Number, required: true, min: 0 },
    multiplier: { type: Number, required: true, min: 1 },
    result: { type: String, enum: ['win', 'loss'], required: true },
    payoutAmount: { type: Number, default: 0, min: 0 },
    outcome: { type: String },
    choice: { type: String, required: true },
    seed: { type: String },
    verificationHash: { type: String },
    status: { type: String, enum: ['completed'], default: 'completed' },
    metadata: { type: Schema.Types.Mixed, default: {} },
    playedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

VirtualGamePlaySchema.index({ user: 1, playedAt: -1 });

export const VirtualGamePlayModel = mongoose.model<IVirtualGamePlay>('VirtualGamePlay', VirtualGamePlaySchema);
