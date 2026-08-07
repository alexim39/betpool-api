import { StakeModel } from '../../models/stake.model';
import { UserModel } from '../../models/user.model';
import { PodModel } from '../../models/pod.model';
import { leaderboardService } from './leaderboard.service';

jest.mock('../../models/stake.model', () => ({
  StakeModel: { aggregate: jest.fn(), findOne: jest.fn() },
}));

jest.mock('../../models/user.model', () => ({
  UserModel: { find: jest.fn() },
}));

jest.mock('../../models/pod.model', () => ({
  PodModel: { findById: jest.fn() },
}));

const stakeAgg = StakeModel.aggregate as jest.Mock;
const stakeFindOne = StakeModel.findOne as jest.Mock;
const userFind = UserModel.find as jest.Mock;
const podFindById = PodModel.findById as jest.Mock;

const row = (id: string, totalStaked: number, won = 0, cnt = 1) => ({
  _id: { toString: () => id },
  totalStaked,
  stakeCount: cnt,
  totalWon: won,
  lastWinAt: won ? new Date() : null,
});

beforeEach(() => {
  jest.clearAllMocks();
  userFind.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: 'user-1', fullName: 'Ada Lovelace', phone: '08012345678' }]) }) });
  podFindById.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ title: 'Arsenal vs Chelsea' }) }) });
});

describe('LeaderboardService.getLeaderboard', () => {
  it('paginates, masks identities and keeps the viewer pinned at top', async () => {
    stakeAgg
      .mockResolvedValueOnce([row('user-1', 60_000, 20_000), row('user-2', 45_000, 10_000)])
      .mockResolvedValueOnce([{ _id: null, count: 30 }]);

    const page = await leaderboardService.getLeaderboard('user-1', 'month', 1, 25);

    expect(page.total).toBe(30);
    expect(page.items.length).toBe(2);
    expect(page.items[0]).toMatchObject({ rank: 1, userId: 'user-1', totalStaked: 60_000, totalWon: 20_000 });
    expect(page.items[0].displayName).toBe('A***e');
    expect(page.items[1].userId).toBe('user-2');
    expect(stakeAgg.mock.calls[0][0][0].$match.status).toEqual({ $in: ['won', 'lost', 'void'] });
  });

  it('pins the viewer at the top even when they fall outside the page window', async () => {
    stakeAgg
      .mockResolvedValueOnce([row('user-9', 1000)])
      .mockResolvedValueOnce([{ _id: null, count: 5 }])
      .mockResolvedValue([row('user-1', 1000), row('user-9', 5000)]);

    const page = await leaderboardService.getLeaderboard('user-1', 'week', 1, 25);

    expect(page.items[0]).toMatchObject({ rank: 1, userId: 'user-1' });
    expect(page.items[1].userId).toBe('user-9');
  });

  it('searches ranked users by name/phone with escaped regex and skips viewer pinning', async () => {
    stakeAgg
      .mockResolvedValueOnce([row('user-2', 45_000, 10_000)])
      .mockResolvedValueOnce([{ count: 3 }]);

    const page = await leaderboardService.getLeaderboard('user-1', 'month', 1, 25, { search: 'a.c (x)?' });

    const pipeline = stakeAgg.mock.calls[0][0] as any[];
    const lookup = pipeline.find(s => s.$lookup);
    expect(lookup.$lookup.from).toBe('users');
    const userMatch = pipeline.find(s => s.$match && s.$match.$or);
    expect(userMatch.$match.$or[0]['u.fullName'].source).toBe('a\\.c \\(x\\)\\?');
    const countPipeline = stakeAgg.mock.calls[1][0] as any[];
    expect(countPipeline[countPipeline.length - 1]).toEqual({ $count: 'count' });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].userId).toBe('user-2');
  });

  it('clamps NaN page/limit and rejects unknown sort fields with safe defaults', async () => {
    stakeAgg
      .mockResolvedValueOnce([row('user-1', 60_000)])
      .mockResolvedValueOnce([{ count: 1 }]);

    const page = await leaderboardService.getLeaderboard('user-1', 'all', 'abc' as any, 999, {
      sortField: 'password',
      sortOrder: 'asc',
    });

    const pipeline = stakeAgg.mock.calls[0][0] as any[];
    expect(pipeline[pipeline.length - 3]).toEqual({ $sort: { totalStaked: 1 } });
    expect(pipeline[pipeline.length - 2]).toEqual({ $skip: 0 });
    expect(pipeline[pipeline.length - 1]).toEqual({ $limit: 100 });
    expect(page.page).toBe(1);
    expect(page.limit).toBe(100);
  });
});

describe('LeaderboardService.myRank', () => {
  it('computes the viewer rank from the full ordering', async () => {
    stakeAgg.mockResolvedValue([row('user-1', 60_000, 20_000), row('user-2', 45_000)]);

    const me = await leaderboardService.myRank('user-2', 'month');

    expect(me).toMatchObject({ rank: 2, userId: 'user-2', totalStaked: 45_000 });
  });

  it('returns null for users with no settled stakes', async () => {
    stakeAgg.mockResolvedValue([row('user-1', 60_000)]);

    expect(await leaderboardService.myRank('ghost', 'month')).toBeNull();
  });
});

describe('LeaderboardService.lastWin', () => {
  it('returns the latest payout with pod title and multiplier', async () => {
    stakeFindOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ netPayout: 8500, settledOdds: 1.85, pod: 'pod-1', settledAt: new Date() }) }) }),
    });

    const win = await leaderboardService.lastWin('user-1');

    expect(win).toMatchObject({ podTitle: 'Arsenal vs Chelsea', netPayout: 8500, multiplier: 1.85 });
  });

  it('returns null when there is no win yet', async () => {
    stakeFindOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) }),
    });

    expect(await leaderboardService.lastWin('user-1')).toBeNull();
  });
});