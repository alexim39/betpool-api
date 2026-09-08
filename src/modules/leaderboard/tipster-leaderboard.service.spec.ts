import { StakeModel } from '../../models/stake.model';
import { UserModel } from '../../models/user.model';
import { tipsterLeaderboardService } from './tipster-leaderboard.service';

jest.mock('../../models/stake.model', () => ({
  StakeModel: { aggregate: jest.fn() },
}));

jest.mock('../../models/user.model', () => ({
  UserModel: { find: jest.fn() },
}));

const stakeAgg = StakeModel.aggregate as jest.Mock;
const userFind = UserModel.find as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  userFind.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ _id: 'creator-1', fullName: 'Ada Lovelace', phone: '08012345678' }])
    })
  });
});

const creatorRow = (id: string, settled: number, won: number, staked: number, profit: number) => ({
  _id: { toString: () => id },
  settled,
  won,
  staked,
  profit,
});

beforeEach(() => {
  jest.clearAllMocks();
  userFind.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ _id: 'creator-1', fullName: 'Ada Lovelace', phone: '08012345678' }])
    })
  });
});

describe('TipsterLeaderboardService.getBoard', () => {
  it('ranks by ROI with win rate and tiers computed per row', async () => {
    stakeAgg
      .mockResolvedValueOnce([creatorRow('creator-1', 120, 70, 120000, 15000)])
      .mockResolvedValueOnce([{ _id: null, count: 1 }]);

    const page = await tipsterLeaderboardService.getBoard('month', 1, 25);

    expect(page.total).toBe(1);
    // 70/120 = 58.3% win, 15000/120000 = 12.5% ROI → Pro
    expect(page.items[0]).toMatchObject({
      rank: 1,
      userId: 'creator-1',
      tier: 'Pro',
      settled: 120,
      won: 70,
      winRate: 58.3,
      roi: 12.5,
      profit: 15000
    });
    expect(page.minSettled).toBe(20);
  });

  it('windows on settledAt (never createdAt) and enforces the min-settled floor', async () => {
    stakeAgg
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ _id: null, count: 0 }]);

    const page = await tipsterLeaderboardService.getBoard('week', 2, 10, { minSettled: 50 });

    const match = stakeAgg.mock.calls[0][0][0].$match;
    expect(match.status).toEqual({ $in: ['won', 'lost'] });
    expect(match.creatorId).toEqual({ $exists: true, $ne: null });
    expect(match.settledAt.$gte).toBeInstanceOf(Date);
    const pipeline = stakeAgg.mock.calls[0][0];
    expect(JSON.stringify(pipeline)).toContain('"settled":{"$gte":50}');
    expect(page.minSettled).toBe(50);
    expect(page.items).toEqual([]);
  });

  it('rejects unknown sort fields to the roi default and clamps paging', async () => {
    stakeAgg
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ _id: null, count: 0 }]);

    const page = await tipsterLeaderboardService.getBoard('all', 99999, 500, { sortField: 'hacked', sortOrder: 'asc' });

    const pipeline = stakeAgg.mock.calls[0][0];
    expect(JSON.stringify(pipeline)).toContain('{"roi":1}');
    expect(page.page).toBe(10000);
    expect(page.limit).toBe(100);
    expect(page.period).toBe('all');
  });

  it('searches creators by name through the users join', async () => {
    stakeAgg
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ _id: null, count: 0 }]);

    await tipsterLeaderboardService.getBoard('month', 1, 25, { search: 'ada (l)?' });

    const pipeline = stakeAgg.mock.calls[0][0];
    const lookup = pipeline.find((s: any) => s.$lookup && s.$lookup.from === 'users');
    expect(lookup).toBeTruthy();
    expect(pipeline).toContainEqual({ $unwind: { path: '$u', preserveNullAndEmptyArrays: true } });
    const match = pipeline.find((s: any) => s.$match && s.$match.$or);
    expect(match.$match.$or[0]['u.fullName'].source).toBe('ada \\(l\\)\\?');
    expect(match.$match.$or[0]['u.fullName'].flags).toBe('i');
  });
});
