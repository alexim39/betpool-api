import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { podSyncService } from './pod-sync.service';

export class PodSyncController {
  async sync(req: AuthRequest, res: Response): Promise<void> {
    try {
      const adminUserId = req.user!.userId;
      const { daysAhead } = req.body;

      const result = await podSyncService.sync(adminUserId, {
        daysAhead: daysAhead ? parseInt(daysAhead as string, 10) : undefined,
      });

      res.json(result);
    } catch (error: any) {
      console.error('Pod sync error:', error);
      res.status(500).json({
        success: false,
        created: 0,
        total: 0,
        details: [],
        errors: [error.message || 'Sync failed'],
        successes: [],
      });
    }
  }
}

export const podSyncController = new PodSyncController();

