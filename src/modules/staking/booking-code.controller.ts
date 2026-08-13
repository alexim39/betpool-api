import { Request, Response } from 'express';
import { bookingCodeService } from './booking-code.service';

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

      res.status(201).json({
        success: true,
        message: 'Booking code generated',
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