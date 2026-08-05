import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true },
    podId: { type: String },
    pick: { type: String },
    sentTo: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const OraPickPushModel = mongoose.model('OraPickPush', schema);
