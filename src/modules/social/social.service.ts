import mongoose from 'mongoose';
import { AppError } from '../../middleware/error.middleware';
import { PodModel } from '../../models/pod.model';
import { UserModel } from '../../models/user.model';
import { StakeModel } from '../../models/stake.model';
import BookingCodeModel from '../../models/booking-code.model';
import { cacheService } from '../../services/cache.service';
import { logger } from '../../services/logger.service';
import { createInAppNotification } from '../../services/notification.service';
import { bookingCodeService } from '../staking/booking-code.service';
import { creatorViralityService } from './creator-virality.service';
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
    const [pod, booking] = await Promise.all([
      PodModel.findById(podId).select('_id').lean(),
      BookingCodeModel.findById(podId).select('_id').lean()
    ]);
    if (!pod && !booking) throw new AppError('Pod not found', 404);
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
    const [rows, codeRows] = await Promise.all([
      PodModel.aggregate<{ _id: mongoose.Types.ObjectId; podCount: number }>([
        { $match: { createdBy: { $exists: true, $ne: null }, status: 'active' } },
        { $group: { _id: '$createdBy', podCount: { $sum: 1 } } }
      ]),
      SocialActivityModel.aggregate<{ _id: mongoose.Types.ObjectId; codeCount: number }>([
        { $match: { type: 'booking_code_shared' } },
        { $group: { _id: '$actor', codeCount: { $sum: 1 } } }
      ])
    ]);
    if (rows.length === 0 && codeRows.length === 0) return [];
    const ids = [...new Set([...rows.map(r => r._id), ...codeRows.map(r => r._id)])];
    const users = await UserModel.find({ _id: { $in: ids }, isActive: true, isSuspended: false })
      .select('_id fullName username')
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
    const codeCounts = new Map(codeRows.map(r => [r._id.toString(), r.codeCount]));
    const followerCounts = new Map(followerRows.map(r => [r._id.toString(), r.followers]));
    return users
      .map(u => {
        const id = String(u._id);
        const isOra = id === oraId;
        return {
          id,
          fullName: (u as any).fullName || 'BetPool user',
          username: (u as any).username || null,
          podCount: counts.get(id) || 0,
          codeCount: codeCounts.get(id) || 0,
          followerCount: followerCounts.get(id) || 0,
          isOra,
          isFollowing: isOra || followed.has(id)
        };
      })
      .filter(c => c.id !== userId)
      .sort((a, b) =>
        (b.isOra ? 1 : 0) - (a.isOra ? 1 : 0) ||
        b.followerCount - a.followerCount ||
        (b.codeCount || 0) - (a.codeCount || 0) ||
        b.podCount - a.podCount
      )
      .slice(0, safeLimit);
  }

  async getProfile(requesterId: string, targetId: string): Promise<Record<string, any>> {
    const cacheKey = `social:profile:${requesterId}:${targetId}`;
    const cached = cacheService.get<Record<string, any>>(cacheKey);
    if (cached) return cached;

    const target = await UserModel.findById(targetId).select('_id fullName username isActive isSuspended').lean();
    if (!target || !(target as any).isActive || (target as any).isSuspended) {
      throw new AppError('User not found', 404);
    }
    const oraId = await this.getOraCreatorId();
    const isOra = targetId === oraId;
    let codes = 0;
    let followers = 0;
    let following = 0;
    let likesReceived = 0;
    let stakers = 0;
    let followRow: any = null;
    try {
      [codes, followers, following, followRow, likesReceived, stakers] = await Promise.all([
        BookingCodeModel.countDocuments({ userId: targetId }),
        SocialFollowModel.countDocuments({ followee: targetId }),
        SocialFollowModel.countDocuments({ follower: targetId }),
        SocialFollowModel.findOne({ follower: requesterId, followee: targetId }).select('_id').lean(),
        this.countLikesReceived(targetId),
        this.countStakers(targetId)
      ]);
    } catch (err: any) {
      logger.error('Social getProfile stats query failed', err);
    }
    const achievements = this.buildAchievements({ isOra, codes, followers, likesReceived, stakers });
    const virality = await creatorViralityService.getVirality(targetId).catch(() => ({
      score: 0,
      codesShared: 0,
      stakesPlaced: 0,
      wins: 0,
      badge: 'Rookie',
      isTopCreator: false,
      rank: null
    }));
    const result: Record<string, any> = {
      user: {
        id: targetId,
        fullName: (target as any).fullName || 'BetPool user',
        username: (target as any).username || null,
        isOra
      },
      stats: { codes, followers, following, likesReceived, stakers },
      achievements,
      virality,
      isSelf: requesterId === targetId,
      isFollowing: isOra || !!followRow
    };
    cacheService.set(cacheKey, result, 30_000);
    return result;
  }

  private async countLikesReceived(targetId: string): Promise<number> {
    const codeIds = await BookingCodeModel.find({ userId: targetId }).select('_id').lean();
    if (codeIds.length === 0) return 0;
    const rows = await SocialLikeModel.aggregate<{ count: number }>([
      { $match: { pod: { $in: codeIds.map(c => c._id) } } },
      { $count: 'count' }
    ]);
    return rows[0]?.count ?? 0;
  }

  private async countStakers(targetId: string): Promise<number> {
    const codes = await BookingCodeModel.find({ userId: targetId }).select('code').lean();
    if (codes.length === 0) return 0;
    const rows = await StakeModel.aggregate<{ _id: mongoose.Types.ObjectId }>([
      { $match: { bookingCode: { $in: codes.map(c => c.code) } } },
      { $group: { _id: '$user' } }
    ]);
    return rows.length;
  }

  private buildAchievements(data: {
    isOra: boolean;
    codes: number;
    followers: number;
    likesReceived: number;
    stakers: number;
  }): string[] {
    const unlocked: string[] = [];
    if (data.isOra) unlocked.push('ai_curator');
    if (data.codes >= 1) unlocked.push('first_code');
    if (data.codes >= 5) unlocked.push('rising_creator');
    if (data.codes >= 20) unlocked.push('veteran_creator');
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
        .populate('follower', 'fullName username')
        .lean() as Promise<Record<string, any>[]>,
      SocialFollowModel.countDocuments(filter)
    ]);
    const users = rows
      .map(r => {
        const u = r?.follower as any;
        return { id: String(u?._id || ''), fullName: u?.fullName || 'BetPool user', username: u?.username || null };
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
        .populate('followee', 'fullName username')
        .lean() as Promise<Record<string, any>[]>,
      SocialFollowModel.countDocuments(filter)
    ]);
    const users = rows
      .map(r => {
        const u = r?.followee as any;
        return { id: String(u?._id || ''), fullName: u?.fullName || 'BetPool user', username: u?.username || null };
      })
      .filter(u => u.id);
    const items = await this.attachFollowState(requesterId, users, targetId);
    return { items, total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
  }

  private async attachFollowState(requesterId: string, users: { id: string; fullName: string; username?: string | null }[], targetId: string): Promise<Record<string, any>[]> {
    const oraId = await this.getOraCreatorId();
    const mine = await SocialFollowModel.find({ follower: requesterId }).select('followee').lean();
    const followed = new Set(mine.map(f => f.followee.toString()));
    const selfId = targetId === requesterId ? requesterId : '';
    return users.map(u => ({
      id: u.id,
      fullName: u.fullName,
      username: u.username || null,
      isOra: u.id === oraId,
      isSelf: u.id === selfId,
      isFollowing: u.id === oraId || followed.has(u.id)
    }));
  }

  async getCreatorCodes(targetId: string, page: number, limit: number): Promise<PagedResult<Record<string, any>>> {
    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.min(100, Math.max(5, limit || 12));
    const target = new mongoose.Types.ObjectId(targetId);
    const filter = { userId: target };
    const [rows, total, boosted, creator] = await Promise.all([
      BookingCodeModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      BookingCodeModel.countDocuments(filter),
      creatorViralityService.isTopCreator(targetId).catch(() => false),
      UserModel.findById(targetId).select('fullName username').lean()
    ]);
    const creatorName = (creator as any)?.fullName || 'BetPool user';
    const creatorUsername = (creator as any)?.username || null;
    const items = rows.map(b => this.toCodePostFromBooking(b, boosted, creatorName, creatorUsername));
    return { items, total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
  }

  private toCodePostFromBooking(booking: Record<string, any>, boosted: boolean, creatorName = 'BetPool user', creatorUsername: string | null = null): Record<string, any> {
    const legs = (booking?.legs || []).map((l: any) => ({
      podId: String(l.podId || ''),
      homeTeam: l.homeTeam,
      awayTeam: l.awayTeam,
      selection: l.selection,
      multiplier: Number(l.multiplier) || 1
    }));
    return {
      kind: 'code',
      id: String(booking._id),
      codeId: String(booking._id),
      code: booking.code,
      creatorId: String(booking.userId),
      creatorName,
      creatorUsername,
      boosted,
      createdAt: booking.createdAt ? new Date(booking.createdAt).getTime() : Date.now(),
      expiresAt: booking.expiresAt ? new Date(booking.expiresAt).toISOString() : null,
      combinedMultiplier: legs.reduce((acc, l) => acc * l.multiplier, 1),
      legCount: legs.length,
      legs: legs.slice(0, 3),
      totalLegs: legs.length,
      stakeAmount: null
    };
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
    const ids = podIds.map(id => new mongoose.Types.ObjectId(id));
    const [rawPods, rawCodes] = await Promise.all([
      PodModel.find({
        _id: { $in: ids },
        status: 'active',
        stakingClosesAt: { $gte: now }
      })
        .select('-legs -marketOdds')
        .populate('createdBy', 'fullName')
        .lean(),
      BookingCodeModel.find({ _id: { $in: ids } }).sort({ createdAt: -1 }).lean()
    ]);
    const creatorIds = [...new Set(rawCodes.map((b: any) => String(b.userId)).filter(Boolean))];
    const creators = creatorIds.length > 0
      ? await UserModel.find({ _id: { $in: creatorIds } }).select('fullName username').lean()
      : [];
    const creatorRows = new Map(creators.map(c => [String(c._id), c]));
    const byId = new Map(this.mapFeedPods(rawPods as any[]).map(p => [String(p._id), { ...p, kind: 'pod' }]));
    const byCodeId = new Map(rawCodes.map((b: any) => {
      const creator = creatorRows.get(String(b.userId)) as any;
      return [
        String(b._id),
        this.toCodePostFromBooking(b, false, creator?.fullName || 'BetPool user', creator?.username || null)
      ];
    }));
    const pods = podIds
      .map(id => byId.get(id))
      .filter(Boolean)
      .sort((a: any, b: any) => new Date(a.stakingClosesAt).getTime() - new Date(b.stakingClosesAt).getTime());
    const codes = podIds.map(id => byCodeId.get(id)).filter(Boolean);
    return { items: [...pods, ...codes], total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
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
        .populate('user', 'fullName username')
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
    const actorFilter = {
      actor: { $in: followedIds.map(id => new mongoose.Types.ObjectId(id)) },
      type: 'booking_code_shared' as const
    };
    const [activities, total] = await Promise.all([
      SocialActivityModel.find(actorFilter)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .populate('actor', 'fullName username')
        .lean() as Promise<Record<string, any>[]>,
      SocialActivityModel.countDocuments(actorFilter)
    ]);
    const items = await Promise.all(activities.map(a => this.toCodePost(a)));
    items.sort((a, b) => (b.boosted ? 1 : 0) - (a.boosted ? 1 : 0) || b.createdAt - a.createdAt);
    return { items, total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
  }

  private async toCodePost(activity: Record<string, any>): Promise<Record<string, any>> {
    const payload = activity?.payload || {};
    const code = String(payload.code || '');
    const creator = (activity?.actor as any) || {};
    const creatorId = String(creator?._id || payload.creatorId || '');
    let view: any = null;
    if (code) {
      try {
        view = await bookingCodeService.view(code);
      } catch {
        view = null;
      }
    }
    const boosted = await creatorViralityService.isTopCreator(creatorId).catch(() => false);
    return {
      kind: 'code',
      id: String(activity?._id || ''),
      codeId: String(view?.codeId || payload.codeId || ''),
      code,
      creatorId,
      creatorName: creator?.fullName || payload.creatorName || 'BetPool user',
      creatorUsername: creator?.username || null,
      boosted,
      createdAt: activity?.createdAt ? new Date(activity.createdAt).getTime() : Date.now(),
      expiresAt: view?.expiresAt || payload.expiresAt || null,
      combinedMultiplier: (view?.combinedMultiplier ?? Number(payload.combinedMultiplier)) || 1,
      legCount: (view?.legCount ?? Number(payload.legCount)) || 0,
      legs: (view?.legs || payload.legs || []).slice(0, 3).map((l: any) => ({
        podId: String(l.podId || ''),
        homeTeam: l.homeTeam,
        awayTeam: l.awayTeam,
        selection: l.selection,
        multiplier: l.multiplier
      })),
      totalLegs: (view?.legCount ?? Number(payload.legCount)) || 0,
      stakeAmount: payload.stakeAmount ? Number(payload.stakeAmount) : null
    };
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
        .populate('actor', 'fullName username')
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

  async notifyFollowersOfCode(creatorId: string, code: string, legCount: number, combinedMultiplier: number): Promise<number> {
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
          `${name} shared a booking code`,
          `Code ${code} — ${legCount} legs at ${combinedMultiplier.toFixed(2)}x. Enter it to stake.`,
          { code, creatorId }
        )
      ));
      return unique.length;
    } catch (err) {
      return 0;
    }
  }
}

export const socialService = new SocialService();
