import mongoose from 'mongoose';

const Schema = mongoose.Schema;

export interface ISettings extends mongoose.Document {
  reserveAmount: number;
  updatedBy?: mongoose.Types.ObjectId;
  updatedAt: Date;
}

const SettingsSchema = new Schema({
  reserveAmount: {
    type: Number,
    required: true,
    default: 1_000_000,
    min: 0,
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
}, { timestamps: true });

export const SettingsModel = mongoose.model<ISettings>('Settings', SettingsSchema);

export async function getOrCreateSettings(): Promise<ISettings> {
  let settings = await SettingsModel.findOne().sort({ createdAt: -1 });
  if (!settings) {
    settings = await SettingsModel.create({ reserveAmount: 1_000_000 });
  }
  return settings;
}
