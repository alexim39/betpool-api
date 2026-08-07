import { StakeModel } from '../../models/stake.model';
import { BetManagerAccountModel } from '../../models/bet-manager-account.model';
import { BetManagerDepositModel } from '../../models/bet-manager-deposit.model';
import { BetManagerCycleModel } from '../../models/bet-manager-cycle.model';
import { BetManagerAllocationModel } from '../../models/bet-manager-allocation.model';
import { WalletModel } from '../../models/wallet.model';
import { TransactionModel } from '../../models/transaction.model';
import { PodModel } from '../../models/pod.model';
import { betManagerService, POOL_WALLET_IDS } from './bet-manager.service';

jest.mock('../../models/stake.model', () => ({
  StakeModel: { create: jest.fn(), findById: jest.fn() },
}));
jest.mock('../../models/bet-manager-account.model', () => ({
  BetManagerAccountModel: {
    findOne: jest.fn(), find: jest.fn(), create: jest.fn(), aggregate: jest.fn(),
    countDocuments: jest.fn(),
  },
}));
jest.mock('../../models/bet-manager-deposit.model', () => ({
  BetManagerDepositModel: {
    find: jest.fn(), findOne: jest.fn(), create: jest.fn(), updateMany: jest.fn(),
    countDocuments: jest.fn(),
  },
}));
jest.mock('../../models/bet-manager-cycle.model', () => ({
  BetManagerCycleModel: {
    findOne: jest.fn(), findById: jest.fn(), find: jest.fn(), create: jest.fn(),
    aggregate: jest.fn(), countDocuments: jest.fn(),
  },
}));
jest.mock('../../models/bet-manager-allocation.model', () => ({
  BetManagerAllocationModel: { find: jest.fn(), create: jest.fn(), aggregate: jest.fn(), countDocuments: jest.fn() },
}));
jest.mock('../../models/wallet.model', () => ({
  WalletModel: {
    findById: jest.fn(), findOne: jest.fn(), create: jest.fn(), findOneAndUpdate: jest.fn(),
  },
}));
jest.mock('../../models/transaction.model', () => ({
  TransactionModel: { create: jest.fn() },
}));
jest.mock('../../models/pod.model', () => ({
  PodModel: { aggregate: jest.fn(), findOneAndUpdate: jest.fn(), findByIdAndUpdate: jest.fn() },
}));
jest.mock('../../utils/transaction', () => ({
  runTransaction: jest.fn(async (fn: (session: any) => Promise<unknown>) => {
    const session = { commitTransaction: jest.fn(), abortTransaction: jest.fn(), endSession: jest.fn() };
    try {
      return await fn(session);
    } finally {
      session.endSession();
    }
  }),
}));

const stakeCreate = StakeModel.create as jest.Mock;
const stakeFindById = StakeModel.findById as jest.Mock;
const accountFindOne = BetManagerAccountModel.findOne as jest.Mock;
const accountAggregate = BetManagerAccountModel.aggregate as jest.Mock;
const depositFind = BetManagerDepositModel.find as jest.Mock;
const depositUpdateMany = BetManagerDepositModel.updateMany as jest.Mock;
const depositCreate = BetManagerDepositModel.create as jest.Mock;
const depositCount = BetManagerDepositModel.countDocuments as jest.Mock;
const cycleFindOne = BetManagerCycleModel.findOne as jest.Mock;
const cycleFindById = BetManagerCycleModel.findById as jest.Mock;
const allocFind = BetManagerAllocationModel.find as jest.Mock;
const allocCount = BetManagerAllocationModel.countDocuments as jest.Mock;
const allocAggregate = BetManagerAllocationModel.aggregate as jest.Mock;
const allocCreate = BetManagerAllocationModel.create as jest.Mock;
const walletFindById = WalletModel.findById as jest.Mock;
const walletFindOne = WalletModel.findOne as jest.Mock;
const walletFindOneAndUpdate = WalletModel.findOneAndUpdate as jest.Mock;
const podAggregate = PodModel.aggregate as jest.Mock;
const podFindOneAndUpdate = PodModel.findOneAndUpdate as jest.Mock;
const podFindByIdAndUpdate = PodModel.findByIdAndUpdate as jest.Mock;

const activeCycle = (tier: string, cycleNumber = 1, overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => `cycle-${tier}` },
  tier,
  cycleNumber,
  startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
  endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
  startingNav: 1,
  startingUnits: 100,
  cashBalance: 100_000,
  totalStaked: 0,
  status: 'active',
  save: jest.fn(),
  ...overrides,
});

const sortedCycle = (cycle: any) => ({ sort: jest.fn().mockResolvedValue(cycle) });
const sessioned = (value: any) => ({ session: jest.fn().mockResolvedValue(value) });

beforeEach(() => {
  jest.clearAllMocks();
  walletFindById.mockResolvedValue({ _id: POOL_WALLET_IDS.goalkeeper, balance: 100_000, lockedBalance: 0, lastTransactionAt: null, save: jest.fn() });
  accountAggregate.mockResolvedValue([{ _id: null, total: 0 }]);
});

describe('BetManagerService.getCurrentNav', () => {
  it('values the pool as cash + active allocations only (never settled)', async () => {
    walletFindById.mockResolvedValue({ balance: 40_000 });
    cycleFindOne.mockReturnValue(sortedCycle(null));
    allocAggregate.mockResolvedValueOnce([{ _id: null, total: 30_000 }]);
    accountAggregate.mockResolvedValueOnce([{ _id: null, total: 100 }]);

    const nav = await betManagerService.getCurrentNav('goalkeeper');

    expect(allocAggregate).toHaveBeenCalledTimes(1);
    expect((allocAggregate.mock.calls[0][0] as any[])[0].$match.status).toBe('active');
    expect(nav).toEqual({ nav: 700, totalValue: 70_000, units: 100 });
  });
});

describe('BetManagerService.allocateDaily', () => {
  it('creates real stakes owned by the tier pool wallet and tracks allocation exposure', async () => {
    const cycle = activeCycle('goalkeeper');
    cycleFindOne.mockReturnValue(sortedCycle(cycle));
    allocCount.mockResolvedValueOnce(0);
    podAggregate.mockResolvedValueOnce([
      {
        _id: 'pod-1', title: 'Pod A', gainsMultiplier: 1.4, minStake: 500, maxStake: 50_000,
        maxPayout: 500_000, currentExposure: 0, maxTotalExposure: 200_000, refundPercent: 10, status: 'active',
      },
    ]);
    podFindOneAndUpdate.mockResolvedValueOnce({ _id: 'pod-1' });
    walletFindOneAndUpdate.mockResolvedValueOnce({ balance: 60_000 });
    stakeCreate.mockResolvedValueOnce({ _id: 'stake-1' });
    allocCreate.mockResolvedValueOnce({});

    await betManagerService.allocateDaily();

    expect(allocCount).toHaveBeenCalledWith({ cycleId: expect.anything(), status: 'active' });
    expect(stakeCreate).toHaveBeenCalledWith(expect.objectContaining({
      user: POOL_WALLET_IDS.goalkeeper,
      pod: 'pod-1',
      metadata: { betManager: true, tier: 'goalkeeper', cycleNumber: 1 },
    }));
    expect(podFindOneAndUpdate.mock.calls[0][1]).toEqual({ $inc: { currentExposure: expect.any(Number), currentParticipants: 1 } });
    expect(allocCreate).toHaveBeenCalledWith(expect.objectContaining({ stakeId: 'stake-1', status: 'active' }));
    expect(walletFindOneAndUpdate.mock.calls[0][1]).toEqual({ $inc: { balance: expect.any(Number) }, $set: { lastTransactionAt: expect.any(Date) } });
    expect(cycle.save).toHaveBeenCalled();
  });

  it('skips pods outside the tier multiplier band', async () => {
    cycleFindOne.mockReturnValue(sortedCycle(activeCycle('goalkeeper')));
    allocCount.mockResolvedValueOnce(0);
    podAggregate.mockResolvedValueOnce([
      { _id: 'pod-x', gainsMultiplier: 4.0, minStake: 100, maxStake: 50_000, status: 'active' },
    ]);

    await betManagerService.allocateDaily();

    expect(stakeCreate).not.toHaveBeenCalled();
    expect(allocCreate).not.toHaveBeenCalled();
  });

  it('skips tiers with insufficient pool cash', async () => {
    cycleFindOne.mockReturnValue(sortedCycle(activeCycle('goalkeeper')));
    walletFindById.mockResolvedValue({ balance: 500 });

    await betManagerService.allocateDaily();

    expect(podAggregate).not.toHaveBeenCalled();
    expect(stakeCreate).not.toHaveBeenCalled();
  });

  it('rolls back pod exposure when the pool wallet lacks funds for a stake', async () => {
    cycleFindOne.mockReturnValue(sortedCycle(activeCycle('goalkeeper')));
    allocCount.mockResolvedValueOnce(0);
    podAggregate.mockResolvedValueOnce([
      { _id: 'pod-1', gainsMultiplier: 1.3, minStake: 100, maxStake: 100_000, status: 'active' },
    ]);
    podFindOneAndUpdate.mockResolvedValueOnce({ _id: 'pod-1' });
    walletFindOneAndUpdate.mockResolvedValueOnce(null);

    await betManagerService.allocateDaily();

    expect(podFindByIdAndUpdate).toHaveBeenCalledWith('pod-1', { $inc: { currentExposure: expect.any(Number), currentParticipants: -1 } });
    expect(stakeCreate).not.toHaveBeenCalled();
    expect(allocCreate).not.toHaveBeenCalled();
  });
});

describe('BetManagerService.reconcileAllocations', () => {
  const alloc = () => ({ cycleId: { toString: () => 'cycle-1' }, status: 'active', returns: 0, save: jest.fn() });

  it('maps won stakes to net payout, voids to stake amount and lost to refund, then syncs the cycle', async () => {
    const allocs = [alloc(), alloc(), alloc()];
    allocFind.mockResolvedValueOnce(allocs);
    stakeFindById
      .mockResolvedValueOnce({ status: 'won', netPayout: 12_000 })
      .mockResolvedValueOnce({ status: 'void', stakeAmount: 8_000 })
      .mockResolvedValueOnce({ status: 'lost', stakeAmount: 8_000, refundAmount: 400 });

    const cycle = activeCycle('goalkeeper');
    cycleFindById.mockResolvedValueOnce(cycle);
    allocAggregate.mockResolvedValueOnce([{ _id: null, total: 8_000 }]);

    await betManagerService.reconcileAllocations();

    expect(allocs[0].status).toBe('won');
    expect(allocs[0].returns).toBe(12_000);
    expect(allocs[1].status).toBe('refunded');
    expect(allocs[1].returns).toBe(8_000);
    expect(allocs[2].status).toBe('lost');
    expect(allocs[2].returns).toBe(400);
    expect(allocs[0].save).toHaveBeenCalled();
    expect(cycle.totalStaked).toBe(8_000);
    expect(cycle.cashBalance).toBe(100_000);
    expect(cycle.save).toHaveBeenCalled();
  });

  it('keeps pending and confirmed stakes outstanding (no settlement yet)', async () => {
    const allocs = [alloc()];
    allocFind.mockResolvedValueOnce(allocs);
    stakeFindById.mockResolvedValueOnce({ status: 'confirmed' });

    await betManagerService.reconcileAllocations();

    expect(allocs[0].status).toBe('active');
    expect(allocs[0].save).not.toHaveBeenCalled();
    expect(cycleFindById).not.toHaveBeenCalled();
  });
});

describe('BetManagerService.withdraw', () => {
  it('redeems only unlocked deposits and deducts a 20% service charge on profit', async () => {
    accountFindOne.mockReturnValue(sessioned({
      _id: 'account-1',
      tier: 'goalkeeper',
      units: 100,
      totalDeposited: 20_000,
      totalWithdrawn: 0,
      totalProfit: 0,
      save: jest.fn(),
    }));
    depositFind.mockReturnValue(sessioned([
      { units: 25, amount: 20_000, status: 'unlocked' },
    ]));
    walletFindById.mockReturnValue({
      _id: POOL_WALLET_IDS.goalkeeper,
      balance: 100_000,
      lastTransactionAt: null,
      save: jest.fn(),
      session: jest.fn().mockResolvedValue({ _id: POOL_WALLET_IDS.goalkeeper, balance: 100_000, lastTransactionAt: null, save: jest.fn() }),
    });
    walletFindOne.mockReturnValue(sessioned({ _id: 'user-wallet', balance: 5_000, lastTransactionAt: null, save: jest.fn() }));
    depositUpdateMany.mockReturnValue(sessioned({ modifiedCount: 1 }));
    depositCreate.mockResolvedValueOnce({});
    allocAggregate.mockResolvedValueOnce([{ _id: null, total: 0 }]);
    accountAggregate.mockResolvedValueOnce([{ _id: null, total: 100 }]);
    const cycle = { ...activeCycle('goalkeeper'), cashBalance: 100_000 };
    cycleFindOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(cycle), session: jest.fn().mockResolvedValue(cycle) });

    const result = await betManagerService.withdraw('user-1', 'goalkeeper');

    expect(result.success).toBe(true);
    expect(depositUpdateMany).toHaveBeenCalledWith(
      { accountId: 'account-1', type: 'deposit', status: 'unlocked' },
      { status: 'withdrawn' },
    );
    expect(depositCreate.mock.calls[0][0]).toEqual([expect.objectContaining({ type: 'withdrawal', status: 'withdrawn' })]);
    const tx = (TransactionModel.create as jest.Mock).mock.calls[0][0][0];
    expect(tx.reference).toMatch(/^BM_WDR_/);
    expect(tx.fee).toBeGreaterThan(0);
  });

  it('rejects withdrawal when nothing is unlocked yet', async () => {
    accountFindOne.mockReturnValue(sessioned({ _id: 'account-1' }));
    depositFind.mockReturnValue(sessioned([]));

    const result = await betManagerService.withdraw('user-1', 'goalkeeper');

    expect(result.success).toBe(false);
    expect(walletFindById).not.toHaveBeenCalled();
  });
});

describe('BetManagerService.settleCycle', () => {
  it('includes outstanding active allocations in the total value and charges 20% performance fee on profit', async () => {
    const settled: any = activeCycle('goalkeeper', 1, { endDate: new Date(Date.now() - 1000) });
    cycleFindOne.mockReturnValue(sortedCycle(settled));
    walletFindById.mockResolvedValue({ balance: 30_000 });
    allocAggregate.mockResolvedValueOnce([{ _id: null, total: 40_000 }]);
    accountAggregate.mockResolvedValueOnce([{ _id: null, total: 100 }]);

    await betManagerService.settleCycle('goalkeeper');

    expect(settled.status).toBe('settled');
    expect(settled.endingNav).toBe(700);
    expect(settled.netProfit).toBe(69_900);
    expect(settled.performanceFee).toBe(13_980);
    expect(settled.save).toHaveBeenCalled();
  });
});

describe('BetManagerService.getDepositHistory', () => {
  const chain = (resolved: any) => {
    const m: any = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(resolved),
    };
    return m;
  };

  it('clamps page/limit, filters by type/status/date-range and escapes search regex', async () => {
    accountFindOne.mockResolvedValueOnce({ _id: 'account-1' });
    depositFind.mockReturnValue(chain([{ amount: 20_000 }]));
    depositCount.mockResolvedValueOnce(3);

    const result = await betManagerService.getDepositHistory('user-1', 'goalkeeper', 99_999, 999, {
      type: 'deposit',
      status: 'locked',
      from: '2026-01-01',
      search: 'a.b (c)?',
    });

    expect(depositFind.mock.calls[0][0]).toMatchObject({ accountId: 'account-1', type: 'deposit', status: 'locked' });
    expect(depositFind.mock.calls[0][0].depositedAt.$gte).toBeInstanceOf(Date);
    expect(depositFind.mock.calls[0][0].$or[0].reference.$regex).toBe('a\\.b \\(c\\)\\?');
    expect(result.total).toBe(3);
    expect(result.page).toBe(10_000);
    expect(result.limit).toBe(100);
  });

  it('rejects unknown sort fields and invalid statuses', async () => {
    accountFindOne.mockResolvedValueOnce({ _id: 'account-1' });
    depositFind.mockReturnValue(chain([]));
    depositCount.mockResolvedValueOnce(0);

    await betManagerService.getDepositHistory('user-1', 'goalkeeper', 1, 20, {
      status: 'hacked', sortField: 'reference;drop',
    });

    const query = depositFind.mock.calls[0][0];
    expect(query.status).toBeUndefined();
    expect(depositFind.mock.results[0].value.sort).toHaveBeenCalledWith({ depositedAt: -1 });
  });
});
