import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { loyaltyService } from './loyalty.service';

export class LoyaltyController {
  async getSnapshot(req: AuthRequest, res: Response): Promise<void> {
    try {
      const snapshot = await loyaltyService.snapshot(req.user!.userId);
      res.json({ success: true, data: snapshot });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to load loyalty snapshot' });
    }
  }
}

export const loyaltyController = new LoyaltyController();
