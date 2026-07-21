import mongoose from 'mongoose';

const Schema = mongoose.Schema;

export interface IUser extends mongoose.Document {
  phone: string;
  fullName: string;
  email?: string;
  pinHash: string;
  role: 'user' | 'admin';
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
  isActive: boolean;
  isSuspended: boolean;
  lastLoginAt?: Date;
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
  isActive: {
    type: Boolean,
    default: true
  },
  isSuspended: {
    type: Boolean,
    default: false
  },
  lastLoginAt: { type: Date }
}, {
  timestamps: true
});

UserSchema.set('toJSON', { virtuals: true });
UserSchema.set('toObject', { virtuals: true });

export const UserModel = mongoose.model<IUser>('User', UserSchema);