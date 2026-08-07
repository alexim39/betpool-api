import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { betManagerService, POOL_WALLET_IDS } from './bet-manager.service';
import { BetManagerTier } from '../../models/bet-manager-account.model';
import { BetManagerCycleModel } from '../../models/bet-manager-cycle.model';
import { BetManagerAccountModel } from '../../models/bet-manager-account.model';
import { BetManagerDepositModel } from '../../models/bet-manager-deposit.model';
import { BetManagerAllocationModel } from '../../models/bet-manager-allocation.model';
import { WalletModel } from '../../models/wallet.model';
import { logger } from '../../services/logger.service';

const VALID_TIERS: BetManagerTier[] = ['goalkeeper', 'defender', 'midfielder', 'striker'];

export class BetManagerAdminController {
  async getStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const stats = await betManagerService.getAdminStats();
      res.json({ success: true, data: stats });
    } catch (error: any) {
      logger.error('BetManager admin getStats error', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch stats' });
    }
  }

  async listAccounts(req: AuthRequest, res: Response): Promise<void> {
    try {
      const page = parseInt(String(req.query.page || ''), 10);
      const limit = parseInt(String(req.query.limit || ''), 10);
      const tier = typeof req.query.tier === 'string' ? req.query.tier.slice(0, 20) : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 120) : undefined;
      const from = typeof req.query.from === 'string' ? req.query.from.slice(0, 40) : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to.slice(0, 40) : undefined;
      const sortField = typeof req.query.sortField === 'string' ? req.query.sortField.slice(0, 40) : undefined;
      const sortOrder = req.query.sortOrder === 'asc' || req.query.sortOrder === 'desc' ? req.query.sortOrder : undefined;
      const result = await betManagerService.listAllAccounts(page, limit, tier, search, from, to, sortField, sortOrder);
      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('BetManager admin listAccounts error', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch accounts' });
    }
  }

  async listDeposits(req: AuthRequest, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const tier = req.query.tier as string | undefined;
      const userId = req.query.userId as string | undefined;
      const status = req.query.status as string | undefined;
      const result = await betManagerService.listAllDeposits(page, limit, tier, userId, status);
      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('BetManager admin listDeposits error', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch deposits' });
    }
  }

  async getPools(req: AuthRequest, res: Response): Promise<void> {
    try {
      const pools = await Promise.all(VALID_TIERS.map(async (tier) => {
        const wallet = await WalletModel.findById(POOL_WALLET_IDS[tier]);
        return { tier, balance: wallet?.balance || 0, walletId: wallet?._id };
      }));
      res.json({ success: true, data: pools });
    } catch (error: any) {
      logger.error('BetManager admin getPools error', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch pools' });
    }
  }

  async getCycles(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tier = req.query.tier as string | undefined;
      const match: any = {};
      if (tier && VALID_TIERS.includes(tier as BetManagerTier)) match.tier = tier;
      const cycles = await BetManagerCycleModel.find(match).sort({ createdAt: -1 }).limit(50).lean();
      res.json({ success: true, data: cycles });
    } catch (error: any) {
      logger.error('BetManager admin getCycles error', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch cycles' });
    }
  }

  async getTierDetail(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tier = req.params.tier as BetManagerTier;
      if (!VALID_TIERS.includes(tier)) { res.status(400).json({ success: false, message: 'Invalid tier' }); return; }
      const navData = await betManagerService.getCurrentNav(tier);
      const navHistory = await betManagerService.getNavHistory(tier);
      const activeCycle = await BetManagerCycleModel.findOne({ tier, status: 'active' }).sort({ cycleNumber: -1 }).lean();
      const totalAccounts = await BetManagerAccountModel.countDocuments({ tier, status: 'active' });
      const totalDeposits = await BetManagerDepositModel.countDocuments({ tier, type: 'deposit' });
      const wallet = await WalletModel.findById(POOL_WALLET_IDS[tier]);
      const activeAllocs = await BetManagerAllocationModel.countDocuments({ tier, status: 'active' });
      const settledCycles = await BetManagerCycleModel.find({ tier, status: 'settled' }).sort({ cycleNumber: -1 }).limit(12).lean();
      const totalFees = settledCycles.reduce((sum, c) => sum + (c.platformFee || 0) + (c.performanceFee || 0), 0);

      res.json({ success: true, data: {
        tier,
        nav: navData,
        navHistory,
        activeCycle,
        totalAccounts,
        totalDeposits,
        poolBalance: wallet?.balance || 0,
        activeAllocations: activeAllocs,
        settledCycleCount: settledCycles.length,
        totalFeesCollected: totalFees,
      }});
    } catch (error: any) {
      logger.error('BetManager admin getTierDetail error', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch tier detail' });
    }
  }

  async settleCycle(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tier = req.body.tier as BetManagerTier;
      if (!VALID_TIERS.includes(tier)) { res.status(400).json({ success: false, message: 'Invalid tier' }); return; }
      await betManagerService.settleCycle(tier);
      res.json({ success: true, message: `${tier} cycle settled` });
    } catch (error: any) {
      logger.error('BetManager admin settleCycle error', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to settle cycle' });
    }
  }

  async runReconcile(req: AuthRequest, res: Response): Promise<void> {
    try {
      await betManagerService.reconcileAllocations();
      res.json({ success: true, message: 'Allocations reconciled' });
    } catch (error: any) {
      logger.error('BetManager admin reconcile error', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to reconcile' });
    }
  }

  async topUpPool(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { tier, amount } = req.body;
      if (!VALID_TIERS.includes(tier)) { res.status(400).json({ success: false, message: 'Invalid tier' }); return; }
      if (!amount || amount <= 0) { res.status(400).json({ success: false, message: 'Invalid amount' }); return; }

      const walletId = await betManagerService.getOrCreatePoolWallet(tier);
      const wallet = await WalletModel.findByIdAndUpdate(
        walletId,
        { $inc: { balance: amount } },
        { new: true }
      );

      logger.info(`[BetManager] Pool topped up: ${tier} +₦${amount} by admin ${req.user?.userId}`);
      res.json({ success: true, message: `${tier} pool topped up with ₦${amount.toLocaleString()}`, data: { balance: wallet.balance } });
    } catch (error: any) {
      logger.error('BetManager admin topUpPool error', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to top up pool' });
    }
  }

  async getAccountDetail(req: AuthRequest, res: Response): Promise<void> {
    try {
      const accountId = req.params.id;
      const account = await BetManagerAccountModel.findById(accountId).populate('userId', 'phone fullName email').lean();
      if (!account) { res.status(404).json({ success: false, message: 'Account not found' }); return; }
      const deposits = await BetManagerDepositModel.find({ accountId }).sort({ createdAt: -1 }).limit(50).lean();
      res.json({ success: true, data: { account, deposits } });
    } catch (error: any) {
      logger.error('BetManager admin getAccountDetail error', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch account detail' });
    }
  }
}

export const betManagerAdminController = new BetManagerAdminController();
