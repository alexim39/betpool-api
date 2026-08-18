import mongoose, { Schema, Document } from 'mongoose';

export interface ISocialLike extends Document {
  pod: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SocialLikeSchema = new Schema<ISocialLike>({
  pod: { type: Schema.Types.ObjectId, ref: 'Pod', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

SocialLikeSchema.index({ pod: 1, user: 1 }, { unique: true });

export const SocialLikeModel = mongoose.model<ISocialLike>('SocialLike', SocialLikeSchema);

export interface ISocialSave extends Document {
  pod: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SocialSaveSchema = new Schema<ISocialSave>({
  pod: { type: Schema.Types.ObjectId, ref: 'Pod', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

SocialSaveSchema.index({ pod: 1, user: 1 }, { unique: true });

export const SocialSaveModel = mongoose.model<ISocialSave>('SocialSave', SocialSaveSchema);

export interface ISocialFollow extends Document {
  follower: mongoose.Types.ObjectId;
  followee: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SocialFollowSchema = new Schema<ISocialFollow>({
  follower: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  followee: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

SocialFollowSchema.index({ follower: 1, followee: 1 }, { unique: true });
SocialFollowSchema.index({ followee: 1 });

export const SocialFollowModel = mongoose.model<ISocialFollow>('SocialFollow', SocialFollowSchema);

export interface ISocialComment extends Document {
  pod: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

const SocialCommentSchema = new Schema<ISocialComment>({
  pod: { type: Schema.Types.ObjectId, ref: 'Pod', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, trim: true, maxlength: 500 }
}, { timestamps: true });

SocialCommentSchema.index({ pod: 1, createdAt: -1 });

export const SocialCommentModel = mongoose.model<ISocialComment>('SocialComment', SocialCommentSchema);

export type SocialActivityType = 'pick_published' | 'pot_won' | 'pick_lost' | 'achievement' | 'system' | 'booking_code_shared' | 'staked_on_code';

export interface ISocialActivity extends Document {
  actor: mongoose.Types.ObjectId;
  type: SocialActivityType;
  pod?: mongoose.Types.ObjectId;
  payload?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const SocialActivitySchema = new Schema<ISocialActivity>({
  actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['pick_published', 'pot_won', 'pick_lost', 'achievement', 'system', 'booking_code_shared', 'staked_on_code'], required: true },
  pod: { type: Schema.Types.ObjectId, ref: 'Pod' },
  payload: { type: Schema.Types.Mixed }
}, { timestamps: true });

SocialActivitySchema.index({ actor: 1, createdAt: -1 });

export const SocialActivityModel = mongoose.model<ISocialActivity>('SocialActivity', SocialActivitySchema);
