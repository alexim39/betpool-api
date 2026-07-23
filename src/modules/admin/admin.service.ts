import mongoose from 'mongoose';
import { PodModel, IPod } from '../../models/pod.model';
import { UserModel, IUser } from '../../models/user.model';
import { StakeModel, IStake } from '../../models/stake.model';
import { WalletModel } from '../../models/wallet.model';
import { TransactionModel, ITransaction } from '../../models/transaction.model';
import { LoanModel, ILoan } from './loan.model';
import { SettingsModel } from './settings.model';
import { AppError } from '../../middleware/error.middleware';
import { cacheService } from '../../services/cache.service';
import { notifyWithdrawalCompleted, notifyWithdrawalFailed, notifyKycApproved } from '../../services/notification.service';
import { walletService } from '../../services/wallet.service';

interface PaginationQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  type?: string;
  userId?: string;
  podId?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  dateFrom?: string;
  dateTo?: string;
}

interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface DashboardData {
  totalUsers: number;
  totalPods: number;
  activePods: number;
  totalStakes: number;
  totalVolume: number;
  totalPayouts: number;
  pendingSettlements: number;
  recentStakes: any[];
  podStatusBreakdown: { status: string; count: number }[];
  dailyVolume: { date: string; volume: number; count: number }[];
}

export class AdminService {
  async getDashboard(): Promise<DashboardData> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      totalPods,
      activePods,
      totalStakes,
      volumeResult,
      payoutResult,
      pendingSettlements,
      recentStakes,
      podStatusBreakdown,
      dailyVolume
    ] = await Promise.all([
      UserModel.countDocuments(),
      PodModel.countDocuments(),
      PodModel.countDocuments({ status: 'active' }),
      StakeModel.countDocuments(),
      StakeModel.aggregate([
        { $match: { status: { $in: ['confirmed', 'won', 'lost', 'void'] } } },
        { $group: { _id: null, total: { $sum: '$stakeAmount' } } }
      ]),
      StakeModel.aggregate([
        { $match: { status: 'won' } },
        { $group: { _id: null, total: { $sum: '$netPayout' } } }
      ]),
      PodModel.countDocuments({ status: { $in: ['published', 'active'] } }),
      StakeModel.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('user', 'phone fullName')
        .populate('pod', 'title')
        .lean(),
      PodModel.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $project: { _id: 0, status: '$_id', count: 1 } },
        { $sort: { count: -1 } }
      ]),
      StakeModel.aggregate([
        { $match: { createdAt: { $gte: sevenDaysAgo }, status: 'confirmed' } },
        { $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            volume: { $sum: '$stakeAmount' },
            count: { $sum: 1 }
          }
        },
        { $project: { _id: 0, date: '$_id', volume: 1, count: 1 } },
        { $sort: { date: 1 } }
      ])
    ]);

    const totalVolume = volumeResult[0]?.total || 0;
    const totalPayouts = payoutResult[0]?.total || 0;

    return {
      totalUsers,
      totalPods,
      activePods,
      totalStakes,
      totalVolume,
      totalPayouts,
      pendingSettlements,
      recentStakes,
      podStatusBreakdown,
      dailyVolume
    };
  }

  async listPods(query: PaginationQuery): Promise<PaginatedResult<IPod>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 20), 100);
    const filter: Record<string, any> = {};

    if (query.status) filter.status = query.status;
    if (query.search) {
      const regex = new RegExp(query.search, 'i');
      filter.$or = [
        { title: regex },
        { homeTeam: regex },
        { awayTeam: regex },
        { sport: regex },
        { league: regex }
      ];
    }
    if (query.dateFrom || query.dateTo) {
      filter.matchDate = {};
      if (query.dateFrom) filter.matchDate.$gte = new Date(query.dateFrom);
      if (query.dateTo) {
        const end = new Date(query.dateTo);
        end.setHours(23, 59, 59, 999);
        filter.matchDate.$lte = end;
      }
    }

    const [items, total] = await Promise.all([
      PodModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('createdBy', 'fullName'),
      PodModel.countDocuments(filter)
    ]);

    return { items: items as unknown as IPod[], total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getPod(id: string): Promise<IPod | null> {
    return PodModel.findById(id)
      .populate('createdBy', 'phone fullName')
      .populate('updatedBy', 'phone fullName')
      .populate('settledBy', 'phone fullName');
  }

  async createPod(data: Partial<IPod>, userId: string): Promise<IPod> {
    const impliedProbability = data.gainsMultiplier ? 1 / data.gainsMultiplier : 0;

    const now = new Date();
    data.opensAt = data.opensAt || now;

    // Auto-calculate refundPercent if not provided
    if (data.refundPercent === undefined || data.refundPercent === null) {
      const mult = data.gainsMultiplier || 1;
      data.refundPercent = mult >= 1.9 ? 5 : mult >= 1.7 ? 20 : mult >= 1.5 ? 35 : 0;
    }

    // Safety cap: prevent dangerously high refunds relative to odds
    const mult = data.gainsMultiplier || 1;
    const maxSafeRefund = Math.floor((1 - 1 / mult) * 100);
    if (data.refundPercent > maxSafeRefund) {
      data.refundPercent = maxSafeRefund;
    }

    if (data.status === 'active') {
      data.opensAt = data.opensAt || new Date();
    }

    const pod = await PodModel.create({
      ...data,
      impliedProbability,
      currentExposure: 0,
      currentParticipants: 0,
      createdBy: new mongoose.Types.ObjectId(userId)
    });

    if (data.status === 'active') {
      this.ensureFutureStakingCloses(pod);
      await pod.save();
      cacheService.clear('feed:');
    }
    return pod;
  }

  async updatePod(id: string, data: Partial<IPod>, userId: string): Promise<IPod | null> {
    const pod = await PodModel.findById(id);
    if (!pod) throw new AppError('Pod not found', 404);

    if (pod.status === 'settled' || pod.status === 'cancelled') {
      const protectedFields = ['homeScore', 'awayScore', 'result', 'settlementStatus', 'settledAt', 'settledBy'];
      for (const field of protectedFields) {
        if ((data as any)[field] !== undefined) {
          throw new AppError(`Cannot modify ${field} on a ${pod.status} pod`, 400);
        }
      }
    }

    if (data.status === 'active') {
      data.opensAt = new Date();
    }

    pod.set({ ...data, updatedBy: new mongoose.Types.ObjectId(userId) });

    if (data.gainsMultiplier) {
      (pod as any).impliedProbability = 1 / data.gainsMultiplier;
    }

    if (data.status === 'active') {
      this.ensureFutureStakingCloses(pod);
    }

    await pod.save();
    if (data.status === 'active') cacheService.clear('feed:');
    return pod;
  }

  async publishPod(id: string): Promise<IPod | null> {
    const pod = await PodModel.findById(id);
    if (!pod) throw new AppError('Pod not found', 404);
    pod.status = 'active';
    pod.opensAt = new Date();
    this.ensureFutureStakingCloses(pod);
    await pod.save();
    cacheService.clear('feed:');
    return pod;
  }

  async activatePod(id: string): Promise<IPod | null> {
    const pod = await PodModel.findById(id);
    if (!pod) throw new AppError('Pod not found', 404);
    if (pod.status !== 'published') throw new AppError('Only published pods can be activated', 400);
    pod.status = 'active';
    pod.opensAt = new Date();
    this.ensureFutureStakingCloses(pod);
    await pod.save();
    cacheService.clear('feed:');
    return pod;
  }

  private ensureFutureStakingCloses(pod: any): void {
    const now = new Date();
    if (pod.stakingClosesAt && pod.stakingClosesAt > now) return;
    if (pod.matchDate && new Date(pod.matchDate) > now) {
      pod.stakingClosesAt = new Date(pod.matchDate);
    } else {
      pod.stakingClosesAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    }
  }

  async settlePod(id: string, result: 'win' | 'loss' | 'void', settledBy: string, notes?: string, homeScore?: number, awayScore?: number): Promise<IPod | null> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const pod = await PodModel.findById(id).session(session);
      if (!pod) throw new Error('Pod not found');
      if (pod.status === 'settled' || pod.status === 'cancelled') {
        throw new Error(`Pod already ${pod.status}`);
      }

      const itemResult = result === 'win' ? 'won' as const : result === 'loss' ? 'lost' as const : 'void' as const;

      // 1. Settle single-pod stakes (existing logic)
      const activeStakes = await StakeModel.find({
        pod: id,
        status: { $in: ['pending', 'confirmed'] }
      }).session(session);

      for (const stake of activeStakes) {
        // Skip parlay stakes — handled separately below
        if (stake.isParlay) continue;

        const wallet = await WalletModel.findOne({ user: stake.user }).session(session);
        if (!wallet) continue;

        let payoutAmount = 0;
        let txType = 'refund';
        let newStatus: IStake['status'] = 'lost';

        if (result === 'win') {
          payoutAmount = stake.netPayout;
          wallet.balance += payoutAmount;
          wallet.totalWon += payoutAmount;
          newStatus = 'won';
          txType = 'payout';
        } else if (result === 'void') {
          payoutAmount = stake.stakeAmount;
          wallet.balance += payoutAmount;
          newStatus = 'void';
          txType = 'refund';
        } else {
          payoutAmount = stake.refundAmount ?? 0;
          wallet.balance += payoutAmount;
          newStatus = 'lost';
          txType = 'refund';
        }

        wallet.lastTransactionAt = new Date();
        await wallet.save({ session });

        if (payoutAmount > 0) {
          const isPartialRefund = result === 'loss' && payoutAmount < stake.stakeAmount;
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
            reference: `POD_${result.toUpperCase()}_${stake._id}`,
            provider: 'internal',
            metadata: {
              podId: id,
              stakeId: stake._id,
              description: isPartialRefund
                ? `Pod lost — ${stake.refundPercent}% refund (₦${payoutAmount.toLocaleString()}) of ₦${stake.stakeAmount.toLocaleString()} stake`
                : result === 'win' ? 'Pod won' : 'Pod voided - stake refunded',
              originalStake: stake.stakeAmount,
              refundPercent: stake.refundPercent,
              refundAmount: payoutAmount
            }
          }], { session });
        }

        stake.status = newStatus;
        stake.settledAt = new Date();
        stake.settledBy = new mongoose.Types.ObjectId(settledBy);
        stake.settlementNotes = notes || `Pod ${result}`;
        stake.settledOdds = pod.gainsMultiplier;
        await stake.save({ session });
      }

      // 2. Handle parlay stakes referencing this pod via items
      const parlayStakes = await StakeModel.find({
        'items.pod': id,
        status: { $in: ['pending', 'confirmed'] }
      }).session(session);

      for (const stake of parlayStakes) {
        if (!stake.items || !stake.isParlay) continue;

        // Update the matching item's status
        for (const item of stake.items) {
          if (item.pod.toString() === id && item.status === 'pending') {
            item.status = itemResult;
            item.settledAt = new Date();
          }
        }

        // Check if all items are now settled
        const allSettled = stake.items.every(item => item.status !== 'pending');
        if (!allSettled) {
          // Parlay still has pending legs — just save the item update, no payout yet
          await stake.save({ session });
          continue;
        }

        // All legs settled — determine parlay outcome
        const hasLoss = stake.items.some(item => item.status === 'lost');
        const allVoid = stake.items.every(item => item.status === 'void');
        const allWon = stake.items.every(item => item.status === 'won');

        const wallet = await WalletModel.findOne({ user: stake.user }).session(session);
        if (!wallet) continue;

        let payoutAmount = 0;
        let txType = 'refund';
        let newStatus: IStake['status'] = 'lost';

        if (allWon) {
          payoutAmount = stake.netPayout;
          wallet.balance += payoutAmount;
          wallet.totalWon += payoutAmount;
          newStatus = 'won';
          txType = 'payout';
        } else if (allVoid) {
          payoutAmount = stake.stakeAmount;
          wallet.balance += payoutAmount;
          newStatus = 'void';
          txType = 'refund';
        } else if (hasLoss) {
          // Any loss = parlay lost, no refund
          payoutAmount = 0;
          newStatus = 'lost';
          txType = 'refund';
        } else {
          // Mixed void + won: recalculate for remaining legs
          const activeItems = stake.items.filter(i => i.status === 'won');
          const recalculatedMultiplier = activeItems.reduce((acc, i) => acc * i.gainsMultiplier, 1);
          const recalculatedPayout = Math.floor(stake.stakeAmount * recalculatedMultiplier);
          const recalculatedFee = Math.floor(recalculatedPayout * 10 / 100);
          const recalculatedNet = recalculatedPayout - recalculatedFee;

          payoutAmount = recalculatedNet;
          wallet.balance += payoutAmount;
          wallet.totalWon += payoutAmount;
          newStatus = 'won';
          txType = 'payout';
        }

        wallet.lastTransactionAt = new Date();
        await wallet.save({ session });

        if (payoutAmount > 0) {
          await TransactionModel.create([{
            user: stake.user,
            wallet: wallet._id,
            type: txType,
            status: 'completed',
            amount: payoutAmount,
            fee: newStatus === 'won' ? stake.platformFee : 0,
            netAmount: payoutAmount,
            balanceBefore: wallet.balance - payoutAmount,
            balanceAfter: wallet.balance,
            currency: 'NGN',
            reference: `PARLAY_${result.toUpperCase()}_${stake._id}`,
            provider: 'internal',
            metadata: {
              podId: id,
              stakeId: stake._id,
              description: newStatus === 'won' ? 'Parlay won' : newStatus === 'void' ? 'Parlay voided' : 'Parlay lost - no refund',
              isParlay: true,
              legCount: stake.items.length
            }
          }], { session });
        }

        stake.status = newStatus;
        stake.settledAt = new Date();
        stake.settledBy = new mongoose.Types.ObjectId(settledBy);
        stake.settlementNotes = notes || `Parlay ${result}`;
        stake.settledOdds = stake.combinedMultiplier;
        await stake.save({ session });
      }

      const podResult = result === 'win' ? 'win' : result === 'loss' ? 'loss' : 'void';
      pod.status = 'settled';
      pod.result = podResult as IPod['result'];
      pod.settledAt = new Date();
      pod.settledBy = new mongoose.Types.ObjectId(settledBy);
      pod.resultNotes = notes;
      pod.settlementStatus = 'settled';
      pod.settlementDisputed = false;
      if (homeScore !== undefined) pod.homeScore = homeScore;
      if (awayScore !== undefined) pod.awayScore = awayScore;
      await pod.save({ session });

      await session.commitTransaction();
      return pod;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async cancelPod(id: string, cancelledBy: string): Promise<IPod | null> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const pod = await PodModel.findById(id).session(session);
      if (!pod) throw new Error('Pod not found');
      if (pod.status === 'settled' || pod.status === 'cancelled') {
        throw new Error(`Pod already ${pod.status}`);
      }

      // 1. Cancel single-pod stakes
      const activeStakes = await StakeModel.find({
        pod: id,
        status: { $in: ['pending', 'confirmed'] }
      }).session(session);

      for (const stake of activeStakes) {
        if (stake.isParlay) continue;

        const wallet = await WalletModel.findOne({ user: stake.user }).session(session);
        if (!wallet) continue;

        wallet.balance += stake.stakeAmount;
        wallet.lastTransactionAt = new Date();
        await wallet.save({ session });

        await TransactionModel.create([{
          user: stake.user,
          wallet: wallet._id,
          type: 'refund',
          status: 'completed',
          amount: stake.stakeAmount,
          fee: 0,
          netAmount: stake.stakeAmount,
          balanceBefore: wallet.balance - stake.stakeAmount,
          balanceAfter: wallet.balance,
          currency: 'NGN',
          reference: `CANCEL_${stake._id}`,
          provider: 'internal',
          metadata: {
            podId: id,
            stakeId: stake._id,
            description: 'Pod cancelled - stake refunded'
          }
        }], { session });

        stake.status = 'cancelled';
        stake.settledAt = new Date();
        stake.settledBy = new mongoose.Types.ObjectId(cancelledBy);
        stake.settlementNotes = 'Pod cancelled by admin';
        await stake.save({ session });
      }

      // 2. Handle parlay stakes referencing this pod
      const parlayStakes = await StakeModel.find({
        'items.pod': id,
        status: { $in: ['pending', 'confirmed'] }
      }).session(session);

      for (const stake of parlayStakes) {
        if (!stake.items || !stake.isParlay) continue;

        let fullyVoided = true;
        for (const item of stake.items) {
          if (item.pod.toString() === id) {
            item.status = 'void';
            item.settledAt = new Date();
          }
          if (item.status === 'pending') {
            fullyVoided = false;
          }
        }

        // All legs voided -> full refund
        if (fullyVoided) {
          const wallet = await WalletModel.findOne({ user: stake.user }).session(session);
          if (wallet) {
            wallet.balance += stake.stakeAmount;
            wallet.lastTransactionAt = new Date();
            await wallet.save({ session });

            await TransactionModel.create([{
              user: stake.user,
              wallet: wallet._id,
              type: 'refund',
              status: 'completed',
              amount: stake.stakeAmount,
              fee: 0,
              netAmount: stake.stakeAmount,
              balanceBefore: wallet.balance - stake.stakeAmount,
              balanceAfter: wallet.balance,
              currency: 'NGN',
              reference: `CANCEL_PARLAY_${stake._id}`,
              provider: 'internal',
              metadata: { podId: id, stakeId: stake._id, description: 'Parlay fully voided - stake refunded', isParlay: true },
              processedAt: new Date()
            }], { session });

            stake.status = 'cancelled';
            stake.settledAt = new Date();
            stake.settledBy = new mongoose.Types.ObjectId(cancelledBy);
            stake.settlementNotes = 'Parlay cancelled - all legs voided';
            await stake.save({ session });
          }
        } else {
          // Only this leg voided, parlay continues with reduced odds
          // Recalculate combined odds for remaining pending legs
          const wonItems = stake.items.filter(i => i.status === 'won');
          const pendingItems = stake.items.filter(i => i.status === 'pending');
          const remainingOdds = [...wonItems, ...pendingItems].reduce((acc, i) => acc * i.gainsMultiplier, 1);
          stake.combinedMultiplier = remainingOdds;
          await stake.save({ session });
        }
      }

      pod.status = 'cancelled';
      pod.settledAt = new Date();
      await pod.save({ session });

      await session.commitTransaction();
      return pod;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async listPodsReadyForBetting(query: any): Promise<PaginatedResult<IPod>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 20), 100);
    const now = new Date();
    const filter: Record<string, any> = {
      stakingClosesAt: { $lte: now }
    };

    const listStatus = query.listStatus || 'all';
    if (listStatus === 'active') {
      filter.status = { $in: ['active', 'published'] };
    } else if (listStatus === 'settled') {
      filter.status = 'settled';
    } else {
      filter.status = { $in: ['active', 'published', 'settled'] };
    }

    if (query.search) {
      const regex = new RegExp(query.search, 'i');
      filter.$or = [
        { title: regex },
        { homeTeam: regex },
        { awayTeam: regex },
        { sport: regex },
        { league: regex }
      ];
    }

    if (query.sport) {
      filter.sport = query.sport;
    }

    if (query.booked === 'booked') {
      filter.bookedExternally = true;
    } else if (query.booked === 'not_booked') {
      filter.bookedExternally = { $ne: true };
    }

    const sortField = query.sortBy || 'stakingClosesAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    const allowedSortFields: Record<string, string> = {
      title: 'title',
      sport: 'sport',
      currentExposure: 'currentExposure',
      currentParticipants: 'currentParticipants',
      stakingClosesAt: 'stakingClosesAt',
      bookedExternally: 'bookedExternally',
      matchDate: 'matchDate'
    };
    const sort: any = {};
    sort[allowedSortFields[sortField] || 'stakingClosesAt'] = sortOrder;

    const [items, total] = await Promise.all([
      PodModel.find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('createdBy', 'fullName'),
      PodModel.countDocuments(filter)
    ]);

    return { items: items as unknown as IPod[], total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async toggleExternalBooking(podId: string, adminId: string): Promise<IPod> {
    const pod = await PodModel.findById(podId);
    if (!pod) throw new AppError('Pod not found', 404);

    const newValue = !pod.bookedExternally;
    const update: Record<string, any> = {
      bookedExternally: newValue,
      bookedBy: new mongoose.Types.ObjectId(adminId)
    };
    if (newValue) {
      update.bookedAt = new Date();
    } else {
      update.bookedAt = null;
    }

    const updated = await PodModel.findByIdAndUpdate(podId, { $set: update }, { new: true })
      .populate('createdBy', 'fullName');
    if (!updated) throw new AppError('Pod not found after update', 404);
    return updated as unknown as IPod;
  }

  async listUsers(query: PaginationQuery): Promise<PaginatedResult<IUser>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 20), 100);
    const filter: Record<string, any> = {};

    if (query.search) {
      const regex = new RegExp(query.search, 'i');
      filter.$or = [
        { phone: regex },
        { fullName: regex },
        { email: regex }
      ];
    }

    const [items, total] = await Promise.all([
      UserModel.find(filter)
        .select('-pinHash')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      UserModel.countDocuments(filter)
    ]);

    return { items: items as unknown as IUser[], total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getUser(id: string): Promise<{
    user: IUser | null;
    wallet: any;
    stakes: { items: IStake[]; total: number };
  }> {
    const user = await UserModel.findById(id).select('-pinHash') as unknown as IUser | null;
    if (!user) return { user: null, wallet: null, stakes: { items: [], total: 0 } };

    const [wallet, stakes, stakeCount] = await Promise.all([
      WalletModel.findOne({ user: id }),
      StakeModel.find({ user: id })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate('pod', 'title status'),
      StakeModel.countDocuments({ user: id })
    ]);

    return { user, wallet, stakes: { items: stakes as unknown as IStake[], total: stakeCount } };
  }

  async toggleUserStatus(id: string): Promise<IUser | null> {
    const user = await UserModel.findById(id).select('-pinHash');
    if (!user) return null;

    user.isSuspended = !user.isSuspended;
    await user.save();
    return user;
  }

  async verifyUserKYC(id: string): Promise<IUser | null> {
    const user = await UserModel.findById(id).select('-pinHash');
    if (!user) return null;

    const wasApproved = !user.kycVerified;
    user.kycVerified = wasApproved;
    await user.save();

    if (wasApproved) {
      notifyKycApproved(id).catch(e => console.error('notifyKycApproved error:', e));
    }

    return user;
  }

  async rejectUserKYC(id: string, notes: string): Promise<IUser | null> {
    const user = await UserModel.findById(id).select('-pinHash');
    if (!user) return null;

    user.kycVerified = false;
    user.kycReviewNote = notes;
    user.kycReviewedAt = new Date();
    await user.save();
    return user;
  }

  async getWithdrawal(id: string): Promise<any> {
    return TransactionModel.findById(id)
      .populate('user', 'phone fullName email')
      .lean();
  }

  async listWithdrawals(query: PaginationQuery): Promise<PaginatedResult<any>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 20), 100);
    const filter: Record<string, any> = { type: 'withdrawal' };

    if (query.status) filter.status = query.status;

    const [items, total] = await Promise.all([
      TransactionModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'phone fullName email')
        .lean(),
      TransactionModel.countDocuments(filter)
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async approveWithdrawal(id: string, adminId: string): Promise<any> {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const transaction = await TransactionModel.findById(id).session(session);
      if (!transaction) throw new AppError('Transaction not found', 404);
      if (transaction.type !== 'withdrawal') throw new AppError('Not a withdrawal transaction', 400);
      if (transaction.status !== 'pending') throw new AppError('Withdrawal is not in pending state', 400);

      const meta = (transaction.metadata || {}) as any;
      const transferResult = await walletService.processPaystackTransfer(
        transaction, meta.bankCode, meta.accountNumber, meta.accountName, meta.narration
      );

      if (!transferResult.success) {
        const wallet = await WalletModel.findOne({ user: transaction.user }).session(session);
        if (wallet) {
          wallet.balance += transaction.amount;
          wallet.totalWithdrawn -= transaction.amount;
          wallet.lastTransactionAt = new Date();
          await wallet.save({ session });
        }
        transaction.status = 'failed';
        transaction.failedAt = new Date();
        transaction.failureReason = transferResult.message || 'Transfer failed';
        transaction.providerData = { ...(transferResult.providerData || {}), approvedBy: adminId, approvedAt: new Date() };
        await transaction.save({ session });
        await session.commitTransaction();
        notifyWithdrawalFailed(
          transaction.user.toString(), transaction.amount, transferResult.message || 'Transfer failed'
        ).catch(e => console.error('notifyWithdrawalFailed error:', e));
        return { success: false, message: transferResult.message || 'Transfer failed', transaction };
      }

      transaction.status = 'completed';
      transaction.completedAt = new Date();
      transaction.providerData = { ...(transferResult.providerData || {}), approvedBy: adminId, approvedAt: new Date() };
      await transaction.save({ session });

      await session.commitTransaction();

      notifyWithdrawalCompleted(
        transaction.user.toString(),
        transaction.amount,
        `${meta.accountName} - ${meta.accountNumber}`
      ).catch(e => console.error('notifyWithdrawalCompleted error:', e));

      return { success: true, message: 'Withdrawal approved and processed', transaction };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async rejectWithdrawal(id: string, reason: string, adminId: string): Promise<any> {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const transaction = await TransactionModel.findById(id).session(session);
      if (!transaction) throw new AppError('Transaction not found', 404);
      if (transaction.type !== 'withdrawal') throw new AppError('Not a withdrawal transaction', 400);
      if (transaction.status !== 'pending') throw new AppError('Withdrawal is not in pending state', 400);

      // Reverse the withdrawal: refund the wallet
      const wallet = await WalletModel.findOne({ user: transaction.user }).session(session);
      if (wallet) {
        wallet.balance += transaction.amount;
        wallet.totalWithdrawn -= transaction.amount;
        wallet.lastTransactionAt = new Date();
        await wallet.save({ session });
      }

      transaction.status = 'failed';
      transaction.failedAt = new Date();
      transaction.failureReason = reason;
      transaction.providerData = { ...(transaction.providerData || {}), rejectedBy: adminId, rejectedAt: new Date() };
      await transaction.save({ session });

      await session.commitTransaction();

      notifyWithdrawalFailed(
        transaction.user.toString(),
        transaction.amount,
        reason
      ).catch(e => console.error('notifyWithdrawalFailed error:', e));

      return { success: true, message: 'Withdrawal rejected and refunded', transaction };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async listStakes(query: PaginationQuery): Promise<PaginatedResult<IStake>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 20), 100);
    const filter: Record<string, any> = {};

    if (query.status) filter.status = query.status;
    if (query.userId) filter.user = new mongoose.Types.ObjectId(query.userId);
    if (query.podId) filter.pod = new mongoose.Types.ObjectId(query.podId);

    const [items, total] = await Promise.all([
      StakeModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'phone fullName')
        .populate('pod', 'title sport')
        .lean(),
      StakeModel.countDocuments(filter)
    ]);

    return { items: items as unknown as IStake[], total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getStake(id: string): Promise<IStake | null> {
    return StakeModel.findById(id)
      .populate('user', 'phone fullName email')
      .populate('pod');
  }

  async settleStake(stakeId: string, result: 'win' | 'loss' | 'void', settledBy: string, notes?: string): Promise<IStake | null> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const stake = await StakeModel.findById(stakeId).session(session);
      if (!stake) throw new Error('Stake not found');
      if (stake.isSettled) throw new Error('Stake already settled');

      // Handle parlay settlement
      if (stake.isParlay && stake.items) {
        const allSettled = stake.items.every(item => item.status !== 'pending');
        if (allSettled) throw new Error('Parlay already fully settled');

        for (const item of stake.items) {
          item.status = result === 'win' ? 'won' : result === 'void' ? 'void' : 'lost';
          item.settledAt = new Date();
        }

        const wallet = await WalletModel.findOne({ user: stake.user }).session(session);
        if (!wallet) throw new Error('Wallet not found');

        let payoutAmount = 0;
        let newStatus: IStake['status'];
        let txType = 'refund';

        if (result === 'win') {
          payoutAmount = stake.netPayout;
          wallet.balance += payoutAmount;
          wallet.totalWon += payoutAmount;
          newStatus = 'won';
          txType = 'payout';
        } else if (result === 'void') {
          payoutAmount = stake.stakeAmount;
          wallet.balance += payoutAmount;
          newStatus = 'void';
          txType = 'refund';
        } else {
          payoutAmount = 0;
          newStatus = 'lost';
          txType = 'refund';
        }

        wallet.lastTransactionAt = new Date();
        await wallet.save({ session });

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
            metadata: { description: result === 'win' ? 'Parlay won (admin)' : result === 'void' ? 'Parlay voided (admin)' : 'Parlay lost - no refund', isParlay: true, legCount: stake.items.length }
          }], { session });
        }

        stake.status = newStatus;
        stake.settledAt = new Date();
        stake.settledBy = new mongoose.Types.ObjectId(settledBy);
        stake.settlementNotes = notes || `Parlay ${result} (admin)`;
        stake.settledOdds = stake.combinedMultiplier;
        await stake.save({ session });

        await session.commitTransaction();
        return stake;
      }

      // Single-pod stake settlement
      const pod = await PodModel.findById(stake.pod).session(session);
      if (!pod) throw new Error('Pod not found');

      const wallet = await WalletModel.findOne({ user: stake.user }).session(session);
      if (!wallet) throw new Error('Wallet not found');

      let payoutAmount = 0;
      let newStatus: IStake['status'];
      let txType = 'refund';

      if (result === 'win') {
        payoutAmount = stake.netPayout;
        wallet.balance += payoutAmount;
        wallet.totalWon += payoutAmount;
        newStatus = 'won';
        txType = 'payout';
      } else if (result === 'void') {
        payoutAmount = stake.stakeAmount;
        wallet.balance += payoutAmount;
        newStatus = 'void';
        txType = 'refund';
      } else {
        payoutAmount = stake.refundAmount ?? 0;
        wallet.balance += payoutAmount;
        newStatus = 'lost';
        txType = 'refund';
      }

      wallet.lastTransactionAt = new Date();
      await wallet.save({ session });

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
          reference: `${result.toUpperCase()}_${stake._id}`,
          provider: 'internal',
          metadata: {
            podId: stake.pod,
            stakeId: stake._id,
            description: result === 'win' ? 'Stake won' : result === 'void' ? 'Stake voided - refunded' : 'Stake lost - refunded',
            originalStake: stake.stakeAmount
          }
        }], { session });
      }

      stake.status = newStatus;
      stake.settledAt = new Date();
      stake.settledBy = new mongoose.Types.ObjectId(settledBy);
      stake.settlementNotes = notes;
      stake.settledOdds = pod.gainsMultiplier;
      await stake.save({ session });

      await session.commitTransaction();
      return stake;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async voidStake(stakeId: string, settledBy: string): Promise<IStake | null> {
    return this.settleStake(stakeId, 'void', settledBy, 'Voided by admin');
  }

  async listTransactions(query: PaginationQuery): Promise<PaginatedResult<any>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 20), 100);
    const filter: Record<string, any> = {};

    if (query.type) filter.type = query.type;
    if (query.status) filter.status = query.status;
    if (query.userId) filter.user = new mongoose.Types.ObjectId(query.userId);

    const [items, total] = await Promise.all([
      TransactionModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'phone fullName'),
      TransactionModel.countDocuments(filter)
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async listLoans(query: PaginationQuery): Promise<PaginatedResult<any>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 20), 100);
    const filter: Record<string, any> = {};

    if (query.status) filter.status = query.status;
    if (query.userId) filter.user = new mongoose.Types.ObjectId(query.userId);

    const [items, total] = await Promise.all([
      LoanModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'phone fullName email')
        .populate('approvedBy', 'phone fullName')
        .lean(),
      LoanModel.countDocuments(filter)
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getLoan(id: string): Promise<any> {
    return LoanModel.findById(id)
      .populate('user', 'phone fullName email')
      .populate('approvedBy', 'phone fullName')
      .lean();
  }

  async approveLoan(id: string, adminId: string): Promise<any> {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      // Atomically claim the loan — prevents double-credit race
      const loan = await LoanModel.findOneAndUpdate(
        { _id: id, status: 'pending' },
        { $set: { status: 'approved', approvedAt: new Date(), approvedBy: new mongoose.Types.ObjectId(adminId) } },
        { new: true, session }
      );
      if (!loan) throw new AppError('Loan not found or already processed', 404);

      // Credit the user's wallet
      const wallet = await WalletModel.findOne({ user: loan.user }).session(session);
      if (!wallet) throw new AppError('User wallet not found', 404);

      wallet.balance += loan.amount;
      wallet.lastTransactionAt = new Date();
      await wallet.save({ session });

      const ref = `LOAN_${loan._id}_${Date.now()}`;
      await TransactionModel.create([{
        user: loan.user,
        wallet: wallet._id,
        type: 'deposit',
        status: 'completed',
        amount: loan.amount,
        fee: 0,
        netAmount: loan.amount,
        balanceBefore: wallet.balance - loan.amount,
        balanceAfter: wallet.balance,
        currency: 'NGN',
        reference: ref,
        provider: 'internal',
        metadata: { description: `Loan approved — ${loan.purpose}` }
      }], { session });

      await session.commitTransaction();
      return { success: true, message: `Loan approved, ₦${loan.amount.toLocaleString()} credited` };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async rejectLoan(id: string, reason: string): Promise<any> {
    const loan = await LoanModel.findById(id);
    if (!loan) throw new AppError('Loan not found', 404);
    if (loan.status !== 'pending') throw new AppError('Loan is not in pending state', 400);

    loan.status = 'rejected';
    loan.note = reason;
    await loan.save();

    return { success: true, message: 'Loan rejected' };
  }

  async repayLoan(id: string): Promise<any> {
    const loan = await LoanModel.findById(id);
    if (!loan) throw new AppError('Loan not found', 404);
    if (loan.status !== 'approved' && loan.status !== 'active') throw new AppError('Loan is not repayable', 400);

    const repayment = loan.repaymentAmount || loan.amount;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const wallet = await WalletModel.findOne({ user: loan.user }).session(session);
      if (!wallet) throw new AppError('User wallet not found', 404);

      const available = wallet.balance - wallet.lockedBalance;
      if (repayment > available) {
        throw new AppError(`Insufficient balance. Need ₦${repayment.toLocaleString()}, available ₦${available.toLocaleString()}`, 400);
      }

      wallet.balance -= repayment;
      wallet.lastTransactionAt = new Date();
      await wallet.save({ session });

      const ref = `LOAN_REPAY_${loan._id}_${Date.now()}`;
      await TransactionModel.create([{
        user: loan.user,
        wallet: wallet._id,
        type: 'fee',
        status: 'completed',
        amount: repayment,
        fee: 0,
        netAmount: -repayment,
        balanceBefore: wallet.balance + repayment,
        balanceAfter: wallet.balance,
        currency: 'NGN',
        reference: ref,
        provider: 'internal',
        metadata: { description: `Loan repayment — ${loan.purpose}`, loanId: loan._id.toString() }
      }], { session });

      loan.status = 'repaid';
      loan.repaidAt = new Date();
      loan.repaymentAmount = repayment;
      await loan.save({ session });

      await session.commitTransaction();
      return { success: true, message: `Loan repaid: ₦${repayment.toLocaleString()} deducted` };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async manualAdjustment(
    targetUserId: string,
    amount: number,
    type: 'credit' | 'debit',
    reason: string,
    adminId: string
  ): Promise<{ success: boolean; message: string; balanceAfter?: number }> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const wallet = await WalletModel.findOne({ user: targetUserId }).session(session);
      if (!wallet) throw new Error('Wallet not found');

      const prevBalance = wallet.balance;
      let netAmount = amount;

      if (type === 'credit') {
        wallet.balance += amount;
      } else {
        const available = wallet.balance - wallet.lockedBalance;
        if (amount > available) {
          throw new Error(`Insufficient available balance. Available: ₦${available.toLocaleString()}`);
        }
        wallet.balance -= amount;
        netAmount = -amount;
      }

      wallet.lastTransactionAt = new Date();
      await wallet.save({ session });

      const reference = `ADJ_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

      await TransactionModel.create([{
        user: targetUserId,
        wallet: wallet._id,
        type: 'adjustment',
        status: 'completed',
        amount,
        fee: 0,
        netAmount,
        balanceBefore: prevBalance,
        balanceAfter: wallet.balance,
        currency: 'NGN',
        reference,
        provider: 'internal',
        metadata: {
          description: `Admin ${type}: ${reason}`,
          adjustedBy: adminId,
          adjustmentType: type,
          reason
        }
      }], { session });

      await session.commitTransaction();
      return { success: true, message: `Wallet ${type}ed ₦${amount.toLocaleString()}`, balanceAfter: wallet.balance };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
  async getReserveConsumption(): Promise<{
    reserveAmount: number;
    activePodsCount: number;
    totalExposure: number;
    refundIfAllLose: number;
    payoutIfAllWin: number;
    netIfAllWin: number;
    netIfAllLose: number;
    consumptionPercent: number;
    pods: Array<{ id: string; title: string; exposure: number; refundPercent: number; gainsMultiplier: number; refundIfLoss: number; payoutIfWin: number }>;
  }> {
    const settings = await SettingsModel.findOne().sort({ createdAt: -1 });
    const reserveAmount = settings?.reserveAmount || 1_000_000;
    const activePods = await PodModel.find({ status: { $in: ['published', 'active'] }, currentExposure: { $gt: 0 } }).lean();

    let totalExposure = 0;
    let refundIfAllLose = 0;
    let payoutIfAllWin = 0;
    const pods: any[] = [];

    for (const p of activePods) {
      const exp = p.currentExposure || 0;
      const refundPct = p.refundPercent || 0;
      const mult = p.gainsMultiplier || 1;
      const refundLoss = Math.floor(exp * refundPct / 100);
      const payoutWin = Math.floor(exp * mult * 0.9); // net payout after 10% fee

      totalExposure += exp;
      refundIfAllLose += refundLoss;
      payoutIfAllWin += payoutWin;

      pods.push({
        id: p._id.toString(),
        title: p.title,
        exposure: exp,
        refundPercent: refundPct,
        gainsMultiplier: mult,
        refundIfLoss: refundLoss,
        payoutIfWin: payoutWin,
      });
    }

    const worstCase = Math.max(refundIfAllLose, payoutIfAllWin);
    const consumptionPercent = Math.min(100, Math.round((worstCase / reserveAmount) * 100));
    const netIfAllWin = totalExposure - payoutIfAllWin;
    const netIfAllLose = totalExposure - refundIfAllLose;

    return {
      reserveAmount,
      activePodsCount: activePods.length,
      totalExposure,
      refundIfAllLose,
      payoutIfAllWin,
      netIfAllWin,
      netIfAllLose,
      consumptionPercent,
      pods,
    };
  }
}

export const adminService = new AdminService();

