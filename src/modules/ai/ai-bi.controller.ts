import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { aiBiService } from './ai-bi.service';

export class AIBIController {
  async getReport(req: AuthRequest, res: Response): Promise<void> {
    try {
      const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
      const report = await aiBiService.generateReport(Math.min(Math.max(days, 7), 365));
      res.json({ success: true, data: report });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'BI report failed' });
    }
  }

  async getForecast(req: AuthRequest, res: Response): Promise<void> {
    try {
      const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
      const forecast = await aiBiService.generateForecast(Math.min(Math.max(days, 7), 365));
      res.json({ success: true, data: forecast });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Forecast failed' });
    }
  }

  async getT4Advisory(req: AuthRequest, res: Response): Promise<void> {
    try {
      const advisory = await aiBiService.generateT4Advisory();
      res.json({ success: true, data: advisory });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'T4 advisory failed' });
    }
  }
}

export const aiBiController = new AIBIController();

