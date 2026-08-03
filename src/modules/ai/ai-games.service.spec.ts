import { aiGamesService } from './ai-games.service';
import { GameAnalysisModel } from '../../models/game-analysis.model';
import { PodModel } from '../../models/pod.model';

jest.mock('../../models/game-analysis.model', () => ({
  GameAnalysisModel: {
    find: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn(),
    countDocuments: jest.fn(),
    distinct: jest.fn(),
  },
}));

jest.mock('../../models/pod.model', () => ({
  PodModel: {
    findOne: jest.fn(),
    find: jest.fn(),
  },
}));

const findMock = GameAnalysisModel.find as jest.Mock;
const updateOneMock = GameAnalysisModel.updateOne as jest.Mock;
const countMock = GameAnalysisModel.countDocuments as jest.Mock;
const distinctMock = GameAnalysisModel.distinct as jest.Mock;
const podFindOneMock = PodModel.findOne as jest.Mock;
const podFindMock = PodModel.find as jest.Mock;

const realFetch = global.fetch;

beforeAll(() => {
  process.env.SPORTSAPI_KEY = 'test-key';
  process.env.DEEPSEEK_API_KEY = 'test-ds-key';
});

afterEach(() => {
  jest.clearAllMocks();
  global.fetch = realFetch;
});

function mockFetch(content: string) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  }) as any;
}

function todayGame(overrides: any = {}): any {
  return {
    _id: { toString: () => 'ga-1' },
    fixtureId: 1001,
    homeTeam: 'Arsenal',
    awayTeam: 'Chelsea',
    league: 'Premier League',
    matchDate: new Date(Date.now() + 5 * 3600000),
    pick: 'Over 2.5',
    marketType: 'Over/Under 2.5',
    gainsMultiplier: 1.85,
    confidence: 72,
    reasoning: 'Both teams score freely at home.',
    availableOdds: 1.85,
    podId: null,
    ...overrides,
  };
}

function mockLeanResult(value: any) {
  const lean = jest.fn().mockResolvedValue(value);
  findMock.mockReturnValue({ sort: () => ({ limit: () => ({ lean }) }) });
}

describe('AIGamesService.getToday', () => {
  it('returns empty list when no games analyzed', async () => {
    mockLeanResult([]);
    const res = await aiGamesService.getToday(1);
    expect(res).toEqual({ items: [], count: 0 });
    expect(findMock).toHaveBeenCalledWith(expect.objectContaining({ matchDate: expect.any(Object) }));
  });

  it('maps docs to game items with pod linking', async () => {
    podFindMock.mockReturnValue({
      select: () => ({
        lean: jest.fn().mockResolvedValue([
          {
            _id: 'pod-9',
            status: 'active',
            opensAt: new Date(Date.now() - 3600000),
            stakingClosesAt: new Date(Date.now() + 3600000),
            bookedExternally: false,
          },
        ]),
      }),
    });
    mockLeanResult([todayGame({ podId: { toString: () => 'pod-9' } }), todayGame({ fixtureId: 1002, podId: null })]);
    const res = await aiGamesService.getToday(1);
    expect(res.count).toBe(2);
    expect(res.items[0].stakable).toBe(true);
    expect(res.items[0].stakeReason).toBeUndefined();
    expect(res.items[0].podId).toBe('pod-9');
    expect(res.items[1].stakable).toBe(false);
    expect(res.items[1].stakeReason).toBe('No live pool yet');
    expect(res.items[1].podId).toBeNull();
  });

  it('marks games as non-stakable when linked pod window is closed', async () => {
    podFindMock.mockReturnValue({
      select: () => ({
        lean: jest.fn().mockResolvedValue([
          {
            _id: 'pod-9',
            status: 'active',
            opensAt: new Date(Date.now() - 24 * 3600000),
            stakingClosesAt: new Date(Date.now() - 3600000),
            bookedExternally: false,
          },
        ]),
      }),
    });
    mockLeanResult([todayGame({ podId: { toString: () => 'pod-9' } })]);
    const res = await aiGamesService.getToday(1);
    expect(res.items[0].stakable).toBe(false);
    expect(res.items[0].stakeReason).toBe('Staking closed');
  });
});

describe('AIGamesService.analyzeToday', () => {
  it('errors when SPORTSAPI_KEY missing', async () => {
    delete process.env.SPORTSAPI_KEY;
    const res = await aiGamesService.analyzeToday();
    expect(res.success).toBe(false);
    expect(res.errors[0]).toContain('SPORTSAPI_KEY');
  });

  it('skips fixtures analyzed within freshness window', async () => {
    process.env.SPORTSAPI_KEY = 'test-key';
    jest.spyOn(aiGamesService as any, 'fetchFixtures').mockResolvedValue([
      { id: 1001, home_team: 'Arsenal', away_team: 'Chelsea', event_date: new Date(Date.now() + 3600000).toISOString(), home_team_id: 1, away_team_id: 2, status: 'notstarted' },
    ]);
    // freshness query returns the fixture as already-analyzed
    const lean = jest.fn().mockResolvedValue([{ fixtureId: 1001, analyzedAt: new Date() }]);
    findMock.mockReturnValue({ select: () => ({ lean }) });
    const ds = jest.spyOn(aiGamesService as any, 'deepseekPick');

    const res = await aiGamesService.analyzeToday();
    expect(res.fixturesFound).toBe(1);
    expect(res.skippedFresh).toBe(1);
    expect(res.analyzed).toBe(0);
    expect(ds).not.toHaveBeenCalled();
  });

  it('analyzes fixtures and upserts with linked pod', async () => {
    process.env.SPORTSAPI_KEY = 'test-key';
    jest.spyOn(aiGamesService as any, 'fetchFixtures').mockResolvedValue([
      { id: 1002, home_team: 'Real Madrid', away_team: 'Barcelona', event_date: new Date(Date.now() + 3 * 3600000).toISOString(), home_team_id: 3, away_team_id: 4, status: 'notstarted', league_id: 3 },
    ]);
    findMock.mockReturnValue({ select: () => ({ lean: jest.fn().mockResolvedValue([]) }) });
    jest.spyOn(aiGamesService as any, 'fetchTeamForm').mockResolvedValue(null);
    jest.spyOn(aiGamesService as any, 'fetchOdds').mockResolvedValue([]);
    mockFetch(JSON.stringify({
      selection: 'Over 2.5',
      marketType: 'Over/Under 2.5',
      multiplier: 1.85,
      confidence: 72,
      reasoning: 'High-scoring form for both teams.',
    }));
    podFindOneMock.mockReturnValue({
      sort: () => ({ _id: { toString: () => 'pod-88' }, selection: 'Over 2.5' }),
    });
    updateOneMock.mockResolvedValue({ upsertedCount: 1 });

    const res = await aiGamesService.analyzeToday();
    expect(res.fixturesFound).toBe(1);
    expect(res.analyzed).toBe(1);
    expect(updateOneMock).toHaveBeenCalledWith(
      { fixtureId: 1002 },
      expect.objectContaining({
        $set: expect.objectContaining({
          pick: 'Over 2.5',
          confidence: 72,
          league: 'La Liga',
          podId: expect.any(Object),
        }),
      }),
      { upsert: true }
    );
  });
});

describe('AIGamesService.list status filters', () => {
  function mockListFind(docs: any[]) {
    const lean = jest.fn().mockResolvedValue(docs);
    findMock.mockReturnValue({
      select: () => ({ sort: () => ({ limit: () => ({ lean }) }) }),
      collation: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean }) }) }) }),
    });
    countMock.mockResolvedValue(docs.length);
    distinctMock.mockResolvedValue([]);
  }

  it('defaults to upcoming window (from now) with no status filter', async () => {
    mockListFind([]);
    await aiGamesService.list({});
    const findCall = findMock.mock.calls.find(c => {
      const f = c[0] as any;
      return f.matchDate && f.matchDate.$gte && !f.matchDate.$lte ? f : null;
    });
    expect(findCall).toBeDefined();
    const matchDate: any = (findCall![0] as any).matchDate;
    const from = new Date(matchDate.$gte);
    const before = Date.now() - 5 * 1000;
    expect(from.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('applies finished filter with a 7-day past window', async () => {
    const finished = todayGame({
      matchDate: new Date(Date.now() - 86400000),
      matchStatus: 'finished',
      homeScore: 2,
      awayScore: 1,
    });
    mockListFind([finished]);
    const res = await aiGamesService.list({ status: 'finished' });
    const findCall = findMock.mock.calls.find(c => {
      const f = c[0] as any;
      return f.matchStatus === 'finished';
    });
    expect(findCall).toBeDefined();
    const from = new Date((findCall![0] as any).matchDate.$gte);
    expect(Date.now() - from.getTime()).toBeGreaterThan(6 * 86400000);
    expect(res.items[0].matchStatus).toBe('finished');
    expect(res.items[0].homeScore).toBe(2);
    expect(res.items[0].result).toBe('home_win');
  });

  it('applies live filter to in-progress statuses', async () => {
    mockListFind([]);
    await aiGamesService.list({ status: 'live' });
    const findCall = findMock.mock.calls.find(c => (c[0] as any).matchStatus && (c[0] as any).matchStatus.$in);
    expect(findCall).toBeDefined();
    expect((findCall![0] as any).matchStatus.$in).toContain('2nd_half');
    expect((findCall![0] as any).matchStatus.$in).toContain('halftime');
  });
});

describe('AIGamesService.syncMatchStatuses', () => {
  it('updates stale non-terminal fixtures with live status and scores', async () => {
    const staleDoc = { _id: 'ga-x', fixtureId: 5005, matchStatus: 'notstarted', statusSyncedAt: null };
    const lean = jest.fn().mockResolvedValue([staleDoc]);
    findMock.mockReturnValue({ select: () => ({ sort: () => ({ limit: () => ({ lean }) }) }) });
    jest.spyOn(aiGamesService as any, 'fetchFixtureStatus').mockResolvedValue({
      status: 'finished',
      homeScore: 3,
      awayScore: 1,
    });
    updateOneMock.mockResolvedValue({});

    await aiGamesService.syncMatchStatuses(10);

    expect(updateOneMock).toHaveBeenCalledWith(
      { fixtureId: 5005 },
      expect.objectContaining({
        $set: expect.objectContaining({
          matchStatus: 'finished',
          homeScore: 3,
          awayScore: 1,
          statusSyncedAt: expect.any(Date),
        }),
      })
    );
  });

  it('skips fixtures synced within the freshness window', async () => {
    const freshDoc = { _id: 'ga-y', fixtureId: 6006, matchStatus: 'inprogress', statusSyncedAt: new Date() };
    const lean = jest.fn().mockResolvedValue([freshDoc]);
    findMock.mockReturnValue({ select: () => ({ sort: () => ({ limit: () => ({ lean }) }) }) });
    const fetchSpy = jest.spyOn(aiGamesService as any, 'fetchFixtureStatus');

    await aiGamesService.syncMatchStatuses(10);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updateOneMock).not.toHaveBeenCalled();
  });
});
