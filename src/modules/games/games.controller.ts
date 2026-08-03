import { Request, Response } from 'express';
import { aiGamesService } from '../ai/ai-games.service';

export class GamesController {
  async getToday(req: Request, res: Response): Promise<void> {
    try {
      const days = req.query.days ? parseInt(req.query.days as string, 10) : 1;
      const result = await aiGamesService.getToday(days);
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Get today games error:', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch games' });
    }
  }

  async analyzeToday(req: Request, res: Response): Promise<void> {
    try {
      const result = await aiGamesService.analyzeToday();
      res.json(result);
    } catch (error: any) {
      console.error('Analyze today games error:', error);
      res.status(500).json({
        success: false,
        fixturesFound: 0,
        analyzed: 0,
        skippedFresh: 0,
        errors: [error.message || 'Analysis failed'],
        apiLog: [],
      });
    }
  }
}

export const gamesController = new GamesController();
