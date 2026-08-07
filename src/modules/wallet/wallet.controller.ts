import { Request, Response } from 'express';
import { walletService } from '../../services/wallet.service';
import { paymentService } from '../../services/payment.service';
import { logger } from '../../services/logger.service';

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
      logger.error('Get balance error', error);
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

      const { type, status, page, limit, startDate, endDate, from, to, search, sortField, sortOrder } = req.query;
      const result = await walletService.getTransactionHistory(userId, {
        type: typeof type === 'string' ? type.slice(0, 20) : undefined,
        status: typeof status === 'string' ? status.slice(0, 20) : undefined,
        search: typeof search === 'string' ? search.slice(0, 120) : undefined,
        page: page ? Number.parseInt(String(page), 10) : undefined,
        limit: limit ? Number.parseInt(String(limit), 10) : undefined,
        from: typeof from === 'string' ? from.slice(0, 40) : undefined,
        to: typeof to === 'string' ? to.slice(0, 40) : undefined,
        startDate: startDate ? new Date(String(startDate).slice(0, 40)) : undefined,
        endDate: endDate ? new Date(String(endDate).slice(0, 40)) : undefined,
        sortField: sortField === 'createdAt' || sortField === 'amount' || sortField === 'type' || sortField === 'status'
          ? String(sortField)
          : undefined,
        sortOrder: sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : undefined
      });

      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Get transactions error', error);
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
      logger.error('Initiate deposit error', error);
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
      logger.error('Recover deposits error', error);
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
      logger.error('Deposit callback error', error);
      res.status(500).json({ success: false, message: 'Callback processing failed' });
    }
  }

  async paystackWebhook(req: Request, res: Response): Promise<void> {
    try {
      const signature = req.headers['x-paystack-signature'] as string;
      const rawBody = (req as any).rawBody || '';
      const payload = req.body;

      logger.info(`Paystack webhook received`, {
        event: payload?.event,
        signature: signature ? `${signature.substring(0, 12)}...` : 'MISSING',
        bodyPreview: JSON.stringify(payload).substring(0, 300)
      });

      if (!signature) {
        res.status(200).json({ success: true, message: 'No signature' });
        return;
      }

      // Try SHA-256 with webhook secret first, fall back to SHA-512 with API key
      const isValid = paymentService.verifyPaystackWebhookSignature(rawBody, signature)
        || paymentService.verifyPaystackWebhookSignatureFallback(rawBody, signature);

      if (!isValid) {
        logger.warn('Paystack webhook signature verification failed', { signature: signature.substring(0, 12) + '...' });
        res.status(200).json({ success: true, message: 'Webhook received' });
        return;
      }

      const event = paymentService.handlePaystackWebhook(payload);
      if (!event) {
        res.status(200).json({ success: true, message: 'Event ignored' });
        return;
      }

      logger.info(`Paystack webhook event matched: ${payload.event}`, { reference: event.reference, amount: event.amount });

      if (payload.event === 'charge.success' && event.status === 'success') {
        await walletService.verifyAndCreditDeposit(event.reference);
      } else if (payload.event === 'transfer.success') {
        await walletService.confirmWithdrawal(event.reference);
      } else if (payload.event === 'transfer.failed' || payload.event === 'transfer.reversed') {
        await walletService.failWithdrawal(event.reference);
      }

      res.status(200).send('OK');
    } catch (error) {
      logger.error('Paystack webhook error', error);
      res.status(200).send('OK');
    }
  }

  async initiateWithdrawal(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { amount, bankCode, bankName, accountNumber, accountName, pin, narration } = req.body;
      if (!amount || !bankCode || !accountNumber || !accountName || !pin) {
        res.status(400).json({ success: false, message: 'All bank details and PIN required' });
        return;
      }

      const result = await walletService.initiateWithdrawal(
        userId,
        Number(amount),
        bankCode,
        bankName,
        accountNumber,
        accountName,
        pin,
        narration
      );

      res.json(result);
    } catch (error) {
      logger.error('Initiate withdrawal error', error);
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

      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('Resolve account error', error);
      const message = error?.response?.data?.message || error?.message || 'Failed to resolve account';
      res.status(200).json({ success: false, message });
    }
  }

  async listBanks(_req: Request, res: Response): Promise<void> {
    try {
      const banks = await paymentService.listBanks();
      res.json({ success: true, data: banks });
    } catch (error) {
      logger.error('List banks error', error);
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
      logger.error('Save account error', error);
      res.status(500).json({ success: false, message: 'Failed to save account' });
    }
  }

  async getSavedAccounts(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      const accounts = await walletService.getSavedAccounts(userId);
      res.json({ success: true, data: accounts });
    } catch (error) {
      logger.error('Get saved accounts error', error);
      res.status(500).json({ success: false, message: 'Failed to fetch saved accounts' });
    }
  }

  async deleteSavedAccount(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      await walletService.deleteSavedAccount(userId, req.params.id);
      res.json({ success: true, message: 'Account removed' });
    } catch (error) {
      logger.error('Delete saved account error', error);
      res.status(500).json({ success: false, message: 'Failed to remove account' });
    }
  }

  async setDefaultAccount(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      await walletService.setDefaultAccount(userId, req.params.id);
      res.json({ success: true, message: 'Default account updated' });
    } catch (error) {
      logger.error('Set default account error', error);
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
        fee: 'No fees'
      }
    });
  }
}

export const walletController = new WalletController();
