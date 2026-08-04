import { pickOutcomeService } from './pick-outcome.service';
import { PodModel } from '../models/pod.model';
import { StakeModel } from '../models/stake.model';
import { PickOutcomeModel } from '../models/pick-outcome.model';
import { aiPersonalizationService } from '../modules/ai/ai-personalization.service';

jest.mock('../models/pod.model', () => ({
  PodModel: { findById: jest.fn() },
}));

jest.mock('../models/stake.model', () => ({
  StakeModel: { find: jest.fn() },
}));

jest.mock('../models/pick-outcome.model', () => ({
  PickOutcomeModel: { insertMany: jest.fn() },
}));

jest.mock('../modules/ai/ai-personalization.service', () => ({
  aiPersonalizationService: { invalidateProfile: jest.fn() },
}));

const findByIdMock = PodModel.findById as jest.Mock;
const stakeFindMock = StakeModel.find as jest.Mock;
const insertManyMock = PickOutcomeModel.insertMany as jest.Mock;
const invalidateMock = aiPersonalizationService.invalidateProfile as jest.Mock;

function mockPod(value: any) {
  const thenable = {
    then: (resolve: any, reject?: any) => Promise.resolve(value).then(resolve, reject),
    session: (_session?: any) => thenable,
  };
  findByIdMock.mockReturnValue(thenable);
}

function stake(id: string, overrides: any = {}) {
  return {
    _id: { toString: () => id },
    user: 'user-1',
    stakeAmount: 2000,
    isParlay: false,
    ...overrides,
  };
}

function makeQuery(items: any[]) {
  return {
    then: (resolve: any, reject?: any) => Promise.resolve(items).then(resolve, reject),
    session: (_session?: any) => Promise.resolve(items),
  };
}

let singlesResult: any[] = [];
let parlaysResult: any[] = [];
stakeFindMock.mockImplementation((filter: any) => makeQuery(filter.pod ? singlesResult : parlaysResult));

const basePod = {
  _id: 'pod-1',
  sport: 'football',
  league: 'Premier League',
  homeTeam: 'Arsenal',
  awayTeam: 'Chelsea',
  selection: 'Home',
  marketType: '1X2',
  gainsMultiplier: 1.7,
  refundPercent: 40,
  result: 'win',
  settledAt: new Date('2026-08-01T12:00:00Z'),
};

beforeEach(() => {
  jest.clearAllMocks();
  singlesResult = [];
  parlaysResult = [];
});

describe('PickOutcomeService.recordPodSettlement', () => {
  it('writes ledger records judged from final scores (1X2 home win => won)', async () => {
    mockPod({ ...basePod, homeScore: 2, awayScore: 0 });
    singlesResult = [stake('s1')];
    parlaysResult = [];
    insertManyMock.mockResolvedValue([]);

    const count = await pickOutcomeService.recordPodSettlement('pod-1');

    expect(count).toBe(1);
    const records = insertManyMock.mock.calls[0][0];
    expect(records[0]).toMatchObject({ user: 'user-1', pod: 'pod-1', outcome: 'won', stakeAmount: 2000, isParlay: false });
    expect(invalidateMock).toHaveBeenCalledWith('user-1');
  });

  it('returns skip on an over/under push', async () => {
    mockPod({ ...basePod, selection: 'Over 2', homeScore: 2, awayScore: 0 });
    singlesResult = [stake('s1')];
    parlaysResult = [];
    insertManyMock.mockResolvedValue([]);

    await pickOutcomeService.recordPodSettlement('pod-1');

    expect(insertManyMock.mock.calls[0][0][0].outcome).toBe('skip');
  });

  it('falls back to the pod result when scores are absent', async () => {
    mockPod({ ...basePod, result: 'loss', homeScore: undefined, awayScore: undefined });
    singlesResult = [stake('s1')];
    parlaysResult = [];
    insertManyMock.mockResolvedValue([]);

    await pickOutcomeService.recordPodSettlement('pod-1');

    expect(insertManyMock.mock.calls[0][0][0].outcome).toBe('lost');
  });

  it('records skip for void pods', async () => {
    mockPod({ ...basePod, result: 'void', homeScore: 0, awayScore: 0 });
    singlesResult = [stake('s1')];
    parlaysResult = [];
    insertManyMock.mockResolvedValue([]);

    await pickOutcomeService.recordPodSettlement('pod-1');

    expect(insertManyMock.mock.calls[0][0][0].outcome).toBe('skip');
  });

  it('includes parlay legs but records each stake once', async () => {
    mockPod({ ...basePod, homeScore: 2, awayScore: 0 });
    singlesResult = [stake('s1'), stake('s2', { isParlay: true })];
    parlaysResult = [stake('s2', { isParlay: true })];
    insertManyMock.mockResolvedValue([]);

    const count = await pickOutcomeService.recordPodSettlement('pod-1');

    expect(count).toBe(2);
    const records = insertManyMock.mock.calls[0][0];
    expect(records.filter((r: any) => r.isParlay)).toHaveLength(1);
    expect(records.map((r: any) => r.pod).every((p: string) => p === 'pod-1')).toBe(true);
  });

  it('writes nothing when there are no settled stakes', async () => {
    mockPod(basePod);
    singlesResult = [];
    parlaysResult = [];

    const count = await pickOutcomeService.recordPodSettlement('pod-1');

    expect(count).toBe(0);
    expect(insertManyMock).not.toHaveBeenCalled();
  });

  it('returns 0 when the pod does not exist', async () => {
    mockPod(null);

    await expect(pickOutcomeService.recordPodSettlement('nope')).resolves.toBe(0);
    expect(insertManyMock).not.toHaveBeenCalled();
  });

  it('passes the session through to insertMany', async () => {
    mockPod({ ...basePod, homeScore: 2, awayScore: 0 });
    singlesResult = [stake('s1')];
    parlaysResult = [];
    insertManyMock.mockResolvedValue([]);
    const session = { id: 'txn' };

    await pickOutcomeService.recordPodSettlement('pod-1', session as any);

    expect(insertManyMock).toHaveBeenCalledWith(expect.anything(), { session });
  });
});
