import mongoose from 'mongoose';
import { PodModel, IPod } from '../../models/pod.model';
import { StakeModel, IStake } from '../../models/stake.model';
import { cacheService } from '../../services/cache.service';
import { logger } from '../../services/logger.service';

export interface CreatePodData {
  title: string;
  description?: string;
  sport: string;
  league?: string;
  homeTeam: string;
  awayTeam: string;
  matchDate: Date;
  marketType: string;
  selection: string;
  gainsMultiplier: number;
  minStake?: number;
  maxStake?: number;
  maxPayout?: number;
  maxTotalExposure?: number;
  opensAt: Date;
  stakingClosesAt: Date;
  settlementEstimateLabel?: string;
  settlementEstimateAt?: Date;
  isLive?: boolean;
  tags?: string[];
  metadata?: Record<string, any>;
  legs?: Array<{ homeTeam: string; awayTeam: string; matchDate: Date; league?: string }>;
  createdBy: mongoose.Types.ObjectId;
}

export interface UpdatePodData {
  title?: string;
  description?: string;
  gainsMultiplier?: number;
  minStake?: number;
  maxStake?: number;
  maxPayout?: number;
  maxTotalExposure?: number;
  status?: IPod['status'];
  opensAt?: Date;
  stakingClosesAt?: Date;
  settlementEstimateLabel?: string;
  settlementEstimateAt?: Date;
  isLive?: boolean;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface PodQueryOptions {
  status?: IPod['status'];
  sport?: string;
  league?: string;
  isLive?: boolean;
  opensAfter?: Date;
  closesBefore?: Date;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export class PodService {
  async create(data: CreatePodData): Promise<IPod> {
    const impliedProbability = 1 / data.gainsMultiplier;

    const pod = await PodModel.create({
      ...data,
      impliedProbability,
      currentExposure: 0,
      settlementEstimateLabel: data.settlementEstimateLabel || 'Pending'
    });

    return pod;
  }

  async getById(id: string): Promise<IPod | null> {
    return PodModel.findById(id)
      .populate('createdBy', 'fullName')
      .select('-legs -marketOdds');
  }

  async getActiveFeed(options: {
    sport?: string;
    isLive?: boolean;
    limit?: number;
    offset?: number;
    cursor?: Date;
  } = {}): Promise<{ pods: IPod[]; total: number }> {
    const offset = options.offset ?? 0;
    const cacheKey = `feed:${options.sport || 'all'}:${options.isLive !== undefined ? options.isLive : 'all'}`;
    if (!options.cursor && offset === 0) {
      const cached = cacheService.get<IPod[]>(cacheKey);
      logger.debug('getActiveFeed cache lookup', { cacheKey, cached: !!cached });
      if (cached) return { pods: cached, total: cached.length };
    }

    const now = new Date();
    const query: Record<string, any> = {
      status: 'active',
      stakingClosesAt: { $gte: now },
      $expr: { $lt: ['$currentExposure', '$maxTotalExposure'] }
    };

    if (options.sport) query.sport = options.sport;
    if (options.isLive !== undefined) query.isLive = options.isLive;
    if (options.cursor) query.opensAt = { $lt: options.cursor };

    const [pods, total] = await Promise.all([
      PodModel.find(query)
        .sort({ isLive: -1, displayOrder: 1, opensAt: 1 })
        .skip(offset)
        .limit(options.limit || 20)
        .select('-legs -marketOdds')
        .lean() as unknown as Promise<IPod[]>,
      PodModel.countDocuments(query)
    ]);

    const result = await pods;

    if (!options.cursor && offset === 0) {
      logger.debug('getActiveFeed setting cache', { cacheKey });
      cacheService.set(cacheKey, result, 60_000);
    }

    return { pods: result, total };
  }

  async getUpcoming(options: {
    sport?: string;
    limit?: number;
    hoursAhead?: number;
  } = {}): Promise<IPod[]> {
    const cacheKey = `upcoming:${options.sport || 'all'}:${options.hoursAhead || 24}`;
    const cached = cacheService.get<IPod[]>(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const endTime = new Date(now.getTime() + (options.hoursAhead || 24) * 60 * 60 * 1000);

    const query: Record<string, any> = {
      status: { $in: ['published', 'active'] },
      opensAt: { $gt: now, $lte: endTime }
    };

    if (options.sport) query.sport = options.sport;

    const pods = await PodModel.find(query)
      .sort({ opensAt: 1 })
      .limit(options.limit || 20)
      .select('-legs -marketOdds')
      .lean() as unknown as Promise<IPod[]>;

    cacheService.set(cacheKey, pods, 60_000);

    return pods;
  }

  async getBySport(sport: string, options: { status?: string; limit?: number } = {}): Promise<IPod[]> {
    const query: Record<string, any> = { sport };
    if (options.status) query.status = options.status;

    return PodModel.find(query)
      .sort({ opensAt: 1 })
      .limit(options.limit || 50)
      .select('-legs -marketOdds')
      .lean() as unknown as Promise<IPod[]>;
  }

  async getUserActiveStakes(userId: string): Promise<IStake[]> {
    return StakeModel.find({
      user: userId,
      status: { $in: ['pending', 'confirmed'] }
    })
      .populate({ path: 'pod', select: '-legs -marketOdds' })
      .sort({ createdAt: -1 })
      .lean() as unknown as Promise<IStake[]>;
  }

  async getUserStakeHistory(
    userId: string,
    options: { page?: number; limit?: number; status?: string } = {}
  ): Promise<{ stakes: IStake[]; total: number }> {
    const query: Record<string, any> = { user: userId };
    if (options.status) query.status = options.status;

    const [stakes, total] = await Promise.all([
      StakeModel.find(query)
        .populate({ path: 'pod', select: '-legs -marketOdds' })
        .sort({ createdAt: -1 })
        .skip(((options.page || 1) - 1) * (options.limit || 20))
        .limit(options.limit || 20)
        .lean() as unknown as Promise<IStake[]>,
      StakeModel.countDocuments(query)
    ]);

    return { stakes, total };
  }

  async update(id: string, data: UpdatePodData, updatedBy: mongoose.Types.ObjectId): Promise<IPod | null> {
    return PodModel.findByIdAndUpdate(
      id,
      { ...data, updatedBy },
      { new: true, runValidators: true }
    );
  }

  async publish(id: string): Promise<IPod | null> {
    const pod = await PodModel.findByIdAndUpdate(
      id,
      { status: 'published', opensAt: new Date() },
      { new: true }
    );
    cacheService.clear('feed:');
    return pod;
  }

  async activate(id: string): Promise<IPod | null> {
    const pod = await PodModel.findByIdAndUpdate(
      id,
      { status: 'active', opensAt: new Date() },
      { new: true }
    );
    cacheService.clear('feed:');
    return pod;
  }

  async settle(
    id: string,
    result: 'win' | 'loss' | 'void',
    settledBy: mongoose.Types.ObjectId,
    notes?: string
  ): Promise<IPod | null> {
    return PodModel.findByIdAndUpdate(
      id,
      {
        status: 'settled',
        result,
        settledAt: new Date(),
        settledBy,
        resultNotes: notes
      },
      { new: true }
    );
  }

  async cancel(id: string): Promise<IPod | null> {
    return PodModel.findByIdAndUpdate(
      id,
      { status: 'cancelled' },
      { new: true }
    );
  }

  async addExposure(podId: string, stakeAmount: number): Promise<IPod | null> {
    return PodModel.findByIdAndUpdate(
      podId,
      { $inc: { currentExposure: stakeAmount } },
      { new: true }
    );
  }

  async removeExposure(podId: string, stakeAmount: number): Promise<IPod | null> {
    return PodModel.findByIdAndUpdate(
      podId,
      { $inc: { currentExposure: -stakeAmount } },
      { new: true }
    );
  }

  async canPlaceStake(podId: string, stakeAmount: number): Promise<{ allowed: boolean; reason?: string }> {
    const pod = await PodModel.findById(podId);
    if (!pod) return { allowed: false, reason: 'Pod not found' };

    const now = new Date();
    if (pod.status !== 'active') return { allowed: false, reason: 'Pod not active' };
    if (now < pod.opensAt) return { allowed: false, reason: 'Pod not yet open' };
    if (now > pod.stakingClosesAt) return { allowed: false, reason: 'Staking closed' };
    if (stakeAmount < pod.minStake) return { allowed: false, reason: `Minimum stake: ₦${pod.minStake.toLocaleString()}` };
    if (stakeAmount > pod.maxStake) return { allowed: false, reason: `Maximum stake: ₦${pod.maxStake.toLocaleString()}` };
    if (pod.currentExposure + stakeAmount > pod.maxTotalExposure) {
      return { allowed: false, reason: 'Maximum exposure limit reached' };
    }

    return { allowed: true };
  }

  async getGains(podId: string): Promise<{
    gainsMultiplier: number;
    minStake: number;
    maxStake: number;
    maxPayout: number;
  } | null> {
    const pod = await PodModel.findById(podId);
    if (!pod) return null;

    return {
      gainsMultiplier: pod.gainsMultiplier,
      minStake: pod.minStake,
      maxStake: pod.maxStake,
      maxPayout: pod.maxPayout
    };
  }

  async search(query: string, options: { limit?: number } = {}): Promise<IPod[]> {
    const regex = new RegExp(query, 'i');
    return PodModel.find({
      $or: [
        { title: regex },
        { homeTeam: regex },
        { awayTeam: regex },
        { league: regex },
        { sport: regex }
      ],
      status: 'active',
      stakingClosesAt: { $gte: new Date() }
    })
      .limit(options.limit || 10)
      .select('-legs -marketOdds')
      .lean() as unknown as Promise<IPod[]>;
  }

  async getSports(): Promise<string[]> {
    return PodModel.distinct('sport', { status: 'active' });
  }
}

export const podService = new PodService();

