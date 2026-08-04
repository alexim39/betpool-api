import { Schema, model, Document } from 'mongoose';

export interface IAbTestEvent extends Document {
  experimentKey: string;
  userId: string;
  variant: string;
  event: string;
  meta: Record<string, any>;
  createdAt: Date;
}

const AbTestEventSchema = new Schema<IAbTestEvent>(
  {
    experimentKey: { type: String, required: true, trim: true, index: true },
    userId: { type: String, required: true, trim: true },
    variant: { type: String, required: true },
    event: { type: String, required: true, trim: true },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

AbTestEventSchema.index({ experimentKey: 1, userId: 1, event: 1 });

export const AbTestEventModel = model<IAbTestEvent>('AbTestEvent', AbTestEventSchema);