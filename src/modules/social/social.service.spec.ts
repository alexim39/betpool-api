import mongoose from 'mongoose';
import { SocialService } from './social.service';
import { cacheService } from '../../services/cache.service';

jest.mock('../../models/pod.model', () => ({
  PodModel: { findById: jest.fn(), find: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn() }
}));
jest.mock('../../models/user.model', () => ({
  UserModel: { findById: jest.fn(), findOne: jest.fn(), find: jest.fn() }
}));
jest.mock('../../services/notification.service', () => ({
  createInAppNotification: jest.fn()
}));
jest.mock('./social.model', () => ({
  SocialLikeModel: { findOne: jest.fn(), create: jest.fn(), deleteOne: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn(), distinct: jest.fn() },
  SocialSaveModel: { findOne: jest.fn(), create: jest.fn(), deleteOne: jest.fn(), distinct: jest.fn() },
  SocialFollowModel: { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), deleteOne: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn() },
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
const MockCreateInAppNotification = require('../../services/notification.service').createInAppNotification;

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

function populateChain(items: unknown[]) {
  return {
    sort: jest.fn().mockReturnValue({
      skip: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(items) })
        })
      })
    })
  };
}

function feedChain(items: unknown[]) {
  return {
    sort: jest.fn().mockReturnValue({
      skip: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(items) })
          })
        })
      })
    })
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
    const USER = new mongoose.Types.ObjectId('507f1f77bcf86cd799439013');

    it('returns empty when the user follows nobody and no Ora creator exists', async () => {
      oraChain(null);
      MockSocialFollowModel.find.mockReturnValue(findChain([]));

      const result = await service.getFollowingFeed(USER.toString(), 1, 12);

      expect(result).toEqual({ items: [], total: 0, page: 1, limit: 12, pages: 0 });
    });

    it('queries active pods by followed creators (Ora always included)', async () => {
      oraChain(null);
      MockSocialFollowModel.find.mockReturnValue(findChain([{ followee: OID }]));
      const pods = [{ _id: POD, title: 'Pick', createdBy: { _id: OID, fullName: 'Ada Lovelace' } }];
      MockPodModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                populate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(pods) })
              })
            })
          })
        })
      });
      MockPodModel.countDocuments.mockResolvedValue(1);

      const result = await service.getFollowingFeed(USER.toString(), 1, 12);

      const filter = MockPodModel.find.mock.calls[0][0];
      expect(filter.status).toBe('active');
      expect(filter.createdBy.$in[0].toString()).toBe(OID.toString());
      expect(filter.createdBy.$in.map((x: { toString: () => string }) => x.toString())).toContain(USER.toString());
      expect(result.items[0].title).toBe('Pick');
      expect(result.items[0].createdBy).toBe(OID.toString());
      expect(result.items[0].creatorName).toBe('Ada Lovelace');
    });

    it('includes Ora in the followed set even with no follow rows', async () => {
      oraChain(OID.toString());
      MockSocialFollowModel.find.mockReturnValue(findChain([]));
      const pods = [{ _id: POD, title: 'Ora pick' }];
      MockPodModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                populate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(pods) })
              })
            })
          })
        })
      });
      MockPodModel.countDocuments.mockResolvedValue(1);

      const result = await service.getFollowingFeed(USER.toString(), 1, 12);

      expect(MockPodModel.find.mock.calls[0][0].createdBy.$in[0].toString()).toBe(OID.toString());
      expect(result.items[0].title).toBe('Ora pick');
      expect(result.items[0].creatorName).toBeNull();
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

  describe('notifyFollowersOfNewPick', () => {
    it('notifies each unique follower with a pod deep-link payload', async () => {
      MockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ fullName: 'Ada Lovelace' }) })
      });
      const other = new mongoose.Types.ObjectId('507f1f77bcf86cd799439014');
      MockSocialFollowModel.find.mockReturnValue(findChain([
        { follower: other },
        { follower: other },
        { follower: OID }
      ]));

      const sent = await service.notifyFollowersOfNewPick('creator-1', POD.toString(), 'Pick title');

      expect(MockCreateInAppNotification).toHaveBeenCalledTimes(2);
      expect(MockCreateInAppNotification).toHaveBeenCalledWith(
        OID.toString(), 'system', 'New pick from Ada Lovelace', '"Pick title" is open for staking now.',
        { podId: POD.toString(), creatorId: 'creator-1' }
      );
      expect(MockCreateInAppNotification).toHaveBeenCalledWith(
        other.toString(), 'system', 'New pick from Ada Lovelace', '"Pick title" is open for staking now.',
        { podId: POD.toString(), creatorId: 'creator-1' }
      );
      expect(sent).toBe(2);
    });

    it('returns 0 when the creator has no followers', async () => {
      MockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ fullName: 'Ada' }) })
      });
      MockSocialFollowModel.find.mockReturnValue(findChain([]));

      const sent = await service.notifyFollowersOfNewPick('creator-1', POD.toString(), 'Pick title');

      expect(MockCreateInAppNotification).not.toHaveBeenCalled();
      expect(sent).toBe(0);
    });
  });

  describe('listFollowing', () => {
    it('returns followed ids with Ora always included', async () => {
      oraChain(OID.toString());
      MockSocialFollowModel.find.mockReturnValue(findChain([{ followee: OID }]));

      const result = await service.listFollowing('u1');

      expect(result.ids).toEqual([OID.toString()]);
      expect(result.oraId).toBe(OID.toString());
    });

    it('adds Ora even when nothing is followed', async () => {
      oraChain(OID.toString());
      MockSocialFollowModel.find.mockReturnValue(findChain([]));

      const result = await service.listFollowing('u1');

      expect(result.ids).toEqual([OID.toString()]);
    });
  });

  describe('listCreators', () => {
    it('returns creators with counts, follower counts, ora flag and following state, excluding the caller', async () => {
      const other = new mongoose.Types.ObjectId('507f1f77bcf86cd799439013');
      oraChain(OID.toString());
      MockPodModel.aggregate.mockResolvedValue([
        { _id: OID, podCount: 12 },
        { _id: other, podCount: 4 }
      ]);
      MockUserModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([
          { _id: OID, fullName: 'Ora' },
          { _id: other, fullName: 'Grace Hopper' }
        ]) })
      });
      MockSocialFollowModel.find.mockReturnValue(findChain([{ followee: other }]));
      MockSocialFollowModel.aggregate.mockResolvedValue([
        { _id: OID, followers: 30 },
        { _id: other, followers: 5 }
      ]);

      const result = await service.listCreators('me', 20);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: OID.toString(), fullName: 'Ora', podCount: 12, followerCount: 30, isOra: true, isFollowing: true });
      expect(result[1]).toMatchObject({ id: other.toString(), fullName: 'Grace Hopper', podCount: 4, followerCount: 5, isOra: false, isFollowing: true });
    });

    it('ranks by follower count before pick count', async () => {
      const high = new mongoose.Types.ObjectId('507f1f77bcf86cd799439014');
      const low = new mongoose.Types.ObjectId('507f1f77bcf86cd799439015');
      oraChain(null);
      MockPodModel.aggregate.mockResolvedValue([
        { _id: high, podCount: 3 },
        { _id: low, podCount: 40 }
      ]);
      MockUserModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([
          { _id: high, fullName: 'Popular Few' },
          { _id: low, fullName: 'Busy Nobody' }
        ]) })
      });
      MockSocialFollowModel.find.mockReturnValue(findChain([]));
      MockSocialFollowModel.aggregate.mockResolvedValue([
        { _id: high, followers: 50 },
        { _id: low, followers: 2 }
      ]);

      const result = await service.listCreators('me', 20);

      expect(result[0]).toMatchObject({ id: high.toString(), followerCount: 50 });
      expect(result[1]).toMatchObject({ id: low.toString(), followerCount: 2 });
    });

    it('excludes the requesting user and non-creators', async () => {
      oraChain(null);
      MockPodModel.aggregate.mockResolvedValue([{ _id: OID, podCount: 7 }]);
      MockUserModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([
          { _id: OID, fullName: 'Ora' }
        ]) })
      });
      MockSocialFollowModel.find.mockReturnValue(findChain([]));
      MockSocialFollowModel.aggregate.mockResolvedValue([{ _id: OID, followers: 7 }]);

      const result = await service.listCreators(OID.toString(), 20);

      expect(result).toHaveLength(0);
    });

    it('returns empty when no pods exist', async () => {
      MockPodModel.aggregate.mockResolvedValue([]);

      const result = await service.listCreators('me', 20);

      expect(result).toEqual([]);
    });
  });

  describe('getProfile', () => {
    it('returns profile stats, achievements and follow state', async () => {
      oraChain(OID.toString());
      MockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: OID, fullName: 'Ada Lovelace', isActive: true, isSuspended: false }) })
      });
      MockPodModel.countDocuments.mockResolvedValue(6);
      MockSocialFollowModel.countDocuments
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(3);
      MockSocialFollowModel.findOne.mockReturnValue(findOneChain({ _id: 'f' }));
      MockPodModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: OID }]) })
      });
      MockSocialLikeModel.aggregate.mockResolvedValue([{ count: 14 }]);
      MockPodModel.aggregate.mockResolvedValue([{ total: 9 }]);

      const result = await service.getProfile('me', OID.toString());

      expect(result.user).toEqual({ id: OID.toString(), fullName: 'Ada Lovelace', isOra: true });
      expect(result.stats).toEqual({ picks: 6, followers: 12, following: 3, likesReceived: 14, stakers: 9 });
      expect(result.isFollowing).toBe(true);
      expect(result.achievements).toContain('ai_curator');
      expect(result.achievements).toContain('rising_creator');
      expect(result.achievements).toContain('trending');
      expect(result.achievements).toContain('community_pick');
      expect(result.achievements).toContain('crowd_favorite');
    });

    it('throws when the target user does not exist', async () => {
      MockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) })
      });

      await expect(service.getProfile('me', OID.toString())).rejects.toThrow('User not found');
    });

    it('degrades gracefully when stats queries fail', async () => {
      oraChain(OID.toString());
      MockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: OID, fullName: 'Ada Lovelace', isActive: true, isSuspended: false }) })
      });
      MockPodModel.countDocuments.mockRejectedValue(new Error('connection lost'));

      const result = await service.getProfile('me', OID.toString());

      expect(result.stats).toEqual({ picks: 0, followers: 0, following: 0, likesReceived: 0, stakers: 0 });
      expect(result.user.fullName).toBe('Ada Lovelace');
    });
  });

  describe('listFollowers / listFollowingUsers', () => {
    it('returns user rows with follow state and ora flag', async () => {
      const fan = new mongoose.Types.ObjectId('507f1f77bcf86cd799439016');
      oraChain(OID.toString());
      MockSocialFollowModel.find
        .mockReturnValueOnce(populateChain([
          { follower: { _id: fan, fullName: 'Fan One' } },
          { follower: { _id: OID, fullName: 'Ora' } }
        ]))
        .mockReturnValueOnce(findChain([{ followee: OID }]));
      MockSocialFollowModel.countDocuments.mockResolvedValue(2);

      const result = await service.listFollowers('me', fan.toString(), 1, 20);

      expect(result.total).toBe(2);
      expect(result.items[0]).toMatchObject({ id: fan.toString(), fullName: 'Fan One', isOra: false, isFollowing: false, isSelf: false });
      expect(result.items[1]).toMatchObject({ id: OID.toString(), fullName: 'Ora', isOra: true, isFollowing: true });
    });

    it('marks own row as self on own profile', async () => {
      oraChain(null);
      MockSocialFollowModel.find
        .mockReturnValueOnce(populateChain([{ follower: { _id: OID, fullName: 'Me' } }]))
        .mockReturnValueOnce(findChain([]));
      MockSocialFollowModel.countDocuments.mockResolvedValue(1);

      const result = await service.listFollowers(OID.toString(), OID.toString(), 1, 20);

      expect(result.items[0]).toMatchObject({ id: OID.toString(), isSelf: true, isFollowing: false });
    });
  });

  describe('getCreatorPicks', () => {
    it('hides followers-only picks from non-followers', async () => {
      const pod = { _id: POD, title: 'T', createdBy: { _id: OID, fullName: 'Ora' } };
      MockSocialFollowModel.findOne.mockReturnValue(findOneChain(null));
      MockPodModel.find.mockReturnValue(feedChain([pod]));
      MockPodModel.countDocuments.mockResolvedValue(1);

      const result = await service.getCreatorPicks('me', OID.toString(), 1, 12);

      const filter = MockPodModel.find.mock.calls[0][0] as any;
      expect(filter.visibility).toEqual({ $ne: 'followers' });
      expect(result.items[0]).toMatchObject({ createdBy: OID.toString(), creatorName: 'Ora' });
    });

    it('includes followers-only picks for followers and the creator', async () => {
      const pod = { _id: POD, title: 'T', createdBy: { _id: OID, fullName: 'Ora' } };
      MockSocialFollowModel.findOne.mockReturnValue(findOneChain({ _id: 'f' }));
      MockPodModel.find.mockReturnValue(feedChain([pod]));
      MockPodModel.countDocuments.mockResolvedValue(1);

      const result = await service.getCreatorPicks(OID.toString(), OID.toString(), 1, 12);

      const filter = MockPodModel.find.mock.calls[0][0] as any;
      expect(filter.visibility).toBeUndefined();
      expect(result.items).toHaveLength(1);
    });
  });
});
