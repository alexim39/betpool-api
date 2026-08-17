import mongoose from 'mongoose';
import { PodService } from './pod.service';
import { cacheService } from '../../services/cache.service';

jest.mock('../../models/pod.model', () => ({
  PodModel: { create: jest.fn(), find: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(), countDocuments: jest.fn(), distinct: jest.fn() }
}));
jest.mock('../ai/ai-personalization.service', () => ({
  aiPersonalizationService: { personalize: jest.fn() }
}));
jest.mock('../../services/logger.service', () => ({
  logger: { debug: jest.fn() }
}));

const MockPodModel = require('../../models/pod.model').PodModel;

const OID = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');

function findChain(pods: unknown[]) {
  return {
    select: jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(pods) })
    })
  };
}

describe('PodService', () => {
  let service: PodService;

  beforeEach(() => {
    service = new PodService();
    cacheService.clear('feed:');
    jest.clearAllMocks();
  });

  describe('createUserPick', () => {
    it('creates an immediately-open followers-only pod owned by the user', async () => {
      MockPodModel.create.mockResolvedValue({ _id: OID, title: 'T' });

      const closesAt = new Date(Date.now() + 60 * 60000);
      const result = await service.createUserPick('u1', {
        sport: 'Football',
        league: 'Premier League',
        homeTeam: 'Team A',
        awayTeam: 'Team B',
        matchDate: closesAt,
        selection: 'Home Win',
        gainsMultiplier: 2.1,
        stakingClosesAt: closesAt
      });

      const created = MockPodModel.create.mock.calls[0][0];
      expect(created.createdBy).toBe('u1');
      expect(created.visibility).toBe('followers');
      expect(created.status).toBe('active');
      expect(created.marketType).toBe('Match Result');
      expect(created.impliedProbability).toBeCloseTo(1 / 2.1);
      expect(created.currentExposure).toBe(0);
      expect(created.currentParticipants).toBe(0);
      expect(created.maxPayout).toBe(Math.floor(50000 * 2.1));
      expect(created.title).toBe('Team A vs Team B — Home Win');
      expect(created.opensAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(result._id).toEqual(OID);
    });

    it('clears the feed cache so the new pick is visible immediately', async () => {
      MockPodModel.create.mockResolvedValue({});
      cacheService.set('feed:all:all', { items: [], total: 0 }, 60000);

      await service.createUserPick('u1', {
        sport: 'Football',
        homeTeam: 'A',
        awayTeam: 'B',
        matchDate: new Date(),
        selection: 'Draw',
        gainsMultiplier: 3,
        stakingClosesAt: new Date(Date.now() + 60000)
      });

      expect(cacheService.get('feed:all:all')).toBeNull();
    });
  });

  describe('getActiveFeed', () => {
    it('excludes followers-only pods from the public feed', async () => {
      const now = new Date();
      const pods = [
        { _id: OID, title: 'Public pick', status: 'active', stakingClosesAt: new Date(now.getTime() + 3600000), displayOrder: 0, opensAt: now, gainsMultiplier: 2, selection: 'X', metadata: null, createdBy: { _id: OID, fullName: 'Ora' } }
      ];
      MockPodModel.find.mockReturnValue(findChain(pods));

      const result = await service.getActiveFeed({ limit: 20 });

      const query = MockPodModel.find.mock.calls[0][0];
      expect(query.visibility).toEqual({ $ne: 'followers' });
      expect(query.status).toBe('active');
      expect(result.pods).toHaveLength(1);
      expect((result.pods[0] as any).creatorName).toBe('Ora');
    });
  });

  describe('extendOwnPick', () => {
    it('updates the closing time and clears the feed cache', async () => {
      const newClose = new Date(Date.now() + 7200000);
      MockPodModel.findByIdAndUpdate.mockResolvedValue({ _id: OID, stakingClosesAt: newClose });
      cacheService.set('feed:all:all', { items: [], total: 0 }, 60000);

      const result = await service.extendOwnPick(OID.toString(), newClose);

      expect(MockPodModel.findByIdAndUpdate).toHaveBeenCalledWith(
        OID.toString(),
        { stakingClosesAt: newClose },
        { new: true, runValidators: true }
      );
      expect(cacheService.get('feed:all:all')).toBeNull();
      expect(result).toEqual({ _id: OID, stakingClosesAt: newClose });
    });
  });
});
