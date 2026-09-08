import mongoose from 'mongoose';
import { stakeService } from './stake.service';

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { ...actual, startSession: jest.fn(), default: actual };
});

jest.mock('../../models/stake.model', () => ({
  StakeModel: { create: jest.fn(), findOne: jest.fn() },
}));
jest.mock('../../models/pod.model', () => ({
  PodModel: { find: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn() },
}));
jest.mock('../../models/wallet.model', () => ({
  WalletModel: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));
jest.mock('../../models/transaction.model', () => ({
  TransactionModel: { create: jest.fn() },
}));
jest.mock('../../models/booking-code.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../../models/game-analysis.model', () => ({
  GameAnalysisModel: { findOne: jest.fn() },
}));
jest.mock('../../services/wallet.service', () => ({ walletService: {} }));
jest.mock('../../services/notification.service', () => ({
  notifyStakePlaced: jest.fn().mockResolvedValue(undefined),
  notifyStakeWon: jest.fn(),
  notifyStakeLost: jest.fn(),
  notifyStakeCashedOut: jest.fn(),
  createInAppNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/user.service', () => ({
  userService: {
    getUserById: jest.fn().mockResolvedValue(null),
    payReferralBonusOnStake: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../abtest/abtest.service', () => ({
  abtestService: { recordEvent: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../loyalty/loyalty.service', () => ({
  loyaltyService: { onStakePlaced: jest.fn().mockResolvedValue(undefined), maybeCreditCashback: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../coaching/coaching.service', () => ({
  coachingService: { flagIfHighRisk: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../social/social.service', () => ({
  socialService: { recordActivity: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../services/cache.service', () => ({
  cacheService: { get: jest.fn(), set: jest.fn(), clear: jest.fn() },
}));
jest.mock('../ai/ai-games.service', () => ({
  GAME_LIVE_STATUSES: [],
}));
jest.mock('./booking-code.service', () => ({
  getMaxAccumulatorLegs: jest.fn().mockReturnValue(5),
  getMaxBookingCodeLegs: jest.fn().mockReturnValue(30),
}));

import { StakeModel } from '../../models/stake.model';
import { PodModel } from '../../models/pod.model';
import { WalletModel } from '../../models/wallet.model';
import { TransactionModel } from '../../models/transaction.model';
import BookingCodeModel from '../../models/booking-code.model';
import { socialService } from '../social/social.service';

const STAKER = '000000000000000000000011';
const CREATOR = '000000000000000000000022';

const session = {
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  abortTransaction: jest.fn(),
  endSession: jest.fn(),
};

function mockPods() {
  const pods = [1, 2].map(n => ({
    _id: `pod-${n}`,
    homeTeam: `Home${n}`,
    awayTeam: `Away${n}`,
    league: 'Test League',
    selection: n === 1 ? 'Home Win' : 'Over 1.5',
    gainsMultiplier: 1.5,
    minStake: 100,
    maxStake: 50000,
    maxTotalExposure: 1000000,
    currentExposure: 0,
    status: 'active',
    isLive: false,
    matchDate: new Date(Date.now() + 86400000),
    opensAt: new Date(Date.now() - 3600000),
    stakingClosesAt: new Date(Date.now() + 3600000),
    bookedExternally: false,
  }));
  (PodModel.find as jest.Mock).mockReturnValue({
    session: jest.fn().mockResolvedValue(pods),
  });
  (PodModel.findOneAndUpdate as jest.Mock).mockImplementation((filter: any) => Promise.resolve({ _id: filter._id }));
}

function mockWallet(balance = 100000) {
  (WalletModel.findOneAndUpdate as jest.Mock).mockResolvedValue({
    _id: 'wallet-1',
    balance: balance - 1000,
    save: jest.fn(),
  });
}

function mockBooking(ownerId: string | null) {
  mockBookingDoc(
    ownerId === null
      ? null
      : {
          code: 'ABC123',
          userId: ownerId,
          podIds: ['pod-1', 'pod-2'],
          expiresAt: new Date(Date.now() + 86400000),
        }
  );
}

function mockBookingDoc(doc: any) {
  (BookingCodeModel.findOne as jest.Mock).mockReturnValue({
    lean: jest.fn().mockResolvedValue(doc),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (mongoose.startSession as jest.Mock).mockResolvedValue(session);
  (StakeModel.findOne as jest.Mock).mockResolvedValue(null);
  (StakeModel.create as jest.Mock).mockImplementation((docs: any[]) => Promise.resolve([{ _id: 'stake-1', ...docs[0] }]));
  (TransactionModel.create as jest.Mock).mockResolvedValue([]);
  mockPods();
  mockWallet();
});

describe('placeAccumulator copy attribution (stake.creatorId)', () => {
  it("stores the code owner's id when copying another creator's code", async () => {
    mockBooking(CREATOR);

    await stakeService.placeAccumulator({ userId: STAKER, podIds: ['pod-1', 'pod-2'], stakeAmount: 1000, bookingCode: 'abc123' });

    const created = (StakeModel.create as jest.Mock).mock.calls[0][0][0];
    expect(String(created.creatorId)).toBe(CREATOR);
    expect(created.bookingCode).toBe('ABC123');
    // post-commit activity uses the same resolved creator (single source)
    expect(socialService.recordActivity).toHaveBeenCalledWith(
      STAKER,
      'staked_on_code',
      undefined,
      expect.objectContaining({ code: 'ABC123', creatorId: CREATOR })
    );
  });

  it('stores no creatorId on self-copies and records no copy activity', async () => {
    mockBooking(STAKER);

    await stakeService.placeAccumulator({ userId: STAKER, podIds: ['pod-1', 'pod-2'], stakeAmount: 1000, bookingCode: 'ABC123' });

    const created = (StakeModel.create as jest.Mock).mock.calls[0][0][0];
    expect(created.creatorId).toBeUndefined();
    expect(socialService.recordActivity).not.toHaveBeenCalled();
  });

  it('stores no creatorId on organic stakes without a code', async () => {
    await stakeService.placeAccumulator({ userId: STAKER, podIds: ['pod-1', 'pod-2'], stakeAmount: 1000 });

    const created = (StakeModel.create as jest.Mock).mock.calls[0][0][0];
    expect(created.creatorId).toBeUndefined();
    expect(BookingCodeModel.findOne).not.toHaveBeenCalled();
  });

  it('still rejects unknown and expired codes exactly as before', async () => {
    mockBookingDoc(null);
    await expect(
      stakeService.placeAccumulator({ userId: STAKER, podIds: ['pod-1', 'pod-2'], stakeAmount: 1000, bookingCode: 'NOPE12' })
    ).rejects.toThrow('Booking code not found');

    mockBookingDoc({
      code: 'OLD123',
      userId: CREATOR,
      podIds: ['pod-1', 'pod-2'],
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      stakeService.placeAccumulator({ userId: STAKER, podIds: ['pod-1', 'pod-2'], stakeAmount: 1000, bookingCode: 'OLD123' })
    ).rejects.toThrow('Booking code has expired');
  });
});
