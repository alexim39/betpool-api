import mongoose from 'mongoose';

const Schema = mongoose.Schema;

export interface IFeaturedBanner extends mongoose.Document {
  title: string;
  subtitle: string;
  description: string;
  ctaLabel: string;
  ctaLink: string;
  emoji: string;
  gradientStart: string;
  gradientEnd: string;
  isActive: boolean;
  startsAt?: Date;
  expiresAt?: Date;
  displayOrder: number;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FeaturedBannerSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 100 },
  subtitle: { type: String, default: '', trim: true, maxlength: 150 },
  description: { type: String, default: '', trim: true, maxlength: 300 },
  ctaLabel: { type: String, default: 'Bet Now', trim: true, maxlength: 30 },
  ctaLink: { type: String, default: '/home', trim: true },
  emoji: { type: String, default: '🔥', maxlength: 10 },
  gradientStart: { type: String, default: '#E8B923' },
  gradientEnd: { type: String, default: '#FF6B35' },
  isActive: { type: Boolean, default: true, index: true },
  startsAt: { type: Date },
  expiresAt: { type: Date },
  displayOrder: { type: Number, default: 0 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

FeaturedBannerSchema.index({ isActive: 1, displayOrder: 1 });

export const FeaturedBannerModel = mongoose.model<IFeaturedBanner>('FeaturedBanner', FeaturedBannerSchema);
