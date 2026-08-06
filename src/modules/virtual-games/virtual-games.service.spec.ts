import crypto from 'crypto';
import mongoose from 'mongoose';
import { VirtualGamePlayModel } from './virtual-games.model';
import { WalletModel } from '../../models/wallet.model';
import { TransactionModel } from '../../models/transaction.model';
import { walletService } from '../../services/wallet.service';
import { createInAppNotification } from '../../services/notification.service';
import { loyaltyService } from '../loyalty/loyalty.service';
import { virtualGamesService, deriveOutcome, VIRTUAL_GAMES } from './virtual-games.service';

jest.mock('./virtual-games.model', () => ({
  VirtualGamePlayModel: {
    aggregate: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
  },
}));

jest.mock('../../models/wallet.model', () => ({
  WalletModel: { findOneAndUpdate: jest.fn() },
}));

jest.mock('../../models/transaction.model', () => ({
  TransactionModel: { create: jest.fn() },
}));

jest.mock('../../services/wallet.service', () => ({
  walletService: { getBalance: jest.fn() },
}));

jest.mock('../../services/notification.service', () => ({
  createInAppNotification: jest.fn(),
}));

jest.mock('../loyalty/loyalty.service', () => ({
  loyaltyService: { onStakePlaced: jest.fn() },
}));

jest.mock('../../services/logger.service', () => ({
  logger: { error: jest.fn() },
}));

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    startSession: jest.fn(() =>
      Promise.resolve({
        startTransaction: jest.fn(),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        abortTransaction: jest.fn().mockResolvedValue(undefined),
        endSession: jest.fn(),
      })
    ),
  };
});

const playAggregate = VirtualGamePlayModel.aggregate as jest.Mock;
const playFindOne = VirtualGamePlayModel.findOne as jest.Mock;
const playCreate = VirtualGamePlayModel.create as jest.Mock;
const playFind = VirtualGamePlayModel.find as jest.Mock;
const playCount = VirtualGamePlayModel.countDocuments as jest.Mock;
const walletUpdate = WalletModel.findOneAndUpdate as jest.Mock;
const txCreate = TransactionModel.create as jest.Mock;
const getBalance = walletService.getBalance as jest.Mock;
const createNotif = createInAppNotification as jest.Mock;
const loyaltyPoints = loyaltyService.onStakePlaced as jest.Mock;

const wallet = (balance = 50000, locked = 0) => ({
  _id: 'wallet-1',
  user: 'user-1',
  balance,
  lockedBalance: locked,
});

const playDoc = (overrides: any = {}) => ({
  _id: 'play-1',
  user: 'user-1',
  game: 'coin_flip',
  stakeAmount: 1000,
  multiplier: 1.9,
  result: 'loss',
  payoutAmount: 0,
  outcome: '',
  choice: 'heads',
  seed: '',
  verificationHash: '',
  status: 'completed',
  metadata: {},
  playedAt: new Date(),
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

const mockSeed = (fill: number) => {
  const bytes = Buffer.alloc(32, fill);
  jest.spyOn(crypto, 'randomBytes').mockReturnValue(bytes as any);
  return bytes.toString('hex');
};

beforeEach(() => {
  jest.clearAllMocks();
  playAggregate.mockResolvedValue([]);
  getBalance.mockResolvedValue({ available: 50000, balance: 50000, locked: 0, totalDeposited: 0, totalWithdrawn: 0, totalStaked: 0, totalWon: 0 });
  loyaltyPoints.mockResolvedValue(undefined);
  createNotif.mockResolvedValue(undefined);
});

describe('deriveOutcome', () => {
  it('always returns a valid outcome for every game', () => {
    for (const game of Object.keys(VIRTUAL_GAMES) as any[]) {
      const out = deriveOutcome(game, 'seed-x', 'play-1');
      expect(VIRTUAL_GAMES[game].outcomes).toContain(out);
    }
  });

  it('is deterministic — same seed and play id yield the same outcome', () => {
    expect(deriveOutcome('coin_flip', 'abc', 'p1')).toBe(deriveOutcome('coin_flip', 'abc', 'p1'));
    expect(deriveOutcome('dice', 'abc', 'p1')).toBe(deriveOutcome('dice', 'abc', 'p1'));
  });
});

describe('VirtualGamesService.catalog', () => {
  it('returns all three games with multipliers and RTP', () => {
    const catalog = virtualGamesService.getCatalog();
    expect(catalog).toHaveLength(3);
    const flip = catalog.find(c => c.id === 'coin_flip')!;
    expect(flip).toMatchObject({ multiplier: 1.9, outcomes: ['heads', 'tails'], enabled: true, minStake: 100 });
    expect(catalog.find(c => c.id === 'dice')!.multiplier).toBe(5.7);
    expect(catalog.find(c => c.id === 'color_wheel')!.outcomes).toContain('emerald');
  });
});

describe('VirtualGamesService.play', () => {
  it('rejects an unknown game', async () => {
    await expect(
      virtualGamesService.play({ userId: 'u1', game: 'roulette' as any, choice: 'x', amount: 500 })
    ).rejects.toThrow('Unknown game');
  });

  it('rejects an invalid choice for the game', async () => {
    await expect(
      virtualGamesService.play({ userId: 'u1', game: 'coin_flip', choice: 'purple', amount: 500 })
    ).rejects.toThrow('Choice must be one of');
  });

  it('enforces min and max stakes', async () => {
    await expect(
      virtualGamesService.play({ userId: 'u1', game: 'coin_flip', choice: 'heads', amount: 50 })
    ).rejects.toThrow('Minimum stake');
    await expect(
      virtualGamesService.play({ userId: 'u1', game: 'coin_flip', choice: 'heads', amount: 999999999 })
    ).rejects.toThrow('Maximum stake');
  });

  it('rejects plays beyond the daily cap', async () => {
    playAggregate.mockResolvedValue([{ _id: null, total: 199000 }]);
    await expect(
      virtualGamesService.play({ userId: 'u1', game: 'coin_flip', choice: 'heads', amount: 2000 })
    ).rejects.toThrow('Daily play limit reached');
  });

  it('fails cleanly on insufficient balance without creating a play', async () => {
    walletUpdate.mockResolvedValue(null);
    await expect(
      virtualGamesService.play({ userId: 'u1', game: 'coin_flip', choice: 'heads', amount: 1000 })
    ).rejects.toThrow('Insufficient balance');
    expect(playCreate).not.toHaveBeenCalled();
  });

  it('credits the exact payout on a win and records both transactions', async () => {
    const seed = mockSeed(3);
    const expected = deriveOutcome('coin_flip', seed, 'play-1');
    playCreate.mockResolvedValue([playDoc()]);
    walletUpdate
      .mockResolvedValueOnce(wallet(49000))
      .mockResolvedValueOnce(wallet(49000 + 1900));

    const res = await virtualGamesService.play({ userId: 'u1', game: 'coin_flip', choice: expected, amount: 1000 });

    expect(res.result).toBe('win');
    expect(res.outcome).toBe(expected);
    expect(res.payoutAmount).toBe(1900);
    expect(res.seed).toBe(seed);
    expect(res.verificationHash).toBe(crypto.createHash('sha256').update(seed).digest('hex'));
    expect(txCreate).toHaveBeenCalledTimes(2);
    const txTypes = txCreate.mock.calls.map((c: any[]) => c[0][0].type);
    expect(txTypes).toEqual(expect.arrayContaining(['stake', 'payout']));
    expect(walletUpdate.mock.calls[1][1].$inc).toMatchObject({ balance: 1900, totalWon: 1900 });
    expect(loyaltyPoints).toHaveBeenCalledWith('u1', 1000);
    expect(createNotif).toHaveBeenCalled();
  });

  it('records a loss with zero payout when the call is wrong', async () => {
    const seed = mockSeed(9);
    const expected = deriveOutcome('coin_flip', seed, 'play-1');
    const losingChoice = expected === 'heads' ? 'tails' : 'heads';
    playCreate.mockResolvedValue([playDoc({ choice: losingChoice })]);
    walletUpdate.mockResolvedValueOnce(wallet(49000));

    const res = await virtualGamesService.play({ userId: 'u1', game: 'coin_flip', choice: losingChoice, amount: 1000 });

    expect(res.result).toBe('loss');
    expect(res.payoutAmount).toBe(0);
    expect(res.outcome).toBe(expected);
    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(txCreate.mock.calls[0][0][0].type).toBe('stake');
    expect(createNotif).not.toHaveBeenCalled();
  });

  it('returns the existing play for a repeated idempotency key without debiting', async () => {
    const existing = playDoc({ seed: 'old-seed', outcome: 'heads', result: 'win', payoutAmount: 1900 });
    delete (existing as any).save;
    playFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(existing) });

    const res = await virtualGamesService.play({
      userId: 'u1',
      game: 'coin_flip',
      choice: 'heads',
      amount: 1000,
      idempotencyKey: 'key-1',
    });

    expect(res.playId).toBe('play-1');
    expect(res.result).toBe('win');
    expect(playCreate).not.toHaveBeenCalled();
    expect(walletUpdate).not.toHaveBeenCalled();
  });

  it('exposes verifiable seed on a dice play', async () => {
    const seed = mockSeed(11);
    const expected = deriveOutcome('dice', seed, 'play-1');
    playCreate.mockResolvedValue([playDoc({ game: 'dice' })]);
    walletUpdate
      .mockResolvedValueOnce(wallet(49000))
      .mockResolvedValueOnce(wallet(49000 + 5700));

    const res = await virtualGamesService.play({ userId: 'u1', game: 'dice', choice: expected, amount: 1000 });

    expect(VIRTUAL_GAMES.dice.outcomes).toContain(res.outcome);
    expect(res.result).toBe('win');
    expect(res.payoutAmount).toBe(5700);
    expect(deriveOutcome('dice', res.seed, res.playId)).toBe(res.outcome);
  });
});

describe('VirtualGamesService.history', () => {
  it('paginates plays newest first', async () => {
    const lean = jest.fn().mockResolvedValue([{ _id: 'p2' }, { _id: 'p1' }]);
    const limit = jest.fn(() => ({ lean }));
    const skip = jest.fn(() => ({ limit }));
    playFind.mockReturnValue({ sort: jest.fn(() => ({ skip })) });
    playCount.mockResolvedValue(2);
    const { items, total } = await virtualGamesService.history({ page: 1, limit: 20 }, 'u1');
    expect(items).toHaveLength(2);
    expect(total).toBe(2);
    expect(playFind.mock.calls[0][0]).toEqual({ user: 'u1' });
    expect(skip).toHaveBeenCalledWith(0);
    expect(limit).toHaveBeenCalledWith(20);
  });

  it('applies game and result filters to the query', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const limit = jest.fn(() => ({ lean }));
    const skip = jest.fn(() => ({ limit }));
    playFind.mockReturnValue({ sort: jest.fn(() => ({ skip })) });
    playCount.mockResolvedValue(0);
    await virtualGamesService.history({ page: 2, limit: 10, game: 'coin_flip', result: 'win' }, 'u1');
    expect(playFind.mock.calls[0][0]).toEqual({ user: 'u1', game: 'coin_flip', result: 'win' });
    expect(skip).toHaveBeenCalledWith(10);
    expect(limit).toHaveBeenCalledWith(10);
  });

  it('ignores unknown game ids and invalid result values', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const limit = jest.fn(() => ({ lean }));
    const skip = jest.fn(() => ({ limit }));
    playFind.mockReturnValue({ sort: jest.fn(() => ({ skip })) });
    playCount.mockResolvedValue(0);

    await virtualGamesService.history({ game: 'roulette' as any, result: 'draw' as any }, 'u1');
    expect(playFind.mock.calls[0][0]).toEqual({ user: 'u1' });
  });

  it('clamps page and limit to safe bounds', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const limit = jest.fn(() => ({ lean }));
    const skip = jest.fn(() => ({ limit }));
    playFind.mockReturnValue({ sort: jest.fn(() => ({ skip })) });
    playCount.mockResolvedValue(0);

    await virtualGamesService.history({ page: 0, limit: 9999 }, 'u1');
    expect(skip).toHaveBeenCalledWith(0);
    expect(limit).toHaveBeenCalledWith(100);
  });
});

describe('VirtualGamesService.summary', () => {
  it('rolls up totals, today, win rate and best win', async () => {
    playAggregate.mockResolvedValue([{
      totals: [{ _id: null, plays: 10, staked: 50000, wins: 6, payout: 62000 }],
      today: [{ _id: null, plays: 3, staked: 9000, won: 3800 }],
      bestWin: [{ amount: 14250, game: 'dice' }],
    }]);

    const s = await virtualGamesService.summary('u1');
    expect(s.totalPlays).toBe(10);
    expect(s.totalStaked).toBe(50000);
    expect(s.totalWins).toBe(6);
    expect(s.totalPayout).toBe(62000);
    expect(s.winRate).toBe(60);
    expect(s.today).toEqual({ plays: 3, staked: 9000, won: 3800 });
    expect(s.bestWin).toEqual({ amount: 14250, game: 'dice' });
  });

  it('returns zeros and null best win when there are no plays', async () => {
    playAggregate.mockResolvedValue([{}]);
    const stats = await virtualGamesService.summary('u1');
    expect(stats.totalPlays).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.today.plays).toBe(0);
    expect(stats.bestWin).toBeNull();
  });

  it('returns null best win when the best payout is zero', async () => {
    playAggregate.mockResolvedValue([{ bestWin: [{ _id: 0, amount: 0, game: 'coin_flip' }] }]);
    const stats = await virtualGamesService.summary('u1');
    expect(stats.bestWin).toBeNull();
  });
});
