import mongoose, { Schema, Document } from 'mongoose';

export interface ICurationJob extends Document {
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: Record<string, any>;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
}

const CurationJobSchema = new Schema<ICurationJob>({
  status: { type: String, enum: ['pending', 'running', 'completed', 'failed'], default: 'pending' },
  result: { type: Schema.Types.Mixed },
  error: { type: String },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
}, { timestamps: true });

CurationJobSchema.index({ status: 1, createdAt: -1 });

export const CurationJobModel = mongoose.model<ICurationJob>('CurationJob', CurationJobSchema);
