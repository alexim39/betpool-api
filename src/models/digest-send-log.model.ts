import mongoose from 'mongoose';

const Schema = mongoose.Schema;

export interface IDigestSendLog extends mongoose.Document {
  userId: mongoose.Types.ObjectId;
  day: string;
  status: 'sending' | 'sent' | 'failed';
  attempts: number;
  error?: string;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DigestSendLogSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  day: { type: String, required: true },
  status: { type: String, enum: ['sending', 'sent', 'failed'], default: 'sending' },
  attempts: { type: Number, default: 1 },
  error: { type: String },
  sentAt: { type: Date }
}, {
  timestamps: true
});

DigestSendLogSchema.index({ userId: 1, day: 1 }, { unique: true });
DigestSendLogSchema.index({ day: 1, status: 1 });

export const DigestSendLogModel = mongoose.model<IDigestSendLog>('DigestSendLog', DigestSendLogSchema);