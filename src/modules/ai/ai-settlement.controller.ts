import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { aiSettlementService } from './ai-settlement.service';
import { adminService } from '../admin/admin.service';

export class AISettlementController {
  async checkPod(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await aiSettlementService.checkPod(req.params.podId);
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Settlement check failed' });
    }
  }

  async settlePod(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { result, notes } = req.body;
      const { podId } = req.params;
      const userId = req.user!.userId;

      if (!['win', 'loss', 'void'].includes(result)) {
        res.status(400).json({ success: false, message: 'Result must be win, loss, or void' });
        return;
      }

      const check = await aiSettlementService.checkPod(podId);
      if (check.recommendedResult !== 'cannot_determine' && check.recommendedResult !== result) {
        res.json({
          success: true,
          warning: `Ora recommends "${check.recommendedResult}" but you chose "${result}". Settlement will proceed.`,
          check,
        });
      }

      const pod = await adminService.settlePod(podId, result, userId, notes || check.reasoning, check.homeScore ?? undefined, check.awayScore ?? undefined);
      res.json({ success: true, data: pod });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Settlement failed' });
    }
  }

  async settleAll(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await aiSettlementService.settleAllSettleable(req.user!.userId);
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Auto-settle all failed' });
    }
  }

  async listDisputed(req: AuthRequest, res: Response): Promise<void> {
    try {
      const pods = await aiSettlementService.listDisputed();
      res.json({ success: true, data: pods, count: pods.length });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to list disputed settlements' });
    }
  }

  async resolveDispute(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { result, reviewNote } = req.body;
      const { podId } = req.params;
      const userId = req.user!.userId;

      if (!['win', 'loss', 'void'].includes(result)) {
        res.status(400).json({ success: false, message: 'Result must be win, loss, or void' });
        return;
      }
      if (!reviewNote || !reviewNote.trim()) {
        res.status(400).json({ success: false, message: 'Review note is required' });
        return;
      }

      const pod = await aiSettlementService.resolveDispute(podId, userId, result, reviewNote.trim());
      res.json({ success: true, data: pod });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to resolve dispute' });
    }
  }

  async batchResolveDisputes(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { podIds, result, reviewNote } = req.body;
      const userId = req.user!.userId;

      if (!Array.isArray(podIds) || podIds.length === 0) {
        res.status(400).json({ success: false, message: 'podIds array is required' });
        return;
      }
      if (!['win', 'loss', 'void'].includes(result)) {
        res.status(400).json({ success: false, message: 'Result must be win, loss, or void' });
        return;
      }
      if (!reviewNote || !reviewNote.trim()) {
        res.status(400).json({ success: false, message: 'Review note is required' });
        return;
      }

      const outcome = await aiSettlementService.batchResolveDisputes(podIds, userId, result, reviewNote.trim());
      res.json({ success: true, ...outcome });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to batch resolve disputes' });
    }
  }

  async listStuck(req: AuthRequest, res: Response): Promise<void> {
    try {
      const pods = await aiSettlementService.listStuck();
      res.json({ success: true, data: pods, count: pods.length });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to list stuck pods' });
    }
  }

  async countPendingReviews(req: AuthRequest, res: Response): Promise<void> {
    try {
      const counts = await aiSettlementService.countPendingReviews();
      res.json({ success: true, data: counts });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to count pending reviews' });
    }
  }
}

export const aiSettlementController = new AISettlementController();

