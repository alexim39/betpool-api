import mongoose, { Document, Schema } from 'mongoose';

export interface ILoan extends Document {
  user: mongoose.Types.ObjectId;
  amount: number;
  interestRate: number;
  status: 'pending' | 'approved' | 'active' | 'repaid' | 'defaulted' | 'rejected';
  purpose: string;
  requestedAt: Date;
  approvedAt?: Date;
  approvedBy?: mongoose.Types.ObjectId;
  dueDate?: Date;
  repaidAt?: Date;
  repaymentAmount?: number;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const LoanSchema = new Schema<ILoan>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true, min: 100 },
  interestRate: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['pending', 'approved', 'active', 'repaid', 'defaulted', 'rejected'],
    default: 'pending'
  },
  purpose: { type: String, required: true },
  requestedAt: { type: Date, default: Date.now },
  approvedAt: { type: Date },
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  dueDate: { type: Date },
  repaidAt: { type: Date },
  repaymentAmount: { type: Number },
  note: { type: String },
}, { timestamps: true });

export const LoanModel = mongoose.model<ILoan>('Loan', LoanSchema);
