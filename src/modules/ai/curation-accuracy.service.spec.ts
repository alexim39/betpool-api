import { PickOutcomeModel } from '../../models/pick-outcome.model';
import { curationAccuracyService, CurationAccuracyStats } from './curation-accuracy.service';

jest.mock('../../models/pick-outcome.model', () => ({
  PickOutcomeModel: { aggregate: jest.fn() },
}));

const aggregateMock = PickOutcomeModel.aggregate as jest.Mock;

function statsOf(overrides: Partial<CurationAccuracyStats> = {}): CurationAccuracyStats {
  return {
    played: 0,
    won: 0,
    winRate: 0,
    byLeague: [],
    byMarket: [],
    sampledAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  curationAccuracyService.invalidate();
});

describe('CurationAccuracyService.getStats', () => {
  it('aggregates played/won/winRate per league and per market', async () => {
    aggregateMock
      .mockResolvedValueOnce([
        { _id: 'Premier League', played: 10, won: 8 },
        { _id: 'La Liga', played: 4, won: 1 },
      ])
      .mockResolvedValueOnce([
        { _id: '1X2', played: 8, won: 6 },
        { _id: 'Over/Under 2.5', played: 6, won: 3 },
      ]);

    const stats = await curationAccuracyService.getStats();

    expect(stats).toMatchObject({
      played: 14,
      won: 9,
      winRate: 64,
    });
    expect(stats?.byLeague[0]).toMatchObject({ key: 'Premier League', played: 10, won: 8, winRate: 80 });
    expect(stats?.byLeague[1]).toMatchObject({ key: 'La Liga', played: 4, won: 1, winRate: 25 });
    expect(stats?.byMarket[0]).toMatchObject({ key: '1X2', played: 8, won: 6, winRate: 75 });
  });

  it('sorts groups by played desc', async () => {
    aggregateMock
      .mockResolvedValueOnce([
        { _id: 'A', played: 2, won: 1 },
        { _id: 'B', played: 9, won: 8 },
      ])
      .mockResolvedValueOnce([]);

    const stats = await curationAccuracyService.getStats();

    expect(stats?.byLeague.map(s => s.key)).toEqual(['B', 'A']);
  });

  it('excludes outcome=skip rows from accuracy', async () => {
    aggregateMock
      .mockResolvedValueOnce([{ _id: 'Premier League', played: 5, won: 3 }])
      .mockResolvedValueOnce([]);

    const stats = await curationAccuracyService.getStats();

    expect(stats?.byLeague[0]).toMatchObject({ played: 5, won: 3 });
  });

  it('returns stats with played 0 for an empty ledger (cold start)', async () => {
    aggregateMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const stats = await curationAccuracyService.getStats();

    expect(stats?.played).toBe(0);
    expect(stats?.winRate).toBe(0);
    expect(stats?.byLeague).toEqual([]);
    expect(curationAccuracyService.leagueAdjustment('Premier League', stats)).toBe(0);
  });

  it('caches aggregated stats until invalidated', async () => {
    aggregateMock
      .mockResolvedValueOnce([{ _id: 'Premier League', played: 6, won: 4 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ _id: 'Premier League', played: 9, won: 8 }])
      .mockResolvedValueOnce([]);

    const first = await curationAccuracyService.getStats();
    const second = await curationAccuracyService.getStats();

    expect(second).toBe(first);
    expect(aggregateMock).toHaveBeenCalledTimes(2);

    curationAccuracyService.invalidate();

    const third = await curationAccuracyService.getStats();
    expect(third?.byLeague[0].played).toBe(9);
    expect(aggregateMock).toHaveBeenCalledTimes(4);
  });

  it('returns null and does not cache when aggregation fails', async () => {
    aggregateMock.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([]);

    const stats = await curationAccuracyService.getStats();

    expect(stats).toBeNull();
    expect(curationAccuracyService.leagueAdjustment('Premier League')).toBe(0);
  });
});

describe('CurationAccuracyService adjustments', () => {
  it('lowers the bar for proven leagues', () => {
    const stats = statsOf({
      byLeague: [{ key: 'Premier League', played: 20, won: 15, winRate: 75 }],
    });

    expect(curationAccuracyService.leagueAdjustment('Premier League', stats)).toBe(-5);
    expect(curationAccuracyService.leagueAdjustment('premier league', stats)).toBe(-5);
  });

  it('raises the bar for chronically losing leagues', () => {
    const stats = statsOf({
      byLeague: [{ key: 'La Liga', played: 20, won: 6, winRate: 30 }],
    });

    expect(curationAccuracyService.leagueAdjustment('La Liga', stats)).toBe(10);
  });

  it('uses mild positive adjustment for weak-but-not-catastrophic leagues', () => {
    const stats = statsOf({
      byLeague: [{ key: 'Serie A', played: 20, won: 9, winRate: 45 }],
    });

    expect(curationAccuracyService.leagueAdjustment('Serie A', stats)).toBe(5);
  });

  it('stays neutral below the minimum sample size', () => {
    const stats = statsOf({
      byLeague: [{ key: 'Serie A', played: 3, won: 3, winRate: 100 }],
    });

    expect(curationAccuracyService.leagueAdjustment('Serie A', stats)).toBe(0);
  });

  it('honors the CURATION_ACCURACY_MIN_SAMPLE env override', async () => {
    process.env.CURATION_ACCURACY_MIN_SAMPLE = '2';
    try {
      const stats = statsOf({
        byLeague: [{ key: 'Serie A', played: 3, won: 3, winRate: 100 }],
      });

      expect(curationAccuracyService.leagueAdjustment('Serie A', stats)).toBe(-5);
    } finally {
      delete process.env.CURATION_ACCURACY_MIN_SAMPLE;
    }
  });

  it('is neutral for unknown leagues and markets', () => {
    const stats = statsOf({
      byLeague: [{ key: 'Premier League', played: 20, won: 14, winRate: 70 }],
      byMarket: [{ key: '1X2', played: 20, won: 14, winRate: 70 }],
    });

    expect(curationAccuracyService.leagueAdjustment('Ekstraklasa', stats)).toBe(0);
    expect(curationAccuracyService.marketAdjustment('1X2', stats)).toBe(-5);
    expect(curationAccuracyService.marketAdjustment('BTTS', stats)).toBe(0);
  });

  it('uses cached stats when no explicit stats are passed', async () => {
    aggregateMock
      .mockResolvedValueOnce([{ _id: 'Premier League', played: 20, won: 14 }])
      .mockResolvedValueOnce([]);

    await curationAccuracyService.getStats();

    expect(curationAccuracyService.leagueAdjustment('Premier League')).toBe(-5);
  });
});

describe('CurationAccuracyService.promptBlock', () => {
  it('produces an overall + league + markets summary', () => {
    const stats = statsOf({
      played: 30,
      won: 21,
      winRate: 70,
      byLeague: [{ key: 'Premier League', played: 10, won: 8, winRate: 80 }],
      byMarket: [
        { key: '1X2', played: 12, won: 9, winRate: 75 },
        { key: 'Over/Under 2.5', played: 8, won: 4, winRate: 50 },
      ],
    });

    const block = curationAccuracyService.promptBlock('Premier League', stats);

    expect(block).toContain('Overall: 30 played, 21 won (70%)');
    expect(block).toContain('League (Premier League): 10 played, 8 won (80%)');
    expect(block).toContain('Markets: 1X2 — 12 played, 75% won');
    expect(block).toContain('Over/Under 2.5 — 8 played, 50% won');
  });

  it('handles leagues without data yet', () => {
    const stats = statsOf({ played: 30, won: 21, winRate: 70, byMarket: [] });

    const block = curationAccuracyService.promptBlock('La Liga', stats);

    expect(block).toContain('League (La Liga): no settled data yet');
  });

  it('returns a cold-start message when there is no ledger', () => {
    const block = curationAccuracyService.promptBlock('Premier League', null);

    expect(block).toBe('No settled-outcome ledger data yet.');
  });
});