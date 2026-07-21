import mongoose, { Schema, Document } from 'mongoose';

export interface IBankAccount extends Document {
  userId: mongoose.Types.ObjectId;
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BankAccountSchema = new Schema<IBankAccount>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  bankName: { type: String, required: true },
  bankCode: { type: String, required: true },
  accountNumber: { type: String, required: true },
  accountName: { type: String, required: true },
  isDefault: { type: Boolean, default: false }
}, { timestamps: true });

BankAccountSchema.index({ userId: 1, bankCode: 1, accountNumber: 1 }, { unique: true });

export const BankAccountModel = mongoose.model<IBankAccount>('BankAccount', BankAccountSchema);
