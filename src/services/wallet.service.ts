import mongoose from 'mongoose';
import crypto from 'crypto';
import { WalletModel, IWallet } from '../models/wallet.model';
import { TransactionModel, ITransaction } from '../models/transaction.model';
import { StakeModel } from '../models/stake.model';
import { BankAccountModel, IBankAccount } from '../models/bank-account.model';
import { paymentService } from './payment.service';
import { userService } from './user.service';
import { notifyDepositSuccess, notifyDepositFailed, notifyWithdrawalSubmitted, notifyWithdrawalCompleted, notifyWithdrawalFailed } from './notification.service';
import { runTransaction } from '../utils/transaction';
import { logger } from './logger.service';
import {
  TransactionHistoryQuery,
  TransactionHistoryResult,
  WALLET_TYPES,
  WALLET_STATUSES,
} from '../modules/wallet/wallet.dto';

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function escapeRegex(s: string): string {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

const HISTORY_SORT_FIELDS: Record<string, string> = {
  createdAt: 'createdAt',
  amount: 'amount',
  type: 'type',
  status: 'status',
};

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
    const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `${prefix}_${Date.now()}_${rand}`;
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
    if (amount < 500) {
      return { success: false, reference: '', message: 'Minimum deposit is ₦500' };
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
    return runTransaction(async (session) => {
      const transaction = await TransactionModel.findOneAndUpdate(
        { reference, status: { $in: ['pending', 'processing'] } },
        { $set: { status: 'processing' } },
        { session, new: true }
      );
      if (!transaction) {
        const existing = await TransactionModel.findOne({ reference }).session(session);
        if (!existing) return { success: false, message: 'Transaction not found' };
        return { success: true, message: 'Already processed' };
      }

      const isSuccessful = providerData.data?.status === 'success';

      if (!isSuccessful) {
        transaction.status = 'failed';
        transaction.failureReason = providerData.message || 'Payment failed';
        transaction.failedAt = new Date();
        await transaction.save({ session });
        await notifyDepositFailed(transaction.user.toString(), transaction.amount, providerData.message || 'Payment failed').catch(e => logger.error('notifyDepositFailed error', e));
        return { success: false, message: 'Payment not successful' };
      }

      const wallet = await WalletModel.findById(transaction.wallet).session(session);
      if (!wallet) {
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

      await notifyDepositSuccess(transaction.user.toString(), transaction.amount, reference).catch(e => logger.error('notifyDepositSuccess error', e));
      return { success: true, message: `₦${transaction.amount.toLocaleString()} deposited successfully` };
    });
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
    for (const pendingTxn of pendingTransactions) {
      const verification = await paymentService.verifyPaystackTransaction(pendingTxn.reference);
      if (verification && verification.status === 'success') {
        const r = await runTransaction(async (session) => {
          // Re-fetch inside transaction to prevent race conditions
          const txn = await TransactionModel.findOneAndUpdate(
            { reference: pendingTxn.reference, status: { $in: ['pending', 'processing'] } },
            { $set: { status: 'processing' } },
            { session, new: true }
          );
          if (!txn) return false;

          const wallet = await WalletModel.findById(txn.wallet).session(session);
          if (!wallet) return false;
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
          return true;
        });
        if (r) recovered++;
      } else if (verification === null) {
        await runTransaction(async (session) => {
          const txn = await TransactionModel.findOneAndUpdate(
            { reference: pendingTxn.reference, status: 'pending' },
            { $set: { status: 'failed', failureReason: 'Payment verification failed', failedAt: new Date() } },
            { session }
          );
        });
      }
    }

    return {
      recovered,
      message: recovered > 0 ? `${recovered} pending deposit(s) credited` : 'No pending deposits found'
    };
  }

  async verifyAndCreditDeposit(reference: string): Promise<{ success: boolean; message: string }> {
    return runTransaction(async (session) => {
      // Atomically claim the pending deposit to prevent race conditions
      const transaction = await TransactionModel.findOneAndUpdate(
        { reference, status: { $in: ['pending', 'processing'] } },
        { $set: { status: 'processing' } },
        { session, new: true }
      );
      if (!transaction) {
        const existing = await TransactionModel.findOne({ reference }).session(session);
        if (!existing) return { success: false, message: 'Transaction not found' };
        return { success: true, message: 'Already processed' };
      }

      if (transaction.type !== 'deposit') {
        return { success: false, message: 'Invalid transaction type' };
      }

      const verification = await paymentService.verifyPaystackTransaction(reference);
      if (!verification || verification.status !== 'success') {
        transaction.status = 'failed';
        transaction.failureReason = 'Payment verification failed';
        transaction.failedAt = new Date();
        await transaction.save({ session });
        return { success: false, message: 'Payment verification failed' };
      }

      // Verify Paystack-collected amount matches the stored transaction amount
      if (verification.amount !== transaction.amount) {
        transaction.status = 'failed';
        transaction.failureReason = `Amount mismatch: transaction=${transaction.amount}, Paystack collected=${verification.amount}`;
        transaction.failedAt = new Date();
        await transaction.save({ session });
        return { success: false, message: 'Amount mismatch' };
      }

      const wallet = await WalletModel.findById(transaction.wallet).session(session);
      if (!wallet) {
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

      await notifyDepositSuccess(transaction.user.toString(), transaction.amount, reference).catch(e => logger.error('notifyDepositSuccess error', e));
      return { success: true, message: `₦${transaction.amount.toLocaleString()} deposited successfully` };
    });
  }

  async confirmWithdrawal(reference: string): Promise<{ success: boolean; message: string }> {
    return runTransaction(async (session) => {
      const transaction = await TransactionModel.findOne({ reference, type: 'withdrawal' }).session(session);
      if (!transaction) {
        return { success: false, message: 'Withdrawal transaction not found' };
      }
      if (transaction.status === 'completed') {
        return { success: true, message: 'Already processed' };
      }

      transaction.status = 'completed';
      transaction.completedAt = new Date();
      await transaction.save({ session });

      await notifyWithdrawalCompleted(transaction.user.toString(), transaction.amount, reference).catch(e => logger.error('notifyWithdrawalCompleted error', e));
      return { success: true, message: 'Withdrawal completed' };
    });
  }

  async failWithdrawal(reference: string): Promise<{ success: boolean; message: string }> {
    return runTransaction(async (session) => {
      const transaction = await TransactionModel.findOne({ reference, type: 'withdrawal' }).session(session);
      if (!transaction) {
        return { success: false, message: 'Withdrawal transaction not found' };
      }
      if (transaction.status === 'completed' || transaction.status === 'failed') {
        return { success: true, message: 'Already processed' };
      }

      const wallet = await WalletModel.findById(transaction.wallet).session(session);
      if (!wallet) {
        return { success: false, message: 'Wallet not found' };
      }

      const refundAmount = transaction.amount;
      wallet.balance += refundAmount;
      wallet.totalWithdrawn -= refundAmount;
      wallet.lastTransactionAt = new Date();
      await wallet.save({ session });

      transaction.status = 'failed';
      transaction.failureReason = 'Paystack transfer failed';
      transaction.failedAt = new Date();
      transaction.balanceAfter = wallet.balance;
      await transaction.save({ session });

      await notifyWithdrawalFailed(transaction.user.toString(), transaction.amount, 'Transfer failed — funds returned to wallet').catch(e => logger.error('notifyWithdrawalFailed error', e));
      return { success: true, message: 'Withdrawal marked failed, wallet re-credited' };
    });
  }

  async initiateWithdrawal(
    userId: string,
    amount: number,
    bankCode: string,
    bankName: string | undefined,
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

    if (amount < 500) {
      return { success: false, reference: '', message: 'Minimum withdrawal is ₦500' };
    }
    if (amount > 5_000_000) {
      return { success: false, reference: '', message: 'Maximum withdrawal is ₦5,000,000' };
    }

    // Enforce daily withdrawal limit (₦10,000,000)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayAgg = await TransactionModel.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId), type: 'withdrawal', status: { $in: ['completed', 'processing'] }, createdAt: { $gte: todayStart } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const todayWithdrawn = todayAgg[0]?.total || 0;
    if (todayWithdrawn + amount > 10_000_000) {
      return { success: false, reference: '', message: 'Daily withdrawal limit of ₦10,000,000 exceeded' };
    }

    // Phase 1: Deduct balance and create pending transaction
    const phase1 = await runTransaction(async (session) => {
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

      if (!wallet) return null;

      const [txn] = await TransactionModel.create([{
        user: userId,
        wallet: wallet._id,
        type: 'withdrawal',
        status: 'pending',
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
          bankName: bankName || '',
          accountNumber,
          accountName,
          narration: narration || 'BetPool Withdrawal'
        }
      }], { session });

      return { txn, walletBalance: wallet.balance };
    });

    if (!phase1) {
      return { success: false, reference: '', message: 'Insufficient balance' };
    }

    const { txn: transaction } = phase1;

    notifyWithdrawalSubmitted(userId, amount, `${accountName} - ${accountNumber}`).catch(e => logger.error('notifyWithdrawalSubmitted error', e));

    // Look up or create Paystack recipient code to avoid duplicates
    let recipientCode: string | undefined;
    try {
      const savedAccount = await BankAccountModel.findOne({ userId: new mongoose.Types.ObjectId(userId), bankCode, accountNumber });
      if (savedAccount?.recipientCode) {
        recipientCode = savedAccount.recipientCode;
      } else {
        const code = await paymentService.createTransferRecipient(accountName, accountNumber, bankCode);
        if (savedAccount) {
          await BankAccountModel.updateOne({ _id: savedAccount._id }, { $set: { recipientCode: code } });
        }
        recipientCode = code;
      }
    } catch (err: any) {
      logger.warn('Failed to get/create Paystack recipient code, will retry inside transfer loop', { error: err.message });
    }

    // Phase 2: Call Paystack outside DB transaction (wrapped in try-catch to prevent stuck deductions)
    let transferResult: { success: boolean; message?: string; providerData?: any };
    try {
      transferResult = await this.processPaystackTransfer(
        transaction as any, bankCode, accountNumber, accountName, narration, recipientCode
      );
    } catch (err: any) {
      logger.error('processPaystackTransfer threw unexpectedly — refunding wallet', { transactionId: transaction._id, error: err.message });
      await this.refundWithdrawal(transaction._id.toString(), err.message || 'Transfer failed');
      notifyWithdrawalFailed(userId, amount, 'Transfer failed — funds returned to wallet').catch(e => logger.error('notifyWithdrawalFailed error', e));
      return { success: false, reference, message: 'Transfer failed — funds returned to wallet' };
    }

    // Phase 3: Record the result in a new DB transaction
    if (!transferResult.success) {
      await this.refundWithdrawal(transaction._id.toString(), transferResult.message || 'Transfer failed');
      notifyWithdrawalFailed(userId, amount, transferResult.message || 'Transfer failed').catch(e => logger.error('notifyWithdrawalFailed error', e));
      return { success: false, reference, message: transferResult.message || 'Transfer failed' };
    }

    // Transfer initiated successfully — mark as processing; webhook will finalize
    await runTransaction(async (session) => {
      const txn = await TransactionModel.findById(transaction._id).session(session);
      if (!txn || txn.status !== 'pending') return;
      txn.status = 'processing';
      txn.providerData = { ...(txn.providerData || {}), ...(transferResult.providerData || {}) };
      await txn.save({ session });
    });

    return { success: true, reference, message: 'Withdrawal is being processed' };
  }

  private async processBankTransfer(
    transaction: ITransaction,
    bankCode: string,
    accountNumber: string,
    accountName: string,
    narration?: string,
    existingRecipientCode?: string
  ): Promise<{ success: boolean; message?: string; providerData?: any }> {
    return this.processPaystackTransfer(transaction, bankCode, accountNumber, accountName, narration, existingRecipientCode);
  }

  async processPaystackTransfer(
    transaction: ITransaction,
    bankCode: string,
    accountNumber: string,
    accountName: string,
    narration?: string,
    existingRecipientCode?: string
  ): Promise<{ success: boolean; message?: string; providerData?: any }> {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      return { success: false, message: 'Payment provider not configured' };
    }

    let lastError: any;
    let recipientCode = existingRecipientCode || '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (!recipientCode) {
          recipientCode = await paymentService.createTransferRecipient(accountName, accountNumber, bankCode);
        }
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
        if (response.ok && data.status === true && data.data?.status) {
          const transferStatus = data.data.status;
          const transferCode = data.data.transfer_code || data.data.code;
          if (['received', 'pending', 'otp', 'success'].includes(transferStatus)) {
            // Poll transfer status — Paystack may reject "received" transfers seconds later
            let finalStatus = transferStatus;
            let lastVerified: Awaited<ReturnType<typeof this.verifyPaystackTransferStatus>> = null;
            const delays = [0, 2000, 3000];
            for (const delay of delays) {
              if (delay > 0) await new Promise(r => setTimeout(r, delay));
              lastVerified = await this.verifyPaystackTransferStatus(transferCode);
              if (lastVerified && ['blocked', 'rejected', 'failed'].includes(lastVerified.status)) {
                finalStatus = lastVerified.status;
                break;
              }
              if (lastVerified) finalStatus = lastVerified.status;
            }
            if (['blocked', 'rejected', 'failed'].includes(finalStatus)) {
              const failReason = lastVerified?.failureReason || 'unknown';
              logger.warn(`Paystack transfer ${transferCode} ${finalStatus} — ${failReason}`, { reference: transaction.reference, transferCode, status: finalStatus, failureReason: failReason });
              return { success: false, message: data.message || `Transfer ${finalStatus}: ${failReason}`, providerData: data };
            }
            return { success: true, providerData: data };
          }
          if (['blocked', 'rejected', 'failed'].includes(transferStatus)) {
            return { success: false, message: data.message || `Transfer ${transferStatus}`, providerData: data };
          }
        }
        const statusCode = response.status;
        if (statusCode >= 500 || statusCode === 429) {
          lastError = { message: `Paystack ${statusCode}: ${data.message || 'Server error'}`, providerData: data };
          if (attempt < 3) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
        }
        return { success: false, message: data.message || `Paystack ${statusCode}`, providerData: data };
      } catch (err: any) {
        lastError = err;
        if (attempt < 3) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
    }
    return { success: false, message: lastError?.message || 'Transfer failed after 3 attempts' };
  }

  private async verifyPaystackTransferStatus(transferCode: string): Promise<{ status: string; reference: string; failureReason?: string } | null> {
    if (!transferCode) return null;
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) return null;
    try {
      const response = await fetch(`https://api.paystack.co/transfer/${transferCode}`, {
        headers: { 'Authorization': `Bearer ${secretKey}` }
      });
      const data = await response.json();
      if (response.ok && data.status === true && data.data?.status) {
        const failures = data.data.failures;
        let failReason: string | undefined;
        if (failures && Array.isArray(failures) && failures.length > 0) {
          failReason = failures.map((f: any) => f.reason || f.message || JSON.stringify(f)).join('; ');
        } else if (data.data.failure_reason) {
          failReason = data.data.failure_reason;
        }
        return {
          status: data.data.status,
          reference: data.data.reference || '',
          failureReason: failReason
        };
      }
      return null;
    } catch (err) {
      logger.error('Paystack transfer verification failed', { transferCode, error: err });
      return null;
    }
  }

  private async refundWithdrawal(transactionId: string, reason: string): Promise<void> {
    await runTransaction(async (session) => {
      const txn = await TransactionModel.findById(transactionId).session(session);
      if (!txn || (txn.status !== 'pending' && txn.status !== 'processing')) return;
      await WalletModel.findOneAndUpdate(
        { user: txn.user },
        { $inc: { balance: txn.amount, totalWithdrawn: -txn.amount } },
        { session }
      );
      txn.status = 'failed';
      txn.failureReason = reason;
      txn.failedAt = new Date();
      await txn.save({ session });
    });
  }

  async lockBalance(userId: string, amount: number, stakeId: string): Promise<boolean> {
    return runTransaction(async (session) => {
      const wallet = await WalletModel.findOneAndUpdate(
        { user: new mongoose.Types.ObjectId(userId),
          $expr: { $gte: [{ $subtract: ['$balance', '$lockedBalance'] }, amount] }
        },
        { $inc: { lockedBalance: amount }, $set: { lastTransactionAt: new Date() } },
        { new: true, session }
      );
      if (!wallet) {
        return false;
      }

      await TransactionModel.create([{
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
        reference: `STAKE_${stakeId}`,
        provider: 'internal',
        metadata: { description: 'Stake locked', stakeId }
      }], { session });

      return true;
    });
  }

  async unlockBalance(userId: string, amount: number, stakeId: string): Promise<boolean> {
    return runTransaction(async (session) => {
      const wallet = await WalletModel.findOneAndUpdate(
        { user: new mongoose.Types.ObjectId(userId),
          lockedBalance: { $gte: amount }
        },
        { $inc: { lockedBalance: -amount }, $set: { lastTransactionAt: new Date() } },
        { new: true, session }
      );
      if (!wallet) {
        return false;
      }

      await TransactionModel.create([{
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
      }], { session });

      return true;
    });
  }

  async settleStake(
    userId: string,
    stakeId: string,
    status: 'won' | 'lost' | 'void' | 'refunded',
    stakeAmount: number,
    netPayout: number,
    platformFee: number
  ): Promise<boolean> {
    return runTransaction(async (session) => {
      if (status === 'lost') {
        const wallet = await WalletModel.findOneAndUpdate(
          { user: new mongoose.Types.ObjectId(userId),
            lockedBalance: { $gte: stakeAmount }
          },
          { $inc: { lockedBalance: -stakeAmount }, $set: { lastTransactionAt: new Date() } },
          { new: true, session }
        );
        if (!wallet) {
          return false;
        }
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
        { new: true, session }
      );
      if (!wallet) {
        return false;
      }

      await TransactionModel.create([{
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
      }], { session });

      return true;
    });
  }

  async getTransactionHistory(
    userId: string,
    options: TransactionHistoryQuery = {}
  ): Promise<TransactionHistoryResult> {
    const query: Record<string, any> = { user: userId };
    if (options.type && WALLET_TYPES.includes(options.type as any)) query.type = options.type;
    if (options.status && WALLET_STATUSES.includes(options.status as any)) query.status = options.status;

    const start = parseDate(options.startDate ?? options.from);
    const end = parseDate(options.endDate ?? options.to);
    if (start || end) {
      query.createdAt = {};
      if (start) query.createdAt.$gte = start;
      if (end) query.createdAt.$lte = end;
    }

    if (options.search && String(options.search).trim()) {
      const term = escapeRegex(String(options.search).trim().slice(0, 120));
      const ors: Record<string, any>[] = [
        { reference: { $regex: term, $options: 'i' } },
        { 'metadata.description': { $regex: term, $options: 'i' } },
      ];
      const amountNum = Number(String(options.search).trim().replace(/[^\d.-]/g, ''));
      if (Number.isFinite(amountNum) && amountNum > 0) ors.push({ amount: amountNum });
      query.$or = ors;
    }

    const page = clampInt(options.page, 1, 1, 10000);
    const limit = clampInt(options.limit, 20, 5, 100);
    const sortField = HISTORY_SORT_FIELDS[options.sortField || 'createdAt'] || 'createdAt';
    const sortOrder: 1 | -1 = options.sortOrder === 'asc' ? 1 : -1;

    const [transactions, total] = await Promise.all([
      TransactionModel.find(query)
        .sort({ [sortField]: sortOrder })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean() as unknown as Promise<ITransaction[]>,
      TransactionModel.countDocuments(query)
    ]);

    return { transactions, total, page, limit };
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

  async reconcileStuckWithdrawals(): Promise<number> {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const stuck = await TransactionModel.find({
      type: 'withdrawal',
      status: 'processing',
      createdAt: { $lte: cutoff }
    }).limit(20);

    let reconciled = 0;
    for (const txn of stuck) {
      const pd = txn.providerData as any;
      const transferCode = pd?.data?.transfer_code || pd?.data?.code || pd?.transfer_code;
      if (!transferCode) {
        // No transfer code — mark as failed with refund
        logger.warn('Stuck withdrawal has no transfer code — refunding', { transactionId: txn._id, reference: txn.reference });
        await this.refundWithdrawal(txn._id.toString(), 'No transfer code from provider');
        reconciled++;
        continue;
      }
      const verified = await this.verifyPaystackTransferStatus(transferCode);
      if (!verified) {
        logger.warn('Stuck withdrawal verification returned null — skipping', { transactionId: txn._id, transferCode });
        continue;
      }
      if (['blocked', 'rejected', 'failed'].includes(verified.status)) {
        const failReason = verified.failureReason || 'unknown';
        logger.warn(`Stuck withdrawal resolved as ${verified.status}: ${failReason} — refunding`, { transactionId: txn._id, transferCode, status: verified.status, failureReason: failReason });
        await this.refundWithdrawal(txn._id.toString(), `Transfer ${verified.status}: ${failReason}`);
        reconciled++;
      } else if (verified.status === 'success') {
        await runTransaction(async (session) => {
          const t = await TransactionModel.findById(txn._id).session(session);
          if (!t || t.status !== 'processing') return;
          t.status = 'completed';
          t.completedAt = new Date();
          await t.save({ session });
          await notifyWithdrawalCompleted(t.user.toString(), t.amount, t.reference).catch(e => logger.error('notifyWithdrawalCompleted error', e));
        });
        reconciled++;
      }
    }
    if (reconciled > 0) {
      logger.info(`Reconciliation: ${reconciled}/${stuck.length} stuck withdrawals resolved`);
    }
    return reconciled;
  }
}

export const walletService = new WalletService();