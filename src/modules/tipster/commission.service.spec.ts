import mongoose from 'mongoose';
import { commissionService, minPayout } from './commission.service';

jest.mock('../../models/stake.model', () => ({
  StakeModel: {
    aggregate: jest.fn(),
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
    })
  },
}));
jest.mock('../../models/wallet.model', () => ({
  WalletModel: { findOneAndUpdate: jest.fn() },
}));
jest.mock('../../models/transaction.model', () => ({
  TransactionModel: { create: jest.fn() },
}));
jest.mock('../../models/creator-commission.model', () => ({
  CreatorCommissionModel: {
    bulkWrite: jest.fn(),
    aggregate: jest.fn(),
    find: jest.fn().mockReturnValue({ session: jest.fn().mockResolvedValue([]) })
  },
}));
jest.mock('../../models/tipster-badge.model', () => ({
  TipsterBadgeModel: { findOne: jest.fn(), find: jest.fn() },
}));
jest.mock('../../services/notification.service', () => ({
  createInAppNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/transaction', () => ({
  runTransaction: jest.fn(async (fn: (session: any) => Promise<unknown>) => {
    const session = {};
    return fn(session);
  }),
}));

import { StakeModel } from '../../models/stake.model';
import { WalletModel } from '../../models/wallet.model';
import { TransactionModel } from '../../models/transaction.model';
import { CreatorCommissionModel } from '../../models/creator-commission.model';
import { TipsterBadgeModel } from '../../models/tipster-badge.model';

const stakeAgg = StakeModel.aggregate as jest.Mock;
const walletFindOneAndUpdate = WalletModel.findOneAndUpdate as jest.Mock;
const txCreate = TransactionModel.create as jest.Mock;
const commissionBulkWrite = CreatorCommissionModel.bulkWrite as jest.Mock;
const commissionAgg = CreatorCommissionModel.aggregate as jest.Mock;
const commissionFind = CreatorCommissionModel.find as jest.Mock;
const badgeFindOne = TipsterBadgeModel.findOne as jest.Mock;
const badgeFind = TipsterBadgeModel.find as jest.Mock;

const PRO_BADGE_DOC = {
  user: '507f1f77bcf86cd799439011',
  tier: 'Pro',
  settled: 150,
  won: 90,
  winRate: 60,
  roi: 8,
  computedAt: new Date()
};

function mockBadgeDocs(docs: any[]) {
  const doc = docs[0] || null;
  badgeFind.mockReturnValue({ lean: jest.fn().mockResolvedValue(docs) });
  badgeFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
}

const CREATOR = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
const STAKE = new mongoose.Types.ObjectId('507f1f77bcf86cd799439012');

const stakeFind = StakeModel.find as jest.Mock;

function mockStakeFind(stakes: any[]) {
  stakeFind.mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(stakes) })
  });
}

function mockCommissionFind(rows: any[]) {
  commissionFind.mockReturnValue({ session: jest.fn().mockResolvedValue(rows) });
}

const wonStake = (overrides: Record<string, unknown> = {}) => ({
  _id: STAKE,
  user: new mongoose.Types.ObjectId('507f1f77bcf86cd799439013'),
  creatorId: CREATOR,
  bookingCode: 'ABC123',
  stakeAmount: 1000,
  platformFee: 300,
  status: 'won',
  settledAt: new Date(),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.CREATOR_MIN_PAYOUT;
});

describe('commission rate map (locked 10/15/20)', () => {
  it('defaults the payout threshold to 100 NGN', () => {
    expect(minPayout()).toBe(100);
  });
});

describe('recordNewWins', () => {
  it('creates one ledger row per winning copied stake lacking one', async () => {
    stakeAgg.mockResolvedValue([{ _id: STAKE }]);
    mockStakeFind([wonStake()]);
    mockBadgeDocs([PRO_BADGE_DOC]);
    badgeFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ tier: 'Pro', settled: 150, won: 90, winRate: 60, roi: 8 }) });
    commissionBulkWrite.mockResolvedValue({});

    const n = await (commissionService as any).recordNewWins();

    expect(n).toBe(1);
    expect(commissionBulkWrite).toHaveBeenCalledTimes(1);
    const op = commissionBulkWrite.mock.calls[0][0][0].updateOne;
    expect(op.filter).toEqual({ stakeId: STAKE });
    expect(op.update.$setOnInsert).toMatchObject({
      creatorId: CREATOR,
      tier: 'Pro',
      ratePct: 15,
      platformFee: 300,
      amount: 45,
      status: 'pending'
    });
  });

  it('swallows duplicate-key races from concurrent runs', async () => {
    stakeAgg.mockResolvedValue([{ _id: STAKE }]);
    mockStakeFind([wonStake()]);
    mockBadgeDocs([PRO_BADGE_DOC]);
    badgeFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ tier: 'Rising', settled: 25, won: 15, winRate: 60, roi: 5 }) });
    commissionBulkWrite.mockRejectedValue({ code: 11000 });

    await expect((commissionService as any).recordNewWins()).resolves.toBe(1);
  });

  it('does nothing when every win already has a row', async () => {
    stakeAgg.mockResolvedValue([]);

    const n = await (commissionService as any).recordNewWins();

    expect(n).toBe(0);
    expect(commissionBulkWrite).not.toHaveBeenCalled();
  });
});

describe('payOut', () => {
  const pendingRow = (amount: number, id = 'row-1') => ({
    _id: id,
    creatorId: CREATOR,
    stakeId: STAKE,
    platformFee: 300,
    amount: 0,
    status: 'pending'
  });

  function mockPayable(rows: any[], tier = 'Pro') {
    commissionAgg.mockResolvedValue([{ _id: CREATOR, total: 9999 }]);
    mockCommissionFind(rows);
    mockBadgeDocs([{ ...PRO_BADGE_DOC, tier }]);
    badgeFindOne.mockResolvedValue({ tier, settled: 150, won: 90, winRate: 60, roi: 8 });
    walletFindOneAndUpdate.mockResolvedValue({ _id: 'wallet-1', balance: 10000 });
    txCreate.mockResolvedValue([]);
    commissionBulkWrite.mockResolvedValue({});
  }

  it('pays creators at/over the threshold with a unique daily reference', async () => {
    mockPayable([pendingRow(0, 'row-1'), pendingRow(0, 'row-2'), pendingRow(0, 'row-3')]);

    const res = await (commissionService as any).payOut();

    // 3 × floor(300 × 15%) = 135 ≥ ₦100 threshold
    expect(res.creatorsPaid).toBe(1);
    expect(res.paidOut).toBe(135);
    expect(walletFindOneAndUpdate).toHaveBeenCalledWith(
      { user: expect.any(mongoose.Types.ObjectId) },
      expect.objectContaining({ $inc: { balance: 135 } }),
      expect.anything()
    );
    const tx = txCreate.mock.calls[0][0][0];
    expect(tx.type).toBe('commission');
    expect(tx.amount).toBe(135);
    expect(tx.reference).toMatch(/^COM_[0-9A-F]{6}_\d{8}$/);
    expect(tx.metadata).toMatchObject({ tier: 'Pro', ratePct: 15, stakeCount: 3 });
  });

  it('leaves sub-threshold balances pending without touching the wallet', async () => {
    commissionAgg.mockResolvedValue([{ _id: CREATOR, total: 45 }]);
    mockCommissionFind([pendingRow(0)]);
    badgeFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ tier: 'Pro', settled: 150, won: 90, winRate: 60, roi: 8 }) });

    const res = await (commissionService as any).payOut();

    expect(res.creatorsPaid).toBe(0);
    expect(res.paidOut).toBe(0);
    expect(walletFindOneAndUpdate).not.toHaveBeenCalled();
    expect(txCreate).not.toHaveBeenCalled();
  });

  it('pays nothing for Rookie-tier creators', async () => {
    commissionAgg.mockResolvedValue([{ _id: CREATOR, total: 500 }]);
    mockCommissionFind([pendingRow(0)]);
    mockBadgeDocs([]);

    const res = await (commissionService as any).payOut();

    expect(res.creatorsPaid).toBe(0);
    expect(walletFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('collects per-creator errors without aborting the run', async () => {
    commissionAgg.mockResolvedValue([{ _id: CREATOR, total: 500 }]);
    mockCommissionFind([pendingRow(0)]);
    badgeFindOne.mockResolvedValue({ tier: 'Pro', settled: 150, won: 90, winRate: 60, roi: 8 });
    walletFindOneAndUpdate.mockResolvedValue(null);

    const res = await (commissionService as any).payOut();

    expect(res.creatorsPaid).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain('Creator wallet not found');
  });
});
