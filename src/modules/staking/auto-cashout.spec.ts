import mongoose from 'mongoose';
import { StakeModel } from '../../models/stake.model';
import { WalletModel } from '../../models/wallet.model';
import { TransactionModel } from '../../models/transaction.model';
import { PodModel } from '../../models/pod.model';
import { GameAnalysisModel } from '../../models/game-analysis.model';
import { notifyStakeCashedOut } from '../../services/notification.service';
import { stakeService } from './stake.service';

jest.mock('../../models/stake.model', () => ({
  StakeModel: { findOne: jest.fn(), findOneAndUpdate: jest.fn(), countDocuments: jest.fn() },
}));

jest.mock('../../models/wallet.model', () => ({
  WalletModel: { findOneAndUpdate: jest.fn() },
}));

jest.mock('../../models/transaction.model', () => ({
  TransactionModel: { create: jest.fn() },
}));

jest.mock('../../models/pod.model', () => ({
  PodModel: { findByIdAndUpdate: jest.fn(), findById: jest.fn(), find: jest.fn() },
}));

jest.mock('../../models/game-analysis.model', () => ({
  GameAnalysisModel: { find: jest.fn() },
}));

jest.mock('../../services/notification.service', () => ({
  notifyStakeCashedOut: jest.fn(),
}));

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    startSession: jest.fn(),
  };
});

const stakeFindOne = StakeModel.findOne as jest.Mock;
const stakeFindOneAndUpdate = StakeModel.findOneAndUpdate as jest.Mock;
const stakeCountDocuments = StakeModel.countDocuments as jest.Mock;
const walletFindOneAndUpdate = WalletModel.findOneAndUpdate as jest.Mock;
const txCreate = TransactionModel.create as jest.Mock;
const podFindByIdAndUpdate = PodModel.findByIdAndUpdate as jest.Mock;
const podFindById = PodModel.findById as jest.Mock;
const podFind = PodModel.find as jest.Mock;
const gameFind = GameAnalysisModel.find as jest.Mock;
const notify = notifyStakeCashedOut as jest.Mock;
const startSession = mongoose.startSession as jest.Mock;

function sessionStub() {
  const session = {
    startTransaction: jest.fn(),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn(),
  };
  startSession.mockResolvedValue(session);
  return session;
}

function itemsFor(...statuses: string[]): any[] {
  const mults: Record<string, number> = { pending: 1.9, won: 1.8, lost: 1.7, void: 1.6 };
  return statuses.map((s, i) => ({
    pod: new mongoose.Types.ObjectId(),
    homeTeam: `H${i}`,
    awayTeam: `A${i}`,
    selection: 'Home Win',
    gainsMultiplier: mults[s],
    matchDate: '2026-08-20T19:00:00Z',
    status: s,
  }));
}

function stakeStub(overrides: any = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    pod: new mongoose.Types.ObjectId(),
    stakeAmount: 1000,
    potentialPayout: 5000,
    status: 'confirmed',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.AUTO_CASHOUT_TICK_MS;
  delete process.env.AUTO_CASHOUT_MAX_PER_TICK;
  delete process.env.AUTO_CASHOUT_LIVE_FACTOR;
  delete process.env.AUTO_CASHOUT_MAX_PER_USER;
  delete process.env.AUTO_CASHOUT_MAX_GLOBAL;
  stakeCountDocuments.mockResolvedValue(0);
  podFind.mockResolvedValue([]);
  gameFind.mockResolvedValue([]);
});

describe('stakeService.computeAutoCashoutQuote', () => {
  it('returns 90% of stake when no legs are won', () => {
    const stake = stakeStub({ items: itemsFor('pending', 'pending') });
    expect(stakeService.computeAutoCashoutQuote(stake as any)).toBe(900);
  });

  it('locks in won legs with a positive quote', () => {
    const stake = stakeStub({ items: itemsFor('won', 'pending') });
    const expected = Math.floor(1000 * 0.9 * 1.8);
    expect(stakeService.computeAutoCashoutQuote(stake as any)).toBe(expected);
  });

  it('quotes the full locked-in value when all legs are won', () => {
    const stake = stakeStub({ items: itemsFor('won', 'won') });
    const expected = Math.floor(1000 * 0.9 * 1.8 * 1.8);
    expect(stakeService.computeAutoCashoutQuote(stake as any)).toBe(expected);
  });

  it('returns 0 when two or more legs are lost', () => {
    const stake = stakeStub({ items: itemsFor('lost', 'lost', 'won') });
    expect(stakeService.computeAutoCashoutQuote(stake as any)).toBe(0);
  });

  it('excludes voided legs from the locked-in value', () => {
    const stake = stakeStub({ items: itemsFor('won', 'void', 'pending') });
    const expected = Math.floor(1000 * 0.9 * 1.8);
    expect(stakeService.computeAutoCashoutQuote(stake as any)).toBe(expected);
  });

  it('applies the one-leg insurance floor when eligible', () => {
    process.env.ACCUMULATOR_INSURANCE_MIN_LEGS = '4';
    const stake = stakeStub({ items: itemsFor('won', 'won', 'won', 'lost') });
    const floor = Math.floor(1000 * 1.8 * 1.8 * 1.8 * 0.9);
    expect(stakeService.computeAutoCashoutQuote(stake as any)).toBe(floor);
  });

  it('does not apply the insurance floor below the min leg count', () => {
    process.env.ACCUMULATOR_INSURANCE_MIN_LEGS = '4';
    const stake = stakeStub({ items: itemsFor('won', 'lost') });
    const expected = Math.floor(1000 * 0.9 * 1.8);
    expect(stakeService.computeAutoCashoutQuote(stake as any)).toBe(expected);
  });

  it('returns 0 for stakes without items', () => {
    const stake = stakeStub({ items: undefined });
    expect(stakeService.computeAutoCashoutQuote(stake as any)).toBe(0);
  });
});

describe('stakeService.armAutoCashout', () => {
  it('arms a valid target on an active stake', async () => {
    const stake = stakeStub({ items: itemsFor('pending', 'pending') });
    stake.save = jest.fn().mockResolvedValue(stake);
    stakeFindOne.mockResolvedValue(stake);

    const result = await stakeService.armAutoCashout(String(stake._id), String(stake.user), 500);
    expect(result).not.toBeNull();
    expect(result!.autoCashout!.enabled).toBe(true);
    expect(result!.autoCashout!.targetAmount).toBe(500);
    expect(stake.save).toHaveBeenCalled();
  });

  it('rejects targets below ₦100', async () => {
    stakeFindOne.mockResolvedValue(stakeStub({ items: itemsFor('pending', 'pending') }));
    await expect(stakeService.armAutoCashout('s1', 'u1', 50)).rejects.toThrow('at least');
  });

  it('rejects targets above the maximum quote', async () => {
    stakeFindOne.mockResolvedValue(stakeStub({ items: itemsFor('pending', 'pending') }));
    await expect(stakeService.armAutoCashout('s1', 'u1', 2000)).rejects.toThrow('maximum cashout');
  });

  it('rejects settled stakes', async () => {
    const stake = stakeStub({ items: itemsFor('won', 'won'), status: 'won', isSettled: true });
    stakeFindOne.mockResolvedValue(stake);
    await expect(stakeService.armAutoCashout('s1', 'u1', 500)).rejects.toThrow('already settled');
  });

  it('returns null when the stake is not found', async () => {
    stakeFindOne.mockResolvedValue(null);
    const result = await stakeService.armAutoCashout('s1', 'u1', 500);
    expect(result).toBeNull();
  });

  it('rejects when the per-user armed cap is reached', async () => {
    process.env.AUTO_CASHOUT_MAX_PER_USER = '2';
    stakeFindOne.mockResolvedValue(stakeStub({ items: itemsFor('pending', 'pending') }));
    stakeCountDocuments.mockResolvedValue(2);

    await expect(stakeService.armAutoCashout('s1', 'u1', 500)).rejects.toThrow('Maximum of 2');
  });

  it('rejects when the global armed cap is reached', async () => {
    process.env.AUTO_CASHOUT_MAX_GLOBAL = '1';
    stakeFindOne.mockResolvedValue(stakeStub({ items: itemsFor('pending', 'pending') }));
    stakeCountDocuments.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    await expect(stakeService.armAutoCashout('s1', 'u1', 500)).rejects.toThrow('Platform auto-cashout limit');
  });
});

describe('stakeService.resolveAutoCashoutQuote', () => {
  function podQuery(pods: any[]) {
    return jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(pods) }) });
  }

  function gameQuery(analyses: any[]) {
    return jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(analyses) }) });
  }

  it('scales the quote down while a leg match is live', async () => {
    process.env.AUTO_CASHOUT_LIVE_FACTOR = '0.75';
    const podId = new mongoose.Types.ObjectId();
    const stake = stakeStub({ pod: podId, items: [{ ...itemsFor('pending')[0], pod: podId }] });
    podFind.mockImplementation(podQuery([{ _id: podId, metadata: { fixtureId: 205861 } }]));
    gameFind.mockImplementation(gameQuery([{ fixtureId: 205861, matchStatus: '2nd_half' }]));

    const quote = await stakeService.resolveAutoCashoutQuote(stake as any);
    expect(quote).toBe(Math.floor(1000 * 0.9 * 0.75));
  });

  it('keeps Stage-1 pricing when no live status is stored (graceful fallback)', async () => {
    const podId = new mongoose.Types.ObjectId();
    const stake = stakeStub({ pod: podId, items: [{ ...itemsFor('pending')[0], pod: podId }] });
    podFind.mockImplementation(podQuery([{ _id: podId, metadata: { fixtureId: 205862 } }]));
    gameFind.mockImplementation(gameQuery([]));

    expect(await stakeService.resolveAutoCashoutQuote(stake as any)).toBe(900);
  });

  it('keeps Stage-1 pricing when the status lookup fails', async () => {
    const podId = new mongoose.Types.ObjectId();
    const stake = stakeStub({ pod: podId, items: [{ ...itemsFor('pending')[0], pod: podId }] });
    podFind.mockImplementation(() => ({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockRejectedValue(new Error('db down')) }) }));

    expect(await stakeService.resolveAutoCashoutQuote(stake as any)).toBe(900);
  });

  it('returns 0 for already-failed stakes', async () => {
    const stake = stakeStub({ items: itemsFor('lost', 'lost', 'won') });
    expect(await stakeService.resolveAutoCashoutQuote(stake as any)).toBe(0);
  });
});

describe('stakeService.disableAutoCashout', () => {
  it('disables an armed stake', async () => {
    const stake = stakeStub({ items: itemsFor('pending', 'pending'), autoCashout: { enabled: true, targetAmount: 500 } });
    stake.save = jest.fn().mockResolvedValue(stake);
    stakeFindOne.mockResolvedValue(stake);

    const result = await stakeService.disableAutoCashout(String(stake._id), String(stake.user));
    expect(result!.autoCashout!.enabled).toBe(false);
  });

  it('throws on cashed-out stakes', async () => {
    const stake = stakeStub({ status: 'cashed_out', cashoutRequested: true, items: itemsFor('pending', 'pending') });
    stakeFindOne.mockResolvedValue(stake);
    await expect(stakeService.disableAutoCashout('s1', 'u1')).rejects.toThrow('already settled or cashed out');
  });
});

describe('stakeService.getAutoCashoutStatus', () => {
  it('returns config with a live quote and max target', async () => {
    stakeFindOne.mockResolvedValue(stakeStub({ items: itemsFor('pending', 'pending') }));

    const status = await stakeService.getAutoCashoutStatus('s1', 'u1');
    expect(status).toMatchObject({ enabled: false, targetAmount: null, quote: 900, maxTarget: 900 });
  });

  it('returns null when the stake is not found', async () => {
    stakeFindOne.mockResolvedValue(null);
    expect(await stakeService.getAutoCashoutStatus('s1', 'u1')).toBeNull();
  });
});

describe('stakeService.executeCashout', () => {
  it('claims, credits the wallet, records a transaction and notifies', async () => {
    const stake = stakeStub({ items: itemsFor('pending', 'pending') });
    const claimed = stakeStub({ status: 'cashed_out' });
    const wallet = { _id: new mongoose.Types.ObjectId(), balance: 5000 };
    sessionStub();
    stakeFindOneAndUpdate.mockResolvedValue(claimed);
    walletFindOneAndUpdate.mockResolvedValue(wallet);
    txCreate.mockResolvedValue([{}]);
    podFindByIdAndUpdate.mockReturnValue({ session: jest.fn().mockResolvedValue({}) });
    podFindById.mockReturnValue({ select: jest.fn().mockResolvedValue({ title: 'Arsenal vs Como' }) });
    notify.mockResolvedValue(undefined);

    const result = await stakeService.executeCashout(stake as any, 900, 100, true, 500);
    expect(result).toBe(claimed);
    expect(stakeFindOneAndUpdate).toHaveBeenCalled();
    expect(walletFindOneAndUpdate).toHaveBeenCalled();
    expect(txCreate).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ reference: `AUTO_CASHOUT_${stake._id}`, amount: 900 })]),
      expect.anything()
    );
    expect(notify).toHaveBeenCalled();
  });

  it('returns null without paying when the stake was raced', async () => {
    const stake = stakeStub({ items: itemsFor('pending', 'pending') });
    const session = sessionStub();
    stakeFindOneAndUpdate.mockResolvedValue(null);

    const result = await stakeService.executeCashout(stake as any, 900, 100, true, 500);
    expect(result).toBeNull();
    expect(walletFindOneAndUpdate).not.toHaveBeenCalled();
    expect(txCreate).not.toHaveBeenCalled();
    expect(session.abortTransaction).toHaveBeenCalled();
  });
});
