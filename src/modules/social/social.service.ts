import mongoose from 'mongoose';
import { AppError } from '../../middleware/error.middleware';
import { PodModel } from '../../models/pod.model';
import { UserModel } from '../../models/user.model';
import { cacheService } from '../../services/cache.service';
import { logger } from '../../services/logger.service';
import { createInAppNotification } from '../../services/notification.service';
import {
  SocialLikeModel,
  SocialSaveModel,
  SocialFollowModel,
  SocialCommentModel,
  SocialActivityModel,
  SocialActivityType
} from './social.model';

export interface SocialStats {
  likes: Record<string, number>;
  comments: Record<string, number>;
  liked: string[];
  saved: string[];
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

const MAX_STATS_IDS = 200;

export class SocialService {
  private async ensurePodExists(podId: string): Promise<void> {
    const pod = await PodModel.findById(podId).select('_id').lean();
    if (!pod) throw new AppError('Pod not found', 404);
  }

  private async getOraCreatorId(): Promise<string> {
    const cached = cacheService.get<string>('social:ora');
    if (cached) return cached;
    const ora = await UserModel.findOne({ role: 'admin' }).sort({ createdAt: 1 }).select('_id').lean();
    const id = ora?._id?.toString() || '';
    if (id) cacheService.set('social:ora', id, 60000);
    return id;
  }

  async toggleLike(userId: string, podId: string): Promise<{ liked: boolean; count: number }> {
    await this.ensurePodExists(podId);
    const existing = await SocialLikeModel.findOne({ pod: podId, user: userId }).lean();
    if (existing) {
      await SocialLikeModel.deleteOne({ _id: existing._id });
    } else {
      await SocialLikeModel.create({ pod: podId, user: userId });
    }
    const count = await SocialLikeModel.countDocuments({ pod: podId });
    return { liked: !existing, count };
  }

  async toggleSave(userId: string, podId: string): Promise<{ saved: boolean }> {
    await this.ensurePodExists(podId);
    const existing = await SocialSaveModel.findOne({ pod: podId, user: userId }).lean();
    if (existing) {
      await SocialSaveModel.deleteOne({ _id: existing._id });
    } else {
      await SocialSaveModel.create({ pod: podId, user: userId });
    }
    return { saved: !existing };
  }

  async toggleFollow(userId: string, creatorId: string): Promise<{ following: boolean; followerCount: number }> {
    const oraId = await this.getOraCreatorId();
    if (creatorId === oraId) {
      const followerCount = await SocialFollowModel.countDocuments({ followee: creatorId });
      return { following: true, followerCount };
    }
    if (creatorId === userId) throw new AppError('You cannot follow yourself', 400);
    const creator = await UserModel.findById(creatorId).select('_id isActive isSuspended').lean();
    if (!creator || !creator.isActive || creator.isSuspended) throw new AppError('Creator not found', 404);
    const existing = await SocialFollowModel.findOne({ follower: userId, followee: creatorId }).lean();
    if (existing) {
      await SocialFollowModel.deleteOne({ _id: existing._id });
    } else {
      await SocialFollowModel.create({ follower: userId, followee: creatorId });
    }
    const followerCount = await SocialFollowModel.countDocuments({ followee: creatorId });
    return { following: !existing, followerCount };
  }

  async listFollowedIds(userId: string): Promise<string[]> {
    const follows = await SocialFollowModel.find({ follower: userId }).select('followee').lean();
    const ids = follows.map(f => f.followee.toString());
    const oraId = await this.getOraCreatorId();
    if (oraId && !ids.includes(oraId)) ids.push(oraId);
    return ids;
  }

  async listFollowing(userId: string): Promise<{ ids: string[]; oraId: string }> {
    const ids = await this.listFollowedIds(userId);
    return { ids, oraId: await this.getOraCreatorId() };
  }

  async listCreators(userId: string, limit: number): Promise<Record<string, any>[]> {
    const safeLimit = Math.min(50, Math.max(1, limit || 20));
    const rows = await PodModel.aggregate<{ _id: mongoose.Types.ObjectId; podCount: number }>([
      { $match: { createdBy: { $exists: true, $ne: null }, status: 'active' } },
      { $group: { _id: '$createdBy', podCount: { $sum: 1 } } }
    ]);
    if (rows.length === 0) return [];
    const ids = rows.map(r => r._id);
    const users = await UserModel.find({ _id: { $in: ids }, isActive: true, isSuspended: false })
      .select('_id fullName')
      .lean();
    if (users.length === 0) return [];
    const oraId = await this.getOraCreatorId();
    const [follows, followerRows] = await Promise.all([
      SocialFollowModel.find({ follower: userId }).select('followee').lean(),
      SocialFollowModel.aggregate<{ _id: mongoose.Types.ObjectId; followers: number }>([
        { $match: { followee: { $in: ids } } },
        { $group: { _id: '$followee', followers: { $sum: 1 } } }
      ])
    ]);
    const followed = new Set(follows.map(f => f.followee.toString()));
    const counts = new Map(rows.map(r => [r._id.toString(), r.podCount]));
    const followerCounts = new Map(followerRows.map(r => [r._id.toString(), r.followers]));
    return users
      .map(u => {
        const id = String(u._id);
        const isOra = id === oraId;
        return {
          id,
          fullName: (u as any).fullName || 'BetPool user',
          podCount: counts.get(id) || 0,
          followerCount: followerCounts.get(id) || 0,
          isOra,
          isFollowing: isOra || followed.has(id)
        };
      })
      .filter(c => c.id !== userId)
      .sort((a, b) =>
        (b.isOra ? 1 : 0) - (a.isOra ? 1 : 0) ||
        b.followerCount - a.followerCount ||
        b.podCount - a.podCount
      )
      .slice(0, safeLimit);
  }

  async getProfile(requesterId: string, targetId: string): Promise<Record<string, any>> {
    const target = await UserModel.findById(targetId).select('_id fullName isActive isSuspended').lean();
    if (!target || !(target as any).isActive || (target as any).isSuspended) {
      throw new AppError('User not found', 404);
    }
    const oraId = await this.getOraCreatorId();
    const isOra = targetId === oraId;
    let picks = 0;
    let followers = 0;
    let following = 0;
    let likesReceived = 0;
    let stakers = 0;
    let followRow: any = null;
    try {
      [picks, followers, following, followRow, likesReceived, stakers] = await Promise.all([
        PodModel.countDocuments({ createdBy: targetId }),
        SocialFollowModel.countDocuments({ followee: targetId }),
        SocialFollowModel.countDocuments({ follower: targetId }),
        SocialFollowModel.findOne({ follower: requesterId, followee: targetId }).select('_id').lean(),
        this.countLikesReceived(targetId),
        this.countStakers(targetId)
      ]);
    } catch (err: any) {
      logger.error('Social getProfile stats query failed', err);
    }
    const achievements = this.buildAchievements({ isOra, picks, followers, likesReceived, stakers });
    return {
      user: {
        id: targetId,
        fullName: (target as any).fullName || 'BetPool user',
        isOra
      },
      stats: { picks, followers, following, likesReceived, stakers },
      achievements,
      isSelf: requesterId === targetId,
      isFollowing: isOra || !!followRow
    };
  }

  private async countLikesReceived(targetId: string): Promise<number> {
    const podIds = await PodModel.find({ createdBy: targetId }).select('_id').lean();
    if (podIds.length === 0) return 0;
    const rows = await SocialLikeModel.aggregate<{ count: number }>([
      { $match: { pod: { $in: podIds.map(p => p._id) } } },
      { $count: 'count' }
    ]);
    return rows[0]?.count ?? 0;
  }

  private async countStakers(targetId: string): Promise<number> {
    const rows = await PodModel.aggregate<{ total: number }>([
      { $match: { createdBy: new mongoose.Types.ObjectId(targetId) } },
      { $group: { _id: null, total: { $sum: '$currentParticipants' } } }
    ]);
    return rows[0]?.total ?? 0;
  }

  private buildAchievements(data: {
    isOra: boolean;
    picks: number;
    followers: number;
    likesReceived: number;
    stakers: number;
  }): string[] {
    const unlocked: string[] = [];
    if (data.isOra) unlocked.push('ai_curator');
    if (data.picks >= 1) unlocked.push('first_pick');
    if (data.picks >= 5) unlocked.push('rising_creator');
    if (data.picks >= 20) unlocked.push('veteran_creator');
    if (data.followers >= 10) unlocked.push('trending');
    if (data.followers >= 25) unlocked.push('pick_star');
    if (data.stakers >= 5) unlocked.push('community_pick');
    if (data.likesReceived >= 10) unlocked.push('crowd_favorite');
    return unlocked;
  }

  async listFollowers(requesterId: string, targetId: string, page: number, limit: number): Promise<PagedResult<Record<string, any>>> {
    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.min(100, Math.max(5, limit || 20));
    const filter = { followee: targetId };
    const [rows, total] = await Promise.all([
      SocialFollowModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .populate('follower', 'fullName')
        .lean() as Promise<Record<string, any>[]>,
      SocialFollowModel.countDocuments(filter)
    ]);
    const users = rows
      .map(r => {
        const u = r?.follower as any;
        return { id: String(u?._id || ''), fullName: u?.fullName || 'BetPool user' };
      })
      .filter(u => u.id);
    const items = await this.attachFollowState(requesterId, users, targetId);
    return { items, total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
  }

  async listFollowingUsers(requesterId: string, targetId: string, page: number, limit: number): Promise<PagedResult<Record<string, any>>> {
    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.min(100, Math.max(5, limit || 20));
    const filter = { follower: targetId };
    const [rows, total] = await Promise.all([
      SocialFollowModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .populate('followee', 'fullName')
        .lean() as Promise<Record<string, any>[]>,
      SocialFollowModel.countDocuments(filter)
    ]);
    const users = rows
      .map(r => {
        const u = r?.followee as any;
        return { id: String(u?._id || ''), fullName: u?.fullName || 'BetPool user' };
      })
      .filter(u => u.id);
    const items = await this.attachFollowState(requesterId, users, targetId);
    return { items, total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
  }

  private async attachFollowState(requesterId: string, users: { id: string; fullName: string }[], targetId: string): Promise<Record<string, any>[]> {
    const oraId = await this.getOraCreatorId();
    const mine = await SocialFollowModel.find({ follower: requesterId }).select('followee').lean();
    const followed = new Set(mine.map(f => f.followee.toString()));
    const selfId = targetId === requesterId ? requesterId : '';
    return users.map(u => ({
      id: u.id,
      fullName: u.fullName,
      isOra: u.id === oraId,
      isSelf: u.id === selfId,
      isFollowing: u.id === oraId || followed.has(u.id)
    }));
  }

  async getCreatorPicks(requesterId: string, targetId: string, page: number, limit: number): Promise<PagedResult<Record<string, any>>> {
    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.min(100, Math.max(5, limit || 12));
    const now = new Date();
    const isFollowed = await SocialFollowModel.findOne({ follower: requesterId, followee: targetId }).select('_id').lean();
    const filter: Record<string, any> = {
      status: 'active',
      createdBy: targetId,
      stakingClosesAt: { $gte: now },
      $expr: { $lt: ['$currentExposure', '$maxTotalExposure'] }
    };
    if (requesterId !== targetId && !isFollowed) {
      filter.visibility = { $ne: 'followers' };
    }
    const raw = (await PodModel.find(filter)
      .sort({ stakingClosesAt: 1, isLive: -1, displayOrder: 1, opensAt: 1, _id: 1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .select('-legs -marketOdds')
      .populate('createdBy', 'fullName')
      .lean()) as any[];
    const items = this.mapFeedPods(raw);
    const total = await PodModel.countDocuments(filter);
    return { items, total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
  }

  private mapFeedPods(raw: any[]): Record<string, any>[] {
    return raw.map(p => {
      const c = p?.createdBy;
      if (c && typeof c === 'object' && c._id) {
        return { ...p, createdBy: String(c._id), creatorName: c.fullName || null };
      }
      return { ...p, creatorName: null };
    });
  }

  async listSavedPods(userId: string, page: number, limit: number): Promise<PagedResult<Record<string, any>>> {
    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.min(100, Math.max(5, limit || 20));
    const filter = { user: userId };
    const now = new Date();
    const [rows, total] = await Promise.all([
      SocialSaveModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean() as Promise<Record<string, any>[]>,
      SocialSaveModel.countDocuments(filter)
    ]);
    const podIds = rows.map(r => String(r.pod)).filter(id => mongoose.isValidObjectId(id));
    if (podIds.length === 0) {
      return { items: [], total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
    }
    const raw = (await PodModel.find({
      _id: { $in: podIds.map(id => new mongoose.Types.ObjectId(id)) },
      status: 'active',
      stakingClosesAt: { $gte: now }
    })
      .select('-legs -marketOdds')
      .populate('createdBy', 'fullName')
      .lean()) as any[];
    const byId = new Map(this.mapFeedPods(raw).map(p => [String(p._id), p]));
    const items = podIds
      .map(id => byId.get(id))
      .filter(Boolean)
      .sort((a: any, b: any) => new Date(a.stakingClosesAt).getTime() - new Date(b.stakingClosesAt).getTime());
    return { items, total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
  }

  async addComment(userId: string, podId: string, text: string): Promise<Record<string, any>> {
    await this.ensurePodExists(podId);
    const comment = await SocialCommentModel.create({ pod: podId, user: userId, text });
    const full = await SocialCommentModel.findById(comment._id)
      .populate('user', 'fullName')
      .lean();
    return full;
  }

  async listComments(podId: string, page: number, limit: number): Promise<PagedResult<Record<string, any>>> {
    await this.ensurePodExists(podId);
    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.min(100, Math.max(5, limit || 20));
    const filter = { pod: podId };
    const [items, total] = await Promise.all([
      SocialCommentModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .populate('user', 'fullName')
        .lean() as Promise<Record<string, any>[]>,
      SocialCommentModel.countDocuments(filter)
    ]);
    return { items, total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
  }

  async getStats(userId: string, rawPodIds: string[]): Promise<SocialStats> {
    const unique = [...new Set(rawPodIds)].filter(id => mongoose.isValidObjectId(id)).slice(0, MAX_STATS_IDS);
    const ids = unique.map(id => new mongoose.Types.ObjectId(id));
    const likes: Record<string, number> = {};
    const comments: Record<string, number> = {};
    if (ids.length > 0) {
      const [likeRows, commentRows, likedIds, savedIds] = await Promise.all([
        SocialLikeModel.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
          { $match: { pod: { $in: ids } } },
          { $group: { _id: '$pod', count: { $sum: 1 } } }
        ]),
        SocialCommentModel.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
          { $match: { pod: { $in: ids } } },
          { $group: { _id: '$pod', count: { $sum: 1 } } }
        ]),
        SocialLikeModel.distinct('pod', { user: userId, pod: { $in: ids } }),
        SocialSaveModel.distinct('pod', { user: userId, pod: { $in: ids } })
      ]);
      likeRows.forEach(row => { likes[row._id.toString()] = row.count; });
      commentRows.forEach(row => { comments[row._id.toString()] = row.count; });
      return {
        likes,
        comments,
        liked: likedIds.map(String),
        saved: savedIds.map(String)
      };
    }
    return { likes, comments, liked: [], saved: [] };
  }

  async getFollowingFeed(userId: string, page: number, limit: number): Promise<PagedResult<Record<string, any>>> {
    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.min(100, Math.max(5, limit || 12));
    const followedIds = await this.listFollowedIds(userId);
    if (followedIds.length === 0) {
      return { items: [], total: 0, page: safePage, limit: safeLimit, pages: 0 };
    }
    const now = new Date();
    const includedIds = [...followedIds, userId].filter(id => mongoose.isValidObjectId(id));
    const filter = {
      status: 'active',
      stakingClosesAt: { $gte: now },
      createdBy: { $in: includedIds.map(id => new mongoose.Types.ObjectId(id)) },
      $expr: { $lt: ['$currentExposure', '$maxTotalExposure'] }
    };
    const raw = (await PodModel.find(filter)
      .sort({ stakingClosesAt: 1, isLive: -1, displayOrder: 1, opensAt: 1, _id: 1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .select('-legs -marketOdds')
      .populate('createdBy', 'fullName')
      .lean()) as any[];
    const items = this.mapFeedPods(raw);
    const total = await PodModel.countDocuments(filter);
    return { items, total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
  }

  async getActivity(userId: string, page: number, limit: number): Promise<PagedResult<Record<string, any>>> {
    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.min(50, Math.max(5, limit || 20));
    const followedIds = await this.listFollowedIds(userId);
    if (followedIds.length === 0) {
      return { items: [], total: 0, page: safePage, limit: safeLimit, pages: 0 };
    }
    const filter = { actor: { $in: followedIds.map(id => new mongoose.Types.ObjectId(id)) } };
    const [items, total] = await Promise.all([
      SocialActivityModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .populate('pod', 'title homeTeam awayTeam league sport gainsMultiplier')
        .populate('actor', 'fullName')
        .lean() as Promise<Record<string, any>[]>,
      SocialActivityModel.countDocuments(filter)
    ]);
    return { items, total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
  }

  async recordActivity(actorId: string, type: SocialActivityType, podId?: string, payload?: Record<string, any>): Promise<void> {
    await SocialActivityModel.create({ actor: actorId, type, pod: podId, payload });
  }

  async notifyFollowersOfNewPick(creatorId: string, podId: string, title: string): Promise<number> {
    try {
      const creator = await UserModel.findById(creatorId).select('fullName').lean();
      const name = (creator as any)?.fullName || 'A creator';
      const followers = await SocialFollowModel.find({ followee: creatorId }).select('follower').lean();
      if (followers.length === 0) return 0;
      const unique = [...new Set(followers.map(f => String(f.follower)))];
      await Promise.all(unique.map(followerId =>
        createInAppNotification(
          followerId,
          'system',
          `New pick from ${name}`,
          `"${title}" is open for staking now.`,
          { podId, creatorId }
        )
      ));
      return unique.length;
    } catch (err) {
      return 0;
    }
  }
}

export const socialService = new SocialService();
