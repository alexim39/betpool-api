import { aiPersonalizationService, BettingProfile } from './ai-personalization.service';
import { StakeModel } from '../../models/stake.model';

jest.mock('../../models/stake.model', () => ({
  StakeModel: { find: jest.fn() },
}));

const findMock = StakeModel.find as jest.Mock;

function mockStakeQuery(stakes: any[]) {
  const lean = jest.fn().mockResolvedValue(stakes);
  findMock.mockReturnValue({
    sort: () => ({ limit: () => ({ populate: () => ({ lean }) }) }),
  });
}

const realFetch = global.fetch;

const historyStakes = [
  { status: 'won', stakeAmount: 5000, isParlay: false, pod: { sport: 'Football', league: 'Premier League', homeTeam: 'Arsenal', awayTeam: 'Chelsea', gainsMultiplier: 1.7, refundPercent: 40 } },
  { status: 'won', stakeAmount: 10000, isParlay: false, pod: { sport: 'Football', league: 'Premier League', homeTeam: 'Arsenal', awayTeam: 'Liverpool', gainsMultiplier: 1.6, refundPercent: 40 } },
  { status: 'lost', stakeAmount: 2000, isParlay: true, pod: { sport: 'Football', league: 'La Liga', homeTeam: 'Real Madrid', awayTeam: 'Barcelona', gainsMultiplier: 3.2, refundPercent: 10 } },
];

afterEach(() => {
  global.fetch = realFetch;
  jest.clearAllMocks();
  delete process.env.DEEPSEEK_API_KEY;
});

describe('AIPersonalizationService — AI path (provider reachable)', () => {
  it('generates an AI profile from history when the provider responds', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    mockStakeQuery(historyStakes);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '{"preferredSports":["Football"],"preferredTeams":["Arsenal"],"preferredLeagues":["Premier League"],"riskTolerance":"low","style":"singles"}',
          },
        }],
      }),
    } as any);

    const profile = await aiPersonalizationService.getProfile('ai-user-1');

    expect(profile.source).toBe('ai');
    expect(profile.preferredSports).toEqual(['Football']);
    expect(profile.preferredTeams).toEqual(['Arsenal']);
    expect(profile.preferredLeagues).toEqual(['Premier League']);
    expect(profile.riskTolerance).toBe('low');
    expect(profile.style).toBe('singles');
  });

  it('survives malformed AI output and falls back to rules', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    mockStakeQuery(historyStakes);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not json at all' } }] }),
    } as any);

    const profile = await aiPersonalizationService.getProfile('ai-user-2');

    expect(profile.source).toBe('rules');
    expect(profile.preferredSports).toEqual(['Football']);
  });
});

describe('AIPersonalizationService — fallback (provider unreachable)', () => {
  it('falls back to a rules profile derived from stake history', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    mockStakeQuery(historyStakes);
    global.fetch = jest.fn().mockRejectedValue(new Error('SSL handshake blocked'));

    const profile = await aiPersonalizationService.getProfile('rule-user-1');

    expect(profile.source).toBe('rules');
    expect(profile.preferredSports).toEqual(['Football']);
    expect(profile.preferredTeams).toContain('Arsenal');
    expect(profile.preferredTeams).toContain('Chelsea');
    expect(profile.preferredLeagues).toEqual(['Premier League', 'La Liga']);
    expect(profile.riskTolerance).toBe('medium');
    expect(profile.style).toBe('mixed');
  });

  it('returns a neutral profile with no history and does not call the provider', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    mockStakeQuery([]);
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;

    const profile = await aiPersonalizationService.getProfile('rule-user-2');

    expect(profile.source).toBe('rules');
    expect(profile.preferredSports).toEqual([]);
    expect(profile.preferredTeams).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('AIPersonalizationService — scoring', () => {
  const profile: BettingProfile = {
    preferredSports: ['Football'],
    preferredTeams: ['Arsenal'],
    preferredLeagues: ['Premier League'],
    riskTolerance: 'low',
    style: 'singles',
    source: 'ai',
  };

  it('scores favorite-sport pods above unrelated pods', () => {
    const favSport = { sport: 'Football', league: 'Premier League', homeTeam: 'Liverpool', awayTeam: 'Everton', gainsMultiplier: 1.6, refundPercent: 40, metadata: { oraConfidence: 60 } };
    const otherSport = { sport: 'Basketball', league: 'NBA', homeTeam: 'Lakers', awayTeam: 'Celtics', gainsMultiplier: 1.9, refundPercent: 30, metadata: { oraConfidence: 60 } };

    expect(aiPersonalizationService.scorePod(favSport, profile)).toBeGreaterThan(
      aiPersonalizationService.scorePod(otherSport, profile)
    );
  });

  it('gives the biggest boost to pods featuring a favorite team', () => {
    const withTeam = { sport: 'Football', league: 'Premier League', homeTeam: 'Arsenal', awayTeam: 'Leicester', gainsMultiplier: 1.5, refundPercent: 40, metadata: { oraConfidence: 60 } };
    const sameSport = { sport: 'Football', league: 'Premier League', homeTeam: 'Fulham', awayTeam: 'Leicester', gainsMultiplier: 1.5, refundPercent: 40, metadata: { oraConfidence: 60 } };

    expect(aiPersonalizationService.scorePod(withTeam, profile)).toBeGreaterThan(
      aiPersonalizationService.scorePod(sameSport, profile) + 10
    );
  });

  it('penalizes pods outside the user risk band', () => {
    const lowRisk = { sport: 'Football', league: 'Premier League', homeTeam: 'Fulham', awayTeam: 'Leicester', gainsMultiplier: 1.5, refundPercent: 40, metadata: { oraConfidence: 60 } };
    const highRisk = { sport: 'Football', league: 'Premier League', homeTeam: 'Fulham', awayTeam: 'Leicester', gainsMultiplier: 3.8, refundPercent: 40, metadata: { oraConfidence: 60 } };

    expect(aiPersonalizationService.scorePod(lowRisk, profile)).toBeGreaterThan(
      aiPersonalizationService.scorePod(highRisk, profile)
    );
  });
});
