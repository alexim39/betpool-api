import { aiCurationService } from './ai-curation.service';
import { curationAccuracyService } from './curation-accuracy.service';

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

const fixture = {
  id: 9001,
  league_id: 1,
  league: { name: 'Premier League' },
  season_id: 2026,
  home_team_id: 11,
  home_team: 'Arsenal',
  away_team_id: 22,
  away_team: 'Chelsea',
  event_date: '2026-08-08',
  status: 'notstarted',
};

const financialHealth = { reserveRatio: 1, totalReserves: 1000000, totalExposure: 500000, activePodCount: 8 };

const context = (errors: string[] = []) => ({
  success: true, total: 0, recommended: 0, skipped: 0,
  fixtures: [], errors, apiLog: [], skippedReason: null,
  oraWinRate: 50, oraTotalPods: 0, oraWon: 0, confidenceThreshold: 65,
  ledgerAccuracy: null,
} as any);

function jsonResponse(parsed: any) {
  return {
    ok: true,
    json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify(parsed) } }] }),
  } as any;
}

const recommendation = (confidence: number) => ({
  selection: 'Home Win',
  confidence,
  recommendedMultiplier: 1.7,
  valueScore: confidence * 0.7,
  reasoning: 'Strong home form',
});

const parsedSingle = (confidence: number) => ({
  recommendations: [recommendation(confidence)],
  verdict: 'RECOMMEND',
  overallReasoning: 'Home dominance',
  combinedRecommendation: { enabled: false },
});

const parsedCombined = (combinedConfidence: number) => ({
  recommendations: [recommendation(60)],
  verdict: 'SKIP',
  overallReasoning: 'single too weak',
  combinedRecommendation: {
    enabled: true,
    leg1Market: '1X2', leg1Selection: 'Home Win', leg1Multiplier: 1.4,
    leg2Market: 'Over/Under 2.5', leg2Selection: 'Over 2.5', leg2Multiplier: 1.4,
    combinedMultiplier: 1.96,
    combinedConfidence,
    reasoning: 'two solid legs',
  },
});

function ledger(leagueWinRate: number, played = 20): any {
  return {
    played: 100,
    won: Math.round(100 * (leagueWinRate / 100)),
    winRate: leagueWinRate,
    byLeague: [{ key: 'Premier League', played, won: Math.round(played * (leagueWinRate / 100)), winRate: leagueWinRate }],
    byMarket: [],
    sampledAt: new Date().toISOString(),
  };
}

describe('AICurationService.analyzeFixtureEnhanced (ledger tuning)', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    process.env.DEEPSEEK_API_KEY = 'test-key';
  });

  afterEach(() => {
    fetchMock.mockReset();
    delete process.env.DEEPSEEK_API_KEY;
  });

  async function analyze(accuracy: any, parsed: any) {
    return (aiCurationService as any).analyzeFixtureEnhanced(
      fixture,
      undefined,
      undefined,
      [],
      financialHealth,
      context(),
      accuracy
    );
  }

  function promptOfCall(): string {
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    return body.messages[1].content as string;
  }

  it('keeps cold-start behavior when accuracy is null', async () => {
    fetchMock.mockResolvedValue(jsonResponse(parsedSingle(68)));

    const result = await analyze(null, parsedSingle(68));

    expect(result.verdict).toBe('RECOMMEND');
    expect(promptOfCall()).toContain('confidence >= 65');
    expect(fetchMock.mock.calls[0][0]).toBe(DEEPSEEK_URL);
  });

  it('lowers the confidence bar for proven leagues', async () => {
    const adjustmentSpy = jest.spyOn(curationAccuracyService, 'leagueAdjustment');
    fetchMock.mockResolvedValue(jsonResponse(parsedSingle(62)));

    const result = await analyze(ledger(80), parsedSingle(62));

    expect(adjustmentSpy).toHaveBeenCalled();
    expect(result.verdict).toBe('RECOMMEND');
    expect(promptOfCall()).toContain('confidence >= 60');
  });

  it('raises the confidence bar for risky leagues and gates combined picks', async () => {
    const adjustmentSpy = jest.spyOn(curationAccuracyService, 'leagueAdjustment');
    fetchMock.mockResolvedValue(jsonResponse(parsedCombined(68)));

    const result = await analyze(ledger(35), parsedCombined(68));

    expect(adjustmentSpy).toHaveBeenCalled();
    expect(promptOfCall()).toContain('confidence >= 75');
    // 68 < 75 -> combined is rejected, base verdict SKIP stands
    expect(result.verdict).toBe('SKIP');
    expect(result.isCombined).toBeFalsy();
  });

  it('includes the ledger performance block in the DeepSeek prompt', async () => {
    fetchMock.mockResolvedValue(jsonResponse(parsedSingle(70)));

    await analyze(ledger(80), parsedSingle(70));

    const prompt = promptOfCall();
    expect(prompt).toContain('ORA LEDGER PERFORMANCE');
    expect(prompt).toContain('Overall: 100 played, 80 won (80%)');
    expect(prompt).toContain('League (Premier League): 20 played, 16 won (80%)');
  });

  it('says no settled data when accuracy exists but league has none', async () => {
    fetchMock.mockResolvedValue(jsonResponse(parsedSingle(70)));

    await analyze(ledger(70, 0), parsedSingle(70));

    expect(promptOfCall()).toContain('League (Premier League): no settled data yet');
  });

  it('applies the effective threshold to combined recommendations', async () => {
    fetchMock.mockResolvedValue(jsonResponse(parsedCombined(68)));

    const proven = await analyze(ledger(80), parsedCombined(68));
    expect(proven.verdict).toBe('RECOMMEND');
    expect(proven.isCombined).toBe(true);
    expect(proven.combinedLegs).toHaveLength(2);

    const risky = await analyze(ledger(35), parsedCombined(68));
    expect(risky.verdict).toBe('SKIP');
    expect(risky.isCombined).toBeFalsy();
  });
});