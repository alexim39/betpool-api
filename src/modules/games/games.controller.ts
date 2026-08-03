import { Request, Response } from 'express';
import { aiGamesService, GamesListQuery } from '../ai/ai-games.service';

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

  async list(req: Request, res: Response): Promise<void> {
    try {
      const q = req.query as Record<string, string>;
      const query: GamesListQuery = {
        page: q.page ? parseInt(q.page, 10) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
        sortField: q.sortField || undefined,
        sortOrder: (q.sortOrder === 'asc' || q.sortOrder === 'desc') ? q.sortOrder : undefined,
        search: q.search?.slice(0, 120) || undefined,
        league: q.league?.slice(0, 120) || undefined,
        marketType: q.marketType?.slice(0, 80) || undefined,
        stakableOnly: q.stakableOnly === 'true',
        minConfidence: q.minConfidence ? parseInt(q.minConfidence, 10) : undefined,
        dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(q.dateFrom || '') ? q.dateFrom : undefined,
        dateTo: /^\d{4}-\d{2}-\d{2}$/.test(q.dateTo || '') ? q.dateTo : undefined,
      };
      const result = await aiGamesService.list(query);
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('List games error:', error);
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
