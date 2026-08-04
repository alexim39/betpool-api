import { Schema, model, Document } from 'mongoose';

export interface IAbTest extends Document {
  key: string;
  description: string;
  enabled: boolean;
  controlShare: number;
  createdAt: Date;
  updatedAt: Date;
}

const AbTestSchema = new Schema<IAbTest>(
  {
    key: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: '' },
    enabled: { type: Boolean, default: false },
    controlShare: { type: Number, default: 50, min: 0, max: 100 },
  },
  { timestamps: true }
);

export const AbTestModel = model<IAbTest>('AbTest', AbTestSchema);