import mongoose from 'mongoose';
import { BetManagerAccountModel, IBetManagerAccount, BetManagerTier } from '../../models/bet-manager-account.model';
import { BetManagerDepositModel, IBetManagerDeposit } from '../../models/bet-manager-deposit.model';
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

const POOL_WALLET_IDS: Record<BetManagerTier, mongoose.Types.ObjectId> = {
  goalkeeper: new mongoose.Types.ObjectId('000000000000000000000004'),
  defender: new mongoose.Types.ObjectId('000000000000000000000001'),
  midfielder: new mongoose.Types.ObjectId('000000000000000000000002'),
  striker: new mongoose.Types.ObjectId('000000000000000000000003'),
};

export class BetManagerService {
  private async getOrCreatePoolWallet(tier: BetManagerTier): Promise<mongoose.Types.ObjectId> {
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
      { $match: { tier, status: { $ne: 'settled' } } },
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

  async getDepositHistory(userId: string, tier: BetManagerTier, page = 1, limit = 20): Promise<{ deposits: IBetManagerDeposit[]; total: number }> {
    const account = await BetManagerAccountModel.findOne({ userId, tier });
    if (!account) return { deposits: [], total: 0 };
    const query = { accountId: account._id };
    const [deposits, total] = await Promise.all([
      BetManagerDepositModel.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean() as unknown as Promise<IBetManagerDeposit[]>,
      BetManagerDepositModel.countDocuments(query),
    ]);
    return { deposits, total };
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
      const summary = await this.getAccountSummary(userId, tier);
      if (summary.unlockedBalance <= 0) return { success: false, message: 'No unlockable balance available. Deposits are locked for 30 days.' };

      const poolWalletId = POOL_WALLET_IDS[tier];
      const poolWallet = await WalletModel.findById(poolWalletId).session(session);
      if (!poolWallet || poolWallet.balance < summary.unlockedBalance) return { success: false, message: 'Insufficient pool liquidity for withdrawal. Try again later.' };

      const account = await BetManagerAccountModel.findOne({ userId, tier }).session(session);
      if (!account) return { success: false, message: 'Account not found' };

      const navData = await this.getCurrentNav(tier);
      const withdrawValue = account.units * navData.nav;
      const withdrawAmount = Math.min(withdrawValue, poolWallet.balance);

      // 20% service charge on profits (deducted at withdrawal)
      const costBasis = account.totalDeposited;
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
      account.units = 0;
      await account.save({ session });

      await BetManagerDepositModel.updateMany(
        { accountId: account._id, status: { $in: ['locked', 'unlocked'] } },
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
      }], { session });

      const cycle = await BetManagerCycleModel.findOne({ tier, status: 'active' }).session(session);
      if (cycle) {
        cycle.cashBalance = (cycle.cashBalance || 0) - netToUser;
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
    const tiers: BetManagerTier[] = ['goalkeeper', 'defender', 'midfielder', 'striker'];
    for (const tier of tiers) {
      try {
        const cycle = await BetManagerCycleModel.findOne({ tier, status: 'active' }).sort({ cycleNumber: -1 });
        if (!cycle) continue;

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
              currentExposure: { $lt: '$maxExposure' },
              'metadata.fixtureId': { $exists: true },
              matchDate: { $gte: new Date(), $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
            },
          },
          { $sample: { size: 20 } },
        ]);

        if (pods.length === 0) continue;

        const selected = pods
          .filter(p => {
            const mult = p.maxPayout && p.minStake ? p.maxPayout / p.minStake : 1;
            return mult >= TIER_CONFIG[tier].minMultiplier && mult <= TIER_CONFIG[tier].maxMultiplier;
          })
          .slice(0, 5);

        if (selected.length === 0) continue;

        const allocPerPod = Math.floor(maxAlloc / selected.length);
        const tierPoolWalletId = POOL_WALLET_IDS[tier];

        for (const pod of selected) {
          const mult = pod.maxPayout && pod.minStake ? pod.maxPayout / pod.minStake : 1;
          const reference = `BM_ALLOC_${tier}_${pod._id.toString().slice(-6)}_${Date.now()}`;

          await TransactionModel.create([{
            user: tierPoolWalletId,
            wallet: tierPoolWalletId,
            type: 'stake',
            status: 'completed',
            amount: allocPerPod,
            fee: 0,
            netAmount: allocPerPod,
            balanceBefore: poolWallet!.balance,
            balanceAfter: poolWallet!.balance - allocPerPod,
            currency: 'NGN',
            reference,
            provider: 'internal',
            metadata: { description: `Bet Manager ${tier} allocation to pod ${pod.title || pod._id}`, tier, podId: pod._id },
          }]);

          poolWallet!.balance -= allocPerPod;
          await poolWallet!.save();

          await BetManagerAllocationModel.create({
            cycleId: cycle._id,
            tier,
            stakeId: new mongoose.Types.ObjectId(),
            podId: pod._id,
            amount: allocPerPod,
            expectedMultiplier: mult,
            status: 'active',
          });

          cycle.totalStaked = (cycle.totalStaked || 0) + allocPerPod;
        }
        await cycle.save();
        logger.info('BetManager daily allocation', { tier, podCount: selected.length, totalAlloc: maxAlloc });
      } catch (err) {
        logger.error(`BetManager allocation failed for ${tier}`, err);
      }
    }
  }

  async reconcileAllocations(): Promise<void> {
    const activeAllocs = await BetManagerAllocationModel.find({ status: 'active' }).populate('podId');
    for (const alloc of activeAllocs) {
      try {
        const pod = alloc.podId as any;
        if (!pod || pod.status === 'active' || pod.status === 'published') continue;

        const tierPoolWalletId = POOL_WALLET_IDS[alloc.tier];
        const poolWallet = await WalletModel.findById(tierPoolWalletId);
        if (!poolWallet) continue;

        let returns = 0;
        let newStatus: string;

        if (pod.status === 'cancelled' || pod.settlementStatus === 'void') {
          returns = alloc.amount;
          newStatus = 'refunded';
        } else if (pod.settlementStatus === 'settled') {
          const payout = Math.floor(alloc.amount * alloc.expectedMultiplier);
          returns = payout;
          newStatus = 'won';
        } else {
          returns = 0;
          newStatus = 'lost';
        }

        poolWallet.balance += returns;
        poolWallet.lastTransactionAt = new Date();
        await poolWallet.save();

        alloc.returns = returns;
        alloc.status = newStatus as any;
        alloc.settledAt = new Date();
        await alloc.save();

        const cycle = await BetManagerCycleModel.findById(alloc.cycleId);
        if (cycle) {
          cycle.totalStaked = (cycle.totalStaked || 0) - alloc.amount;
          cycle.cashBalance = (cycle.cashBalance || 0) + returns;
          await cycle.save();
        }
      } catch (err) {
        logger.error('BetManager reconcile error', { allocId: alloc._id, error: err });
      }
    }
  }

  async settleCycle(tier: BetManagerTier): Promise<void> {
    const cycle = await BetManagerCycleModel.findOne({ tier, status: 'active' }).sort({ cycleNumber: -1 });
    if (!cycle || cycle.endDate > new Date()) return;

    const poolWallet = await WalletModel.findById(POOL_WALLET_IDS[tier]);
    const totalValue = poolWallet?.balance || 0;
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

  async listAllAccounts(page = 1, limit = 20, tier?: string, search?: string): Promise<{ accounts: any[]; total: number; page: number; totalPages: number }> {
    const match: any = { status: 'active' };
    if (tier && ['goalkeeper', 'defender', 'midfielder', 'striker'].includes(tier)) match.tier = tier;

    let userIds: string[] | undefined;
    if (search) {
      const users = await mongoose.model('User').find({
        $or: [
          { phone: { $regex: search, $options: 'i' } },
          { fullName: { $regex: search, $options: 'i' } },
        ],
      }).select('_id').lean();
      userIds = users.map((u: any) => u._id.toString());
      match.userId = { $in: userIds };
    }

    const [accounts, total] = await Promise.all([
      BetManagerAccountModel.find(match)
        .sort({ totalDeposited: -1 })
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

    return { accounts: enriched, total, page, totalPages: Math.ceil(total / limit) };
  }

  async listAllDeposits(page = 1, limit = 20, tier?: string, userId?: string, status?: string): Promise<{ deposits: any[]; total: number }> {
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
