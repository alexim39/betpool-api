import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { coachingService } from './coaching.service';

export class CoachingController {
  async getInsights(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await coachingService.insights(req.user!.userId);
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to load coaching insights' });
    }
  }
}

export const coachingController = new CoachingController();
