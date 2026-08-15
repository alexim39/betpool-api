import mongoose from 'mongoose';
import { SocialService } from './social.service';
import { cacheService } from '../../services/cache.service';

jest.mock('../../models/pod.model', () => ({
  PodModel: { findById: jest.fn(), find: jest.fn(), countDocuments: jest.fn() }
}));
jest.mock('../../models/user.model', () => ({
  UserModel: { findById: jest.fn(), findOne: jest.fn() }
}));
jest.mock('./social.model', () => ({
  SocialLikeModel: { findOne: jest.fn(), create: jest.fn(), deleteOne: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn(), distinct: jest.fn() },
  SocialSaveModel: { findOne: jest.fn(), create: jest.fn(), deleteOne: jest.fn(), distinct: jest.fn() },
  SocialFollowModel: { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), deleteOne: jest.fn(), countDocuments: jest.fn() },
  SocialCommentModel: { find: jest.fn(), findById: jest.fn(), create: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn() },
  SocialActivityModel: { find: jest.fn(), create: jest.fn(), countDocuments: jest.fn() }
}));

const MockPodModel = require('../../models/pod.model').PodModel;
const MockUserModel = require('../../models/user.model').UserModel;
const MockSocialLikeModel = require('./social.model').SocialLikeModel;
const MockSocialSaveModel = require('./social.model').SocialSaveModel;
const MockSocialFollowModel = require('./social.model').SocialFollowModel;
const MockSocialCommentModel = require('./social.model').SocialCommentModel;
const MockSocialActivityModel = require('./social.model').SocialActivityModel;

const OID = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
const POD = new mongoose.Types.ObjectId('507f1f77bcf86cd799439012');

function podChain(exists = true) {
  MockPodModel.findById.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(exists ? { _id: 'pod' } : null)
    })
  });
}

function findOneChain(value: unknown) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function oraChain(oraId: string | null) {
  MockUserModel.findOne.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(oraId ? { _id: new mongoose.Types.ObjectId(oraId) } : null) })
    })
  });
}

function findChain(items: unknown[]) {
  return {
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(items) })
  };
}

describe('SocialService', () => {
  let service: SocialService;

  beforeEach(() => {
    service = new SocialService();
    cacheService.clear('social:');
    jest.clearAllMocks();
  });

  describe('toggleLike', () => {
    it('rejects when the pod does not exist', async () => {
      podChain(false);
      await expect(service.toggleLike('u1', POD.toString())).rejects.toMatchObject({ statusCode: 404 });
    });

    it('creates a like when none exists and returns the new count', async () => {
      podChain(true);
      MockSocialLikeModel.findOne.mockReturnValue(findOneChain(null));
      MockSocialLikeModel.create.mockResolvedValue({});
      MockSocialLikeModel.countDocuments.mockResolvedValue(7);

      const result = await service.toggleLike('u1', POD.toString());

      expect(MockSocialLikeModel.create).toHaveBeenCalledWith({ pod: POD.toString(), user: 'u1' });
      expect(result).toEqual({ liked: true, count: 7 });
    });

    it('removes the like when one already exists', async () => {
      podChain(true);
      MockSocialLikeModel.findOne.mockReturnValue(findOneChain({ _id: 'like-1', pod: POD, user: OID }));
      MockSocialLikeModel.deleteOne.mockResolvedValue({});
      MockSocialLikeModel.countDocuments.mockResolvedValue(3);

      const result = await service.toggleLike('u1', POD.toString());

      expect(MockSocialLikeModel.deleteOne).toHaveBeenCalledWith({ _id: 'like-1' });
      expect(result).toEqual({ liked: false, count: 3 });
    });
  });

  describe('toggleSave', () => {
    it('toggles a save on and off', async () => {
      podChain(true);
      MockSocialSaveModel.findOne
        .mockReturnValueOnce(findOneChain(null))
        .mockReturnValueOnce(findOneChain({ _id: 'save-1' }));
      MockSocialSaveModel.create.mockResolvedValue({});
      MockSocialSaveModel.deleteOne.mockResolvedValue({});

      const on = await service.toggleSave('u1', POD.toString());
      expect(on).toEqual({ saved: true });
      expect(MockSocialSaveModel.create).toHaveBeenCalledWith({ pod: POD.toString(), user: 'u1' });

      const off = await service.toggleSave('u1', POD.toString());
      expect(off).toEqual({ saved: false });
      expect(MockSocialSaveModel.deleteOne).toHaveBeenCalledWith({ _id: 'save-1' });
    });
  });

  describe('toggleFollow', () => {
    it('rejects self-follows', async () => {
      oraChain(null);
      await expect(service.toggleFollow('u1', 'u1')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects when the creator does not exist or is inactive', async () => {
      oraChain(null);
      MockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) })
      });
      await expect(service.toggleFollow('u1', OID.toString())).rejects.toMatchObject({ statusCode: 404 });
    });

    it('follows and returns the follower count', async () => {
      oraChain(null);
      MockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: OID, isActive: true, isSuspended: false }) })
      });
      MockSocialFollowModel.findOne.mockReturnValue(findOneChain(null));
      MockSocialFollowModel.create.mockResolvedValue({});
      MockSocialFollowModel.countDocuments.mockResolvedValue(12);

      const result = await service.toggleFollow('u1', OID.toString());

      expect(MockSocialFollowModel.create).toHaveBeenCalledWith({ follower: 'u1', followee: OID.toString() });
      expect(result).toEqual({ following: true, followerCount: 12 });
    });

    it('never lets a user unfollow Ora — always following', async () => {
      oraChain(OID.toString());
      MockSocialFollowModel.countDocuments.mockResolvedValue(42);

      const result = await service.toggleFollow('u1', OID.toString());

      expect(result).toEqual({ following: true, followerCount: 42 });
      expect(MockSocialFollowModel.deleteOne).not.toHaveBeenCalled();
      expect(MockSocialFollowModel.create).not.toHaveBeenCalled();
    });
  });

  describe('addComment', () => {
    it('rejects when the pod does not exist', async () => {
      podChain(false);
      await expect(service.addComment('u1', POD.toString(), 'Nice pick')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('creates the comment and returns it populated', async () => {
      podChain(true);
      const comment = { _id: 'c1', pod: POD, user: OID, text: 'Nice pick' };
      MockSocialCommentModel.create.mockResolvedValue(comment);
      MockSocialCommentModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ ...comment, user: { fullName: 'Ade' } }) })
      });

      const result = await service.addComment('u1', POD.toString(), 'Nice pick');

      expect(MockSocialCommentModel.create).toHaveBeenCalledWith({ pod: POD.toString(), user: 'u1', text: 'Nice pick' });
      expect(result).toMatchObject({ _id: 'c1', text: 'Nice pick' });
    });
  });

  describe('listComments', () => {
    it('clamps limit into [5, 100]', async () => {
      podChain(true);
      MockSocialCommentModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              populate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
            })
          })
        })
      });
      MockSocialCommentModel.countDocuments.mockResolvedValue(0);

      const result = await service.listComments(POD.toString(), 1, 999);

      expect(result.limit).toBe(100);
    });
  });

  describe('getStats', () => {
    it('dedupes, drops invalid and caps pod ids at 200', async () => {
      const ids = [
        POD.toString(),
        POD.toString(),
        'not-an-id',
        ...Array.from({ length: 210 }, () => new mongoose.Types.ObjectId().toString())
      ];
      MockSocialLikeModel.aggregate.mockResolvedValue([{ _id: POD, count: 4 }]);
      MockSocialCommentModel.aggregate.mockResolvedValue([]);
      MockSocialLikeModel.distinct.mockResolvedValue([POD]);
      MockSocialSaveModel.distinct.mockResolvedValue([POD]);

      const result = await service.getStats('u1', ids);

      expect(MockSocialLikeModel.aggregate).toHaveBeenCalledTimes(1);
      const matchArg = MockSocialLikeModel.aggregate.mock.calls[0][0][0];
      expect(matchArg.$match.pod.$in.length).toBe(200);
      expect(result.likes[POD.toString()]).toBe(4);
      expect(result.liked).toEqual([POD.toString()]);
      expect(result.saved).toEqual([POD.toString()]);
    });
  });

  describe('getFollowingFeed', () => {
    it('returns empty when the user follows nobody and no Ora creator exists', async () => {
      oraChain(null);
      MockSocialFollowModel.find.mockReturnValue(findChain([]));

      const result = await service.getFollowingFeed('u1', 1, 12);

      expect(result).toEqual({ items: [], total: 0, page: 1, limit: 12, pages: 0 });
    });

    it('queries active pods by followed creators (Ora always included)', async () => {
      oraChain(null);
      MockSocialFollowModel.find.mockReturnValue(findChain([{ followee: OID }]));
      const pods = [{ _id: POD, title: 'Pick' }];
      MockPodModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(pods) })
            })
          })
        })
      });
      MockPodModel.countDocuments.mockResolvedValue(1);

      const result = await service.getFollowingFeed('u1', 1, 12);

      const filter = MockPodModel.find.mock.calls[0][0];
      expect(filter.status).toBe('active');
      expect(filter.createdBy.$in[0].toString()).toBe(OID.toString());
      expect(result.items).toEqual(pods);
    });

    it('includes Ora in the followed set even with no follow rows', async () => {
      oraChain(OID.toString());
      MockSocialFollowModel.find.mockReturnValue(findChain([]));
      const pods = [{ _id: POD, title: 'Ora pick' }];
      MockPodModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(pods) })
            })
          })
        })
      });
      MockPodModel.countDocuments.mockResolvedValue(1);

      const result = await service.getFollowingFeed('u1', 1, 12);

      expect(MockPodModel.find.mock.calls[0][0].createdBy.$in[0].toString()).toBe(OID.toString());
      expect(result.items).toEqual(pods);
    });
  });

  describe('getActivity', () => {
    it('returns empty when the user follows nobody and no Ora creator exists', async () => {
      oraChain(null);
      MockSocialFollowModel.find.mockReturnValue(findChain([]));

      const result = await service.getActivity('u1', 1, 20);

      expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20, pages: 0 });
    });

    it('fetches activity from followed actors', async () => {
      oraChain(null);
      MockSocialFollowModel.find.mockReturnValue(findChain([{ followee: OID }]));
      const activity = [{ _id: 'a1', type: 'pick_published', pod: POD }];
      MockSocialActivityModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              populate: jest.fn().mockReturnValue({
                populate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(activity) })
              })
            })
          })
        })
      });
      MockSocialActivityModel.countDocuments.mockResolvedValue(1);

      const result = await service.getActivity('u1', 1, 20);

      expect(MockSocialActivityModel.find.mock.calls[0][0].actor.$in[0].toString()).toBe(OID.toString());
      expect(result.items).toEqual(activity);
    });

    it('records a new activity document', async () => {
      MockSocialActivityModel.create.mockResolvedValue({});

      await service.recordActivity(OID.toString(), 'pick_published', POD.toString(), { x: 1 });

      expect(MockSocialActivityModel.create).toHaveBeenCalledWith({
        actor: OID.toString(),
        type: 'pick_published',
        pod: POD.toString(),
        payload: { x: 1 }
      });
    });
  });
});
