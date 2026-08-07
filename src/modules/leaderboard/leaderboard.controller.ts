import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { leaderboardService, LeaderboardPeriod } from './leaderboard.service';

export class LeaderboardController {
  async getLeaderboard(req: AuthRequest, res: Response): Promise<void> {
    try {
      const period = (req.query.period as LeaderboardPeriod) || 'month';
      const page = parseInt(String(req.query.page || '1'), 10);
      const limit = parseInt(String(req.query.limit || '25'), 10);
      const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 120) : undefined;
      const sortField = typeof req.query.sortField === 'string' ? req.query.sortField.slice(0, 40) : undefined;
      const sortOrder = (req.query.sortOrder === 'asc' || req.query.sortOrder === 'desc')
        ? req.query.sortOrder
        : undefined;
      const data = await leaderboardService.getLeaderboard(req.user!.userId, period, page, limit, {
        search,
        sortField,
        sortOrder,
      });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to load leaderboard' });
    }
  }

  async getMyRank(req: AuthRequest, res: Response): Promise<void> {
    try {
      const period = (req.query.period as LeaderboardPeriod) || 'month';
      const data = await leaderboardService.myRank(req.user!.userId, period);
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to load rank' });
    }
  }

  async getLastWin(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await leaderboardService.lastWin(req.user!.userId);
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to load last win' });
    }
  }
}

export const leaderboardController = new LeaderboardController();
