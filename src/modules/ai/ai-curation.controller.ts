import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { aiCurationService } from './ai-curation.service';

export class AICurationController {
  async curate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await aiCurationService.curate();
      res.json(result);
    } catch (error: any) {
      console.error('AI curation error:', error);
      res.status(500).json({
        success: false,
        total: 0,
        recommended: 0,
        skipped: 0,
        fixtures: [],
        errors: [error.message || 'Curation failed'],
        apiLog: [],
        skippedReason: null,
      });
    }
  }
}

export const aiCurationController = new AICurationController();

