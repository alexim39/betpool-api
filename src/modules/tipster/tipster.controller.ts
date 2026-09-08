import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { CreatorCommissionModel } from '../../models/creator-commission.model';
import { commissionService } from './commission.service';
import { logger } from '../../services/logger.service';

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export class TipsterController {
  async listCommissions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const page = clampInt(req.query.page, 1, 1, 10000);
      const limit = clampInt(req.query.limit, 20, 5, 100);
      const filter: Record<string, any> = {};
      if (typeof req.query.creatorId === 'string' && req.query.creatorId) {
        filter.creatorId = req.query.creatorId;
      }
      if (req.query.status === 'pending' || req.query.status === 'paid') {
        filter.status = req.query.status;
      }
      const [rows, total] = await Promise.all([
        CreatorCommissionModel.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .populate('creatorId', 'fullName phone')
          .lean(),
        CreatorCommissionModel.countDocuments(filter)
      ]);
      res.json({ success: true, data: { rows, total, page, limit } });
    } catch (error: any) {
      logger.error('Tipster listCommissions error', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to list commissions' });
    }
  }

  async runPayout(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await commissionService.runCycle();
      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('Tipster runPayout error', error);
      res.status(500).json({ success: false, message: error.message || 'Commission payout failed' });
    }
  }
}

export const tipsterController = new TipsterController();
