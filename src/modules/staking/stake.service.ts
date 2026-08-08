import mongoose from 'mongoose';
import { StakeModel, IStake } from '../../models/stake.model';
import { PodModel, IPod } from '../../models/pod.model';
import { WalletModel } from '../../models/wallet.model';
import { TransactionModel } from '../../models/transaction.model';
import { walletService } from '../../services/wallet.service';
import { notifyStakePlaced, notifyStakeWon, notifyStakeLost, notifyStakeCashedOut } from '../../services/notification.service';
import { userService } from '../../services/user.service';
import { abtestService } from '../abtest/abtest.service';
import { loyaltyService } from '../loyalty/loyalty.service';
import { coachingService } from '../coaching/coaching.service';

// Type helper to cast Mongoose lean queries
function toLeanArray<T>(): (query: any) => Promise<T[]> {
  return (query: any) => query.lean() as unknown as Promise<T[]>;
}

function toLean<T>(): (query: any) => Promise<T | null> {
  return (query: any) => query.lean() as unknown as Promise<T | null>;
}

export interface PlaceStakeData {
  userId: string;
  podId: string;
  oddsOfferId?: string;
  podIds?: string[];
  stakeAmount: number;
  idempotencyKey?: string;
}

export interface PlaceMultiStakeData {
  userId: string;
  podIds: string[];
  stakeAmount: number;
  idempotencyKey?: string;
}

export interface StakeResult {
  stake: IStake;
  potentialPayout: number;
  netPayout: number;
  platformFee: number;
  refundPercent: number;
  refundAmount: number;
}

export class StakeService {
  private readonly PLATFORM_FEE_PERCENT = 10;

  async placeStake(data: PlaceStakeData): Promise<StakeResult> {
    const podId = data.podId || data.oddsOfferId;
    if (!podId) throw new Error('Pod ID required');

    // Idempotency check
    if (data.idempotencyKey) {
      const existing = await StakeModel.findOne({ 'metadata.idempotencyKey': data.idempotencyKey });
      if (existing) {
        return {
          stake: existing,
          potentialPayout: existing.potentialPayout,
          netPayout: existing.netPayout,
          platformFee: existing.platformFee,
          refundPercent: existing.refundPercent,
          refundAmount: existing.refundAmount
        };
      }
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const pod = await PodModel.findById(podId).session(session);
      if (!pod) {
        throw new Error('Pod not found');
      }

      const now = new Date();
      if (now < pod.opensAt || now > pod.stakingClosesAt) {
        throw new Error('Staking is closed for this pod');
      }
      if (pod.status !== 'active') {
        throw new Error('This pod is not available for staking');
      }

      if (data.stakeAmount < pod.minStake) {
        throw new Error(`Minimum stake is ₦${pod.minStake.toLocaleString()}`);
      }
      if (data.stakeAmount > pod.maxStake) {
        throw new Error(`Maximum stake is ₦${pod.maxStake.toLocaleString()}`);
      }
      if (pod.bookedExternally) {
        throw new Error('This pod is externally booked and not available for staking');
      }

      const potentialPayout = Math.floor(data.stakeAmount * pod.gainsMultiplier);
      if (pod.maxPayout && potentialPayout > pod.maxPayout) {
        throw new Error(`Stake exceeds maximum payout of ₦${pod.maxPayout.toLocaleString()}`);
      }
      const platformFee = Math.floor(potentialPayout * (this.PLATFORM_FEE_PERCENT / 100));
      const netPayout = potentialPayout - platformFee;
      const refundPercent = pod.refundPercent ?? 0;
      const refundAmount = Math.floor(data.stakeAmount * refundPercent / 100);

      // Atomically update pod exposure — prevents race condition
      const updatedPod = await PodModel.findOneAndUpdate(
        {
          _id: podId,
          status: 'active',
          $expr: { $lte: [{ $add: ['$currentExposure', data.stakeAmount] }, '$maxTotalExposure'] }
        },
        { $inc: { currentExposure: data.stakeAmount, currentParticipants: 1 } },
        { new: true, session }
      );
      if (!updatedPod) {
        throw new Error('Maximum exposure limit reached for this pod');
      }

      // Atomically deduct wallet — prevents race condition
      const wallet = await WalletModel.findOneAndUpdate(
        {
          user: data.userId,
          $expr: { $gte: [{ $subtract: ['$balance', '$lockedBalance'] }, data.stakeAmount] }
        },
        {
          $inc: { balance: -data.stakeAmount, totalStaked: data.stakeAmount },
          $set: { lastTransactionAt: new Date() }
        },
        { new: true, session }
      );
      if (!wallet) {
        throw new Error('Insufficient balance');
      }

      const stake = await StakeModel.create([{
        user: data.userId,
        pod: podId,
        stakeAmount: data.stakeAmount,
        potentialPayout,
        netPayout,
        platformFee,
        feePercent: this.PLATFORM_FEE_PERCENT,
        refundPercent,
        refundAmount,
        status: 'confirmed',
        metadata: {
          ...(data.idempotencyKey ? { idempotencyKey: data.idempotencyKey } : {})
        }
      }], { session });

      await TransactionModel.create([{
        user: data.userId,
        wallet: wallet._id,
        type: 'stake',
        status: 'completed',
        amount: data.stakeAmount,
        fee: 0,
        netAmount: data.stakeAmount,
        balanceBefore: wallet.balance + data.stakeAmount,
        balanceAfter: wallet.balance,
        currency: 'NGN',
        reference: `STAKE_${stake[0]._id}`,
        provider: 'internal',
        relatedStake: stake[0]._id,
        relatedPod: podId,
        metadata: { potentialPayout, netPayout, platformFee },
        processedAt: new Date()
      }], { session });

      await session.commitTransaction();

      userService.payReferralBonusOnStake(data.userId).catch(e => console.error('Referral bonus error', e));
      
      loyaltyService.onStakePlaced(data.userId, data.stakeAmount).catch(e => console.error('Loyalty points error', e));

      coachingService.flagIfHighRisk(data.userId).catch(e => console.error('Coaching flag error', e));
      
      await notifyStakePlaced(data.userId, pod.title || 'Pod', data.stakeAmount, potentialPayout).catch(e => console.error(e));
      
      abtestService.recordEvent(data.userId, 'personalization', 'stake_placed', {
        isParlay: false,
        stakeAmount: data.stakeAmount,
        podId,
      });
      
      return {
        stake: stake[0],
        potentialPayout,
        netPayout,
        platformFee,
        refundPercent,
        refundAmount
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  private attachVirtuals(stake: any): any {
    const items = stake.items && stake.items.length > 0 ? stake.items : undefined;
    return {
      ...stake,
      items,
      isParlay: Array.isArray(items) && items.length > 1,
      isSettled: ['won', 'lost', 'void', 'refunded', 'cashed_out'].includes(stake.status),
      isActive: ['pending', 'confirmed'].includes(stake.status),
      profit: stake.status === 'won'
        ? (stake.netPayout || 0) - (stake.stakeAmount || 0)
        : stake.status === 'lost'
          ? (stake.refundAmount || 0) - (stake.stakeAmount || 0)
          : 0
    };
  }

  private async attachLegScores(stakes: any[]): Promise<any[]> {
    const podIds = new Set<string>();
    for (const s of stakes) {
      if (s.isParlay && Array.isArray(s.items) && s.items.length) {
        for (const item of s.items) {
          if (item?.pod) podIds.add(item.pod.toString());
        }
      }
    }
    if (podIds.size > 0) {
      const pods = await PodModel.find({ _id: { $in: [...podIds] } })
        .select('_id homeScore awayScore')
        .lean();
      const scoreMap = new Map(pods.map(p => [p._id.toString(), p]));
      for (const s of stakes) {
        if (!s.isParlay || !Array.isArray(s.items)) continue;
        for (const item of s.items) {
          const pod = item?.pod ? scoreMap.get(item.pod.toString()) : undefined;
          if (pod) {
            item.homeScore = pod.homeScore ?? null;
            item.awayScore = pod.awayScore ?? null;
          }
        }
      }
    }
    return stakes;
  }

  async getUserStakes(
    userId: string,
    options: {
      status?: IStake['status'] | 'settled' | 'all';
      page?: number;
      limit?: number;
      search?: string;
      sortField?: string;
      sortOrder?: 'asc' | 'desc';
      from?: string;
      to?: string;
    } = {}
  ): Promise<{ stakes: IStake[]; total: number; page: number; limit: number; totalPages: number }> {
    const query: Record<string, any> = { user: userId };
    if (options.status === 'settled') {
      query.status = { $nin: ['pending', 'confirmed'] };
    } else if (options.status && options.status !== 'all') {
      query.status = options.status;
    }

    if (options.search && options.search.trim()) {
      const term = options.search.trim().slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { 'items.homeTeam': { $regex: term, $options: 'i' } },
        { 'items.awayTeam': { $regex: term, $options: 'i' } },
        { 'items.selection': { $regex: term, $options: 'i' } }
      ];
    }

    if (options.from || options.to) {
      const range: Record<string, Date> = {};
      if (options.from) {
        const from = new Date(options.from);
        if (!isNaN(from.getTime())) range.$gte = from;
      }
      if (options.to) {
        const to = new Date(options.to);
        if (!isNaN(to.getTime())) range.$lte = new Date(to.getTime() + 86399999);
      }
      if (Object.keys(range).length > 0) query.createdAt = range;
    }

    const page = Math.max(1, Math.floor(options.page || 1));
    const limit = Math.min(Math.max(1, Math.floor(options.limit || 20)), 100);
    const SORT_FIELDS: Record<string, string> = {
      createdAt: 'createdAt',
      stakeAmount: 'stakeAmount',
      payout: 'potentialPayout',
      status: 'status'
    };
    const sortField = SORT_FIELDS[options.sortField || 'createdAt'] || 'createdAt';
    const sortOrder: 1 | -1 = options.sortOrder === 'asc' ? 1 : -1;

    const [docs, total] = await Promise.all([
      StakeModel.find(query)
        .populate('pod')
        .sort({ [sortField]: sortOrder })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      StakeModel.countDocuments(query)
    ]);

    const stakes = (docs as any[]).map(s => this.attachVirtuals(s));
    return {
      stakes: await this.attachLegScores(stakes),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /**
   * Settled-bet win/loss summary: lifetime outcome counts plus a zero-filled
   * daily series (last 14 days, UTC) grouped by settledAt. Voided and
   * cancelled bets are excluded from the daily bars but shown in overall counts.
   */
  async getUserBetSummary(userId: string): Promise<{
    overall: { played: number; won: number; lost: number; void: number; cashedOut: number; winRate: number } | null;
    daily: Array<{ date: string; won: number; lost: number; played: number }>;
  }> {
    const userIdMatch = new mongoose.Types.ObjectId(userId);
    const start = new Date(Date.now() - 13 * 86400000);
    start.setUTCHours(0, 0, 0, 0);

    const [dailyRows, overallRows] = await Promise.all([
      StakeModel.aggregate([
        { $match: { user: userIdMatch, status: { $in: ['won', 'lost', 'void'] }, settledAt: { $gte: start } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$settledAt', timezone: 'UTC' } },
            won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
            lost: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] } },
          },
        },
      ]),
      StakeModel.aggregate([
        { $match: { user: userIdMatch, status: { $in: ['won', 'lost', 'void', 'refunded', 'cashed_out', 'cancelled'] } } },
        {
          $group: {
            _id: null,
            won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
            lost: { $sum: { $cond: [{ $in: ['$status', ['lost', 'refunded']] }, 1, 0] } },
            void: { $sum: { $cond: [{ $in: ['$status', ['void', 'cancelled']] }, 1, 0] } },
            cashedOut: { $sum: { $cond: [{ $eq: ['$status', 'cashed_out'] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const dayMap = new Map<string, { won: number; lost: number }>(
      dailyRows.map(r => [r._id, { won: r.won || 0, lost: r.lost || 0 }]),
    );
    const daily: Array<{ date: string; won: number; lost: number; played: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const row = dayMap.get(date);
      const won = row?.won ?? 0;
      const lost = row?.lost ?? 0;
      daily.push({ date, won, lost, played: won + lost });
    }

    const o = overallRows[0];
    const won = o?.won ?? 0;
    const lost = o?.lost ?? 0;
    const voided = o?.void ?? 0;
    const cashedOut = o?.cashedOut ?? 0;
    const overall = won + lost + voided + cashedOut > 0
      ? {
          played: won + lost + voided + cashedOut,
          won,
          lost,
          void: voided,
          cashedOut,
          winRate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0,
        }
      : null;

    return { overall, daily };
  }

  async getActiveStakes(userId: string): Promise<IStake[]> {
    const docs = await StakeModel.find({ 
      user: userId, 
      status: { $in: ['pending', 'confirmed'] } 
    })
      .populate('pod')
      .sort({ createdAt: -1 })
      .lean();
    return this.attachLegScores((docs as any[]).map(s => this.attachVirtuals(s)));
  }

  async getStakeById(stakeId: string, userId?: string): Promise<IStake | null> {
    const query: Record<string, any> = { _id: stakeId };
    if (userId) query.user = userId;
    const doc = await StakeModel.findOne(query).populate('pod').lean();
    const attached = doc ? this.attachVirtuals(doc) : null;
    return attached ? (await this.attachLegScores([attached]))[0] : null;
  }

  async placeAccumulator(data: PlaceMultiStakeData): Promise<StakeResult> {
    const { userId, podIds, stakeAmount, idempotencyKey } = data;

    if (podIds.length < 2 || podIds.length > 5) {
      throw new Error('Accumulator requires 2 to 5 selections');
    }

    if (data.idempotencyKey) {
      const existing = await StakeModel.findOne({ 'metadata.idempotencyKey': data.idempotencyKey });
      if (existing) {
        return {
          stake: existing,
          potentialPayout: existing.potentialPayout,
          netPayout: existing.netPayout,
          platformFee: existing.platformFee,
          refundPercent: 0,
          refundAmount: 0
        };
      }
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const pods = await PodModel.find({ _id: { $in: podIds } }).session(session);
      if (pods.length !== podIds.length) {
        throw new Error('One or more pods not found');
      }

      const now = new Date();
      const matchKeys = new Set<string>();

      for (const pod of pods) {
        if (now < pod.opensAt || now > pod.stakingClosesAt) {
          throw new Error(`Staking is closed for "${pod.title}"`);
        }
        if (pod.status !== 'active') {
          throw new Error(`"${pod.title}" is not available for staking`);
        }
        if (pod.gainsMultiplier < 1.10) {
          throw new Error(`"${pod.title}" must have minimum odds of 1.10x`);
        }

        const key = `${pod.homeTeam}|${pod.awayTeam}|${pod.matchDate}`;
        if (matchKeys.has(key)) {
          throw new Error('Cannot combine multiple selections from the same match');
        }
        matchKeys.add(key);

        if (stakeAmount < pod.minStake) {
          throw new Error(`Minimum stake is ₦${pod.minStake.toLocaleString()} for "${pod.title}"`);
        }
        if (stakeAmount > pod.maxStake) {
          throw new Error(`Maximum stake is ₦${pod.maxStake.toLocaleString()} for "${pod.title}"`);
        }
        if (pod.bookedExternally) {
          throw new Error(`"${pod.title}" is externally booked and not available for staking`);
        }
      }

      const combinedMultiplier = pods.reduce((acc, p) => acc * p.gainsMultiplier, 1);
      if (combinedMultiplier > 50) {
        throw new Error('Combined odds exceed maximum of 50x');
      }

      const minAccumulatorStake = 100;
      if (stakeAmount < minAccumulatorStake) {
        throw new Error(`Minimum accumulator stake is ₦${minAccumulatorStake.toLocaleString()}`);
      }

      const maxAccumulatorStake = 5000;
      const effectiveMaxStake = Math.min(maxAccumulatorStake, ...pods.map(p => p.maxStake));
      if (stakeAmount > effectiveMaxStake) {
        throw new Error(`Maximum accumulator stake is ₦${effectiveMaxStake.toLocaleString()}`);
      }

      const potentialPayout = Math.floor(stakeAmount * combinedMultiplier);
      const platformFee = Math.floor(potentialPayout * (this.PLATFORM_FEE_PERCENT / 100));
      const netPayout = potentialPayout - platformFee;

      // Atomically update each pod's exposure
      for (const pod of pods) {
        const updatedPod = await PodModel.findOneAndUpdate(
          {
            _id: pod._id,
            status: 'active',
            $expr: { $lte: [{ $add: ['$currentExposure', stakeAmount] }, '$maxTotalExposure'] }
          },
          { $inc: { currentExposure: stakeAmount, currentParticipants: 1 } },
          { new: true, session }
        );
        if (!updatedPod) {
          throw new Error(`Maximum exposure limit reached for "${pod.title}"`);
        }
      }

      // Atomically deduct wallet
      const wallet = await WalletModel.findOneAndUpdate(
        {
          user: userId,
          $expr: { $gte: [{ $subtract: ['$balance', '$lockedBalance'] }, stakeAmount] }
        },
        {
          $inc: { balance: -stakeAmount, totalStaked: stakeAmount },
          $set: { lastTransactionAt: new Date() }
        },
        { new: true, session }
      );
      if (!wallet) {
        throw new Error('Insufficient balance');
      }

      const items = pods.map(p => ({
        pod: p._id,
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        league: p.league,
        selection: p.selection,
        gainsMultiplier: p.gainsMultiplier,
        matchDate: p.matchDate,
        status: 'pending' as const
      }));

      const stake = await StakeModel.create([{
        user: userId,
        pod: pods[0]._id, // first pod for backward compat
        items,
        combinedMultiplier,
        stakeAmount,
        potentialPayout,
        netPayout,
        platformFee,
        feePercent: this.PLATFORM_FEE_PERCENT,
        refundPercent: 0,
        refundAmount: 0,
        status: 'confirmed',
        metadata: {
          ...(idempotencyKey ? { idempotencyKey } : {}),
          isParlay: true,
          podIds: podIds.map(id => id.toString())
        }
      }], { session });

      await TransactionModel.create([{
        user: userId,
        wallet: wallet._id,
        type: 'stake',
        status: 'completed',
        amount: stakeAmount,
        fee: 0,
        netAmount: stakeAmount,
        balanceBefore: wallet.balance + stakeAmount,
        balanceAfter: wallet.balance,
        currency: 'NGN',
        reference: `ACCUM_${stake[0]._id}`,
        provider: 'internal',
        relatedStake: stake[0]._id,
        relatedPods: podIds,
        metadata: { potentialPayout, netPayout, platformFee, isParlay: true, combinedMultiplier, legCount: podIds.length },
        processedAt: new Date()
      }], { session });

      await session.commitTransaction();

      const podTitle = `${pods[0].homeTeam} vs ${pods[0].awayTeam} +${podIds.length - 1}`;
      await notifyStakePlaced(userId, `${podTitle} (${podIds.length}-leg parlay)`, stakeAmount, potentialPayout).catch(e => console.error(e));

      abtestService.recordEvent(userId, 'personalization', 'stake_placed', {
        isParlay: true,
        legCount: podIds.length,
        stakeAmount,
        combinedMultiplier,
      });
      
      return {
        stake: stake[0],
        potentialPayout,
        netPayout,
        platformFee,
        refundPercent: 0,
        refundAmount: 0
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async settleStake(
    stakeId: string,
    result: 'win' | 'lost' | 'void',
    settledBy: string,
    notes?: string,
    existingSession?: mongoose.ClientSession
  ): Promise<IStake | null> {
    const ownsSession = !existingSession;
    const session = existingSession || await mongoose.startSession();

    if (ownsSession) {
      session.startTransaction();
    }

    try {
      const stake = await StakeModel.findById(stakeId).session(session);
      if (!stake) throw new Error('Stake not found');
      if (stake.isSettled) throw new Error('Stake already settled');

      // Handle parlay settlement — settle all items
      if (stake.isParlay && stake.items) {
        const allSettled = stake.items.every(item => item.status !== 'pending');
        if (allSettled) throw new Error('Parlay already fully settled');

        // Settle all items based on the result
        for (const item of stake.items) {
          item.status = result === 'win' ? 'won' : result === 'void' ? 'void' : 'lost';
          item.settledAt = new Date();
        }

        let payoutAmount = 0;
        let newStatus: IStake['status'];
        let txType = 'refund';
        const incFields: Record<string, number> = {};

        if (result === 'win') {
          payoutAmount = stake.netPayout;
          incFields.balance = payoutAmount;
          incFields.totalWon = payoutAmount;
          newStatus = 'won';
          txType = 'payout';
        } else if (result === 'void') {
          payoutAmount = stake.stakeAmount;
          incFields.balance = payoutAmount;
          newStatus = 'void';
          txType = 'refund';
        } else {
          payoutAmount = 0;
          newStatus = 'lost';
          txType = 'refund';
        }

        const wallet = await WalletModel.findOneAndUpdate(
          { user: stake.user },
          { $inc: incFields, $set: { lastTransactionAt: new Date() } },
          { session, new: true }
        );
        if (!wallet) throw new Error('Wallet not found');

        if (payoutAmount > 0) {
          await TransactionModel.create([{
            user: stake.user,
            wallet: wallet._id,
            type: txType,
            status: 'completed',
            amount: payoutAmount,
            fee: result === 'win' ? stake.platformFee : 0,
            netAmount: payoutAmount,
            balanceBefore: wallet.balance - payoutAmount,
            balanceAfter: wallet.balance,
            currency: 'NGN',
            reference: `P${result.toUpperCase()}_${stake._id}`,
            provider: 'internal',
            relatedStake: stake._id,
            relatedPod: stake.pod,
            metadata: { description: result === 'win' ? 'Parlay won' : result === 'void' ? 'Parlay voided' : 'Parlay lost - no refund', isParlay: true, legCount: stake.items.length },
            processedAt: new Date()
          }], { session });
        }

        stake.status = newStatus;
        stake.settledAt = new Date();
        stake.settledBy = new mongoose.Types.ObjectId(settledBy);
        stake.settlementNotes = notes || `Parlay ${result}`;
        stake.settledOdds = stake.combinedMultiplier;
        await stake.save({ session });

        // Decrement exposure on all pods in the parlay
        for (const item of stake.items) {
          await PodModel.findByIdAndUpdate(item.pod, { $inc: { currentExposure: -stake.stakeAmount, currentParticipants: -1 } }).session(session);
        }

        if (ownsSession) {
          await session.commitTransaction();
        }

        if (ownsSession) {
          const title = `${stake.items[0]?.homeTeam} vs ${stake.items[0]?.awayTeam} +${stake.items.length - 1}`;
          if (result === 'win') {
            await notifyStakeWon(stake.user.toString(), `${title} (parlay)`, payoutAmount).catch(e => console.error(e));
          } else if (result === 'lost') {
            await notifyStakeLost(stake.user.toString(), `${title} (parlay)`, stake.stakeAmount).catch(e => console.error(e));
          }
        }

        return stake;
      }

      // Single-pod stake settlement (existing logic)
      const pod = await PodModel.findById(stake.pod).session(session);
      if (!pod) throw new Error('Pod not found');

      let payoutAmount = 0;
      let newStatus: IStake['status'];
      let description = '';
      const incFields: Record<string, number> = {};

      if (result === 'win') {
        payoutAmount = stake.netPayout;
        incFields.balance = payoutAmount;
        incFields.totalWon = payoutAmount;
        newStatus = 'won';
        description = 'Stake won';
      } else if (result === 'void') {
        payoutAmount = stake.stakeAmount;
        incFields.balance = payoutAmount;
        newStatus = 'void';
        description = 'Stake voided - stake refunded';
      } else {
        payoutAmount = stake.refundAmount ?? 0;
        incFields.balance = payoutAmount;
        newStatus = 'lost';
        description = `Stake lost - ${stake.refundPercent}% refund (₦${payoutAmount.toLocaleString()})`;
      }

      const wallet = await WalletModel.findOneAndUpdate(
        { user: stake.user },
        { $inc: incFields, $set: { lastTransactionAt: new Date() } },
        { session, new: true }
      );
      if (!wallet) throw new Error('Wallet not found');

      if (payoutAmount > 0) {
        await TransactionModel.create([{
          user: stake.user,
          wallet: wallet._id,
          type: result === 'win' ? 'payout' : 'refund',
          status: 'completed',
          amount: payoutAmount,
          fee: result === 'win' ? stake.platformFee : 0,
          netAmount: payoutAmount,
          balanceBefore: wallet.balance - payoutAmount,
          balanceAfter: wallet.balance,
          currency: 'NGN',
          reference: `${result.toUpperCase()}_${stake._id}`,
          provider: 'internal',
          relatedStake: stake._id,
          relatedPod: stake.pod,
          metadata: { description, originalStake: stake.stakeAmount, refundPercent: stake.refundPercent, refundAmount: payoutAmount },
          processedAt: new Date()
        }], { session });
      }

      stake.status = newStatus;
      stake.settledAt = new Date();
      stake.settledBy = new mongoose.Types.ObjectId(settledBy);
      stake.settlementNotes = notes;
      stake.settledOdds = pod.gainsMultiplier;
      await stake.save({ session });

      // Decrement pod exposure now that stake is settled
      await PodModel.findByIdAndUpdate(stake.pod, { $inc: { currentExposure: -stake.stakeAmount, currentParticipants: -1 } }).session(session);

      if (ownsSession) {
        await session.commitTransaction();
      }

      if (ownsSession) {
        const notifPod = await PodModel.findById(stake.pod).select('title');
        if (result === 'win') {
          await notifyStakeWon(stake.user.toString(), notifPod?.title || 'Pod', payoutAmount).catch(e => console.error(e));
        } else if (result === 'lost') {
          await notifyStakeLost(stake.user.toString(), notifPod?.title || 'Pod', stake.stakeAmount - payoutAmount).catch(e => console.error(e));
        }
      }

      if (result === 'lost') {
        loyaltyService.maybeCreditCashback(stake).catch(e => console.error('Cashback credit error', e));
      }

      return stake;
    } catch (error) {
      if (ownsSession) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      if (ownsSession) {
        session.endSession();
      }
    }
  }

  async voidStake(stakeId: string, settledBy: string): Promise<IStake | null> {
    return this.settleStake(stakeId, 'void', settledBy, 'Voided by admin');
  }

  async getStakesByPod(podId: string, status?: IStake['status']): Promise<IStake[]> {
    const query: Record<string, any> = {
      $or: [{ pod: podId }, { 'items.pod': new mongoose.Types.ObjectId(podId) }]
    };
    if (status) query.status = status;
    return StakeModel.find(query).populate('user', 'phone fullName').lean() as unknown as Promise<IStake[]>;
  }

  async getExposureSummary(podId: string): Promise<{
    totalStakes: number;
    totalExposure: number;
    participantCount: number;
    byStatus: Record<string, { count: number; amount: number }>;
  }> {
    const [stats] = await StakeModel.aggregate([
      { $match: { pod: new mongoose.Types.ObjectId(podId) } },
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$stakeAmount' }, exposure: { $sum: '$potentialPayout' } } },
      { $group: { _id: null, totalStakes: { $sum: '$amount' }, totalExposure: { $sum: '$exposure' }, participantCount: { $sum: '$count' }, byStatus: { $push: { k: '$_id', v: { count: '$count', amount: '$amount' } } } } },
      { $replaceRoot: { newRoot: { $mergeObjects: [{ totalStakes: '$$ROOT.totalStakes', totalExposure: '$$ROOT.totalExposure', participantCount: '$$ROOT.participantCount' }, { byStatus: { $arrayToObject: '$byStatus' } }] } } }
    ]);
    return stats || { totalStakes: 0, totalExposure: 0, participantCount: 0, byStatus: {} };
  }

  async calculatePotentialPayout(podId: string, stakeAmount: number): Promise<{
    potentialPayout: number;
    platformFee: number;
    netPayout: number;
    refundPercent: number;
    refundAmount: number;
    maxLoss: number;
    minStake: number;
    maxStake: number;
  } | null> {
    const pod = await PodModel.findById(podId);
    if (!pod) return null;

    const potentialPayout = Math.floor(stakeAmount * pod.gainsMultiplier);
    const platformFee = Math.floor(potentialPayout * (this.PLATFORM_FEE_PERCENT / 100));
    const netPayout = potentialPayout - platformFee;
    const refundPercent = pod.refundPercent ?? 0;
    const refundAmount = Math.floor(stakeAmount * refundPercent / 100);
    const maxLoss = stakeAmount - refundAmount;

    return {
      potentialPayout,
      platformFee,
      netPayout,
      refundPercent,
      refundAmount,
      maxLoss,
      minStake: pod.minStake,
      maxStake: pod.maxStake
    };
  }

  // Cashout methods
  async getCashoutQuote(stakeId: string, userId: string): Promise<{
    cashoutAmount: number;
    fee: number;
    stakeAmount: number;
    potentialPayout: number;
  } | null> {
    const stake = await StakeModel.findOne({ _id: stakeId, user: userId });
    if (!stake) return null;
    if (stake.isSettled) throw new Error('Stake already settled');
    if (stake.cashoutRequested) throw new Error('Cashout already requested');

    const CASHOUT_FEE_PERCENT = 10;
    const cashoutAmount = Math.floor(stake.stakeAmount * (1 - CASHOUT_FEE_PERCENT / 100));
    const fee = stake.stakeAmount - cashoutAmount;

    return {
      cashoutAmount,
      fee,
      stakeAmount: stake.stakeAmount,
      potentialPayout: stake.potentialPayout
    };
  }

  async confirmCashout(stakeId: string, userId: string): Promise<IStake | null> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const stake = await StakeModel.findOne({ _id: stakeId, user: userId }).session(session);
      if (!stake) throw new Error('Stake not found');
      if (stake.isSettled) throw new Error('Stake already settled');
      if (stake.cashoutRequested) throw new Error('Cashout already requested');

      const CASHOUT_FEE_PERCENT = 10;
      const cashoutAmount = Math.floor(stake.stakeAmount * (1 - CASHOUT_FEE_PERCENT / 100));
      const fee = stake.stakeAmount - cashoutAmount;

      const wallet = await WalletModel.findOneAndUpdate(
        { user: userId },
        { $inc: { balance: cashoutAmount }, $set: { lastTransactionAt: new Date() } },
        { session, new: true }
      );
      if (!wallet) throw new Error('Wallet not found');

      stake.status = 'cashed_out';
      stake.cashoutRequested = true;
      stake.cashoutAmount = cashoutAmount;
      stake.cashoutAt = new Date();
      stake.settledAt = new Date();
      stake.settlementNotes = `Cashout: ₦${cashoutAmount.toLocaleString()} (fee: ₦${fee.toLocaleString()})`;
      await stake.save({ session });

      await TransactionModel.create([{
        user: userId,
        wallet: wallet._id,
        type: 'refund',
        status: 'completed',
        amount: cashoutAmount,
        fee,
        netAmount: cashoutAmount,
        balanceBefore: wallet.balance - cashoutAmount,
        balanceAfter: wallet.balance,
        currency: 'NGN',
        reference: `CASHOUT_${stake._id}`,
        provider: 'internal',
        completedAt: new Date(),
        metadata: { originalStake: stake.stakeAmount, cashoutAmount, fee, stakeId: stake._id }
      }], { session });

      // Decrement pod exposure inside the transaction
      await PodModel.findByIdAndUpdate(stake.pod, { $inc: { currentExposure: -stake.stakeAmount, currentParticipants: -1 } }).session(session);

      await session.commitTransaction();

      const cashoutPod = await PodModel.findById(stake.pod).select('title');
      await notifyStakeCashedOut(userId, cashoutPod?.title || 'Pod', cashoutAmount).catch(e => console.error(e));

      return stake as any;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}

export const stakeService = new StakeService();
