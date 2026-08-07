import { StakeModel } from '../../models/stake.model';
import { TransactionModel } from '../../models/transaction.model';
import { curationAccuracyService } from '../ai/curation-accuracy.service';
import { oraRecordService, OraRecord } from './orarecord.service';

jest.mock('../../models/stake.model', () => ({
  StakeModel: { aggregate: jest.fn() },
}));

jest.mock('../../models/transaction.model', () => ({
  TransactionModel: { aggregate: jest.fn() },
}));

jest.mock('../ai/curation-accuracy.service', () => ({
  curationAccuracyService: { getStats: jest.fn() },
}));

const stakeAgg = StakeModel.aggregate as jest.Mock;
const txAgg = TransactionModel.aggregate as jest.Mock;
const getStats = curationAccuracyService.getStats as jest.Mock;

const stats = (overrides: any = {}) => ({
  played: 40,
  won: 26,
  winRate: 65,
  byLeague: [
    { key: 'Premier League', played: 10, won: 8, winRate: 80 },
    { key: 'La Liga', played: 3, won: 1, winRate: 33 },
  ],
  byMarket: [],
  sampledAt: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (oraRecordService as any).cache = null;
  stakeAgg.mockResolvedValue([{ _id: null, count: 12, avgMs: 900_000 }]);
  txAgg.mockResolvedValue([{ _id: null, count: 9, total: 120_000, avgMs: 3_600_000 }]);
  getStats.mockResolvedValue(stats());
});

describe('OraRecordService.getRecord', () => {
  it('builds league stats and flags low samples', async () => {
    const record = await oraRecordService.getRecord();

    expect(record.byLeague[0]).toMatchObject({ league: 'Premier League', played: 10, won: 8, sample: 'sufficient' });
    expect(record.byLeague[1]).toMatchObject({ league: 'La Liga', played: 3, won: 1, sample: 'low' });
  });

  it('reports settlement latency and payout speed aggregates', async () => {
    const record = await oraRecordService.getRecord();

    expect(record.settledPots30d).toBe(12);
    expect(record.avgSettlementMs).toBe(900_000);
    expect(record.payouts30d).toBe(9);
    expect(record.avgPayoutMs).toBe(3_600_000);
  });

  it('attaches an HMAC signature over the record payload', async () => {
    const record = await oraRecordService.getRecord();

    expect(record.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(record.signatureAlgo).toBe('hmac-sha256');
  });

  it('caches results for 60s and skips the second aggregation', async () => {
    await oraRecordService.getRecord();
    const second = await oraRecordService.getRecord();

    expect(stakeAgg).toHaveBeenCalledTimes(1);
    expect(second.sampledAt).toBeDefined();
  });

  it('filters by league, clamps limit and re-computes the signature', async () => {
    const record = await oraRecordService.getRecord(false, { league: 'la liga', limit: 1 });

    expect(record.byLeague).toHaveLength(1);
    expect(record.byLeague[0].league).toBe('La Liga');
    expect(record.byLeague[0].sample).toBe('low');
    expect(record.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('bypasses the cache when force refresh is requested', async () => {
    await oraRecordService.getRecord();
    await oraRecordService.getRecord(true);

    expect(stakeAgg).toHaveBeenCalledTimes(2);
  });

  it('clamps NaN limit to the default and returns an empty list for unknown leagues', async () => {
    const record = await oraRecordService.getRecord(false, { league: 'Serie A', limit: 'abc' as any });

    expect(record.byLeague).toHaveLength(0);
  });
});
