import { Request, Response } from 'express';
import { bookingCodeService } from './booking-code.service';
import { socialService } from '../social/social.service';

interface AuthRequest extends Request {
  user?: { userId: string };
}

export class BookingCodeController {
  async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { podIds } = req.body as { podIds?: string[] };
      const result = await bookingCodeService.create(userId, Array.isArray(podIds) ? podIds : []);

      socialService.recordActivity(userId, 'booking_code_shared', result.codeId, {
        code: result.code,
        codeId: result.codeId,
        legCount: result.legCount,
        combinedMultiplier: result.combinedMultiplier,
        expiresAt: result.expiresAt,
        creatorName: result.creator?.name || null
      }).catch(e => console.error('Code-share activity error', e));
      socialService.notifyFollowersOfCode(userId, result.code, result.legCount, result.combinedMultiplier)
        .catch(e => console.error('Code-share notification error', e));

      res.status(201).json({
        success: true,
        message: 'Booking code generated and shared with your followers',
        data: result
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message || 'Failed to generate booking code' });
    }
  }

  async redeem(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { code } = req.params;
      const result = await bookingCodeService.redeem(code);

      res.json({
        success: true,
        message: 'Booking code redeemed',
        data: result
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message || 'Failed to redeem booking code' });
    }
  }
}

export const bookingCodeController = new BookingCodeController();