import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { betManagerService } from './bet-manager.service';
import { BetManagerTier } from '../../models/bet-manager-account.model';
import { logger } from '../../services/logger.service';

const VALID_TIERS: BetManagerTier[] = ['goalkeeper', 'defender', 'midfielder', 'striker'];

function parseTier(tier: string): BetManagerTier | null {
  return VALID_TIERS.includes(tier as BetManagerTier) ? (tier as BetManagerTier) : null;
}

export class BetManagerController {
  async getAccounts(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const accounts = await betManagerService.getAllAccounts(userId);
      res.json({ success: true, data: accounts });
    } catch (error: any) {
      logger.error('BetManager getAccounts error', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch accounts' });
    }
  }

  async getAccount(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const tier = parseTier(req.params.tier);
      if (!tier) { res.status(400).json({ success: false, message: 'Invalid tier' }); return; }
      const summary = await betManagerService.getAccountSummary(userId, tier);
      if (!summary.account) {
        res.json({ success: true, data: null, message: 'No account for this tier' });
        return;
      }
      const minDeposit = tier === 'goalkeeper' ? 20_000 : tier === 'defender' ? 50_000 : tier === 'midfielder' ? 100_000 : 200_000;
      res.json({ success: true, data: { ...summary, tier, tierConfig: { minDeposit, platformFee: 500, lockDays: 30 } } });
    } catch (error: any) {
      logger.error('BetManager getAccount error', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch account' });
    }
  }

  async getNav(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tier = parseTier(req.params.tier);
      if (!tier) { res.status(400).json({ success: false, message: 'Invalid tier' }); return; }
      const nav = await betManagerService.getCurrentNav(tier);
      const { history, daily } = await betManagerService.getNavHistory(tier);
      res.json({ success: true, data: { current: nav, history, daily } });
    } catch (error: any) {
      logger.error('BetManager getNav error', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch NAV' });
    }
  }

  async deposit(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const tier = parseTier(req.body.tier);
      if (!tier) { res.status(400).json({ success: false, message: 'Invalid tier' }); return; }
      const amount = parseInt(req.body.amount) || 0;
      const result = await betManagerService.deposit(userId, tier, amount);
      if (!result.success) { res.status(400).json(result); return; }
      res.json(result);
    } catch (error: any) {
      logger.error('BetManager deposit error', error);
      res.status(500).json({ success: false, message: error.message || 'Deposit failed' });
    }
  }

  async withdraw(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const tier = parseTier(req.body.tier);
      if (!tier) { res.status(400).json({ success: false, message: 'Invalid tier' }); return; }
      const result = await betManagerService.withdraw(userId, tier);
      if (!result.success) { res.status(400).json(result); return; }
      res.json(result);
    } catch (error: any) {
      logger.error('BetManager withdraw error', error);
      res.status(500).json({ success: false, message: error.message || 'Withdrawal failed' });
    }
  }

  async getDepositHistory(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const tier = parseTier(req.params.tier);
      if (!tier) { res.status(400).json({ success: false, message: 'Invalid tier' }); return; }
      const page = parseInt(String(req.query.page || ''), 10);
      const limit = parseInt(String(req.query.limit || ''), 10);
      const type = req.query.type === 'deposit' || req.query.type === 'withdrawal' ? req.query.type : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status.slice(0, 20) : undefined;
      const from = typeof req.query.from === 'string' ? req.query.from.slice(0, 40) : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to.slice(0, 40) : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 120) : undefined;
      const sortField = typeof req.query.sortField === 'string' ? req.query.sortField.slice(0, 40) : undefined;
      const sortOrder = req.query.sortOrder === 'asc' || req.query.sortOrder === 'desc' ? req.query.sortOrder : undefined;
      const result = await betManagerService.getDepositHistory(userId, tier, page, limit, {
        type, status, from, to, search, sortField, sortOrder,
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('BetManager getDepositHistory error', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch history' });
    }
  }

  async getPerformance(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const tier = parseTier(req.params.tier);
      if (!tier) { res.status(400).json({ success: false, message: 'Invalid tier' }); return; }
      const result = await betManagerService.getPerformance(userId, tier);
      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('BetManager getPerformance error', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch performance' });
    }
  }
}

export const betManagerController = new BetManagerController();
