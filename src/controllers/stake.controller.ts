import { Request, Response } from 'express';
import { stakeService, PlaceStakeData } from '../services/stake.service';

interface AuthRequest extends Request {
  user?: { userId: string };
}

export class StakeController {
  async placeStake(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { podId, oddsOfferId, podIds, stakeAmount } = req.body as { podId?: string; oddsOfferId?: string; podIds?: string[]; stakeAmount: number };

      if (!stakeAmount) {
        res.status(400).json({ success: false, message: 'Stake amount required' });
        return;
      }

      if (stakeAmount < 10) {
        res.status(400).json({ success: false, message: 'Minimum stake is ₦10' });
        return;
      }

      // Accumulator (multi-pod) bet
      if (podIds && podIds.length >= 2) {
        const result = await stakeService.placeAccumulator({ userId, podIds, stakeAmount });
        res.status(201).json({
          success: true,
          message: 'Accumulator placed successfully',
          data: result
        });
        return;
      }

      // Single-pod bet
      const resolvedPodId = podId || oddsOfferId;
      if (!resolvedPodId) {
        res.status(400).json({ success: false, message: 'Pod ID required for single bet' });
        return;
      }

      const result = await stakeService.placeStake({ userId, podId: resolvedPodId, stakeAmount });
      
      res.status(201).json({
        success: true,
        message: 'Stake placed successfully',
        data: result
      });
    } catch (error: any) {
      console.error('Place stake error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to place stake' });
    }
  }

  async getUserStakes(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { status, page, limit } = req.query;
      const result = await stakeService.getUserStakes(userId, {
        status: status as any,
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 20
      });

      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Get user stakes error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch stakes' });
    }
  }

  async getActiveStakes(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const stakes = await stakeService.getActiveStakes(userId);
      res.json({ success: true, data: stakes });
    } catch (error) {
      console.error('Get active stakes error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch active stakes' });
    }
  }

  async getStakeById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      const { id } = req.params;

      const stake = await stakeService.getStakeById(id, userId);
      if (!stake) {
        res.status(404).json({ success: false, message: 'Stake not found' });
        return;
      }

      res.json({ success: true, data: stake });
    } catch (error) {
      console.error('Get stake by ID error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch stake' });
    }
  }

  async calculatePayout(req: Request, res: Response): Promise<void> {
    try {
      const { podId, oddsOfferId, stakeAmount } = req.query;
      const resolvedPodId = (podId || oddsOfferId) as string;
      
      if (!resolvedPodId || !stakeAmount) {
        res.status(400).json({ success: false, message: 'Pod ID and stake amount required' });
        return;
      }

      const amount = parseFloat(stakeAmount as string);
      if (isNaN(amount) || amount < 10) {
        res.status(400).json({ success: false, message: 'Invalid stake amount' });
        return;
      }

      const result = await stakeService.calculatePotentialPayout(resolvedPodId, amount);
      if (!result) {
        res.status(404).json({ success: false, message: 'Pod not found' });
        return;
      }

      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Calculate payout error:', error);
      res.status(500).json({ success: false, message: 'Failed to calculate payout' });
    }
  }

  async settleStake(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { result, notes } = req.body;
      const userId = req.user?.userId;

      if (!['won', 'lost', 'void'].includes(result)) {
        res.status(400).json({ success: false, message: 'Invalid result. Must be: won, lost, or void' });
        return;
      }

      const stake = await stakeService.settleStake(id, result, userId!, notes);
      if (!stake) {
        res.status(404).json({ success: false, message: 'Stake not found' });
        return;
      }

      res.json({ success: true, data: stake });
    } catch (error: any) {
      console.error('Settle stake error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to settle stake' });
    }
  }

  async voidStake(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user?.userId;

      const stake = await stakeService.voidStake(id, userId!);
      if (!stake) {
        res.status(404).json({ success: false, message: 'Stake not found' });
        return;
      }

      res.json({ success: true, data: stake });
    } catch (error: any) {
      console.error('Void stake error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to void stake' });
    }
  }

  async getExposure(req: Request, res: Response): Promise<void> {
    try {
      const { podId } = req.params;
      const exposure = await stakeService.getExposureSummary(podId);
      res.json({ success: true, data: exposure });
    } catch (error) {
      console.error('Get exposure error:', error);
      res.status(500).json({ success: false, message: 'Failed to get exposure' });
    }
  }

  async getCashoutQuote(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const quote = await stakeService.getCashoutQuote(id, userId);
      if (!quote) {
        res.status(404).json({ success: false, message: 'Stake not found' });
        return;
      }

      res.json({ success: true, data: quote });
    } catch (error: any) {
      console.error('Get cashout quote error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to get cashout quote' });
    }
  }

  async confirmCashout(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const stake = await stakeService.confirmCashout(id, userId);
      if (!stake) {
        res.status(404).json({ success: false, message: 'Stake not found' });
        return;
      }

      res.json({
        success: true,
        message: 'Cashout successful',
        data: stake
      });
    } catch (error: any) {
      console.error('Confirm cashout error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to process cashout' });
    }
  }
}

export const stakeController = new StakeController();