import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { aiCampaignService } from '../services/ai-campaign.service';

export class AICampaignController {
  async segmentUsers(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await aiCampaignService.segmentUsers();
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Segmentation failed' });
    }
  }

  async generateCampaign(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { segment, maxUsers = 20 } = req.body;
      if (!segment || !['churned', 'at_risk', 'high_value', 'new', 'active'].includes(segment)) {
        res.status(400).json({ success: false, message: 'Valid segment required: churned, at_risk, high_value, new, active' });
        return;
      }
      const result = await aiCampaignService.generateCampaign(segment, Math.min(maxUsers, 100));
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Campaign generation failed' });
    }
  }

  async sendCampaign(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { messages, channels } = req.body;
      if (!messages || !Array.isArray(messages)) {
        res.status(400).json({ success: false, message: 'Messages array required' });
        return;
      }
      const result = await aiCampaignService.sendCampaign(messages, channels || ['in_app', 'sms']);
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Campaign send failed' });
    }
  }
}

export const aiCampaignController = new AICampaignController();
