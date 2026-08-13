import mongoose, { Schema, Model, Document } from 'mongoose';

export interface IBookingCodeLeg {
  podId: string;
  homeTeam: string;
  awayTeam: string;
  selection: string;
  multiplier: number;
  league?: string;
}

export interface IBookingCode extends Document {
  code: string;
  userId: mongoose.Types.ObjectId;
  podIds: string[];
  legs: IBookingCodeLeg[];
  expiresAt: Date;
  usedCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const BookingCodeLegSchema = new Schema({
  podId: { type: String, required: true },
  homeTeam: { type: String, required: true, trim: true },
  awayTeam: { type: String, required: true, trim: true },
  selection: { type: String, trim: true },
  multiplier: { type: Number, min: 1.01 },
  league: { type: String, trim: true }
}, { _id: false });

const BookingCodeSchema = new Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true
  },
  userId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'User',
    index: true
  },
  podIds: [{ type: String, required: true }],
  legs: [BookingCodeLegSchema],
  expiresAt: { type: Date, required: true, index: true },
  usedCount: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

export const BookingCodeModel: Model<IBookingCode> = mongoose.model<IBookingCode>('BookingCode', BookingCodeSchema);
export default BookingCodeModel;