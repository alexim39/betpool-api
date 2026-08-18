import { Request, Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { podService } from './pod.service';
import { PodModel } from '../../models/pod.model';
import { UserModel } from '../../models/user.model';
import { cacheService } from '../../services/cache.service';
import { socialService } from '../social/social.service';
import { adminService } from '../admin/admin.service';
import { verifyFixture } from './fixture-verifier';

async function getOraId(): Promise<string> {
  const cached = cacheService.get<string>('feed:oraId');
  if (cached) return cached;
  const ora = await UserModel.findOne({ role: 'admin' }).sort({ createdAt: 1 }).select('_id').lean();
  const id = ora?._id?.toString() || '';
  if (id) cacheService.set('feed:oraId', id, 60000);
  return id;
}

export class PodController {
  async createPick(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }
      const body = req.body || {};
      const errors: string[] = [];
      const fixtureId = Number(body.fixtureId);
      if (!Number.isInteger(fixtureId) || fixtureId < 1) errors.push('fixtureId is required — pick a real game from the games list');
      if (!body.sport || typeof body.sport !== 'string') errors.push('sport is required');
      if (!body.homeTeam || typeof body.homeTeam !== 'string') errors.push('homeTeam is required');
      if (!body.awayTeam || typeof body.awayTeam !== 'string') errors.push('awayTeam is required');
      if (!body.selection || typeof body.selection !== 'string') errors.push('selection is required');

      const mult = Number(body.gainsMultiplier);
      if (!isFinite(mult) || mult < 1.01 || mult > 1000) errors.push('gainsMultiplier must be between 1.01 and 1000');

      const close = body.stakingClosesAt ? new Date(body.stakingClosesAt) : null;
      if (!close || isNaN(close.getTime())) {
        errors.push('stakingClosesAt is required');
      } else if (close.getTime() <= Date.now()) {
        errors.push('stakingClosesAt must be in the future');
      }

      const minStake = body.minStake === undefined ? 100 : Number(body.minStake);
      const maxStake = body.maxStake === undefined ? 50000 : Number(body.maxStake);
      if (!isFinite(minStake) || minStake < 10) errors.push('minStake must be at least 10');
      if (!isFinite(maxStake) || maxStake < minStake) errors.push('maxStake must be greater than or equal to minStake');

      const maxTotalExposure = body.maxTotalExposure === undefined ? 5000000 : Number(body.maxTotalExposure);
      if (!isFinite(maxTotalExposure) || maxTotalExposure < maxStake) errors.push('maxTotalExposure must be at least maxStake');

      if (errors.length > 0) {
        res.status(400).json({ success: false, message: errors.join('; ') });
        return;
      }
      if (!close) {
        res.status(400).json({ success: false, message: 'stakingClosesAt is required' });
        return;
      }

      // The fixture MUST exist in the sports feed, teams must match, and the
      // match must not have started. The verified fixture data (not the client
      // payload) is what gets stored on the pod.
      const verification = await verifyFixture(fixtureId, { homeTeam: body.homeTeam, awayTeam: body.awayTeam });
      if (!verification.ok || !verification.fixture) {
        res.status(400).json({ success: false, message: verification.reason || 'That game could not be verified' });
        return;
      }
      const kickoff = verification.fixture.matchDate;
      if (close.getTime() >= kickoff.getTime()) {
        res.status(400).json({ success: false, message: 'Staking must close before the game kicks off' });
        return;
      }

      const pod = await podService.createUserPick(req.user.userId, {
        sport: body.sport,
        league: verification.fixture.league,
        homeTeam: verification.fixture.homeTeam,
        awayTeam: verification.fixture.awayTeam,
        matchDate: kickoff,
        selection: body.selection,
        gainsMultiplier: mult,
        minStake,
        maxStake,
        maxTotalExposure,
        stakingClosesAt: close as Date,
        fixtureId
      });

      await socialService.recordActivity(req.user.userId, 'pick_published', String(pod._id), {
        title: pod.title
      });
      await socialService.notifyFollowersOfNewPick(req.user.userId, String(pod._id), pod.title);

      res.status(201).json({
        success: true,
        data: {
          id: String(pod._id),
          pod: {
            ...pod.toObject(),
            id: String(pod._id),
            createdBy: String(pod.createdBy),
            creatorName: (pod as any).creatorName || null
          }
        }
      });
    } catch (error) {
      console.error('Create pick error:', error);
      res.status(500).json({ success: false, message: 'Failed to create pick' });
    }
  }

  async managePick(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }
      const { id } = req.params;
      const body = req.body || {};
      const action = body.action;
      if (action !== 'extend' && action !== 'cancel') {
        res.status(400).json({ success: false, message: 'action must be "extend" or "cancel"' });
        return;
      }

      const pod = await PodModel.findById(id).select('createdBy status stakingClosesAt currentParticipants').lean();
      if (!pod) {
        res.status(404).json({ success: false, message: 'Pod not found' });
        return;
      }
      const isOwner = String(pod.createdBy) === req.user.userId;
      const isAdmin = req.user.role === 'admin';
      if (!isOwner && !isAdmin) {
        res.status(403).json({ success: false, message: 'Only the creator can manage this pick' });
        return;
      }

      if (action === 'extend') {
        const close = body.stakingClosesAt ? new Date(body.stakingClosesAt) : null;
        if (!close || isNaN(close.getTime())) {
          res.status(400).json({ success: false, message: 'stakingClosesAt is required' });
          return;
        }
        if (close.getTime() <= Date.now()) {
          res.status(400).json({ success: false, message: 'New closing time must be in the future' });
          return;
        }
        if (pod.status !== 'active') {
          res.status(400).json({ success: false, message: 'Only active picks can be extended' });
          return;
        }
        if (close.getTime() <= new Date(pod.stakingClosesAt).getTime()) {
          res.status(400).json({ success: false, message: 'New closing time must be later than the current closing time' });
          return;
        }
        const updated = await podService.extendOwnPick(id, close);
        res.json({ success: true, data: updated });
        return;
      }

      if (pod.status !== 'active') {
        res.status(400).json({ success: false, message: 'Only active picks can be cancelled' });
        return;
      }
      const cancelled = await adminService.cancelPod(id, req.user.userId);
      cacheService.clear('feed:');
      res.json({ success: true, data: cancelled });
    } catch (error) {
      console.error('Manage pick error:', error);
      res.status(500).json({ success: false, message: 'Failed to manage pick' });
    }
  }

  async getActiveFeed(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { sport, isLive, limit, offset, cursor, personalized } = req.query;
      const limitNum = limit ? parseInt(limit as string) : 20;
      const offsetNum = offset ? parseInt(offset as string) : 0;
      const { pods, total } = await podService.getActiveFeed({
        sport: sport as string,
        isLive: isLive !== undefined ? isLive === 'true' : undefined,
        limit: limitNum,
        offset: offsetNum,
        cursor: cursor ? new Date(cursor as string) : undefined,
        personalized: personalized === 'true' ? req.user?.userId : undefined
      });
      res.json({
        success: true,
        data: {
          items: pods,
          total,
          hasMore: offsetNum + limitNum < total,
          maxAccumulatorLegs: parseInt(process.env.MAX_ACCUMULATOR_LEGS || '5', 10),
          insuranceMinLegs: parseInt(process.env.ACCUMULATOR_INSURANCE_MIN_LEGS || '4', 10),
          oraId: await getOraId()
        }
      });
    } catch (error) {
      console.error('Get active feed error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch pods' });
    }
  }

  async getActiveFeedDebug(req: Request, res: Response): Promise<void> {
    try {
      const { sport, isLive, limit, cursor } = req.query;
      const now = new Date();
      const query: Record<string, any> = {
        status: 'active'
      };
      if (sport) query.sport = sport;
      if (isLive !== undefined) query.isLive = isLive === 'true';
      if (cursor) query.opensAt = { $lt: new Date(cursor as string) };

      console.log('DEBUG getActiveFeedDebug query:', JSON.stringify(query));
      console.log('DEBUG getActiveFeedDebug now:', now.toISOString());

      const pods = await PodModel.find(query)
        .sort({ isLive: -1, displayOrder: 1, opensAt: 1 })
        .limit(limit ? parseInt(limit as string) : 20)
        .lean();

      console.log('DEBUG getActiveFeedDebug result count:', pods.length);
      pods.forEach(p => console.log('  -', p.title, p.status, p.isLive, p.stakingClosesAt));

      res.json({ success: true, data: pods, query, count: pods.length });
    } catch (error) {
      console.error('Debug feed error:', error);
      res.status(500).json({ success: false, message: 'Debug failed' });
    }
  }

  async getUpcoming(req: Request, res: Response): Promise<void> {
    try {
      const { sport, limit, hoursAhead } = req.query;
      const pods = await podService.getUpcoming({
        sport: sport as string,
        limit: limit ? parseInt(limit as string) : 20,
        hoursAhead: hoursAhead ? parseInt(hoursAhead as string) : 24
      });
      res.json({ success: true, data: pods });
    } catch (error) {
      console.error('Get upcoming error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch upcoming pods' });
    }
  }

  async getSports(req: Request, res: Response): Promise<void> {
    try {
      const now = new Date();
      const sports = await PodModel.aggregate([
        {
          $match: {
            status: 'active',
            stakingClosesAt: { $gte: now },
            visibility: { $ne: 'followers' },
            $expr: { $lt: ['$currentExposure', '$maxTotalExposure'] }
          }
        },
        { $group: { _id: { $toLower: '$sport' }, sport: { $first: '$sport' }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, sport: 1, count: 1 } }
      ]);
      res.json({ success: true, data: sports });
    } catch (error) {
      console.error('Get sports error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch sports' });
    }
  }

  async getById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const pod = await podService.getById(id);
      if (!pod) {
        res.status(404).json({ success: false, message: 'Pod not found' });
        return;
      }
      res.json({ success: true, data: pod });
    } catch (error) {
      console.error('Get pod by ID error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch pod' });
    }
  }

  async getGains(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const gains = await podService.getGains(id);
      if (!gains) {
        res.status(404).json({ success: false, message: 'Pod not found' });
        return;
      }
      res.json({ success: true, data: gains });
    } catch (error) {
      console.error('Get gains error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch gains' });
    }
  }

  async search(req: Request, res: Response): Promise<void> {
    try {
      const { q, limit } = req.query;
      if (!q) {
        res.status(400).json({ success: false, message: 'Search query required' });
        return;
      }
      const pods = await podService.search(q as string, { limit: limit ? parseInt(limit as string) : 10 });
      res.json({ success: true, data: pods });
    } catch (error) {
      console.error('Search pods error:', error);
      res.status(500).json({ success: false, message: 'Search failed' });
    }
  }

  async getBySport(req: Request, res: Response): Promise<void> {
    try {
      const { sport } = req.params;
      const { status, limit } = req.query;
      const pods = await podService.getBySport(sport, {
        status: status as string,
        limit: limit ? parseInt(limit as string) : 50
      });
      res.json({ success: true, data: pods });
    } catch (error) {
      console.error('Get by sport error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch pods' });
    }
  }

}

export const podController = new PodController();

