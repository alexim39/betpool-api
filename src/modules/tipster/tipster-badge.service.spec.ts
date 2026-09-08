import mongoose from 'mongoose';
import {
  tipsterBadgeService,
  tierForStats,
  commissionPctForTier,
  TIPSTER_COMMISSION_PCT
} from './tipster-badge.service';

jest.mock('../../models/stake.model', () => ({
  StakeModel: { aggregate: jest.fn() }
}));
jest.mock('../../models/tipster-badge.model', () => ({
  TipsterBadgeModel: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), bulkWrite: jest.fn() }
}));

import { StakeModel } from '../../models/stake.model';
import { TipsterBadgeModel } from '../../models/tipster-badge.model';

const stakeAggregate = StakeModel.aggregate as jest.Mock;
const badgeFindOne = TipsterBadgeModel.findOne as jest.Mock;
const badgeFind = TipsterBadgeModel.find as jest.Mock;
const badgeFindOneAndUpdate = TipsterBadgeModel.findOneAndUpdate as jest.Mock;
const badgeBulkWrite = TipsterBadgeModel.bulkWrite as jest.Mock;

const CREATOR = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('tierForStats', () => {
  it.each([
    [0, 0, 'Rookie'],
    [19, 100, 'Rookie'],
    [20, 40, 'Rising'],
    [99, 90, 'Rising'],
    [100, 49.9, 'Rising'],
    [100, 50, 'Pro'],
    [499, 80, 'Pro'],
    [500, 51.9, 'Pro'],
    [500, 52, 'Legend'],
    [2000, 60, 'Legend'],
  ])('settled=%i winRate=%i → %s', (settled, winRate, expected) => {
    expect(tierForStats(settled, winRate)).toBe(expected);
  });
});

describe('commission schedule (locked 10/15/20)', () => {
  it('maps tiers to rates and unknown/Rookie to zero', () => {
    expect(TIPSTER_COMMISSION_PCT).toEqual({ Rising: 10, Pro: 15, Legend: 20 });
    expect(commissionPctForTier('Rising')).toBe(10);
    expect(commissionPctForTier('Pro')).toBe(15);
    expect(commissionPctForTier('Legend')).toBe(20);
    expect(commissionPctForTier('Rookie')).toBe(0);
    expect(commissionPctForTier('bogus')).toBe(0);
  });
});

describe('computeAll', () => {
  it('aggregates copied stakes once and upserts one badge per creator', async () => {
    stakeAggregate.mockResolvedValue([
      { _id: CREATOR, settled: 120, won: 70, staked: 120000, profit: 15000 },
      { _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'), settled: 5, won: 5, staked: 5000, profit: 2000 }
    ]);
    badgeBulkWrite.mockResolvedValue({});

    const res = await tipsterBadgeService.computeAll();

    expect(res).toEqual({ computed: 2 });
    expect(stakeAggregate).toHaveBeenCalledTimes(1);
    const pipeline = stakeAggregate.mock.calls[0][0];
    expect(pipeline[0].$match).toMatchObject({ status: { $in: ['won', 'lost'] } });
    expect(badgeBulkWrite).toHaveBeenCalledTimes(1);
    const ops = badgeBulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(2);
    const main = ops[0].updateOne;
    expect(main.filter).toEqual({ user: CREATOR });
    expect(main.upsert).toBe(true);
    // 70/120 = 58.3% → Pro (≥100 settled, ≥50%)
    expect(main.update.$set).toMatchObject({ tier: 'Pro', settled: 120, won: 70, winRate: 58.3 });
    // 5 settled → Rookie despite 100% win rate (sample floor rules)
    expect(ops[1].updateOne.update.$set.tier).toBe('Rookie');
  });

  it('does nothing when no copied stakes settled', async () => {
    stakeAggregate.mockResolvedValue([]);

    const res = await tipsterBadgeService.computeAll();

    expect(res).toEqual({ computed: 0 });
    expect(badgeBulkWrite).not.toHaveBeenCalled();
  });
});

describe('computeForUser', () => {
  it('writes a Legend badge for a proven creator', async () => {
    stakeAggregate.mockResolvedValue([
      { _id: CREATOR, settled: 600, won: 360, staked: 600000, profit: 60000 }
    ]);
    badgeFindOneAndUpdate.mockResolvedValue({});

    const view = await tipsterBadgeService.computeForUser(CREATOR.toString());

    expect(view.tier).toBe('Legend');
    expect(view.winRate).toBe(60);
    expect(view.roi).toBe(10);
    expect(badgeFindOneAndUpdate).toHaveBeenCalledWith(
      { user: expect.any(mongoose.Types.ObjectId) },
      expect.objectContaining({ $set: expect.objectContaining({ tier: 'Legend' }) }),
      { upsert: true, new: true }
    );
  });
});

describe('getBadge / getBadges', () => {
  it('returns Rookie default for unknown creators and invalid ids', async () => {
    badgeFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    await expect(tipsterBadgeService.getBadge('507f1f77bcf86cd799439099')).resolves.toMatchObject({ tier: 'Rookie', computedAt: null });
    await expect(tipsterBadgeService.getBadge('not-an-id')).resolves.toMatchObject({ tier: 'Rookie' });
    await expect(tipsterBadgeService.getBadge('')).resolves.toMatchObject({ tier: 'Rookie' });
  });

  it('maps stored docs and defaults missing creators in batch reads', async () => {
    badgeFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { user: CREATOR, tier: 'Pro', settled: 150, won: 90, winRate: 60, roi: 8, computedAt: new Date('2026-01-01T00:00:00Z') }
      ])
    });

    const map = await tipsterBadgeService.getBadges([CREATOR.toString(), '507f1f77bcf86cd799439099']);

    expect(map.get(CREATOR.toString())).toMatchObject({ tier: 'Pro', settled: 150 });
    expect(map.get('507f1f77bcf86cd799439099')).toMatchObject({ tier: 'Rookie' });
  });

  it('fails open to Rookie defaults when the store errors', async () => {
    badgeFindOne.mockReturnValue({ lean: jest.fn().mockRejectedValue(new Error('db down')) });
    badgeFind.mockReturnValue({ lean: jest.fn().mockRejectedValue(new Error('db down')) });

    await expect(tipsterBadgeService.getBadge(CREATOR.toString())).resolves.toMatchObject({ tier: 'Rookie' });
    const map = await tipsterBadgeService.getBadges([CREATOR.toString()]);
    expect(map.get(CREATOR.toString())).toMatchObject({ tier: 'Rookie' });
  });
});
