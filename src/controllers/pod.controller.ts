import { Request, Response } from 'express';
import { podService, CreatePodData, UpdatePodData } from '../services/pod.service';
import { PodModel } from '../models/pod.model';

export class PodController {
  async getActiveFeed(req: Request, res: Response): Promise<void> {
    try {
      const { sport, isLive, limit, offset, cursor } = req.query;
      const limitNum = limit ? parseInt(limit as string) : 20;
      const offsetNum = offset ? parseInt(offset as string) : 0;
      const { pods, total } = await podService.getActiveFeed({
        sport: sport as string,
        isLive: isLive !== undefined ? isLive === 'true' : undefined,
        limit: limitNum,
        offset: offsetNum,
        cursor: cursor ? new Date(cursor as string) : undefined
      });
      res.json({
        success: true,
        data: {
          items: pods,
          total,
          hasMore: offsetNum + limitNum < total
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
      const sports = await PodModel.distinct('sport', { status: 'active' });
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

  async create(req: Request, res: Response): Promise<void> {
    try {
      const data = req.body as CreatePodData;
      const pod = await podService.create(data);
      res.status(201).json({ success: true, data: pod });
    } catch (error) {
      console.error('Create pod error:', error);
      res.status(500).json({ success: false, message: 'Failed to create pod' });
    }
  }

  async update(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data = req.body as UpdatePodData;
      const pod = await podService.update(id, data, new (require('mongoose').Types.ObjectId)(req.body.userId));
      if (!pod) {
        res.status(404).json({ success: false, message: 'Pod not found' });
        return;
      }
      res.json({ success: true, data: pod });
    } catch (error) {
      console.error('Update pod error:', error);
      res.status(500).json({ success: false, message: 'Failed to update pod' });
    }
  }

  async publish(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const pod = await podService.publish(id);
      if (!pod) {
        res.status(404).json({ success: false, message: 'Pod not found' });
        return;
      }
      res.json({ success: true, data: pod });
    } catch (error) {
      console.error('Publish pod error:', error);
      res.status(500).json({ success: false, message: 'Failed to publish pod' });
    }
  }

  async settle(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { result, notes } = req.body;
      const pod = await podService.settle(id, result, new (require('mongoose').Types.ObjectId)(req.body.userId), notes);
      if (!pod) {
        res.status(404).json({ success: false, message: 'Pod not found' });
        return;
      }
      res.json({ success: true, data: pod });
    } catch (error) {
      console.error('Settle pod error:', error);
      res.status(500).json({ success: false, message: 'Failed to settle pod' });
    }
  }

  async cancel(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const pod = await podService.cancel(id);
      if (!pod) {
        res.status(404).json({ success: false, message: 'Pod not found' });
        return;
      }
      res.json({ success: true, data: pod });
    } catch (error) {
      console.error('Cancel pod error:', error);
      res.status(500).json({ success: false, message: 'Failed to cancel pod' });
    }
  }
}

export const podController = new PodController();
