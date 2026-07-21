import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { aiAutomationService } from '../services/ai-automation.service';

export class AIAutomationController {
  async runCycle(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await aiAutomationService.runCycle();
      res.json({ success: true, message: 'Automation cycle completed', data: result });
    } catch (error: any) {
      console.error('Automation cycle error:', error);
      res.status(500).json({ success: false, message: error.message || 'Automation cycle failed' });
    }
  }

  async status(req: AuthRequest, res: Response): Promise<void> {
    res.json({ success: true, data: { running: aiAutomationService['running'] } });
  }
}

export const aiAutomationController = new AIAutomationController();
