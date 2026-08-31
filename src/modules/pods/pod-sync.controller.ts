import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { podSyncService } from './pod-sync.service';
import { aiGamesService } from '../ai/ai-games.service';

export class PodSyncController {
  async sync(req: AuthRequest, res: Response): Promise<void> {
    try {
      const adminUserId = req.user!.userId;
      const { daysAhead } = req.body;

      const result = await podSyncService.sync(adminUserId, {
        daysAhead: daysAhead ? parseInt(daysAhead as string, 10) : undefined,
      });

      // If quota exhausted, surface as 429 so admin toast can show countdown
      const isQuota = (result as any).code === 'taster_exhausted' || (result as any).status === 429 || result.errors.some(e => e.toLowerCase().includes('quota exhausted'));
      if (isQuota) {
        res.status(429).json({ error: true, status: 429, code: 'taster_exhausted', detail: result.errors[0] || 'Daily quota exhausted', result });
        return;
      }

      // Kick off Ora's daily games analysis (batch analyze at sync) — non-blocking
      aiGamesService.analyzeToday()
        .then(analysis => console.log('[Games Today] analysis:', JSON.stringify(analysis)))
        .catch(e => console.error('[Games Today] analysis failed', e));

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

