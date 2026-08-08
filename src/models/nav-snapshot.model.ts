import mongoose, { Schema, Document } from 'mongoose';

export interface INavSnapshot extends Document {
  tier: 'defender' | 'midfielder' | 'striker' | 'goalkeeper';
  cycleNumber: number;
  nav: number;
  totalValue: number;
  units: number;
  at: Date;
  createdAt: Date;
}

const NavSnapshotSchema = new Schema<INavSnapshot>({
  tier: { type: String, enum: ['defender', 'midfielder', 'striker', 'goalkeeper'], required: true },
  cycleNumber: { type: Number, required: true },
  nav: { type: Number, required: true },
  totalValue: { type: Number, default: 0 },
  units: { type: Number, default: 0 },
  at: { type: Date, required: true },
}, { timestamps: true });

NavSnapshotSchema.index({ tier: 1, at: -1 }, { unique: true });
NavSnapshotSchema.index({ tier: 1, cycleNumber: 1, at: -1 });

export const NavSnapshotModel = mongoose.model<INavSnapshot>('NavSnapshot', NavSnapshotSchema);
