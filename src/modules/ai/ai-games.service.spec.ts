import { aiGamesService } from './ai-games.service';
import { GameAnalysisModel } from '../../models/game-analysis.model';
import { PodModel } from '../../models/pod.model';

jest.mock('../../models/game-analysis.model', () => ({
  GameAnalysisModel: {
    find: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn(),
  },
}));

jest.mock('../../models/pod.model', () => ({
  PodModel: {
    findOne: jest.fn(),
  },
}));

const findMock = GameAnalysisModel.find as jest.Mock;
const updateOneMock = GameAnalysisModel.updateOne as jest.Mock;
const podFindOneMock = PodModel.findOne as jest.Mock;

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
    mockLeanResult([todayGame({ podId: { toString: () => 'pod-9' } }), todayGame({ fixtureId: 1002, podId: null })]);
    const res = await aiGamesService.getToday(1);
    expect(res.count).toBe(2);
    expect(res.items[0].stakable).toBe(true);
    expect(res.items[0].podId).toBe('pod-9');
    expect(res.items[1].stakable).toBe(false);
    expect(res.items[1].podId).toBeNull();
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
