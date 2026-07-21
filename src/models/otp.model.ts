import mongoose from 'mongoose';

const Schema = mongoose.Schema;

export interface IOtp extends mongoose.Document {
  phone: string;
  code: string;
  purpose: 'signup' | 'login' | 'reset_pin' | 'verify_phone' | 'email_login';
  attempts: number;
  maxAttempts: number;
  consumed: boolean;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OtpSchema = new Schema({
  phone: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    length: 6
  },
  purpose: {
    type: String,
    required: true,
    enum: ['signup', 'login', 'reset_pin', 'verify_phone', 'email_login']
  },
  attempts: {
    type: Number,
    default: 0
  },
  maxAttempts: {
    type: Number,
    default: 3
  },
  consumed: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }
  }
}, {
  timestamps: true
});

OtpSchema.index({ phone: 1, purpose: 1, consumed: 1 });

export const OtpModel = mongoose.model<IOtp>('Otp', OtpSchema);