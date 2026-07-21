import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { aiRiskService } from '../services/ai-risk.service';

export class AIRiskController {
  async getReport(req: AuthRequest, res: Response): Promise<void> {
    try {
      const report = await aiRiskService.generateReport();
      res.json({ success: true, data: report });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Risk report failed' });
    }
  }

  async getPodRisk(req: AuthRequest, res: Response): Promise<void> {
    try {
      const podRisk = await aiRiskService.getPodRisk(req.params.podId);
      if (!podRisk) {
        res.status(404).json({ success: false, message: 'Pod not found or not active' });
        return;
      }
      res.json({ success: true, data: podRisk });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Pod risk check failed' });
    }
  }

  async applyAutoCaps(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await aiRiskService.applyAutoCaps();
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Auto-cap failed' });
    }
  }

  async restoreCaps(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await aiRiskService.restoreCaps();
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Restore caps failed' });
    }
  }

  async runEscalation(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await aiRiskService.runAutoEscalation();
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Escalation check failed' });
    }
  }

  async getEscalationState(req: AuthRequest, res: Response): Promise<void> {
    try {
      const state = await aiRiskService.getEscalationState();
      res.json({ success: true, data: state });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to get escalation state' });
    }
  }
}

export const aiRiskController = new AIRiskController();
