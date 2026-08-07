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
      const userId = (req as any).user?.userId || (req as any).user?._id;
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
      const userId = (req as any).user?.userId || (req as any).user?._id;
      const game = typeof req.query.game === 'string' ? req.query.game : undefined;
      const result = typeof req.query.result === 'string' ? req.query.result : undefined;
      const data = await virtualGamesService.history({
        page: parseInt(String(req.query.page || '1'), 10) || 1,
        limit: parseInt(String(req.query.limit || '20'), 10) || 20,
        game: (game as any) || undefined,
        result: (result as any) || undefined,
      }, userId);
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'Failed to load history' });
    }
  }

  async stats(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      const data = await virtualGamesService.summary(userId);
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'Failed to load stats' });
    }
  }

  async adminSummary(req: Request, res: Response) {
    try {
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const data = await virtualGamesService.adminSummary({ from, to });
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message || 'Failed to load virtual games summary' });
    }
  }
}

export const virtualGamesController = new VirtualGamesController();
