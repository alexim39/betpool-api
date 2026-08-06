import mongoose from 'mongoose';

const Schema = mongoose.Schema;

export interface IUser extends mongoose.Document {
  phone: string;
  fullName: string;
  email?: string;
  pinHash: string;
  role: 'user' | 'admin';
  tokenVersion: number;
  failedLoginAttempts: number;
  lockedUntil?: Date;
  phoneVerified: boolean;
  kycVerified: boolean;
  kycType: 'bvn' | 'nin' | null;
  kycNumber: string;
  kycSubmittedAt?: Date;
  kycReviewedAt?: Date;
  kycReviewNote?: string;
  kycData: {
    bvn?: string;
    nin?: string;
    dob?: string;
    address?: string;
  };
  referralCode: string;
  referredBy?: mongoose.Types.ObjectId;
  referralBonusPaid: boolean;
  isActive: boolean;
  isSuspended: boolean;
  lastLoginAt?: Date;
  digestOptOut?: boolean;
  lastDigestSentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = new Schema({
  phone: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
    match: /^\+?[1-9]\d{1,14}$/
  },
  fullName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  email: {
    type: String,
    lowercase: true,
    trim: true,
    sparse: true,
    unique: true,
    maxlength: 255
  },
  pinHash: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
    index: true
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  kycVerified: {
    type: Boolean,
    default: false
  },
  kycType: {
    type: String,
    enum: ['bvn', 'nin', null],
    default: null
  },
  kycNumber: { type: String },
  kycSubmittedAt: { type: Date },
  kycReviewedAt: { type: Date },
  kycReviewNote: { type: String },
  kycData: {
    bvn: { type: String, trim: true, sparse: true, unique: true },
    nin: { type: String, trim: true, sparse: true, unique: true },
    dob: { type: String },
    address: { type: String }
  },
  referralCode: {
    type: String,
    unique: true,
    sparse: true,
    uppercase: true,
    length: 6
  },
  referredBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  referralBonusPaid: {
    type: Boolean,
    default: false
  },
  tokenVersion: {
    type: Number,
    default: 0
  },
  failedLoginAttempts: {
    type: Number,
    default: 0
  },
  lockedUntil: {
    type: Date,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isSuspended: {
    type: Boolean,
    default: false
  },
  lastLoginAt: { type: Date },
  digestOptOut: { type: Boolean, default: false },
  lastDigestSentAt: { type: Date }
}, {
  timestamps: true
});

UserSchema.set('toJSON', { virtuals: true });
UserSchema.set('toObject', { virtuals: true });

UserSchema.virtual('registrationDate').get(function (this: IUser) {
  return this.createdAt;
});

UserSchema.index({ createdAt: 1 }, { name: 'idx_users_registration_date' });

export const UserModel = mongoose.model<IUser>('User', UserSchema);