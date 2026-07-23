import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { aiKycService } from './ai-kyc.service';
import { adminService } from '../admin/admin.service';

export class AIKycController {
  async reviewUser(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await aiKycService.reviewUser(req.params.userId);
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'KYC review failed' });
    }
  }

  async approveUser(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = await adminService.verifyUserKYC(req.params.userId);
      res.json({ success: true, data: user });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'KYC approve failed' });
    }
  }

  async rejectUser(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { notes } = req.body;
      const user = await adminService.rejectUserKYC(req.params.userId, notes || 'KYC rejected by Ora');
      res.json({ success: true, data: user });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'KYC reject failed' });
    }
  }

  async reviewAll(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await aiKycService.reviewAllPending();
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'KYC review all failed' });
    }
  }
}

export const aiKycController = new AIKycController();

