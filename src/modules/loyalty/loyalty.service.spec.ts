import { StakeModel } from '../../models/stake.model';
import { WalletModel } from '../../models/wallet.model';
import { TransactionModel } from '../../models/transaction.model';
import { walletService } from '../../services/wallet.service';
import { createInAppNotification } from '../../services/notification.service';
import { LoyaltyProfileModel } from './loyalty.model';
import { loyaltyService } from './loyalty.service';

jest.mock('../../models/stake.model', () => ({
  StakeModel: { find: jest.fn() },
}));

jest.mock('../../models/wallet.model', () => ({
  WalletModel: { findOneAndUpdate: jest.fn() },
}));

jest.mock('../../models/transaction.model', () => ({
  TransactionModel: { exists: jest.fn(), create: jest.fn() },
}));

jest.mock('../../services/wallet.service', () => ({
  walletService: { getBalance: jest.fn() },
}));

jest.mock('../../services/notification.service', () => ({
  createInAppNotification: jest.fn(),
}));

jest.mock('./loyalty.model', () => ({
  LoyaltyProfileModel: {
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
  },
}));

const stakeFind = StakeModel.find as jest.Mock;
const walletUpdate = WalletModel.findOneAndUpdate as jest.Mock;
const txExists = TransactionModel.exists as jest.Mock;
const txCreate = TransactionModel.create as jest.Mock;
const getBalance = walletService.getBalance as jest.Mock;
const createNotif = createInAppNotification as jest.Mock;
const lpUpsert = LoyaltyProfileModel.findOneAndUpdate as jest.Mock;
const lpFindOne = LoyaltyProfileModel.findOne as jest.Mock;

const stake = {
  _id: { toString: () => 'stake-1' },
  user: { toString: () => 'user-1' },
  stakeAmount: 5000,
  pod: 'pod-1',
} as any;

function recentSettled(statuses: string[]) {
  return statuses.map((status, i) => ({ _id: { toString: () => `s${i}` }, status }));
}

function chainFind(result: any[]) {
  stakeFind.mockReturnValue({
    select: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(result) }),
      }),
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  getBalance.mockResolvedValue({ available: 50_000, totalStaked: 120_000, balance: 50_000 });
  lpUpsert.mockReturnValue({ lean: jest.fn().mockResolvedValue({ points: 250, tier: 'gold', currentStreak: 4, lossStreak: 1, cashbackTotal: 300 }) });
});

describe('LoyaltyService.snapshot', () => {
  it('derives tier from lifetime staked volume and reports progress', async () => {
    const snap = await loyaltyService.snapshot('user-1');

    expect(snap).toMatchObject({
      totalStaked: 120_000,
      tier: 'gold',
      nextTier: 'platinum',
      points: 250,
      cashbackPercent: 2,
      cashbackLossStreak: 3,
    });
  });
});

describe('LoyaltyService.maybeCreditCashback', () => {
  it('credits NGN wallet + transaction with unique CB reference after loss streak', async () => {
    chainFind(recentSettled(['lost', 'lost', 'lost', 'won']));
    txExists.mockResolvedValue(null);
    walletUpdate.mockResolvedValue({ _id: 'wallet-1', balance: 52_100 });
    lpUpsert.mockResolvedValue({ lean: jest.fn() });

    await loyaltyService.maybeCreditCashback(stake);

    expect(walletUpdate).toHaveBeenCalledWith(expect.objectContaining({}), expect.objectContaining({ $inc: { balance: 100 } }), expect.anything());
    expect(txCreate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'bonus',
      reference: 'CB_stake-1',
      amount: 100,
      metadata: expect.objectContaining({ cashback: true }),
    }));
    expect(lpUpsert.mock.calls[0][0]).toEqual({ user: 'user-1' });
    expect(createNotif).toHaveBeenCalledWith('user-1', 'system', 'Cashback credited', expect.any(String), { cashback: true });
  });

  it('is idempotent — skips when the CB reference already exists', async () => {
    txExists.mockResolvedValue({ _id: 'exists' });

    await loyaltyService.maybeCreditCashback(stake);

    expect(walletUpdate).not.toHaveBeenCalled();
    expect(txCreate).not.toHaveBeenCalled();
  });

  it('does nothing on a short loss streak', async () => {
    chainFind(recentSettled(['lost', 'won']));
    txExists.mockResolvedValue(null);

    await loyaltyService.maybeCreditCashback(stake);

    expect(walletUpdate).not.toHaveBeenCalled();
    expect(createNotif).not.toHaveBeenCalled();
  });

  it('skips when the cashback amount is below the minimum', async () => {
    chainFind(recentSettled(['lost', 'lost', 'lost']));
    txExists.mockResolvedValue(null);
    const small = { ...stake, stakeAmount: 100 };

    await loyaltyService.maybeCreditCashback(small);

    expect(walletUpdate).not.toHaveBeenCalled();
  });
});

describe('LoyaltyService.onStakePlaced', () => {
  it('accumulates points and tracks a running streak', async () => {
    const profile = { user: 'user-1', points: 10, currentStreak: 2, lastStakeAt: new Date(Date.now() - 3600_000), tier: 'bronze', save: jest.fn() };
    lpFindOne.mockResolvedValue(profile);

    await loyaltyService.onStakePlaced('user-1', 5000);

    expect(profile.points).toBe(60);
    expect(profile.save).toHaveBeenCalled();
  });
});