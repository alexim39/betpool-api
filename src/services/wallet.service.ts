import mongoose from 'mongoose';
import { WalletModel, IWallet } from '../models/wallet.model';
import { TransactionModel, ITransaction } from '../models/transaction.model';
import { StakeModel } from '../models/stake.model';
import { BankAccountModel, IBankAccount } from '../models/bank-account.model';
import { paymentService } from './payment.service';
import { userService } from './user.service';
import { notifyDepositSuccess, notifyDepositFailed, notifyWithdrawalSubmitted, notifyWithdrawalCompleted, notifyWithdrawalFailed } from './notification.service';

interface DepositResult {
  success: boolean;
  reference: string;
  authorizationUrl?: string;
  message?: string;
}

interface WithdrawalResult {
  success: boolean;
  reference: string;
  message?: string;
}

export class WalletService {
  private generateReference(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  async getOrCreateWallet(userId: string): Promise<IWallet> {
    let wallet = await WalletModel.findOne({ user: userId });
    if (!wallet) {
      wallet = await WalletModel.create({
        user: userId,
        balance: 0,
        lockedBalance: 0,
        currency: 'NGN'
      });
    }
    return wallet;
  }

  async getBalance(userId: string): Promise<{ balance: number; locked: number; available: number; totalDeposited: number; totalWithdrawn: number; totalStaked: number; totalWon: number }> {
    const wallet = await this.getOrCreateWallet(userId);
    return {
      balance: wallet.balance,
      locked: wallet.lockedBalance,
      available: wallet.balance - wallet.lockedBalance,
      totalDeposited: wallet.totalDeposited || 0,
      totalWithdrawn: wallet.totalWithdrawn || 0,
      totalStaked: wallet.totalStaked || 0,
      totalWon: wallet.totalWon || 0,
    };
  }

  async initiateDeposit(
    userId: string, 
    amount: number, 
    provider: 'paystack',
    metadata?: Record<string, any>
  ): Promise<DepositResult> {
    if (amount < 5000) {
      return { success: false, reference: '', message: 'Minimum deposit is ₦5,000' };
    }
    if (amount > 1000000) {
      return { success: false, reference: '', message: 'Maximum deposit is ₦1,000,000' };
    }

    const wallet = await this.getOrCreateWallet(userId);
    const reference = this.generateReference('DEP');

    const transaction = await TransactionModel.create({
      user: userId,
      wallet: wallet._id,
      type: 'deposit',
      status: 'pending',
      amount,
      fee: 0,
      netAmount: amount,
      balanceBefore: wallet.balance,
      balanceAfter: wallet.balance,
      currency: 'NGN',
      reference,
      provider,
      metadata: { ...metadata, description: 'Wallet deposit' }
    });

    try {
      const authorizationUrl = await this.initiatePaystackDeposit(amount, reference, userId);
      return { 
        success: true, 
        reference, 
        authorizationUrl,
        message: 'Deposit initiated. Complete payment to credit your wallet.'
      };
    } catch (err: any) {
      transaction.status = 'failed';
      transaction.failureReason = err.message;
      await transaction.save();
      return { success: false, reference, message: err.message || 'Failed to initiate deposit' };
    }
  }

  private async initiatePaystackDeposit(amount: number, reference: string, userId: string): Promise<string> {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      throw new Error('Payment provider not configured');
    }

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: `user_${userId}@betpool.tech`,
        amount: amount * 100,
        reference,
        callback_url: `${process.env.FRONTEND_URL}/wallet/deposit/callback?ref=${reference}`,
        metadata: { userId, reference }
      })
    });
    const data = await response.json();
    if (!data.status) throw new Error(data.message || 'Paystack initialization failed');
    return data.data.authorization_url;
  }

  async handleDepositCallback(
    reference: string,
    provider: 'paystack',
    providerData: Record<string, any>
  ): Promise<{ success: boolean; message: string }> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const transaction = await TransactionModel.findOne({ reference }).session(session);
      if (!transaction) {
        await session.abortTransaction();
        return { success: false, message: 'Transaction not found' };
      }

      if (transaction.status === 'completed') {
        await session.abortTransaction();
        return { success: true, message: 'Already processed' };
      }

      const isSuccessful = providerData.data?.status === 'success';

      if (!isSuccessful) {
        transaction.status = 'failed';
        transaction.failureReason = providerData.message || 'Payment failed';
        transaction.failedAt = new Date();
        await transaction.save({ session });
        await session.commitTransaction();
        await notifyDepositFailed(transaction.user.toString(), transaction.amount, providerData.message || 'Payment failed').catch(e => console.error('notifyDepositFailed error:', e));
        return { success: false, message: 'Payment not successful' };
      }

      const wallet = await WalletModel.findById(transaction.wallet).session(session);
      if (!wallet) {
        await session.abortTransaction();
        return { success: false, message: 'Wallet not found' };
      }

      const newBalance = wallet.balance + transaction.amount;

      transaction.status = 'completed';
      transaction.balanceBefore = wallet.balance;
      transaction.balanceAfter = newBalance;
      transaction.completedAt = new Date();
      transaction.providerData = providerData;
      await transaction.save({ session });

      wallet.balance = newBalance;
      wallet.totalDeposited += transaction.amount;
      wallet.lastTransactionAt = new Date();
      await wallet.save({ session });

      await session.commitTransaction();

      await notifyDepositSuccess(transaction.user.toString(), transaction.amount, reference).catch(e => console.error('notifyDepositSuccess error:', e));
      return { success: true, message: `₦${transaction.amount.toLocaleString()} deposited successfully` };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async recoverPendingDeposits(userId: string): Promise<{ recovered: number; message: string }> {
    const pendingTransactions = await TransactionModel.find({
      user: userId,
      type: 'deposit',
      status: 'pending',
      provider: 'paystack',
      createdAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) }
    }).limit(5);

    let recovered = 0;
    for (const txn of pendingTransactions) {
      const verification = await paymentService.verifyPaystackTransaction(txn.reference);
      if (verification && verification.status === 'success') {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          const wallet = await WalletModel.findById(txn.wallet).session(session);
          if (wallet) {
            const newBalance = wallet.balance + txn.amount;
            txn.status = 'completed';
            txn.balanceBefore = wallet.balance;
            txn.balanceAfter = newBalance;
            txn.completedAt = new Date();
            txn.externalReference = verification.channel;
            if (txn.metadata && typeof txn.metadata === 'object') {
              (txn.metadata as any).verifiedAt = new Date().toISOString();
            }
            await txn.save({ session });

            wallet.balance = newBalance;
            wallet.totalDeposited += txn.amount;
            wallet.lastTransactionAt = new Date();
            await wallet.save({ session });

            await session.commitTransaction();
            recovered++;
          } else {
            await session.abortTransaction();
          }
        } catch (error) {
          await session.abortTransaction();
        } finally {
          session.endSession();
        }
      } else if (verification === null) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          txn.status = 'failed';
          txn.failureReason = 'Payment verification failed';
          txn.failedAt = new Date();
          await txn.save({ session });
          await session.commitTransaction();
        } catch (error) {
          await session.abortTransaction();
        } finally {
          session.endSession();
        }
      }
    }

    return {
      recovered,
      message: recovered > 0 ? `${recovered} pending deposit(s) credited` : 'No pending deposits found'
    };
  }

  async verifyAndCreditDeposit(reference: string): Promise<{ success: boolean; message: string }> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const transaction = await TransactionModel.findOne({ reference }).session(session);
      if (!transaction) {
        await session.abortTransaction();
        return { success: false, message: 'Transaction not found' };
      }

      if (transaction.status === 'completed') {
        await session.abortTransaction();
        return { success: true, message: 'Already processed' };
      }

      if (transaction.type !== 'deposit') {
        await session.abortTransaction();
        return { success: false, message: 'Invalid transaction type' };
      }

      const verification = await paymentService.verifyPaystackTransaction(reference);
      if (!verification || verification.status !== 'success') {
        transaction.status = 'failed';
        transaction.failureReason = 'Payment verification failed';
        transaction.failedAt = new Date();
        await transaction.save({ session });
        await session.commitTransaction();
        return { success: false, message: 'Payment verification failed' };
      }

      const wallet = await WalletModel.findById(transaction.wallet).session(session);
      if (!wallet) {
        await session.abortTransaction();
        return { success: false, message: 'Wallet not found' };
      }

      const newBalance = wallet.balance + transaction.amount;

      transaction.status = 'completed';
      transaction.balanceBefore = wallet.balance;
      transaction.balanceAfter = newBalance;
      transaction.completedAt = new Date();
      transaction.externalReference = verification.channel;
      if (transaction.metadata && typeof transaction.metadata === 'object') {
        (transaction.metadata as any).verifiedAt = new Date().toISOString();
      }
      await transaction.save({ session });

      wallet.balance = newBalance;
      wallet.totalDeposited += transaction.amount;
      wallet.lastTransactionAt = new Date();
      await wallet.save({ session });

      await session.commitTransaction();

      await notifyDepositSuccess(transaction.user.toString(), transaction.amount, reference).catch(e => console.error('notifyDepositSuccess error:', e));
      return { success: true, message: `₦${transaction.amount.toLocaleString()} deposited successfully` };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async initiateWithdrawal(
    userId: string,
    amount: number,
    bankCode: string,
    accountNumber: string,
    accountName: string,
    pin: string,
    narration?: string
  ): Promise<WithdrawalResult> {
    const pinValid = await userService.verifyPin(userId, pin);
    if (!pinValid) {
      return { success: false, reference: '', message: 'Incorrect PIN' };
    }

    const reference = this.generateReference('WDR');

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      if (amount < 500) {
        await session.abortTransaction();
        return { success: false, reference: '', message: 'Minimum withdrawal is ₦500' };
      }
      if (amount > 5_000_000) {
        await session.abortTransaction();
        return { success: false, reference: '', message: 'Maximum withdrawal is ₦5,000,000' };
      }

      // Atomically debit wallet — prevents race condition
      const wallet = await WalletModel.findOneAndUpdate(
        {
          user: userId,
          $expr: { $gte: [{ $subtract: ['$balance', '$lockedBalance'] }, amount] }
        },
        {
          $inc: { balance: -amount, totalWithdrawn: amount },
          $set: { lastTransactionAt: new Date() }
        },
        { new: true, session }
      );

      if (!wallet) {
        await session.abortTransaction();
        return { success: false, reference: '', message: 'Insufficient balance' };
      }

      const transaction = await TransactionModel.create([{
        user: userId,
        wallet: wallet._id,
        type: 'withdrawal',
        status: 'processing',
        amount,
        fee: 0,
        netAmount: amount,
        balanceBefore: wallet.balance + amount,
        balanceAfter: wallet.balance,
        currency: 'NGN',
        reference,
        provider: 'bank_transfer',
        metadata: {
          description: 'Withdrawal to bank account',
          bankCode,
          accountNumber,
          accountName,
          narration: narration || 'BetPool Withdrawal'
        }
      }], { session });

      await notifyWithdrawalSubmitted(userId, amount, `${accountName} - ${accountNumber}`).catch(e => console.error('notifyWithdrawalSubmitted error:', e));

      const transferResult = await this.processBankTransfer(transaction[0], bankCode, accountNumber, accountName, narration);

      if (!transferResult.success) {
        await session.abortTransaction();
        await notifyWithdrawalFailed(userId, amount, transferResult.message || 'Transfer failed').catch(e => console.error('notifyWithdrawalFailed error:', e));
        return { success: false, reference, message: transferResult.message || 'Transfer failed' };
      }

      transaction[0].status = 'completed';
      transaction[0].completedAt = new Date();
      transaction[0].providerData = transferResult.providerData;
      await transaction[0].save({ session });

      await session.commitTransaction();

      await notifyWithdrawalCompleted(userId, amount, `${accountName} - ${accountNumber}`).catch(e => console.error('notifyWithdrawalCompleted error:', e));

      return { success: true, reference, message: 'Withdrawal processed successfully' };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  private async processBankTransfer(
    transaction: ITransaction,
    bankCode: string,
    accountNumber: string,
    accountName: string,
    narration?: string
  ): Promise<{ success: boolean; message?: string; providerData?: any }> {
    return this.processPaystackTransfer(transaction, bankCode, accountNumber, accountName, narration);
  }

  private async processPaystackTransfer(
    transaction: ITransaction,
    bankCode: string,
    accountNumber: string,
    accountName: string,
    narration?: string
  ): Promise<{ success: boolean; message?: string; providerData?: any }> {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      return { success: false, message: 'Payment provider not configured' };
    }

    try {
      const recipientCode = await paymentService.createTransferRecipient(accountName, accountNumber, bankCode);
      const response = await fetch('https://api.paystack.co/transfer', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secretKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source: 'balance',
          amount: transaction.netAmount * 100,
          reference: transaction.reference,
          recipient: recipientCode,
          reason: narration || 'BetPool Withdrawal'
        })
      });
      const data = await response.json();
      if (data.status === true) {
        return { success: true, providerData: data };
      }
      return { success: false, message: data.message || 'Transfer failed', providerData: data };
    } catch (err: any) {
      return { success: false, message: err.message || 'Transfer failed' };
    }
  }

  async lockBalance(userId: string, amount: number, stakeId: string): Promise<boolean> {
    const wallet = await WalletModel.findOneAndUpdate(
      { user: new mongoose.Types.ObjectId(userId),
        $expr: { $gte: [{ $subtract: ['$balance', '$lockedBalance'] }, amount] }
      },
      { $inc: { lockedBalance: amount }, $set: { lastTransactionAt: new Date() } },
      { new: true }
    );
    if (!wallet) return false;

    await TransactionModel.create({
      user: userId,
      wallet: wallet._id,
      type: 'stake',
      status: 'completed',
      amount,
      fee: 0,
      netAmount: amount,
      balanceBefore: wallet.balance,
      balanceAfter: wallet.balance,
      currency: 'NGN',
      reference: `STK_${stakeId}`,
      provider: 'internal',
      metadata: { description: 'Stake locked', stakeId }
    });
    return true;
  }

  async unlockBalance(userId: string, amount: number, stakeId: string): Promise<boolean> {
    const wallet = await WalletModel.findOneAndUpdate(
      { user: new mongoose.Types.ObjectId(userId),
        lockedBalance: { $gte: amount }
      },
      { $inc: { lockedBalance: -amount }, $set: { lastTransactionAt: new Date() } },
      { new: true }
    );
    if (!wallet) return false;

    await TransactionModel.create({
      user: userId,
      wallet: wallet._id,
      type: 'stake_refund',
      status: 'completed',
      amount,
      fee: 0,
      netAmount: amount,
      balanceBefore: wallet.balance,
      balanceAfter: wallet.balance,
      currency: 'NGN',
      reference: `REF_${stakeId}`,
      provider: 'internal',
      metadata: { description: 'Stake refunded', stakeId }
    });

    return true;
  }

  async settleStake(
    userId: string,
    stakeId: string,
    status: 'won' | 'lost' | 'void' | 'refunded',
    stakeAmount: number,
    netPayout: number,
    platformFee: number
  ): Promise<boolean> {
    if (status === 'lost') {
      await WalletModel.findOneAndUpdate(
        { user: new mongoose.Types.ObjectId(userId),
          lockedBalance: { $gte: stakeAmount }
        },
        { $inc: { lockedBalance: -stakeAmount }, $set: { lastTransactionAt: new Date() } },
        { new: true }
      );
      return true;
    }

    const amount = (status === 'won') ? netPayout : stakeAmount;
    const description = status === 'won' ? 'Stake won' : (status === 'void' ? 'Stake voided' : 'Stake refunded');

    const wallet = await WalletModel.findOneAndUpdate(
      { user: new mongoose.Types.ObjectId(userId),
        lockedBalance: { $gte: stakeAmount }
      },
      { $inc: { lockedBalance: -stakeAmount, balance: amount, ...(status === 'won' ? { totalWon: netPayout } : {}) },
        $set: { lastTransactionAt: new Date() } },
      { new: true }
    );
    if (!wallet) return false;

    await TransactionModel.create({
      user: userId,
      wallet: wallet._id,
      type: status === 'won' ? 'payout' : 'refund',
      status: 'completed',
      amount,
      fee: platformFee,
      netAmount: amount,
      balanceBefore: wallet.balance - amount,
      balanceAfter: wallet.balance,
      currency: 'NGN',
      reference: `${(status === 'won' ? 'PAYOUT' : 'REFUND')}_${stakeId}`,
      provider: 'internal',
      metadata: { description, stakeId, platformFee }
    });

    return true;
  }

  async getTransactionHistory(
    userId: string,
    options: { 
      page?: number; 
      limit?: number; 
      type?: string; 
      status?: string;
      startDate?: Date;
      endDate?: Date;
    } = {}
  ): Promise<{ transactions: ITransaction[]; total: number }> {
    const query: Record<string, any> = { user: userId };
    if (options.type) query.type = options.type;
    if (options.status) query.status = options.status;
    if (options.startDate || options.endDate) {
      query.createdAt = {};
      if (options.startDate) query.createdAt.$gte = options.startDate;
      if (options.endDate) query.createdAt.$lte = options.endDate;
    }

    const page = options.page || 1;
    const limit = Math.min(options.limit || 20, 100);

    const [transactions, total] = await Promise.all([
      TransactionModel.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean() as unknown as Promise<ITransaction[]>,
      TransactionModel.countDocuments(query)
    ]);

    return { transactions, total };
  }

  async getWalletSummary(userId: string): Promise<{
    balance: number;
    locked: number;
    available: number;
    totalDeposited: number;
    totalWithdrawn: number;
    totalStaked: number;
    totalWon: number;
  }> {
    const wallet = await this.getOrCreateWallet(userId);
    return {
      balance: wallet.balance,
      locked: wallet.lockedBalance,
      available: wallet.balance - wallet.lockedBalance,
      totalDeposited: wallet.totalDeposited,
      totalWithdrawn: wallet.totalWithdrawn,
      totalStaked: wallet.totalStaked,
      totalWon: wallet.totalWon
    };
  }
  async saveAccount(userId: string, bankCode: string, accountNumber: string, accountName: string, bankName: string): Promise<IBankAccount> {
    const existing = await BankAccountModel.findOne({ userId, bankCode, accountNumber });
    if (existing) {
      existing.bankName = bankName;
      existing.accountName = accountName;
      return existing.save();
    }
    const count = await BankAccountModel.countDocuments({ userId });
    return BankAccountModel.create({
      userId,
      bankName,
      bankCode,
      accountNumber,
      accountName,
      isDefault: count === 0
    });
  }

  async getSavedAccounts(userId: string): Promise<IBankAccount[]> {
    return BankAccountModel.find({ userId }).sort({ isDefault: -1, createdAt: -1 });
  }

  async deleteSavedAccount(userId: string, accountId: string): Promise<void> {
    const acct = await BankAccountModel.findOne({ _id: accountId, userId });
    if (!acct) throw new Error('Account not found');
    const wasDefault = acct.isDefault;
    await BankAccountModel.deleteOne({ _id: accountId, userId });
    if (wasDefault) {
      const next = await BankAccountModel.findOne({ userId }).sort({ createdAt: -1 });
      if (next) {
        next.isDefault = true;
        await next.save();
      }
    }
  }

  async setDefaultAccount(userId: string, accountId: string): Promise<void> {
    const acct = await BankAccountModel.findOne({ _id: accountId, userId });
    if (!acct) throw new Error('Account not found');
    await BankAccountModel.updateMany({ userId }, { isDefault: false });
    acct.isDefault = true;
    await acct.save();
  }
}

export const walletService = new WalletService();