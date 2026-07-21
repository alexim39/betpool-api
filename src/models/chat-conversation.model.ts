import mongoose, { Schema, Document } from 'mongoose';

export interface IChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface IChatConversation extends Document {
  user: mongoose.Types.ObjectId;
  messages: IChatMessage[];
  status: 'active' | 'escalated' | 'resolved';
  escalatedAt?: Date;
  escalationReason?: string;
  escalatedNotified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ChatMessageSchema = new Schema<IChatMessage>({
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const ChatConversationSchema = new Schema<IChatConversation>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  messages: [ChatMessageSchema],
  status: { type: String, enum: ['active', 'escalated', 'resolved'], default: 'active' },
  escalatedAt: { type: Date },
  escalationReason: { type: String },
  escalatedNotified: { type: Boolean, default: false }
}, { timestamps: true });

ChatConversationSchema.index({ user: 1, updatedAt: -1 });
ChatConversationSchema.index({ status: 1, updatedAt: -1 });

export const ChatConversationModel = mongoose.model<IChatConversation>('ChatConversation', ChatConversationSchema);
