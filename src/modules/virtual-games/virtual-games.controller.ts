import { Request, Response } from 'express';
import { virtualGamesService } from './virtual-games.service';

class VirtualGamesController {
  async catalog(_req: Request, res: Response) {
    try {
      res.json({ success: true, data: virtualGamesService.getCatalog() });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'Failed to load virtual games' });
    }
  }

  async play(req: Request, res: Response) {
    try {
      const userId = (req as any).user?._id || (req as any).user?.id;
      const { game, choice, amount, idempotencyKey } = req.body;
      const result = await virtualGamesService.play({
        userId,
        game,
        choice,
        amount: Math.floor(Number(amount) || 0),
        idempotencyKey: typeof idempotencyKey === 'string' && idempotencyKey ? idempotencyKey : undefined,
      });
      res.json({ success: true, data: result });
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message || 'Failed to play' });
    }
  }

  async history(req: Request, res: Response) {
    try {
      const userId = (req as any).user?._id || (req as any).user?.id;
      const page = parseInt(String(req.query.page || '1'), 10) || 1;
      const limit = parseInt(String(req.query.limit || '20'), 10) || 20;
      const data = await virtualGamesService.history(userId, page, limit);
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'Failed to load history' });
    }
  }
}

export const virtualGamesController = new VirtualGamesController();
