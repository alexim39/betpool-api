import { abtestService, fnv1a } from './abtest.service';
import { AbTestModel } from './abtest.model';
import { AbTestEventModel } from './abtest-event.model';

jest.mock('./abtest.model', () => ({
  AbTestModel: { findOne: jest.fn(), findOneAndUpdate: jest.fn(), find: jest.fn() },
}));

jest.mock('./abtest-event.model', () => ({
  AbTestEventModel: { create: jest.fn(), aggregate: jest.fn(), distinct: jest.fn() },
}));

const findOneMock = AbTestModel.findOne as jest.Mock;
const findOneAndUpdateMock = AbTestModel.findOneAndUpdate as jest.Mock;
const findMock = AbTestModel.find as jest.Mock;
const eventCreateMock = AbTestEventModel.create as jest.Mock;
const eventAggregateMock = AbTestEventModel.aggregate as jest.Mock;
const eventDistinctMock = AbTestEventModel.distinct as jest.Mock;

const experiment = (overrides: any = {}) => ({
  key: 'personalization',
  enabled: true,
  controlShare: 50,
  ...overrides,
});

/** Chainable query mock: findOne().select().lean() -> result (or rejects for Errors). */
function queryMock(result: any) {
  const lean = jest.fn().mockImplementation(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  );
  return { select: () => ({ lean }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  abtestService.invalidateAll();
});

describe('fnv1a', () => {
  it('is deterministic for the same input', () => {
    expect(fnv1a('personalization:u1')).toBe(fnv1a('personalization:u1'));
  });

  it('produces different buckets for different users', () => {
    const buckets = new Set(['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'].map(u => fnv1a(`personalization:${u}`) % 100));
    expect(buckets.size).toBeGreaterThan(1);
  });
});

describe('AbTestService.variantFor', () => {
  it('returns null when the experiment does not exist', async () => {
    findOneMock.mockReturnValue(queryMock(null));

    await expect(abtestService.variantFor('u1', 'personalization')).resolves.toBeNull();
  });

  it('returns null when the experiment is disabled', async () => {
    findOneMock.mockReturnValue(queryMock(experiment({ enabled: false })));

    await expect(abtestService.variantFor('u1', 'personalization')).resolves.toBeNull();
  });

  it('assigns control to the first controlShare% of buckets', async () => {
    findOneMock.mockReturnValue(queryMock(experiment()));
    const bucket = fnv1a('personalization:u1') % 100;

    const variant = await abtestService.variantFor('u1', 'personalization');

    expect(variant).toBe(bucket < 50 ? 'control' : 'treatment');
  });

  it('splits users across both variants', async () => {
    findOneMock.mockReturnValue(queryMock(experiment()));
    const users = Array.from({ length: 200 }, (_, i) => `u${i}`);
    const variants = new Set<string>();
    for (const u of users) variants.add((await abtestService.variantFor(u, 'personalization'))!);
    expect(variants.has('control')).toBe(true);
    expect(variants.has('treatment')).toBe(true);
  });

  it('assigns everyone to treatment at controlShare 0', async () => {
    findOneMock.mockReturnValue(queryMock(experiment({ controlShare: 0 })));

    await expect(abtestService.variantFor('u1', 'personalization')).resolves.toBe('treatment');
  });

  it('is stable across calls and uses the cache', async () => {
    findOneMock.mockReturnValue(queryMock(experiment()));

    const first = await abtestService.variantFor('u1', 'personalization');
    const second = await abtestService.variantFor('u1', 'personalization');

    expect(first).toBe(second);
    expect(findOneMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes the cache after invalidation', async () => {
    findOneMock.mockReturnValue(queryMock(experiment({ enabled: false })));
    await abtestService.variantFor('u1', 'personalization');

    abtestService.invalidate('personalization');
    findOneMock.mockReturnValue(queryMock(experiment({ enabled: true })));

    await expect(abtestService.variantFor('u1', 'personalization')).resolves.toBeTruthy();
  });

  it('never throws when the lookup fails', async () => {
    findOneMock.mockReturnValue(queryMock(new Error('db down')));

    await expect(abtestService.variantFor('u1', 'personalization')).resolves.toBeNull();
  });
});

describe('AbTestService.recordEvent', () => {
  it('records the event with the user variant when active', async () => {
    findOneMock.mockReturnValue(queryMock(experiment()));
    const bucket = fnv1a('personalization:u1') % 100;
    const expectedVariant = bucket < 50 ? 'control' : 'treatment';

    await abtestService.recordEvent('u1', 'personalization', 'stake_placed', { isParlay: true });

    expect(eventCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      experimentKey: 'personalization',
      userId: 'u1',
      variant: expectedVariant,
      event: 'stake_placed',
      meta: { isParlay: true },
    }));
  });

  it('does nothing when the experiment is disabled', async () => {
    findOneMock.mockReturnValue(queryMock(experiment({ enabled: false })));

    await abtestService.recordEvent('u1', 'personalization', 'stake_placed');

    expect(eventCreateMock).not.toHaveBeenCalled();
  });

  it('swallows recording errors', async () => {
    findOneMock.mockReturnValue(queryMock(experiment()));
    eventCreateMock.mockRejectedValue(new Error('insert failed'));

    await expect(abtestService.recordEvent('u1', 'personalization', 'stake_placed')).resolves.toBeUndefined();
  });
});

describe('AbTestService admin ops', () => {
  it('upserts an experiment and invalidates the cache', async () => {
    findOneAndUpdateMock.mockResolvedValue({ key: 'personalization', enabled: true, controlShare: 40 });
    const invalidateSpy = jest.spyOn(abtestService, 'invalidate');

    const result = await abtestService.upsert({ key: 'personalization', enabled: true, controlShare: 40 });

    expect(result).toEqual({ key: 'personalization', enabled: true, controlShare: 40 });
    expect(invalidateSpy).toHaveBeenCalledWith('personalization');
  });

  it('setEnabled returns null for unknown experiments', async () => {
    findOneAndUpdateMock.mockResolvedValue(null);

    await expect(abtestService.setEnabled('nope', true)).resolves.toBeNull();
  });

  it('lists experiments newest first', async () => {
    findMock.mockReturnValue({ sort: () => ({ select: () => ({ lean: jest.fn().mockResolvedValue([experiment()]) }) }) });

    const list = await abtestService.list();

    expect(list).toHaveLength(1);
    expect(list[0].key).toBe('personalization');
  });

  it('summarizes event counts and distinct users per variant', async () => {
    findOneMock.mockReturnValue(queryMock(experiment()));
    eventAggregateMock.mockResolvedValue([
      { variant: 'control', event: 'stake_placed', count: 4 },
      { variant: 'treatment', event: 'stake_placed', count: 6 },
    ]);
    eventDistinctMock.mockResolvedValueOnce(['u1', 'u2']).mockResolvedValueOnce(['u3', 'u4', 'u5']);

    const summary = await abtestService.summary('personalization');

    expect(summary.experiment?.enabled).toBe(true);
    expect(summary.events).toEqual([
      { variant: 'control', event: 'stake_placed', count: 4 },
      { variant: 'treatment', event: 'stake_placed', count: 6 },
    ]);
    expect(summary.users).toEqual({ control: 2, treatment: 3 });
  });
});