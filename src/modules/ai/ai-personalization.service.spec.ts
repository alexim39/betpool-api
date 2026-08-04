import { aiPersonalizationService, BettingProfile } from './ai-personalization.service';
import { StakeModel } from '../../models/stake.model';
import { PickOutcomeModel } from '../../models/pick-outcome.model';
import { UserModel } from '../../models/user.model';

jest.mock('../../models/stake.model', () => ({
  StakeModel: { find: jest.fn() },
}));

jest.mock('../../models/pick-outcome.model', () => ({
  PickOutcomeModel: { find: jest.fn(), distinct: jest.fn() },
}));

jest.mock('../../models/user.model', () => ({
  UserModel: { findById: jest.fn() },
}));

const findMock = StakeModel.find as jest.Mock;
const pickFindMock = PickOutcomeModel.find as jest.Mock;
const distinctMock = PickOutcomeModel.distinct as jest.Mock;
const userFindMock = UserModel.findById as jest.Mock;

function mockStakeQuery(stakes: any[]) {
  const lean = jest.fn().mockResolvedValue(stakes);
  findMock.mockReturnValue({
    sort: () => ({ limit: () => ({ populate: () => ({ lean }) }) }),
  });
}

function mockPickOutcomeQuery(records: any[]) {
  pickFindMock.mockReturnValue({
    sort: () => ({ limit: () => ({ lean: () => Promise.resolve(records) }) }),
  });
}

function mockActiveUser(overrides: any = {}) {
  userFindMock.mockReturnValue({
    lean: () => Promise.resolve({ _id: 'u1', isActive: true, isSuspended: false, ...overrides }),
  });
}

function dayAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

const realFetch = global.fetch;

const historyStakes = [
  { status: 'won', stakeAmount: 5000, isParlay: false, pod: { sport: 'Football', league: 'Premier League', homeTeam: 'Arsenal', awayTeam: 'Chelsea', gainsMultiplier: 1.7, refundPercent: 40 } },
  { status: 'won', stakeAmount: 10000, isParlay: false, pod: { sport: 'Football', league: 'Premier League', homeTeam: 'Arsenal', awayTeam: 'Liverpool', gainsMultiplier: 1.6, refundPercent: 40 } },
  { status: 'lost', stakeAmount: 2000, isParlay: true, pod: { sport: 'Football', league: 'La Liga', homeTeam: 'Real Madrid', awayTeam: 'Barcelona', gainsMultiplier: 3.2, refundPercent: 10 } },
];

const podArsenal = {
  _id: 'p1',
  sport: 'Football',
  league: 'Premier League',
  homeTeam: 'Arsenal',
  awayTeam: 'Leicester',
  gainsMultiplier: 1.5,
  refundPercent: 40,
  opensAt: new Date('2026-08-01T10:00:00Z'),
  metadata: { oraConfidence: 0 },
};
const podFulham = {
  _id: 'p2',
  sport: 'Football',
  league: 'Premier League',
  homeTeam: 'Fulham',
  awayTeam: 'Leicester',
  gainsMultiplier: 1.5,
  refundPercent: 40,
  opensAt: new Date('2026-08-01T11:00:00Z'),
  metadata: { oraConfidence: 0 },
};

beforeEach(() => {
  mockPickOutcomeQuery([]);
  mockActiveUser();
});

afterEach(() => {
  global.fetch = realFetch;
  jest.clearAllMocks();
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.PERSONALIZATION_LLM_REASONS;
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
    expect(profile.historyCount).toBe(0);
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

  it('merges ledger signals into the profile', async () => {
    mockStakeQuery(historyStakes);
    mockPickOutcomeQuery([
      { outcome: 'lost', stakeAmount: 2000, settledAt: dayAgo(2) },
      { outcome: 'lost', stakeAmount: 2000, settledAt: dayAgo(5) },
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(6) },
      { outcome: 'won', stakeAmount: 1000, settledAt: dayAgo(10) },
    ]);

    const profile = await aiPersonalizationService.getProfile('signals-user');

    expect(profile.historyCount).toBe(4);
    expect(profile.winRate90d).toBe(0.5);
    expect(profile.lossStreak).toBe(2);
    expect(profile.dampen).toBe(0.4);
    expect(profile.avgStake).toBe(2500);
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

describe('AIPersonalizationService — hybrid reranking (personalize)', () => {
  it('skips personalization for users with no settled history (cold start)', async () => {
    mockStakeQuery([]);
    mockPickOutcomeQuery([]);

    const result = await aiPersonalizationService.personalize([podArsenal, podFulham], 'u-cold');

    expect(result.personalized).toBe(false);
    expect(result.items[0]._id).toBe('p1');
    expect(result.items[0].whyRecommended).toBeUndefined();
  });

  it('skips personalization for suspended users', async () => {
    mockActiveUser({ isSuspended: true });
    mockStakeQuery(historyStakes);
    mockPickOutcomeQuery([{ outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(2) }]);

    const result = await aiPersonalizationService.personalize([podArsenal, podFulham], 'u-susp');

    expect(result.personalized).toBe(false);
    expect(result.items[0]._id).toBe('p1');
  });

  it('ranks favorite-team pods first and attaches whyRecommended', async () => {
    mockStakeQuery(historyStakes);
    mockPickOutcomeQuery([
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(2) },
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(4) },
      { outcome: 'lost', stakeAmount: 2000, settledAt: dayAgo(6) },
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(8) },
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(10) },
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(12) },
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(14) },
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(16) },
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(18) },
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(20) },
    ]);

    const result = await aiPersonalizationService.personalize([podFulham, podArsenal], 'u-rank');

    expect(result.personalized).toBe(true);
    expect(result.items[0]._id).toBe('p1');
    expect(result.items[0].whyRecommended).toContain('Arsenal');
    expect(result.items[1].whyRecommended).toContain('Premier League');
    expect(typeof result.items[0].personalizationScore).toBe('number');
  });

  it('enters protective mode after 3 consecutive losses and dampens the boost', async () => {
    mockStakeQuery([]);
    mockPickOutcomeQuery([
      { outcome: 'lost', stakeAmount: 2000, settledAt: dayAgo(1) },
      { outcome: 'lost', stakeAmount: 2000, settledAt: dayAgo(2) },
      { outcome: 'lost', stakeAmount: 2000, settledAt: dayAgo(3) },
    ]);

    const result = await aiPersonalizationService.personalize([podArsenal, podFulham], 'u-protect');

    expect(result.personalized).toBe(true);
    expect(result.protective).toBe(true);
    expect(result.items[0].whyRecommended.startsWith('Safeguard after losses')).toBe(true);
  });

  it('uses cached LLM one-liners for the top recommendations when enabled', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    process.env.PERSONALIZATION_LLM_REASONS = '1';
    mockStakeQuery([]);
    mockPickOutcomeQuery([
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(2) },
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(4) },
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(6) },
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(8) },
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(10) },
    ]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '["Nice fit for your Arsenal form.", "Your league, your edge."]' } }],
      }),
    } as any);

    const result = await aiPersonalizationService.personalize([podArsenal, podFulham], 'u-llm');

    expect(result.items[0].whyRecommended).toBe('Nice fit for your Arsenal form.');
    expect(result.items[1].whyRecommended).toBe('Your league, your edge.');
  });

  it('keeps deterministic reasons when the LLM polish fails', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    process.env.PERSONALIZATION_LLM_REASONS = '1';
    mockStakeQuery([]);
    mockPickOutcomeQuery([
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(2) },
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(4) },
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(6) },
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(8) },
      { outcome: 'won', stakeAmount: 5000, settledAt: dayAgo(10) },
    ]);
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));

    const result = await aiPersonalizationService.personalize([podArsenal, podFulham], 'u-llmfail');

    expect(result.items[0].whyRecommended).toContain('High-probability pick');
  });
});

describe('AIPersonalizationService — warm-up', () => {
  it('warms profiles for users with recent settled activity', async () => {
    distinctMock.mockResolvedValue(['u1', 'u2']);
    mockStakeQuery([]);
    mockPickOutcomeQuery([]);

    const warmed = await aiPersonalizationService.warmAllProfiles();

    expect(warmed).toBe(2);
    expect(distinctMock).toHaveBeenCalled();
  });
});
