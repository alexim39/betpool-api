import mongoose from 'mongoose';
import { StakeModel } from '../../models/stake.model';
import { BetManagerAccountModel, IBetManagerAccount, BetManagerTier } from '../../models/bet-manager-account.model';
import { BetManagerDepositModel } from '../../models/bet-manager-deposit.model';
import { BetManagerCycleModel, IBetManagerCycle } from '../../models/bet-manager-cycle.model';
import { BetManagerAllocationModel } from '../../models/bet-manager-allocation.model';
import { WalletModel } from '../../models/wallet.model';
import { TransactionModel } from '../../models/transaction.model';
import { PodModel } from '../../models/pod.model';
import { logger } from '../../services/logger.service';
import { runTransaction } from '../../utils/transaction';

const TIER_CONFIG = {
  goalkeeper: { minDeposit: 20_000, maxAllocPct: 0.7, minMultiplier: 1.1, maxMultiplier: 1.5, platformFee: 300 },
  defender: { minDeposit: 50_000, maxAllocPct: 0.8, minMultiplier: 1.2, maxMultiplier: 1.8, platformFee: 500 },
  midfielder: { minDeposit: 100_000, maxAllocPct: 0.85, minMultiplier: 1.5, maxMultiplier: 2.5, platformFee: 500 },
  striker: { minDeposit: 200_000, maxAllocPct: 0.9, minMultiplier: 2.0, maxMultiplier: 5.0, platformFee: 500 },
};

export const POOL_WALLET_IDS: Record<BetManagerTier, mongoose.Types.ObjectId> = {
  goalkeeper: new mongoose.Types.ObjectId('000000000000000000000004'),
  defender: new mongoose.Types.ObjectId('000000000000000000000001'),
  midfielder: new mongoose.Types.ObjectId('000000000000000000000002'),
  striker: new mongoose.Types.ObjectId('000000000000000000000003'),
};

const VALID_TIERS: BetManagerTier[] = ['goalkeeper', 'defender', 'midfielder', 'striker'];
const VALID_DEPOSIT_STATUSES = ['locked', 'unlocked', 'withdrawn'];

export interface DepositHistoryQuery {
  type?: 'deposit' | 'withdrawal';
  status?: string;
  from?: string;
  to?: string;
  search?: string;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function escapeRegex(s: string): string {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class BetManagerService {
  async getOrCreatePoolWallet(tier: BetManagerTier): Promise<mongoose.Types.ObjectId> {
    const walletId = POOL_WALLET_IDS[tier];
    const existing = await WalletModel.findById(walletId);
    if (existing) return walletId;
    await WalletModel.create({
      _id: walletId,
      user: walletId,
      balance: 0,
      lockedBalance: 0,
      currency: 'NGN',
    });
    logger.info('BetManager pool wallet created', { tier, walletId: walletId.toString() });
    return walletId;
  }

  private async getOrCreateCycle(tier: BetManagerTier): Promise<IBetManagerCycle> {
    const active = await BetManagerCycleModel.findOne({ tier, status: 'active' }).sort({ cycleNumber: -1 });
    if (active) return active;
    const lastCycle = await BetManagerCycleModel.findOne({ tier }).sort({ cycleNumber: -1 });
    const cycleNumber = (lastCycle?.cycleNumber || 0) + 1;
    const now = new Date();
    const startDate = lastCycle?.endDate && lastCycle.endDate > now ? lastCycle.endDate : now;
    const endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const poolWallet = await WalletModel.findById(POOL_WALLET_IDS[tier]);
    const totalUnits = await BetManagerAccountModel.aggregate([
      { $match: { tier, status: 'active' } },
      { $group: { _id: null, total: { $sum: '$units' } } },
    ]);
    const startingUnits = totalUnits[0]?.total || 0;
    const poolBalance = poolWallet?.balance || 0;
    const startingNav = startingUnits > 0 ? poolBalance / startingUnits : 1;

    return BetManagerCycleModel.create({
      tier,
      cycleNumber,
      startDate,
      endDate,
      startingNav,
      startingUnits,
      cashBalance: poolBalance,
      totalStaked: 0,
      netProfit: 0,
      platformFee: 0,
      performanceFee: 0,
      feePaid: false,
      status: 'active',
    });
  }

  async getCurrentNav(tier: BetManagerTier): Promise<{ nav: number; totalValue: number; units: number }> {
    const cycle = await BetManagerCycleModel.findOne({ tier, status: 'active' }).sort({ cycleNumber: -1 });
    const poolWallet = await WalletModel.findById(POOL_WALLET_IDS[tier]);
    const poolBalance = poolWallet?.balance || 0;
    const totalUnits = await BetManagerAccountModel.aggregate([
      { $match: { tier, status: 'active' } },
      { $group: { _id: null, total: { $sum: '$units' } } },
    ]);
    const units = totalUnits[0]?.total || 0;
    const allocs = await BetManagerAllocationModel.aggregate([
      { $match: { tier, status: 'active' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const stakedValue = allocs[0]?.total || 0;
    const totalValue = poolBalance + stakedValue;
    const nav = units > 0 ? totalValue / units : (cycle?.startingNav || 1);
    return { nav, totalValue, units };
  }

  async getAccountSummary(userId: string, tier: BetManagerTier): Promise<{
    account: IBetManagerAccount | null;
    nav: number;
    currentValue: number;
    totalProfit: number;
    lockedBalance: number;
    unlockedBalance: number;
  }> {
    const account = await BetManagerAccountModel.findOne({ userId, tier });
    const navData = await this.getCurrentNav(tier);
    const units = account?.units || 0;
    const currentValue = units * navData.nav;
    const totalProfit = (account?.totalProfit || 0) + currentValue - (account?.totalDeposited || 0) - (account?.totalWithdrawn || 0);

    const deposits = await BetManagerDepositModel.find({
      userId, accountId: account?._id, type: 'deposit', status: { $ne: 'withdrawn' },
    });
    let lockedBalance = 0;
    let unlockedBalance = 0;
    const now = new Date();
    for (const d of deposits) {
      if (d.withdrawableAt && d.withdrawableAt <= now) {
        unlockedBalance += d.amount;
      } else {
        lockedBalance += d.amount;
      }
    }

    return { account, nav: navData.nav, currentValue, totalProfit, lockedBalance, unlockedBalance };
  }

  async getAllAccounts(userId: string): Promise<Array<{
    tier: BetManagerTier;
    currentValue: number;
    units: number;
    totalDeposited: number;
    totalProfit: number;
  }>> {
    const tiers: BetManagerTier[] = ['goalkeeper', 'defender', 'midfielder', 'striker'];
    const results = [];
    for (const tier of tiers) {
      const account = await BetManagerAccountModel.findOne({ userId, tier });
      const navData = await this.getCurrentNav(tier);
      const units = account?.units || 0;
      results.push({
        tier,
        currentValue: units * navData.nav,
        units,
        totalDeposited: account?.totalDeposited || 0,
        totalProfit: (account?.totalProfit || 0) + (units * navData.nav) - (account?.totalDeposited || 0) - (account?.totalWithdrawn || 0),
      });
    }
    return results;
  }

  async deposit(userId: string, tier: BetManagerTier, amountOverride = 0): Promise<{ success: boolean; message: string; account?: IBetManagerAccount }> {
    const minDeposit = TIER_CONFIG[tier].minDeposit;
    await this.getOrCreatePoolWallet(tier);
    const poolWalletId = POOL_WALLET_IDS[tier];

    return runTransaction(async (session) => {
      const userWallet = await WalletModel.findOne({ user: userId }).session(session);
      if (!userWallet) return { success: false, message: 'Wallet not found' };
      const available = userWallet.balance - userWallet.lockedBalance;
      const amount = amountOverride > 0 ? amountOverride : minDeposit;
      if (amount < minDeposit) return { success: false, message: `Minimum deposit for ${tier} is ₦${minDeposit.toLocaleString()}.` };
      if (amount > available) return { success: false, message: `Insufficient balance. You need ₦${amount.toLocaleString()} but only have ₦${available.toLocaleString()} available.` };

      const navData = await this.getCurrentNav(tier);
      const nav = navData.nav;
      const units = amount / nav;

      userWallet.balance -= amount;
      userWallet.lastTransactionAt = new Date();
      await userWallet.save({ session });

      const poolWallet = await WalletModel.findById(poolWalletId).session(session);
      if (poolWallet) {
        poolWallet.balance += amount;
        poolWallet.lastTransactionAt = new Date();
        await poolWallet.save({ session });
      }

      await TransactionModel.create([{
        user: userId,
        wallet: poolWalletId,
        type: 'bonus',
        status: 'completed',
        amount,
        fee: 0,
        netAmount: amount,
        balanceBefore: userWallet.balance + amount,
        balanceAfter: userWallet.balance,
        currency: 'NGN',
        reference: `BM_DEP_${userId.slice(-6)}_${Date.now()}`,
        provider: 'internal',
        metadata: { description: `Bet Manager ${tier} deposit`, tier },
      }], { session });

      let account = await BetManagerAccountModel.findOne({ userId, tier }).session(session);
      if (!account) {
        [account] = await BetManagerAccountModel.create([{
          userId, tier, units: 0, totalDeposited: 0, totalWithdrawn: 0, totalProfit: 0,
        }], { session });
      }
      account.units += units;
      account.totalDeposited += amount;
      await account.save({ session });

      await BetManagerDepositModel.create([{
        userId,
        accountId: account._id,
        type: 'deposit',
        amount,
        units,
        navAtExecution: nav,
        depositedAt: new Date(),
        withdrawableAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: 'locked',
        reference: `BM_DEP_${userId.slice(-6)}_${Date.now()}`,
      }], { session });

      const cycle = await BetManagerCycleModel.findOne({ tier, status: 'active' }).session(session);
      if (cycle) {
        cycle.cashBalance = (cycle.cashBalance || 0) + amount;
        await cycle.save({ session });
      }

      logger.info('BetManager deposit', { userId, tier, amount, units, nav });
      return { success: true, message: `₦${amount.toLocaleString()} deposited into ${tier} Bet Manager`, account };
    });
  }

  async getDepositHistory(
    userId: string,
    tier: BetManagerTier,
    page = 1,
    limit = 20,
    options: DepositHistoryQuery = {}
  ): Promise<{ deposits: any[]; total: number; page: number; limit: number }> {
    page = clampInt(page, 1, 1, 10000);
    limit = clampInt(limit, 20, 5, 100);
    const account = await BetManagerAccountModel.findOne({ userId, tier });
    if (!account) return { deposits: [], total: 0, page, limit };

    const query: Record<string, any> = { accountId: account._id };
    if (options.type === 'deposit' || options.type === 'withdrawal') query.type = options.type;
    if (options.status && VALID_DEPOSIT_STATUSES.includes(options.status)) query.status = options.status;

    if (options.from || options.to) {
      const range: Record<string, Date> = {};
      const from = new Date(String(options.from ?? ''));
      if (!isNaN(from.getTime())) range.$gte = from;
      const to = new Date(String(options.to ?? ''));
      if (!isNaN(to.getTime())) range.$lte = new Date(to.getTime() + 86399999);
      if (Object.keys(range).length > 0) query.depositedAt = range;
    }

    if (options.search && options.search.trim()) {
      const term = escapeRegex(options.search.trim().slice(0, 120));
      const amountNum = Number(options.search.trim().replace(/[^\d.-]/g, ''));
      query.$or = [{ reference: { $regex: term, $options: 'i' } }];
      if (Number.isFinite(amountNum) && amountNum > 0) query.$or.push({ amount: amountNum });
    }

    const SORT_FIELDS: Record<string, string> = { depositedAt: 'depositedAt', amount: 'amount' };
    const sortField = SORT_FIELDS[options.sortField || 'depositedAt'] || 'depositedAt';
    const sortOrder: 1 | -1 = options.sortOrder === 'asc' ? 1 : -1;

    const [deposits, total] = await Promise.all([
      BetManagerDepositModel.find(query)
        .sort({ [sortField]: sortOrder })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      BetManagerDepositModel.countDocuments(query),
    ]);
    return { deposits, total, page, limit };
  }

  async getPerformance(userId: string, tier: BetManagerTier): Promise<{
    currentValue: number;
    totalDeposited: number;
    totalProfit: number;
    returnPct: number;
    cycles: Array<{ cycleNumber: number; startDate: Date; endDate: Date; returnPct: number; status: string }>;
  }> {
    const summary = await this.getAccountSummary(userId, tier);
    const totalDeposited = summary.account?.totalDeposited || 0;
    const totalProfit = summary.totalProfit;
    const returnPct = totalDeposited > 0 ? (totalProfit / totalDeposited) * 100 : 0;

    const cycles = await BetManagerCycleModel.find({ tier }).sort({ cycleNumber: -1 }).limit(12).lean();
    const cycleData = cycles.map(c => ({
      cycleNumber: c.cycleNumber,
      startDate: c.startDate,
      endDate: c.endDate,
      returnPct: c.startingNav > 0 && c.endingNav ? ((c.endingNav - c.startingNav) / c.startingNav) * 100 : 0,
      status: c.status,
    }));

    return { currentValue: summary.currentValue, totalDeposited, totalProfit, returnPct, cycles: cycleData };
  }

  async withdraw(userId: string, tier: BetManagerTier): Promise<{ success: boolean; message: string }> {
    return runTransaction(async (session) => {
      const account = await BetManagerAccountModel.findOne({ userId, tier }).session(session);
      if (!account) return { success: false, message: 'Account not found' };

      const unlockedDeposits = await BetManagerDepositModel.find({
        accountId: account._id, type: 'deposit', status: 'unlocked',
      }).session(session);
      if (unlockedDeposits.length === 0) {
        return { success: false, message: 'No unlockable balance available. Deposits are locked for 30 days.' };
      }

      const unlockedUnits = unlockedDeposits.reduce((sum, d) => sum + (d.units || 0), 0);
      const costBasis = unlockedDeposits.reduce((sum, d) => sum + (d.amount || 0), 0);

      const navData = await this.getCurrentNav(tier);
      const poolWalletId = POOL_WALLET_IDS[tier];
      const poolWallet = await WalletModel.findById(poolWalletId).session(session);
      if (!poolWallet) return { success: false, message: 'Insufficient pool liquidity for withdrawal. Try again later.' };

      const withdrawValue = Math.floor(unlockedUnits * navData.nav);
      const withdrawAmount = Math.min(withdrawValue, Math.floor(poolWallet.balance));
      if (withdrawAmount <= 0) return { success: false, message: 'Your unlockable balance is worth ₦0 right now — check back after results settle.' };

      // 20% service charge on profits (deducted at withdrawal)
      const profit = Math.max(0, withdrawAmount - costBasis);
      const serviceCharge = Math.floor(profit * 0.20);
      const netToUser = withdrawAmount - serviceCharge;

      const userWallet = await WalletModel.findOne({ user: userId }).session(session);
      if (!userWallet) return { success: false, message: 'User wallet not found' };

      poolWallet.balance -= netToUser;
      poolWallet.lastTransactionAt = new Date();
      await poolWallet.save({ session });

      userWallet.balance += netToUser;
      userWallet.lastTransactionAt = new Date();
      await userWallet.save({ session });

      await TransactionModel.create([{
        user: userId,
        wallet: userWallet._id,
        type: 'withdrawal',
        status: 'completed',
        amount: withdrawAmount,
        fee: serviceCharge,
        netAmount: netToUser,
        balanceBefore: userWallet.balance - netToUser,
        balanceAfter: userWallet.balance,
        currency: 'NGN',
        reference: `BM_WDR_${userId.slice(-6)}_${Date.now()}`,
        provider: 'internal',
        metadata: { description: `Bet Manager ${tier} withdrawal`, tier, serviceCharge },
      }], { session });

      account.totalWithdrawn += netToUser;
      account.totalProfit += profit - serviceCharge;
      account.units = Math.max(0, account.units - unlockedUnits);
      await account.save({ session });

      await BetManagerDepositModel.updateMany(
        { accountId: account._id, type: 'deposit', status: 'unlocked' },
        { status: 'withdrawn' },
      ).session(session);

      await BetManagerDepositModel.create([{
        userId,
        accountId: account._id,
        type: 'withdrawal',
        amount: netToUser,
        units: 0,
        navAtExecution: navData.nav,
        depositedAt: new Date(),
        withdrawableAt: null,
        status: 'withdrawn',
        reference: `BM_WDR_${userId.slice(-6)}_${Date.now()}`,
      }], { session });

      const cycle = await BetManagerCycleModel.findOne({ tier, status: 'active' }).session(session);
      if (cycle) {
        cycle.cashBalance = Math.max(0, (cycle.cashBalance || 0) - netToUser);
        await cycle.save({ session });
      }

      logger.info('BetManager withdraw', { userId, tier, withdrawAmount, serviceCharge, netToUser });
      return { success: true, message: `₦${netToUser.toLocaleString()} withdrawn from ${tier} Bet Manager (₦${serviceCharge.toLocaleString()} service charge)` };
    });
  }

  async unlockDeposits(): Promise<number> {
    const now = new Date();
    const result = await BetManagerDepositModel.updateMany(
      { type: 'deposit', status: 'locked', withdrawableAt: { $lte: now } },
      { status: 'unlocked' },
    );
    if (result.modifiedCount > 0) {
      logger.info('BetManager deposits unlocked', { count: result.modifiedCount });
    }
    return result.modifiedCount;
  }

  async allocateDaily(): Promise<void> {
    for (const tier of VALID_TIERS) {
      try {
        const cycle = await this.getOrCreateCycle(tier);

        const poolWallet = await WalletModel.findById(POOL_WALLET_IDS[tier]);
        const availableCash = poolWallet?.balance || 0;
        const maxAlloc = Math.floor(availableCash * TIER_CONFIG[tier].maxAllocPct);

        if (maxAlloc < 1000) continue;

        const existingAllocs = await BetManagerAllocationModel.countDocuments({ cycleId: cycle._id, status: 'active' });
        if (existingAllocs >= 10) continue;

        const pods = await PodModel.aggregate([
          {
            $match: {
              status: 'active',
              $expr: { $lt: ['$currentExposure', '$maxTotalExposure'] },
              'metadata.fixtureId': { $exists: true },
              matchDate: { $gte: new Date(), $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
            },
          },
          { $sample: { size: 20 } },
        ]);

        if (pods.length === 0) continue;

        const selected = pods
          .filter(p => {
            const mult = p.gainsMultiplier || 1;
            return mult >= TIER_CONFIG[tier].minMultiplier && mult <= TIER_CONFIG[tier].maxMultiplier;
          })
          .slice(0, 5);

        if (selected.length === 0) continue;

        const allocPerPod = Math.floor(maxAlloc / selected.length);
        const tierPoolWalletId = POOL_WALLET_IDS[tier];
        const now = new Date();

        for (const pod of selected) {
          try {
            if (allocPerPod < (pod.minStake || 100)) continue;
            const stakeAmount = Math.min(allocPerPod, pod.maxStake || allocPerPod);
            const mult = pod.gainsMultiplier || 1;
            const potentialPayout = Math.floor(stakeAmount * mult);
            if (pod.maxPayout && potentialPayout > pod.maxPayout) continue;

            const updatedPod = await PodModel.findOneAndUpdate(
              {
                _id: pod._id,
                status: 'active',
                $expr: { $lte: [{ $add: ['$currentExposure', stakeAmount] }, '$maxTotalExposure'] },
              },
              { $inc: { currentExposure: stakeAmount, currentParticipants: 1 } },
              { new: true }
            );
            if (!updatedPod) continue;

            const wallet = await WalletModel.findOneAndUpdate(
              { _id: tierPoolWalletId, $expr: { $gte: ['$balance', stakeAmount] } },
              { $inc: { balance: -stakeAmount }, $set: { lastTransactionAt: now } },
              { new: true }
            );
            if (!wallet) {
              await PodModel.findByIdAndUpdate(pod._id, { $inc: { currentExposure: -stakeAmount, currentParticipants: -1 } });
              continue;
            }

            const platformFee = Math.floor(potentialPayout * 0.1);
            const netPayout = potentialPayout - platformFee;
            const stake = await StakeModel.create({
              user: tierPoolWalletId,
              pod: pod._id,
              stakeAmount,
              potentialPayout,
              netPayout,
              platformFee,
              feePercent: 10,
              refundPercent: pod.refundPercent || 0,
              refundAmount: Math.floor(stakeAmount * (pod.refundPercent || 0) / 100),
              status: 'confirmed',
              metadata: { betManager: true, tier, cycleNumber: cycle.cycleNumber },
            });

            await TransactionModel.create([{
              user: tierPoolWalletId,
              wallet: tierPoolWalletId,
              type: 'stake',
              status: 'completed',
              amount: stakeAmount,
              fee: 0,
              netAmount: stakeAmount,
              balanceBefore: wallet.balance + stakeAmount,
              balanceAfter: wallet.balance,
              currency: 'NGN',
              reference: `BM_ALLOC_${tier}_${pod._id.toString().slice(-6)}_${Date.now()}`,
              provider: 'internal',
              relatedStake: stake._id,
              relatedPod: pod._id,
              metadata: { description: `Bet Manager ${tier} allocation to pod ${pod.title || pod._id}`, tier, podId: pod._id },
            }]);

            await BetManagerAllocationModel.create({
              cycleId: cycle._id,
              tier,
              stakeId: stake._id,
              podId: pod._id,
              amount: stakeAmount,
              expectedMultiplier: mult,
              status: 'active',
            });

            cycle.totalStaked = (cycle.totalStaked || 0) + stakeAmount;
          } catch (err) {
            logger.error('BetManager per-pod allocation error', { tier, podId: pod._id, error: err });
          }
        }
        await cycle.save();
        logger.info('BetManager daily allocation', { tier, podCount: selected.length, totalAlloc: maxAlloc });
      } catch (err) {
        logger.error(`BetManager allocation failed for ${tier}`, err);
      }
    }
  }

  async reconcileAllocations(): Promise<void> {
    const activeAllocs = await BetManagerAllocationModel.find({ status: 'active' });
    const cycleIds = new Set<string>();

    for (const alloc of activeAllocs) {
      try {
        const stake = await StakeModel.findById(alloc.stakeId);
        if (!stake || ['pending', 'confirmed'].includes(stake.status)) continue;

        let returns = 0;
        let newStatus: string;
        if (stake.status === 'won') {
          returns = stake.netPayout || 0;
          newStatus = 'won';
        } else if (stake.status === 'void' || stake.status === 'refunded') {
          returns = stake.stakeAmount;
          newStatus = 'refunded';
        } else {
          returns = stake.refundAmount || 0;
          newStatus = 'lost';
        }

        alloc.returns = returns;
        alloc.status = newStatus as any;
        alloc.settledAt = new Date();
        await alloc.save();
        cycleIds.add(alloc.cycleId.toString());
      } catch (err) {
        logger.error('BetManager reconcile error', { allocId: alloc._id, error: err });
      }
    }

    for (const cycleId of cycleIds) {
      try {
        const cycle = await BetManagerCycleModel.findById(cycleId);
        if (!cycle) continue;
        const poolWallet = await WalletModel.findById(POOL_WALLET_IDS[cycle.tier]);
        const outstanding = await BetManagerAllocationModel.aggregate([
          { $match: { cycleId: cycle._id, status: 'active' } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);
        cycle.totalStaked = outstanding[0]?.total || 0;
        cycle.cashBalance = poolWallet?.balance || 0;
        await cycle.save();
      } catch (err) {
        logger.error('BetManager cycle sync error', { cycleId, error: err });
      }
    }
  }

  async settleCycle(tier: BetManagerTier): Promise<void> {
    const cycle = await BetManagerCycleModel.findOne({ tier, status: 'active' }).sort({ cycleNumber: -1 });
    if (!cycle || cycle.endDate > new Date()) return;

    const poolWallet = await WalletModel.findById(POOL_WALLET_IDS[tier]);
    const outstanding = await BetManagerAllocationModel.aggregate([
      { $match: { tier, status: 'active' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalValue = (poolWallet?.balance || 0) + (outstanding[0]?.total || 0);
    const totalUnits = await BetManagerAccountModel.aggregate([
      { $match: { tier, status: 'active' } },
      { $group: { _id: null, total: { $sum: '$units' } } },
    ]);
    const units = totalUnits[0]?.total || 0;
    const endingNav = units > 0 ? totalValue / units : cycle.startingNav;
    const netProfit = totalValue - (cycle.startingNav * cycle.startingUnits);

    let performanceFee = 0;
    if (netProfit > 0) {
      performanceFee = Math.floor(netProfit * 0.2);
    }

    const platformFee = TIER_CONFIG[tier].platformFee;

    cycle.endingNav = endingNav;
    cycle.netProfit = netProfit;
    cycle.performanceFee = performanceFee;
    cycle.platformFee = platformFee;
    cycle.feePaid = true;
    cycle.status = 'settled';
    cycle.settledAt = new Date();
    await cycle.save();

    await this.getOrCreateCycle(tier);
    logger.info('BetManager cycle settled', { tier, cycleNumber: cycle.cycleNumber, netProfit, performanceFee });
  }

  async getNavHistory(tier: BetManagerTier): Promise<Array<{ cycleNumber: number; startDate: Date; endDate: Date; startingNav: number; endingNav: number | null; returnPct: number }>> {
    const cycles = await BetManagerCycleModel.find({ tier }).sort({ cycleNumber: -1 }).limit(24).lean();
    return cycles.map(c => ({
      cycleNumber: c.cycleNumber,
      startDate: c.startDate,
      endDate: c.endDate,
      startingNav: c.startingNav,
      endingNav: c.endingNav,
      returnPct: c.startingNav > 0 && c.endingNav ? parseFloat((((c.endingNav - c.startingNav) / c.startingNav) * 100).toFixed(2)) : 0,
    }));
  }

  async getAdminStats(): Promise<{
    totalAccounts: number;
    totalAUM: number;
    feesCollected: number;
    poolBalances: Record<string, number>;
    activeCycles: number;
    accountsByTier: Record<string, number>;
    aumByTier: Record<string, number>;
  }> {
    const tiers: BetManagerTier[] = ['goalkeeper', 'defender', 'midfielder', 'striker'];
    const poolBalances: Record<string, number> = {};
    const accountsByTier: Record<string, number> = {};
    const aumByTier: Record<string, number> = {};
    let totalAUM = 0;

    for (const tier of tiers) {
      const navData = await this.getCurrentNav(tier);
      const wallet = await WalletModel.findById(POOL_WALLET_IDS[tier]);
      poolBalances[tier] = wallet?.balance || 0;
      const count = await BetManagerAccountModel.countDocuments({ tier, status: 'active' });
      accountsByTier[tier] = count;
      const totalUnits = await BetManagerAccountModel.aggregate([
        { $match: { tier, status: 'active' } },
        { $group: { _id: null, total: { $sum: '$units' } } },
      ]);
      const units = totalUnits[0]?.total || 0;
      const aum = units * navData.nav;
      aumByTier[tier] = aum;
      totalAUM += aum;
    }

    const feeResult = await BetManagerCycleModel.aggregate([
      { $match: { status: 'settled' } },
      { $group: { _id: null, total: { $sum: { $add: ['$platformFee', '$performanceFee'] } } } },
    ]);
    const feesCollected = feeResult[0]?.total || 0;
    const activeCycles = await BetManagerCycleModel.countDocuments({ status: 'active' });

    const totalAccounts = await BetManagerAccountModel.countDocuments({ status: 'active' });
    return { totalAccounts, totalAUM, feesCollected, poolBalances, activeCycles, accountsByTier, aumByTier };
  }

  async listAllAccounts(
    page = 1,
    limit = 20,
    tier?: string,
    search?: string,
    from?: string,
    to?: string,
    sortField = 'totalDeposited',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<{ accounts: any[]; total: number; page: number; totalPages: number }> {
    page = clampInt(page, 1, 1, 10000);
    limit = clampInt(limit, 20, 5, 100);
    const match: any = { status: 'active' };
    if (tier && VALID_TIERS.includes(tier as BetManagerTier)) match.tier = tier;

    if (search && search.trim()) {
      const rx = new RegExp(escapeRegex(search.trim().slice(0, 120)), 'i');
      const users = await mongoose.model('User').find({
        $or: [
          { phone: rx },
          { fullName: rx },
        ],
      }).select('_id').lean();
      match.userId = { $in: users.map((u: any) => u._id.toString()) };
    }

    if (from || to) {
      const range: Record<string, Date> = {};
      const fromDate = new Date(String(from ?? ''));
      if (!isNaN(fromDate.getTime())) range.$gte = fromDate;
      const toDate = new Date(String(to ?? ''));
      if (!isNaN(toDate.getTime())) range.$lte = new Date(toDate.getTime() + 86399999);
      if (Object.keys(range).length > 0) match.createdAt = range;
    }

    const SORT_FIELDS: Record<string, string> = {
      createdAt: 'createdAt',
      totalDeposited: 'totalDeposited',
      units: 'units',
    };
    const sf = SORT_FIELDS[String(sortField)] || 'totalDeposited';
    const so: 1 | -1 = sortOrder === 'asc' ? 1 : -1;

    const [accounts, total] = await Promise.all([
      BetManagerAccountModel.find(match)
        .sort({ [sf]: so })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('userId', 'phone fullName email')
        .lean(),
      BetManagerAccountModel.countDocuments(match),
    ]);

    const enriched = await Promise.all(accounts.map(async (a: any) => {
      const navData = await this.getCurrentNav(a.tier);
      const currentValue = a.units * navData.nav;
      return { ...a, currentValue, currentNav: navData.nav };
    }));

    return { accounts: enriched, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  async listAllDeposits(page = 1, limit = 20, tier?: string, userId?: string, status?: string): Promise<{ deposits: any[]; total: number }> {
    page = clampInt(page, 1, 1, 10000);
    limit = clampInt(limit, 20, 5, 100);
    const match: any = {};
    if (tier) match.tier = tier;
    if (userId) match.userId = userId;
    if (status) match.status = status;

    const [deposits, total] = await Promise.all([
      BetManagerDepositModel.find(match)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('userId', 'phone fullName email')
        .lean(),
      BetManagerDepositModel.countDocuments(match),
    ]);
    return { deposits, total };
  }
}

export const betManagerService = new BetManagerService();
