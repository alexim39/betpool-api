import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { logger } from '../../services/logger.service';
import { socialService } from './social.service';
import { creatorViralityService } from './creator-virality.service';

function getUserId(req: AuthRequest): string | null {
  return req.user?.userId ?? null;
}

function parsePage(req: AuthRequest): number {
  return Math.max(1, parseInt(req.query.page as string, 10) || 1);
}

function parseLimit(req: AuthRequest, fallback: number): number {
  return Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || fallback));
}

export class SocialController {
  async toggleLike(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
      const data = await socialService.toggleLike(userId, String(req.body.podId));
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Social toggleLike error', error);
      res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Failed to update like' });
    }
  }

  async toggleSave(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
      const data = await socialService.toggleSave(userId, String(req.body.podId));
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Social toggleSave error', error);
      res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Failed to update save' });
    }
  }

  async toggleFollow(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
      const data = await socialService.toggleFollow(userId, String(req.body.creatorId));
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Social toggleFollow error', error);
      res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Failed to update follow' });
    }
  }

  async addComment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
      const data = await socialService.addComment(userId, String(req.body.podId), String(req.body.text));
      res.status(201).json({ success: true, data });
    } catch (error: any) {
      logger.error('Social addComment error', error);
      res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Failed to add comment' });
    }
  }

  async listComments(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
      const podId = String(req.query.podId || '');
      if (!podId || podId.length !== 24) { res.status(400).json({ success: false, message: 'Invalid pod ID' }); return; }
      const data = await socialService.listComments(podId, parsePage(req), parseLimit(req, 20));
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Social listComments error', error);
      res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Failed to fetch comments' });
    }
  }

  async getStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
      const raw = req.query.podIds;
      const podIds = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(',').filter(Boolean) : [];
      const data = await socialService.getStats(userId, podIds);
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Social getStats error', error);
      res.status(500).json({ success: false, message: error?.message || 'Failed to fetch social stats' });
    }
  }

  async getFollowingFeed(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
      const data = await socialService.getFollowingFeed(userId, parsePage(req), parseLimit(req, 12));
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Social getFollowingFeed error', error);
      res.status(500).json({ success: false, message: error?.message || 'Failed to fetch following feed' });
    }
  }

  async listFollowing(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
      const data = await socialService.listFollowing(userId);
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Social listFollowing error', error);
      res.status(500).json({ success: false, message: error?.message || 'Failed to fetch following list' });
    }
  }

  async listCreators(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
      const data = await socialService.listCreators(userId, parseLimit(req, 12));
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Social listCreators error', error);
      res.status(500).json({ success: false, message: error?.message || 'Failed to fetch creators' });
    }
  }

  async getLeaderboard(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await creatorViralityService.getLeaderboard(parseLimit(req, 20));
      res.json({ success: true, data: { items: data } });
    } catch (error: any) {
      logger.error('Social leaderboard error', error);
      res.status(500).json({ success: false, message: error?.message || 'Failed to fetch leaderboard' });
    }
  }

  async getActivity(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
      const data = await socialService.getActivity(userId, parsePage(req), parseLimit(req, 20));
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Social getActivity error', error);
      res.status(500).json({ success: false, message: error?.message || 'Failed to fetch activity' });
    }
  }

  async getProfile(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
      const targetId = String(req.params.userId || '');
      if (!targetId || targetId.length !== 24) { res.status(400).json({ success: false, message: 'Invalid user ID' }); return; }
      const data = await socialService.getProfile(userId, targetId);
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Social getProfile error', error);
      res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Failed to fetch profile' });
    }
  }

  async listFollowers(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
      const targetId = String(req.query.userId || '');
      if (!targetId || targetId.length !== 24) { res.status(400).json({ success: false, message: 'Invalid user ID' }); return; }
      const data = await socialService.listFollowers(userId, targetId, parsePage(req), parseLimit(req, 20));
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Social listFollowers error', error);
      res.status(500).json({ success: false, message: error?.message || 'Failed to fetch followers' });
    }
  }

  async listFollowingUsers(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
      const targetId = String(req.query.userId || '');
      if (!targetId || targetId.length !== 24) { res.status(400).json({ success: false, message: 'Invalid user ID' }); return; }
      const data = await socialService.listFollowingUsers(userId, targetId, parsePage(req), parseLimit(req, 20));
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Social listFollowingUsers error', error);
      res.status(500).json({ success: false, message: error?.message || 'Failed to fetch following list' });
    }
  }

  async getCreatorPicks(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
      const targetId = String(req.query.userId || '');
      if (!targetId || targetId.length !== 24) { res.status(400).json({ success: false, message: 'Invalid user ID' }); return; }
      const data = await socialService.getCreatorPicks(userId, targetId, parsePage(req), parseLimit(req, 12));
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Social getCreatorPicks error', error);
      res.status(500).json({ success: false, message: error?.message || 'Failed to fetch creator picks' });
    }
  }

  async listSavedPods(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
      const data = await socialService.listSavedPods(userId, parsePage(req), parseLimit(req, 20));
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Social listSavedPods error', error);
      res.status(500).json({ success: false, message: error?.message || 'Failed to fetch saved picks' });
    }
  }
}

export const socialController = new SocialController();
