import { AISettlementService } from './ai-settlement.service';

jest.mock('axios');
import axios from 'axios';

jest.mock('../../models/pod.model', () => ({
  PodModel: {
    findById: jest.fn(),
    find: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    countDocuments: jest.fn(),
  },
}));

import { PodModel } from '../../models/pod.model';

const axiosGetMock = axios.get as unknown as jest.Mock;

const pod = (selection: string, homeTeam = 'New York City FC', awayTeam = 'Philadelphia Union') => ({
  _id: { toString: () => 'pod-1' },
  title: `${homeTeam} vs ${awayTeam}`,
  homeTeam,
  awayTeam,
  selection,
  metadata: { fixtureId: 123 },
});

function mockMatch(homeScore: number, awayScore: number, status = 'finished') {
  axiosGetMock.mockImplementation((url: string) => {
    if (url.includes('/events/123/')) {
      return Promise.resolve({
        data: {
          id: 123,
          status,
          home_team_id: 11,
          away_team_id: 22,
          home_score: homeScore,
          away_score: awayScore,
          event_date: '2026-08-10T19:00:00.000Z',
        },
      });
    }
    return Promise.resolve({
      data: {
        results: [{ id: 123, home_team_id: 11, away_team_id: 22, home_score: homeScore, away_score: awayScore }],
      },
    });
  });
}

describe('AISettlementService.checkPod', () => {
  let service: AISettlementService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AISettlementService();
    (PodModel.findById as jest.Mock).mockReturnValue({ populate: jest.fn().mockResolvedValue(pod('Home Win')) });
  });

  afterEach(() => {
    delete process.env.SPORTSAPI_KEY;
    delete process.env.DEEPSEEK_API_KEY;
  });

  it.each([
    ['Over 1.50', 1, 1, 'win'],
    ['Over 1.50', 2, 0, 'win'],
    ['Over 2.5', 2, 0, 'loss'],
    ['Under 2.5', 1, 0, 'win'],
    ['Under 1.50', 1, 1, 'loss'],
    ['Over 0.5', 0, 0, 'loss'],
  ])('settles %s pick on total goals (%i-%i) as %s', async (selection, home, away, expected) => {
    mockMatch(home, away);
    (PodModel.findById as jest.Mock).mockReturnValue({ populate: jest.fn().mockResolvedValue(pod(selection)) });
    const result = await service.checkPod('pod-1');
    expect(result.recommendedResult).toBe(expected);
    expect(result.homeScore).toBe(home);
    expect(result.awayScore).toBe(away);
  });

  it('settles Over pick as void (push) when total equals the line', async () => {
    mockMatch(2, 0);
    (PodModel.findById as jest.Mock).mockReturnValue({ populate: jest.fn().mockResolvedValue(pod('Over 2.0')) });
    const result = await service.checkPod('pod-1');
    expect(result.recommendedResult).toBe('void');
    expect(result.reasoning).toContain('refund');
  });

  it('does not treat the line number as a 1X2 home marker ("Over 1.50" must not mean home win)', async () => {
    mockMatch(0, 2);
    (PodModel.findById as jest.Mock).mockReturnValue({ populate: jest.fn().mockResolvedValue(pod('Over 1.50')) });
    const result = await service.checkPod('pod-1');
    expect(result.recommendedResult).toBe('win');
  });

  it('does not treat the line number as a 1X2 away marker ("Over 2.50" must not mean away win)', async () => {
    mockMatch(3, 0);
    (PodModel.findById as jest.Mock).mockReturnValue({ populate: jest.fn().mockResolvedValue(pod('Over 2.50')) });
    const result = await service.checkPod('pod-1');
    expect(result.recommendedResult).toBe('win');
  });

  it.each([
    ['Home Win', 2, 0, 'win'],
    ['Draw', 1, 1, 'win'],
    ['Away Win', 1, 2, 'win'],
    ['Home Win', 0, 2, 'loss'],
    ['12', 2, 1, 'win'],
    ['1X', 1, 1, 'win'],
    ['X2', 1, 2, 'win'],
  ])('still settles 1X2/double-chance pick %s (%i-%i) as %s', async (selection, home, away, expected) => {
    mockMatch(home, away);
    (PodModel.findById as jest.Mock).mockReturnValue({ populate: jest.fn().mockResolvedValue(pod(selection)) });
    const result = await service.checkPod('pod-1');
    expect(result.recommendedResult).toBe(expected);
  });

  it.each([
    ['BTTS Yes', 2, 1, 'win'],
    ['BTTS Yes', 2, 0, 'loss'],
    ['BTTS No', 2, 0, 'win'],
    ['BTTS No', 1, 1, 'loss'],
  ])('settles BTTS pick %s (%i-%i) as %s', async (selection, home, away, expected) => {
    mockMatch(home, away);
    (PodModel.findById as jest.Mock).mockReturnValue({ populate: jest.fn().mockResolvedValue(pod(selection)) });
    const result = await service.checkPod('pod-1');
    expect(result.recommendedResult).toBe(expected);
  });

  it('flags composite picks (e.g. "Home & Over 2.5") for manual review', async () => {
    mockMatch(3, 0);
    (PodModel.findById as jest.Mock).mockReturnValue({ populate: jest.fn().mockResolvedValue(pod('Home & Over 2.5')) });
    const result = await service.checkPod('pod-1');
    expect(result.recommendedResult).toBe('cannot_determine');
    expect(result.reasoning).toContain('manual');
  });

  it('flags multi-line picks (e.g. "Over 1.5 & Under 2.5") for manual review', async () => {
    mockMatch(2, 1);
    (PodModel.findById as jest.Mock).mockReturnValue({ populate: jest.fn().mockResolvedValue(pod('Over 1.5 & Under 2.5')) });
    const result = await service.checkPod('pod-1');
    expect(result.recommendedResult).toBe('cannot_determine');
    expect(result.reasoning).toContain('manual');
  });

  it('settles Draw No Bet home pick as loss on a draw', async () => {
    mockMatch(1, 1);
    (PodModel.findById as jest.Mock).mockReturnValue({ populate: jest.fn().mockResolvedValue(pod('Draw No Bet Home')) });
    const result = await service.checkPod('pod-1');
    expect(result.recommendedResult).toBe('loss');
  });

  it('keeps score-mismatch disputes intact', async () => {
    axiosGetMock.mockImplementation((url: string) => {
      if (url.includes('/events/123/')) {
        return Promise.resolve({
          data: { id: 123, status: 'finished', home_team_id: 11, away_team_id: 22, home_score: 2, away_score: 0, event_date: '2026-08-10T19:00:00.000Z' },
        });
      }
      return Promise.resolve({
        data: { results: [{ id: 123, home_team_id: 11, away_team_id: 22, home_score: 1, away_score: 0 }] },
      });
    });
    (PodModel.findById as jest.Mock).mockReturnValue({ populate: jest.fn().mockResolvedValue(pod('Home Win')) });
    const result = await service.checkPod('pod-1');
    expect(result.disputed).toBe(true);
    expect(result.recommendedResult).toBe('cannot_determine');
  });

  it('aligns scores when the API lists the fixture with the teams in the opposite order', async () => {
    axiosGetMock.mockImplementation((url: string) => {
      if (url.includes('/events/123/')) {
        return Promise.resolve({
          data: {
            id: 123,
            status: 'finished',
            home_team_id: 22,
            away_team_id: 11,
            home_team: 'Philadelphia Union',
            away_team: 'New York City FC',
            home_score: 0,
            away_score: 2,
            event_date: '2026-08-10T19:00:00.000Z',
          },
        });
      }
      return Promise.resolve({
        data: { results: [{ id: 123, home_team_id: 22, away_team_id: 11, home_score: 0, away_score: 2 }] },
      });
    });
    (PodModel.findById as jest.Mock).mockReturnValue({ populate: jest.fn().mockResolvedValue(pod('Home Win')) });
    const result = await service.checkPod('pod-1');
    expect(result.homeScore).toBe(2);
    expect(result.awayScore).toBe(0);
    expect(result.recommendedResult).toBe('win');
  });

  it('refuses to settle when the API event teams do not match the pod fixture', async () => {
    axiosGetMock.mockImplementation((url: string) => {
      if (url.includes('/events/123/')) {
        return Promise.resolve({
          data: {
            id: 123,
            status: 'finished',
            home_team_id: 33,
            away_team_id: 44,
            home_team: 'Los Angeles FC',
            away_team: 'Seattle Sounders',
            home_score: 3,
            away_score: 1,
            event_date: '2026-08-10T19:00:00.000Z',
          },
        });
      }
      return Promise.resolve({ data: { results: [] } });
    });
    (PodModel.findById as jest.Mock).mockReturnValue({ populate: jest.fn().mockResolvedValue(pod('Home Win')) });
    const result = await service.checkPod('pod-1');
    expect(result.matchFound).toBe(false);
    expect(result.recommendedResult).toBe('cannot_determine');
    expect(result.reasoning).toContain('Manual settlement required');
  });

  it('matches team names despite club suffixes ("Angel City FC" vs "Angel City")', async () => {
    axiosGetMock.mockImplementation((url: string) => {
      if (url.includes('/events/123/')) {
        return Promise.resolve({
          data: {
            id: 123,
            status: 'finished',
            home_team_id: 11,
            away_team_id: 22,
            home_team: 'Angel City',
            away_team: 'Washington Spirit',
            home_score: 2,
            away_score: 0,
            event_date: '2026-08-10T19:00:00.000Z',
          },
        });
      }
      return Promise.resolve({
        data: { results: [{ id: 123, home_team_id: 11, away_team_id: 22, home_score: 2, away_score: 0 }] },
      });
    });
    (PodModel.findById as jest.Mock).mockReturnValue({ populate: jest.fn().mockResolvedValue(pod('Home Win', 'Angel City FC', 'Washington Spirit')) });
    const result = await service.checkPod('pod-1');
    expect(result.matchFound).toBe(true);
    expect(result.recommendedResult).toBe('win');
  });
});
