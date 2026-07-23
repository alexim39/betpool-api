import mongoose from 'mongoose';
import { MatchPoolModel, IMatchPool } from './match-pool.model';
import { PoolStakeModel, IPoolStake } from './pool-stake.model';
import { WalletModel } from '../../models/wallet.model';
import { TransactionModel } from '../../models/transaction.model';
import { UserModel } from '../../models/user.model';
import { logger } from '../../services/logger.service';

const PLATFORM_FEE_RATE = 0.15;

interface CreatePoolInput {
  eventTitle: string;
  markets: { marketId: string; label: string }[];
  stakingClosesAt: Date;
  minStake?: number;
  maxStake?: number;
  adminId: string;
}

interface StakeInput {
  userId: string;
  matchPoolId: string;
  marketId: string;
  amount: number;
}

interface PaginationQuery {
  page?: number;
  limit?: number;
}

interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class MatchPoolService {
  async createPool(data: CreatePoolInput): Promise<IMatchPool> {
    const markets = data.markets.map(m => ({ marketId: m.marketId, label: m.label, totalStaked: 0 }));
    const pool = await MatchPoolModel.create({
      eventTitle: data.eventTitle,
      markets,
      stakingClosesAt: data.stakingClosesAt,
      minStake: data.minStake || 100,
      maxStake: data.maxStake || 100000,
      createdByAdminId: new mongoose.Types.ObjectId(data.adminId),
      totalPool: 0,
      platformFeeAmount: 0,
      distributableAmount: 0
    });
    return pool;
  }

  async listOpenPools(query: PaginationQuery = {}): Promise<PaginatedResult<IMatchPool>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 20), 100);
    const now = new Date();

    const filter = { status: 'open' as const, stakingClosesAt: { $gt: now } };
    const [items, total] = await Promise.all([
      MatchPoolModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      MatchPoolModel.countDocuments(filter)
    ]);
    return { items: items as any, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getPoolById(id: string): Promise<IMatchPool | null> {
    return MatchPoolModel.findById(id) as any;
  }

  async stake(data: StakeInput): Promise<IPoolStake> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const pool = await MatchPoolModel.findById(data.matchPoolId).session(session);
      if (!pool) throw new Error('Match pool not found');
      if (pool.status !== 'open') throw new Error('Match pool is not open for staking');
      if (new Date() >= pool.stakingClosesAt) throw new Error('Staking window has closed');

      const market = pool.markets.find(m => m.marketId === data.marketId);
      if (!market) throw new Error('Invalid market selected');

      // Check existing stake
      const existingStake = await PoolStakeModel.findOne({
        userId: data.userId,
        matchPoolId: data.matchPoolId
      }).session(session);
      if (existingStake) throw new Error('You already have a stake in this match pool');

      if (data.amount < pool.minStake) throw new Error(`Minimum stake is ₦${pool.minStake}`);
      if (data.amount > pool.maxStake) throw new Error(`Maximum stake is ₦${pool.maxStake}`);

      // Atomically deduct wallet — prevents race condition
      const wallet = await WalletModel.findOneAndUpdate(
        {
          user: data.userId,
          $expr: { $gte: [{ $subtract: ['$balance', '$lockedBalance'] }, data.amount] }
        },
        {
          $inc: { balance: -data.amount, totalInvested: data.amount },
          $set: { lastTransactionAt: new Date() }
        },
        { new: true, session }
      );
      if (!wallet) {
        throw new Error('Insufficient balance');
      }

      // Create stake
      const stake = await PoolStakeModel.create([{
        userId: data.userId,
        matchPoolId: data.matchPoolId,
        marketId: data.marketId,
        amount: data.amount,
        status: 'confirmed',
        payoutAmount: 0
      }], { session });

      // Update market totalStaked and pool total
      market.totalStaked += data.amount;
      pool.totalPool += data.amount;
      await pool.save({ session });

      // Create transaction
      await TransactionModel.create([{
        user: data.userId,
        wallet: wallet._id,
        type: 'stake',
        status: 'completed',
        amount: data.amount,
        fee: 0,
        netAmount: data.amount,
        balanceBefore: wallet.balance + data.amount,
        balanceAfter: wallet.balance,
        currency: 'NGN',
        reference: `MPSTAKE-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        provider: 'internal'
      }], { session });

      await session.commitTransaction();
      return stake[0];
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async closeStaking(poolId: string): Promise<IMatchPool> {
    const pool = await MatchPoolModel.findById(poolId);
    if (!pool) throw new Error('Match pool not found');
    if (pool.status !== 'open') throw new Error('Match pool is not open');
    pool.status = 'staking_closed';
    await pool.save();
    return pool;
  }

  async settlePool(poolId: string, winningMarketId: string): Promise<IMatchPool> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const pool = await MatchPoolModel.findById(poolId).session(session);
      if (!pool) throw new Error('Match pool not found');
      if (pool.status === 'settled') throw new Error('Match pool already settled');
      if (pool.status === 'cancelled') throw new Error('Match pool was cancelled');
      if (pool.status === 'open') pool.status = 'staking_closed';

      const market = pool.markets.find(m => m.marketId === winningMarketId);
      if (!market) throw new Error('Winning market not found in this pool');

      // Compute totals
      const stakes = await PoolStakeModel.find({ matchPoolId: poolId }).session(session);
      const totalPool = stakes.reduce((sum, s) => sum + s.amount, 0);
      const platformFeeAmount = Math.floor(totalPool * PLATFORM_FEE_RATE);
      const distributableAmount = totalPool - platformFeeAmount;
      const winningStakes = stakes.filter(s => s.marketId === winningMarketId);
      const winningMarketTotal = winningStakes.reduce((sum, s) => sum + s.amount, 0);

      if (winningMarketTotal === 0) throw new Error('No stakes on the winning market — cannot settle');

      // Log audit trail
      const auditLog = {
        poolId,
        eventTitle: pool.eventTitle,
        totalPool,
        platformFeeAmount,
        distributableAmount,
        winningMarketId,
        winningMarketTotal,
        totalStakers: stakes.length,
        winnersCount: winningStakes.length,
        timestamp: new Date().toISOString(),
        perStakerPayouts: [] as { userId: string; amount: number; stakeAmount: number }[]
      };

      // Settle winning stakes
      let totalDistributed = 0;
      for (const stake of winningStakes) {
        // Integer-safe: multiply first, then divide
        const payoutAmount = Math.floor((stake.amount * distributableAmount) / winningMarketTotal);
        totalDistributed += payoutAmount;
        stake.payoutAmount = payoutAmount;
        stake.status = 'won';
        stake.settledAt = new Date();
        await stake.save({ session });

        // Credit wallet
        const wallet = await WalletModel.findOne({ user: stake.userId }).session(session);
        if (wallet) {
          wallet.balance += payoutAmount;
          await wallet.save({ session });
        }

        // Create payout transaction
        await TransactionModel.create([{
          user: stake.userId,
          wallet: wallet._id,
          type: 'payout',
          status: 'completed',
          amount: payoutAmount,
          fee: 0,
          netAmount: payoutAmount,
          balanceBefore: wallet.balance - payoutAmount,
          balanceAfter: wallet.balance,
          currency: 'NGN',
          reference: `MPWIN-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          provider: 'internal'
        }], { session });

        auditLog.perStakerPayouts.push({
          userId: stake.userId.toString(),
          amount: payoutAmount,
          stakeAmount: stake.amount
        });
      }

      // Mark losing stakes
      const losingStakes = stakes.filter(s => s.marketId !== winningMarketId);
      for (const stake of losingStakes) {
        stake.status = 'lost';
        stake.settledAt = new Date();
        await stake.save({ session });
      }

      // Dust rounding — add unallocated remainder to platform fee
      const dustAmount = distributableAmount - totalDistributed;
      const effectiveFee = platformFeeAmount + dustAmount;

      // Update pool
      pool.winningMarketId = winningMarketId;
      pool.totalPool = totalPool;
      pool.platformFeeAmount = effectiveFee;
      pool.distributableAmount = distributableAmount;
      pool.status = 'settled';
      pool.settledAt = new Date();
      await pool.save({ session });

      // Create platform fee transaction
      const admin = await UserModel.findOne({ role: 'admin' }).session(session);
      if (admin) {
        const adminWallet = await WalletModel.findOne({ user: admin._id }).session(session);
        if (adminWallet) {
          adminWallet.balance += effectiveFee;
          await adminWallet.save({ session });
        }
        await TransactionModel.create([{
          user: admin._id,
          wallet: adminWallet._id,
          type: 'fee',
          status: 'completed',
          amount: effectiveFee,
          fee: 0,
          netAmount: effectiveFee,
          balanceBefore: adminWallet.balance - platformFeeAmount,
          balanceAfter: adminWallet.balance,
          currency: 'NGN',
          reference: `MPFEE-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          provider: 'internal'
        }], { session });
      }

      logger.info('MatchPool Settlement', auditLog);

      await session.commitTransaction();
      return pool;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async cancelPool(poolId: string): Promise<IMatchPool> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const pool = await MatchPoolModel.findById(poolId).session(session);
      if (!pool) throw new Error('Match pool not found');
      if (pool.status === 'settled') throw new Error('Cannot cancel a settled match pool');
      if (pool.status === 'cancelled') throw new Error('Match pool already cancelled');

      const stakes = await PoolStakeModel.find({ matchPoolId: poolId, status: 'confirmed' }).session(session);

      // Refund all confirmed stakes
      for (const stake of stakes) {
        const wallet = await WalletModel.findOne({ user: stake.userId }).session(session);
        if (wallet) {
          wallet.balance += stake.amount;
          await wallet.save({ session });
        }

        stake.status = 'cancelled_refunded';
        stake.settledAt = new Date();
        await stake.save({ session });

        await TransactionModel.create([{
          user: stake.userId,
          wallet: wallet._id,
          type: 'refund',
          status: 'completed',
          amount: stake.amount,
          fee: 0,
          netAmount: stake.amount,
          balanceBefore: wallet.balance - stake.amount,
          balanceAfter: wallet.balance,
          currency: 'NGN',
          reference: `MPREFUND-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          provider: 'internal'
        }], { session });
      }

      pool.status = 'cancelled';
      pool.cancelledAt = new Date();
      await pool.save({ session });

      await session.commitTransaction();
      return pool;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async getUserStakes(userId: string, query: PaginationQuery = {}): Promise<PaginatedResult<IPoolStake>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 20), 100);

    const [docs, total] = await Promise.all([
      PoolStakeModel.find({ userId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('matchPoolId', 'eventTitle status'),
      PoolStakeModel.countDocuments({ userId })
    ]);
    const items = docs.map(d => {
      const obj: any = d.toObject();
      obj.matchPool = obj.matchPoolId;
      return obj;
    });
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getPoolReport(poolId: string): Promise<any> {
    const pool = await MatchPoolModel.findById(poolId) as any;
    if (!pool) throw new Error('Match pool not found');

    const stakes = await PoolStakeModel.find({ matchPoolId: poolId }) as any;
    const marketBreakdown = pool.markets.map(m => {
      const marketStakes = stakes.filter(s => s.marketId === m.marketId);
      return {
        marketId: m.marketId,
        label: m.label,
        totalStaked: m.totalStaked,
        stakerCount: marketStakes.length,
        winners: marketStakes.filter(s => s.status === 'won').length
      };
    });

    return {
      eventTitle: pool.eventTitle,
      status: pool.status,
      totalPool: pool.totalPool,
      platformFeeAmount: pool.platformFeeAmount,
      distributableAmount: pool.distributableAmount,
      winningMarketId: pool.winningMarketId,
      totalStakers: stakes.length,
      totalWinners: stakes.filter(s => s.status === 'won').length,
      marketBreakdown,
      settledAt: pool.settledAt,
      cancelledAt: pool.cancelledAt
    };
  }

  async listAllPools(query: PaginationQuery & { status?: string } = {}): Promise<PaginatedResult<IMatchPool>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 20), 100);
    const filter: Record<string, any> = {};
    if (query.status) filter.status = query.status;

    const [items, total] = await Promise.all([
      MatchPoolModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      MatchPoolModel.countDocuments(filter)
    ]);
    return { items: items as any, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getAdminDetail(poolId: string): Promise<any> {
    const pool = await MatchPoolModel.findById(poolId) as any;
    if (!pool) throw new Error('Match pool not found');

    const stakes = await PoolStakeModel.find({ matchPoolId: poolId })
      .populate('userId', 'phone fullName email') as any;

    const marketBreakdown = pool.markets.map(m => {
      const marketStakes = stakes.filter((s: any) => s.marketId === m.marketId);
      return {
        marketId: m.marketId,
        label: m.label,
        totalStaked: m.totalStaked,
        stakerCount: marketStakes.length,
        stakes: marketStakes.map((s: any) => ({
          _id: s._id,
          user: s.userId,
          amount: s.amount,
          status: s.status,
          payoutAmount: s.payoutAmount
        }))
      };
    });

    return { pool, marketBreakdown, totalStakes: stakes.length };
  }

  async getReports(query: { from?: string; to?: string } = {}): Promise<any> {
    const filter: Record<string, any> = { status: 'settled' };
    if (query.from || query.to) {
      filter.settledAt = {};
      if (query.from) filter.settledAt.$gte = new Date(query.from);
      if (query.to) filter.settledAt.$lte = new Date(query.to);
    }

    const pools = await MatchPoolModel.find(filter).sort({ settledAt: -1 }) as any;
    const totalFeeRevenue = pools.reduce((sum, p) => sum + p.platformFeeAmount, 0);
    const avgPoolSize = pools.length > 0 ? Math.floor(pools.reduce((sum, p) => sum + p.totalPool, 0) / pools.length) : 0;
    const totalStakers = new Set<string>();
    const marketStakerCounts: Record<string, number> = {};

    for (const pool of pools) {
      const stakes = await PoolStakeModel.find({ matchPoolId: pool._id }) as any;
      for (const s of stakes) {
        totalStakers.add(s.userId.toString());
        marketStakerCounts[s.marketId] = (marketStakerCounts[s.marketId] || 0) + 1;
      }
    }

    return {
      totalSettled: pools.length,
      totalFeeRevenue,
      avgPoolSize,
      uniqueStakers: totalStakers.size,
      pools: pools.map(p => ({
        _id: p._id,
        eventTitle: p.eventTitle,
        totalPool: p.totalPool,
        platformFeeAmount: p.platformFeeAmount,
        settledAt: p.settledAt
      }))
    };
  }
}

export const matchPoolService = new MatchPoolService();

