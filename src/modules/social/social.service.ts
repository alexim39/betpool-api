import mongoose from 'mongoose';
import { AppError } from '../../middleware/error.middleware';
import { PodModel } from '../../models/pod.model';
import { UserModel } from '../../models/user.model';
import { cacheService } from '../../services/cache.service';
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
      { $match: { createdBy: { $exists: true, $ne: null } } },
      { $group: { _id: '$createdBy', podCount: { $sum: 1 } } },
      { $sort: { podCount: -1 } }
    ]);
    if (rows.length === 0) return [];
    const ids = rows.map(r => r._id);
    const users = await UserModel.find({ _id: { $in: ids }, isActive: true }).select('_id fullName').lean();
    if (users.length === 0) return [];
    const oraId = await this.getOraCreatorId();
    const follows = await SocialFollowModel.find({ follower: userId }).select('followee').lean();
    const followed = new Set(follows.map(f => f.followee.toString()));
    const counts = new Map(rows.map(r => [r._id.toString(), r.podCount]));
    return users
      .map(u => {
        const id = String(u._id);
        const isOra = id === oraId;
        return {
          id,
          fullName: (u as any).fullName || 'BetPool user',
          podCount: counts.get(id) || 0,
          isOra,
          isFollowing: isOra || followed.has(id)
        };
      })
      .filter(c => c.id !== userId)
      .sort((a, b) => b.podCount - a.podCount)
      .slice(0, safeLimit);
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
    const filter = {
      status: 'active',
      stakingClosesAt: { $gte: now },
      createdBy: { $in: followedIds.map(id => new mongoose.Types.ObjectId(id)) },
      $expr: { $lt: ['$currentExposure', '$maxTotalExposure'] }
    };
    const raw = (await PodModel.find(filter)
      .sort({ stakingClosesAt: 1, isLive: -1, displayOrder: 1, opensAt: 1, _id: 1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .select('-legs -marketOdds')
      .populate('createdBy', 'fullName')
      .lean()) as any[];
    const items = raw.map(p => {
      const c = p?.createdBy;
      if (c && typeof c === 'object' && c._id) {
        return { ...p, createdBy: String(c._id), creatorName: c.fullName || null };
      }
      return { ...p, creatorName: null };
    });
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
}

export const socialService = new SocialService();
