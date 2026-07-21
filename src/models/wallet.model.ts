import mongoose from 'mongoose';

const Schema = mongoose.Schema;

export interface IWallet extends mongoose.Document {
  user: mongoose.Types.ObjectId;
  balance: number;
  lockedBalance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalStaked: number;
  totalWon: number;
  currency: string;
  isActive: boolean;
  lastTransactionAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  availableBalance(): number;
  canDebit(amount: number): boolean;
  lock(amount: number): boolean;
  unlock(amount: number): boolean;
}

const WalletSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  balance: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  lockedBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  totalDeposited: {
    type: Number,
    default: 0,
    min: 0
  },
  totalWithdrawn: {
    type: Number,
    default: 0,
    min: 0
  },
  totalStaked: {
    type: Number,
    default: 0,
    min: 0
  },
  totalWon: {
    type: Number,
    default: 0,
    min: 0
  },
  currency: {
    type: String,
    default: 'NGN',
    uppercase: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastTransactionAt: { type: Date }
}, {
  timestamps: true
});

WalletSchema.methods.availableBalance = function(this: IWallet): number {
  return this.balance - this.lockedBalance;
};

WalletSchema.methods.canDebit = function(this: IWallet, amount: number): boolean {
  return this.availableBalance() >= amount;
};

WalletSchema.methods.lock = function(this: IWallet, amount: number): boolean {
  if (this.availableBalance() < amount) return false;
  this.lockedBalance += amount;
  return true;
};

WalletSchema.methods.unlock = function(this: IWallet, amount: number): boolean {
  if (this.lockedBalance < amount) return false;
  this.lockedBalance -= amount;
  return true;
};

export const WalletModel = mongoose.model<IWallet>('Wallet', WalletSchema);