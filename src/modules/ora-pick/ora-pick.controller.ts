import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { oraPickService } from './ora-pick.service';

export class OraPickController {
  async getPickOfDay(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      const pick = await oraPickService.getPickOfDay(userId);
      if (!pick) {
        res.status(404).json({ success: false, message: 'No stakable picks available right now' });
        return;
      }
      res.json({ success: true, data: pick });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to load pick of the day' });
    }
  }
}

export const oraPickController = new OraPickController();
