import { Request, Response } from 'express';
import { walletService } from '../services/wallet.service';
import { paymentService } from '../services/payment.service';

export class WalletController {
  async getBalance(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const balance = await walletService.getBalance(userId);
      res.json({ success: true, data: balance });
    } catch (error) {
      console.error('Get balance error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch balance' });
    }
  }

  async getTransactions(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { type, status, page, limit, startDate, endDate } = req.query;
      const result = await walletService.getTransactionHistory(userId, {
        type: type as any,
        status: status as any,
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 20,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined
      });

      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Get transactions error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
    }
  }

  async initiateDeposit(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { amount, provider } = req.body;
      if (!amount || !provider) {
        res.status(400).json({ success: false, message: 'Amount and provider required' });
        return;
      }

      if (provider !== 'paystack') {
        res.status(400).json({ success: false, message: 'Invalid provider' });
        return;
      }

      const result = await walletService.initiateDeposit(
        userId,
        Number(amount),
        provider,
        { ip: req.ip, userAgent: req.get('user-agent') }
      );

      res.json(result);
    } catch (error) {
      console.error('Initiate deposit error:', error);
      res.status(500).json({ success: false, message: 'Failed to initiate deposit' });
    }
  }

  async recoverDeposits(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const result = await walletService.recoverPendingDeposits(userId);
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Recover deposits error:', error);
      res.status(500).json({ success: false, message: 'Recovery failed' });
    }
  }

  async depositCallback(req: Request, res: Response): Promise<void> {
    try {
      const reference = (req.query.reference as string) || (req.query.trxref as string);
      if (!reference) {
        res.status(400).json({ success: false, message: 'Reference required' });
        return;
      }

      const result = await walletService.verifyAndCreditDeposit(reference as string);

      res.json(result);
    } catch (error) {
      console.error('Deposit callback error:', error);
      res.status(500).json({ success: false, message: 'Callback processing failed' });
    }
  }

  async paystackWebhook(req: Request, res: Response): Promise<void> {
    try {
      const signature = req.headers['x-paystack-signature'] as string;
      if (!signature) {
        res.status(400).json({ success: false, message: 'Missing signature' });
        return;
      }

      const isValid = paymentService.verifyPaystackWebhookSignature(req.body, signature);
      if (!isValid) {
        res.status(401).json({ success: false, message: 'Invalid signature' });
        return;
      }

      const event = paymentService.handlePaystackWebhook(req.body);
      if (!event) {
        res.status(200).json({ success: true, message: 'Event ignored' });
        return;
      }

      if (event.status === 'success') {
        await walletService.verifyAndCreditDeposit(event.reference);
      }

      res.status(200).json({ success: true });
    } catch (error) {
      console.error('Paystack webhook error:', error);
      res.status(200).json({ success: true, message: 'Webhook received' });
    }
  }

  async initiateWithdrawal(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { amount, bankCode, accountNumber, accountName, pin, narration } = req.body;
      if (!amount || !bankCode || !accountNumber || !accountName || !pin) {
        res.status(400).json({ success: false, message: 'All bank details and PIN required' });
        return;
      }

      const result = await walletService.initiateWithdrawal(
        userId,
        Number(amount),
        bankCode,
        accountNumber,
        accountName,
        pin,
        narration
      );

      res.json(result);
    } catch (error) {
      console.error('Initiate withdrawal error:', error);
      res.status(500).json({ success: false, message: 'Failed to initiate withdrawal' });
    }
  }

  async resolveBankAccount(req: Request, res: Response): Promise<void> {
    try {
      const { accountNumber, bankCode } = req.query;
      if (!accountNumber || !bankCode) {
        res.status(400).json({ success: false, message: 'Account number and bank code required' });
        return;
      }

      const result = await paymentService.resolveBankAccount(
        accountNumber as string,
        bankCode as string
      );

      if (!result) {
        res.status(404).json({ success: false, message: 'Account not found' });
        return;
      }

      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Resolve account error:', error);
      res.status(500).json({ success: false, message: 'Failed to resolve account' });
    }
  }

  async listBanks(_req: Request, res: Response): Promise<void> {
    try {
      const banks = await paymentService.listBanks();
      res.json({ success: true, data: banks });
    } catch (error) {
      console.error('List banks error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch banks' });
    }
  }

  async saveAccount(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      const { bankCode, accountNumber, accountName, bankName } = req.body;
      if (!bankCode || !accountNumber || !accountName) {
        res.status(400).json({ success: false, message: 'Bank code, account number, and account name required' });
        return;
      }
      const account = await walletService.saveAccount(userId, bankCode, accountNumber, accountName, bankName || '');
      res.json({ success: true, data: account });
    } catch (error) {
      console.error('Save account error:', error);
      res.status(500).json({ success: false, message: 'Failed to save account' });
    }
  }

  async getSavedAccounts(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      const accounts = await walletService.getSavedAccounts(userId);
      res.json({ success: true, data: accounts });
    } catch (error) {
      console.error('Get saved accounts error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch saved accounts' });
    }
  }

  async deleteSavedAccount(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      await walletService.deleteSavedAccount(userId, req.params.id);
      res.json({ success: true, message: 'Account removed' });
    } catch (error) {
      console.error('Delete saved account error:', error);
      res.status(500).json({ success: false, message: 'Failed to remove account' });
    }
  }

  async setDefaultAccount(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      await walletService.setDefaultAccount(userId, req.params.id);
      res.json({ success: true, message: 'Default account updated' });
    } catch (error) {
      console.error('Set default account error:', error);
      res.status(500).json({ success: false, message: 'Failed to set default account' });
    }
  }

  async getWithdrawalLimits(req: Request, res: Response): Promise<void> {
    res.json({
      success: true,
      data: {
        min: 500,
        max: 5000000,
        dailyLimit: 10000000,
        fee: '1.5% (max ₦50)'
      }
    });
  }
}

export const walletController = new WalletController();