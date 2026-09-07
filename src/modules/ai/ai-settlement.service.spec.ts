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
jest.mock('../../models/stake.model', () => ({
  StakeModel: { find: jest.fn(), findById: jest.fn(), countDocuments: jest.fn() },
}));

const mockSettleStakeLeg = jest.fn().mockResolvedValue({});
const mockSettleStake = jest.fn().mockResolvedValue({});
jest.mock('../admin/admin.service', () => ({
  AdminService: jest.fn().mockImplementation(() => ({
    settleStakeLeg: (...args: any[]) => mockSettleStakeLeg(...args),
    settleStake: (...args: any[]) => mockSettleStake(...args),
  })),
}));

import { PodModel } from '../../models/pod.model';
import { StakeModel } from '../../models/stake.model';

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

describe('AISettlementService.listStuckStakes', () => {
  let service: AISettlementService;
  const stakeFind = StakeModel.find as jest.Mock;

  const oldDate = new Date(Date.now() - 60 * 86400000);
  const futureDate = new Date(Date.now() + 86400000);

  function mockStakeFind(stakes: any[]) {
    const lean = jest.fn().mockResolvedValue(stakes);
    const limit = jest.fn().mockReturnValue({ lean });
    const sort = jest.fn().mockReturnValue({ limit });
    const p3: any = { populate: jest.fn(), sort };
    p3.populate.mockReturnValue({ sort });
    const p2: any = { populate: jest.fn().mockReturnValue(p3) };
    const p1: any = { populate: jest.fn().mockReturnValue(p2) };
    stakeFind.mockReturnValue(p1);
  }

  const staleLeg = (overrides: Record<string, unknown> = {}) => ({
    pod: { _id: 'pod-1', title: 'A vs B', status: 'active', matchDate: oldDate },
    status: 'pending',
    homeTeam: 'A',
    awayTeam: 'B',
    selection: 'Home or Draw',
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AISettlementService();
  });

  it('lists old stakes whose pending legs all concluded long ago', async () => {
    mockStakeFind([{
      _id: 'stake-1',
      user: { _id: 'u1', fullName: 'Alex Imenwo' },
      status: 'confirmed',
      createdAt: oldDate,
      items: [staleLeg(), { ...staleLeg(), status: 'won' }],
    }]);
    const out = await service.listStuckStakes(7);
    expect(out).toHaveLength(1);
    expect(out[0].stakeId).toBe('stake-1');
    expect(out[0].user).toBe('Alex Imenwo');
    expect(out[0].legs).toHaveLength(1);
    expect(out[0].legs[0].podId).toBe('pod-1');
  });

  it('excludes stakes with a genuinely upcoming leg', async () => {
    mockStakeFind([{
      _id: 'stake-2',
      user: 'u2',
      status: 'confirmed',
      createdAt: oldDate,
      items: [staleLeg({ pod: { _id: 'pod-9', title: 'C vs D', status: 'active', matchDate: futureDate } })],
    }]);
    const out = await service.listStuckStakes(7);
    expect(out).toHaveLength(0);
  });

  it('includes legs whose pod document is gone', async () => {
    mockStakeFind([{
      _id: 'stake-3',
      user: 'u3',
      status: 'pending',
      createdAt: oldDate,
      items: [{ pod: null, status: 'pending', homeTeam: 'E', awayTeam: 'F' }],
    }]);
    const out = await service.listStuckStakes(7);
    expect(out).toHaveLength(1);
    expect(out[0].legs[0].podId).toBeNull();
    expect(out[0].legs[0].reason).toContain('gone');
  });
});

describe('AISettlementService.sweepStaleStakes', () => {
  let service: AISettlementService;
  const stakeFind = StakeModel.find as jest.Mock;
  const stakeFindById = StakeModel.findById as jest.Mock;

  const oldDate = new Date(Date.now() - 60 * 86400000);

  function mockStakeFind(stakes: any[]) {
    const lean = jest.fn().mockResolvedValue(stakes);
    const limit = jest.fn().mockReturnValue({ lean });
    const sort = jest.fn().mockReturnValue({ limit });
    const p3: any = { populate: jest.fn(), sort };
    p3.populate.mockReturnValue({ sort });
    const p2: any = { populate: jest.fn().mockReturnValue(p3) };
    const p1: any = { populate: jest.fn().mockReturnValue(p2) };
    stakeFind.mockReturnValue(p1);
  }

  const staleStake = (items: any[]) => ({
    _id: 'stake-1',
    user: { _id: 'u1', fullName: 'Alex Imenwo' },
    status: 'confirmed',
    createdAt: oldDate,
    items,
  });

  const stalePodLeg = () => ({
    pod: { _id: 'pod-1', title: 'A vs B', status: 'active', matchDate: oldDate },
    status: 'pending',
    homeTeam: 'A',
    awayTeam: 'B',
    selection: 'Home or Draw',
  });

  // Realistic 2-leg parlay: one leg already decided, one still pending.
  const parlayWithPendingLeg = (pendingLeg: any) => [
    pendingLeg,
    { pod: { _id: 'pod-2', title: 'C vs D', status: 'settled', matchDate: oldDate }, status: 'won', homeTeam: 'C', awayTeam: 'D', selection: 'Over 1.5' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AISettlementService();
    mockSettleStakeLeg.mockResolvedValue({});
    mockSettleStake.mockResolvedValue({});
    (StakeModel.countDocuments as jest.Mock).mockResolvedValue(0);
    (PodModel.findById as jest.Mock).mockReturnValue({ populate: jest.fn().mockResolvedValue(pod('Home or Draw')) });
  });

  it('voids the leg of a postponed fixture and counts the stake resolved', async () => {
    axiosGetMock.mockImplementation((url: string) => {
      if (url.includes('/events/123/')) {
        return Promise.resolve({ data: { id: 123, status: 'postponed', home_team_id: 11, away_team_id: 22, event_date: '2026-06-01T19:00:00.000Z' } });
      }
      return Promise.resolve({ data: { results: [] } });
    });
    mockStakeFind([staleStake(parlayWithPendingLeg(stalePodLeg()))]);
    (stakeFindById as jest.Mock).mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ status: 'void' }) }) });

    const res = await service.sweepStaleStakes('admin-1', 7);

    expect(mockSettleStakeLeg).toHaveBeenCalledWith('stake-1', 0, 'void', 'admin-1');
    expect(res.resolved).toBe(1);
    expect(res.stillStuck).toHaveLength(0);
  });

  it('voids legs whose pod document is gone without calling the sports API', async () => {
    mockStakeFind([staleStake(parlayWithPendingLeg({ pod: null, status: 'pending', homeTeam: 'E', awayTeam: 'F' }))]);
    (stakeFindById as jest.Mock).mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ status: 'void' }) }) });

    const res = await service.sweepStaleStakes('admin-1', 7);

    expect(axiosGetMock).not.toHaveBeenCalled();
    expect(mockSettleStakeLeg).toHaveBeenCalledWith('stake-1', 0, 'void', 'admin-1');
    expect(res.resolved).toBe(1);
  });

  it('settles a finished match leg as win from scores', async () => {
    mockMatch(2, 0);
    mockStakeFind([staleStake(parlayWithPendingLeg(stalePodLeg()))]);
    (stakeFindById as jest.Mock).mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ status: 'won' }) }) });

    const res = await service.sweepStaleStakes('admin-1', 7);

    expect(mockSettleStakeLeg).toHaveBeenCalledWith('stake-1', 0, 'win', 'admin-1');
    expect(res.resolved).toBe(1);
  });

  it('leaves indeterminable legs pending and reports them as still stuck', async () => {
    axiosGetMock.mockImplementation((url: string) => {
      if (url.includes('/events/123/')) {
        return Promise.resolve({ data: { id: 123, status: 'notstarted', home_team_id: 11, away_team_id: 22, event_date: '2026-06-01T19:00:00.000Z' } });
      }
      return Promise.resolve({ data: { results: [] } });
    });
    mockStakeFind([staleStake(parlayWithPendingLeg(stalePodLeg()))]);
    (stakeFindById as jest.Mock).mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ status: 'confirmed' }) }) });

    const res = await service.sweepStaleStakes('admin-1', 7);

    expect(mockSettleStakeLeg).not.toHaveBeenCalled();
    expect(res.resolved).toBe(0);
    expect(res.stillStuck).toHaveLength(1);
    expect(res.stillStuck[0].legs[0].reason).toContain('notstarted');
  });

  it('resolves a single (non-parlay) stale stake via settleStake, not settleStakeLeg', async () => {
    mockStakeFind([{
      _id: 'stake-9',
      user: 'u9',
      status: 'confirmed',
      createdAt: new Date(Date.now() - 60 * 86400000),
      items: [],
      pod: null,
    }]);
    (stakeFindById as jest.Mock).mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ status: 'void' }) }) });

    const res = await service.sweepStaleStakes('admin-1', 7);

    expect(mockSettleStakeLeg).not.toHaveBeenCalled();
    expect(mockSettleStake).toHaveBeenCalledWith('stake-9', 'void', 'admin-1', expect.any(String));
    expect(res.resolved).toBe(1);
    expect(res.skippedInternal).toBe(0);
  });

  it('excludes internal bet-manager pool stakes from auto-resolution', async () => {
    mockStakeFind([]);
    (StakeModel.countDocuments as jest.Mock).mockResolvedValue(5);

    const res = await service.sweepStaleStakes('admin-1', 7);

    const findFilter = (StakeModel.find as jest.Mock).mock.calls[0][0];
    expect(findFilter['metadata.betManager']).toEqual({ $ne: true });
    expect(res.scanned).toBe(0);
    expect(mockSettleStakeLeg).not.toHaveBeenCalled();
    expect(mockSettleStake).not.toHaveBeenCalled();
  });
});
