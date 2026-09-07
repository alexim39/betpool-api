import mongoose from 'mongoose';
import { AdminService } from './admin.service';

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    startSession: jest.fn(),
  };
});

jest.mock('../../models/pod.model', () => ({
  PodModel: { findById: jest.fn(), findByIdAndUpdate: jest.fn() },
}));
jest.mock('../../models/user.model', () => ({ UserModel: {} }));
jest.mock('../../models/stake.model', () => ({
  StakeModel: { findById: jest.fn() },
}));
jest.mock('../../models/wallet.model', () => ({
  WalletModel: { findOne: jest.fn() },
}));
jest.mock('../../models/transaction.model', () => ({
  TransactionModel: { create: jest.fn(), deleteOne: jest.fn() },
}));
jest.mock('./loan.model', () => ({ LoanModel: {} }));
jest.mock('./settings.model', () => ({ SettingsModel: {} }));
jest.mock('../../services/cache.service', () => ({ cacheService: { get: jest.fn(), set: jest.fn(), clear: jest.fn() } }));
jest.mock('../../services/notification.service', () => ({
  notifyWithdrawalCompleted: jest.fn(),
  notifyWithdrawalFailed: jest.fn(),
  notifyKycApproved: jest.fn(),
  createInAppNotification: jest.fn(),
}));
jest.mock('../../services/wallet.service', () => ({ walletService: {} }));
jest.mock('../staking/stake.service', () => ({ stakeService: {} }));
jest.mock('../../services/pick-outcome.service', () => ({ pickOutcomeService: { recordPodSettlement: jest.fn() } }));

import { StakeModel } from '../../models/stake.model';
import { WalletModel } from '../../models/wallet.model';
import { TransactionModel } from '../../models/transaction.model';
import { PodModel } from '../../models/pod.model';

const stakeFindById = StakeModel.findById as jest.Mock;
const walletFindOne = WalletModel.findOne as jest.Mock;
const txCreate = TransactionModel.create as jest.Mock;
const podFindByIdAndUpdate = PodModel.findByIdAndUpdate as jest.Mock;
const startSession = mongoose.startSession as jest.Mock;

const ADMIN_ID = '000000000000000000000001';

const fakeSession = () => ({
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  abortTransaction: jest.fn(),
  endSession: jest.fn(),
});

const leg = (status: string, gainsMultiplier = 2.0, pod = 'pod-a') => ({
  pod,
  homeTeam: 'H',
  awayTeam: 'A',
  selection: 'X',
  gainsMultiplier,
  status,
});

function stakeDoc(items: any[], overrides: Record<string, unknown> = {}) {
  return {
    _id: 'stake-1',
    user: 'user-1',
    isParlay: true,
    items,
    stakeAmount: 1000,
    netPayout: 5000,
    platformFee: 500,
    combinedMultiplier: 6.0,
    status: 'confirmed',
    save: jest.fn().mockResolvedValue(undefined),
    markModified: jest.fn(),
    ...overrides,
  };
}

function walletDoc(balance = 0) {
  return { _id: 'wallet-1', balance, totalWon: 0, lastTransactionAt: null, save: jest.fn().mockResolvedValue(undefined) };
}

function wireFinders(stake: any, wallet: any) {
  stakeFindById.mockImplementation(() => ({
    session: () => Promise.resolve(stake),
    populate: () => ({ populate: () => Promise.resolve({ ...stake, status: stake.status }) }),
  }));
  walletFindOne.mockReturnValue({ session: () => Promise.resolve(wallet) });
  podFindByIdAndUpdate.mockReturnValue({ session: () => Promise.resolve({}) });
}

describe('AdminService.settleStakeLeg', () => {
  let service: AdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminService();
    startSession.mockResolvedValue(fakeSession());
    txCreate.mockResolvedValue([]);
  });

  it('pays the reduced accumulator (never a loss) for a won+void mix — Alex Imenwo scenario', async () => {
    const stake = stakeDoc([leg('won', 2.0), leg('pending', 1.5)]);
    const wallet = walletDoc(0);
    wireFinders(stake, wallet);

    const out: any = await service.settleStakeLeg('stake-1', 1, 'void', ADMIN_ID);

    expect(stake.items[1].status).toBe('void');
    expect(out.status).toBe('won');
    // reduced: floor(1000 * 2.0) = 2000 payout, 200 fee, 1800 net
    expect(wallet.balance).toBe(1800);
    expect(wallet.totalWon).toBe(1800);
    expect(txCreate).toHaveBeenCalled();
    const txArg = txCreate.mock.calls[0][0][0];
    expect(txArg.type).toBe('payout');
    expect(txArg.fee).toBe(200);
    // pool exposure released per leg pod
    expect(podFindByIdAndUpdate).toHaveBeenCalledTimes(2);
    expect(podFindByIdAndUpdate.mock.calls[0][1]).toEqual({ $inc: { currentExposure: -1000 } });
  });

  it('applies lucky-loser insurance when exactly one leg lost on a 5-leg slip', async () => {
    const stake = stakeDoc([leg('won', 2.0), leg('won', 1.5), leg('won', 1.8), leg('pending', 1.4), leg('void', 1.6)]);
    const wallet = walletDoc(0);
    wireFinders(stake, wallet);

    const out: any = await service.settleStakeLeg('stake-1', 3, 'loss', ADMIN_ID);

    expect(out.status).toBe('won');
    expect(out.insuranceApplied).toBe(true);
    // reduced on winners: floor(1000 * 2.0*1.5*1.8) = 5400, fee 540, net 4860
    expect(wallet.balance).toBe(4860);
  });

  it('marks lost with zero payout on multiple lost legs (no insurance)', async () => {
    const stake = stakeDoc([leg('won', 2.0), leg('pending', 1.5), leg('pending', 1.8)]);
    const wallet = walletDoc(0);
    // settle both pending legs as lost through two calls
    wireFinders(stake, wallet);

    await service.settleStakeLeg('stake-1', 1, 'loss', ADMIN_ID);
    const out: any = await service.settleStakeLeg('stake-1', 2, 'loss', ADMIN_ID);

    expect(out.status).toBe('lost');
    expect(wallet.balance).toBe(0);
  });

  it('refunds the stake when every leg is void', async () => {
    const stake = stakeDoc([leg('void', 2.0), leg('pending', 1.5)]);
    const wallet = walletDoc(100);
    wireFinders(stake, wallet);

    const out: any = await service.settleStakeLeg('stake-1', 1, 'void', ADMIN_ID);

    expect(out.status).toBe('void');
    expect(wallet.balance).toBe(1100);
  });
});
