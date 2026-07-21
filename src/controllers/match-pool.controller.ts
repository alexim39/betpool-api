import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { matchPoolService } from '../services/match-pool.service';

export class MatchPoolController {
  // User-facing endpoints
  async listOpen(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = req.query;
      const result = await matchPoolService.listOpenPools({
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 20
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('List match pools error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch match pools' });
    }
  }

  async getById(req: Request, res: Response): Promise<void> {
    try {
      const pool = await matchPoolService.getPoolById(req.params.id);
      if (!pool) {
        res.status(404).json({ success: false, message: 'Match pool not found' });
        return;
      }
      res.json({ success: true, data: pool });
    } catch (error: any) {
      console.error('Get match pool error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch match pool' });
    }
  }

  async createStake(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { marketId, amount } = req.body;
      if (!marketId || !amount || amount < 1) {
        res.status(400).json({ success: false, message: 'Market and valid amount required' });
        return;
      }

      const stake = await matchPoolService.stake({
        userId,
        matchPoolId: req.params.id,
        marketId,
        amount
      });

      res.json({ success: true, data: stake, message: 'Stake placed successfully' });
    } catch (error: any) {
      console.error('Create match pool stake error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to place stake' });
    }
  }

  async getMyStakes(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { page, limit } = req.query;
      const result = await matchPoolService.getUserStakes(userId, {
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 20
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Get my match pool stakes error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch stakes' });
    }
  }

  // Admin endpoints
  async createPool(req: AuthRequest, res: Response): Promise<void> {
    try {
      const adminId = req.user?.userId;
      if (!adminId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { eventTitle, markets, stakingClosesAt, minStake, maxStake } = req.body;
      if (!eventTitle || !markets || !Array.isArray(markets) || markets.length < 2 || !stakingClosesAt) {
        res.status(400).json({ success: false, message: 'Event title, at least 2 markets, and staking close time required' });
        return;
      }

      const pool = await matchPoolService.createPool({
        eventTitle,
        markets: markets.map((m: any) => ({ marketId: m.marketId || m.label.toLowerCase().replace(/\s+/g, '_'), label: m.label })),
        stakingClosesAt: new Date(stakingClosesAt),
        minStake,
        maxStake,
        adminId
      });

      res.status(201).json({ success: true, data: pool });
    } catch (error: any) {
      console.error('Create match pool error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to create match pool' });
    }
  }

  async closeStaking(req: AuthRequest, res: Response): Promise<void> {
    try {
      const pool = await matchPoolService.closeStaking(req.params.id);
      res.json({ success: true, data: pool, message: 'Staking closed' });
    } catch (error: any) {
      console.error('Close staking error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to close staking' });
    }
  }

  async settle(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { winningMarketId } = req.body;
      if (!winningMarketId) {
        res.status(400).json({ success: false, message: 'Winning market ID required' });
        return;
      }

      const pool = await matchPoolService.settlePool(req.params.id, winningMarketId);
      res.json({ success: true, data: pool, message: 'Match pool settled' });
    } catch (error: any) {
      console.error('Settle match pool error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to settle match pool' });
    }
  }

  async cancel(req: AuthRequest, res: Response): Promise<void> {
    try {
      const pool = await matchPoolService.cancelPool(req.params.id);
      res.json({ success: true, data: pool, message: 'Match pool cancelled and stakes refunded' });
    } catch (error: any) {
      console.error('Cancel match pool error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to cancel match pool' });
    }
  }

  async getReport(req: Request, res: Response): Promise<void> {
    try {
      const report = await matchPoolService.getPoolReport(req.params.id);
      res.json({ success: true, data: report });
    } catch (error: any) {
      console.error('Get match pool report error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to fetch report' });
    }
  }

  async adminListAll(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { page, limit, status } = req.query;
      const result = await matchPoolService.listAllPools({
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 20,
        status: status as string
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Admin list match pools error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch match pools' });
    }
  }

  async adminGetDetail(req: AuthRequest, res: Response): Promise<void> {
    try {
      const detail = await matchPoolService.getAdminDetail(req.params.id);
      res.json({ success: true, data: detail });
    } catch (error: any) {
      console.error('Admin get match pool detail error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to fetch detail' });
    }
  }

  async getReportsAggregate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { from, to } = req.query;
      const reports = await matchPoolService.getReports({
        from: from as string,
        to: to as string
      });
      res.json({ success: true, data: reports });
    } catch (error: any) {
      console.error('Match pool reports error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch reports' });
    }
  }
}

export const matchPoolController = new MatchPoolController();
