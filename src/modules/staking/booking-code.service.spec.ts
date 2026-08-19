import { PodModel } from '../../models/pod.model';
import BookingCodeModel from '../../models/booking-code.model';
import { UserModel } from '../../models/user.model';
import { bookingCodeService } from './booking-code.service';

jest.mock('../../models/pod.model', () => ({
  PodModel: { find: jest.fn() },
}));

jest.mock('../../models/booking-code.model', () => ({
  __esModule: true,
  default: { exists: jest.fn(), findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn() },
}));

jest.mock('../../models/user.model', () => ({
  UserModel: { findById: jest.fn() },
}));

const podFind = PodModel.find as jest.Mock;
const bcExists = BookingCodeModel.exists as jest.Mock;
const bcFindOne = BookingCodeModel.findOne as jest.Mock;
const bcCreate = BookingCodeModel.create as jest.Mock;
const bcUpdateOne = BookingCodeModel.updateOne as jest.Mock;
const userFindById = UserModel.findById as jest.Mock;

function chainPodFind(pods: any[]) {
  podFind.mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(pods) }),
  });
}

const VALID_PODS = [
  {
    _id: 'pod-1',
    title: 'Arsenal vs Como',
    homeTeam: 'Arsenal',
    awayTeam: 'Como',
    selection: 'Home Win',
    gainsMultiplier: 1.41,
    league: 'UCL',
    status: 'active',
    stakingClosesAt: new Date(Date.now() + 60 * 60 * 1000),
    matchDate: new Date(Date.now() + 48 * 60 * 60 * 1000),
    currentExposure: 10,
    maxTotalExposure: 100,
  },
  {
    _id: 'pod-2',
    title: 'Chelsea vs Lyon',
    homeTeam: 'Chelsea',
    awayTeam: 'Lyon',
    selection: 'Over 1.5',
    gainsMultiplier: 2.1,
    league: 'UCL',
    status: 'active',
    stakingClosesAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    matchDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    currentExposure: 5,
    maxTotalExposure: 100,
  },
];

function mockUser() {
  userFindById.mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'user-1', fullName: 'Ada Lovelace' }) }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.MAX_ACCUMULATOR_LEGS;
  delete process.env.MAX_BOOKING_CODE_LEGS;
  mockUser();
});

describe('bookingCodeService.create', () => {
  it('generates a code and stores a snapshot of the selections', async () => {
    chainPodFind(VALID_PODS);
    bcExists.mockResolvedValue(null);
    bcCreate.mockResolvedValue({
      code: 'K7M2Q9DX',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      userId: 'user-1',
      podIds: ['pod-1', 'pod-2'],
      legs: VALID_PODS.map(p => ({
        podId: String(p._id),
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        selection: p.selection,
        multiplier: p.gainsMultiplier,
      })),
    });

    const result = await bookingCodeService.create('user-1', ['pod-1', 'pod-2']);

    expect(result.code).toBe('K7M2Q9DX');
    expect(result.legs).toHaveLength(2);
    expect(result.legs[0]).toMatchObject({ podId: 'pod-1', available: true });
    expect(result.combinedMultiplier).toBeCloseTo(1.41 * 2.1);
    expect(bcCreate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      podIds: ['pod-1', 'pod-2'],
      legs: [
        expect.objectContaining({ podId: 'pod-1', multiplier: 1.41 }),
        expect.objectContaining({ podId: 'pod-2', multiplier: 2.1 }),
      ],
    }));
  });

  it('rejects fewer than 2 selections', async () => {
    await expect(bookingCodeService.create('user-1', ['pod-1']))
      .rejects.toThrow('at least 2 selections');
  });

  it('rejects selections above the env leg limit', async () => {
    process.env.MAX_BOOKING_CODE_LEGS = '2';
    await expect(bookingCodeService.create('user-1', ['pod-1', 'pod-2', 'pod-3']))
      .rejects.toThrow('up to 2 selections');
  });

  it('allows pods kicking off at any future time (no kickoff window restriction)', async () => {
    const soon = { ...VALID_PODS[0], matchDate: new Date(Date.now() + 60 * 60 * 1000) };
    const farOut = { ...VALID_PODS[1], matchDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) };
    chainPodFind([soon, farOut]);
    bcExists.mockResolvedValue(null);
    bcCreate.mockResolvedValue({
      code: 'K7M2Q9DX',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      userId: 'user-1',
      podIds: ['pod-1', 'pod-2'],
      legs: [soon, farOut].map(p => ({
        podId: String(p._id),
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        selection: p.selection,
        multiplier: p.gainsMultiplier,
      })),
    });

    const result = await bookingCodeService.create('user-1', ['pod-1', 'pod-2']);

    expect(result.code).toBe('K7M2Q9DX');
    expect(result.legs).toHaveLength(2);
  });

  it('rejects pods that are closed or exposure-capped', async () => {
    const closed = {
      ...VALID_PODS[0],
      status: 'settled',
    };
    chainPodFind([closed, VALID_PODS[1]]);
    bcExists.mockResolvedValue(null);
    bcCreate.mockResolvedValue({ code: 'K7M2Q9DX', expiresAt: new Date() });

    await expect(bookingCodeService.create('user-1', ['pod-1', 'pod-2']))
      .rejects.toThrow('no longer available');
  });

  it('rejects two selections from the same match', async () => {
    const sameMatch = {
      _id: 'pod-3',
      title: 'Arsenal vs Como 2',
      homeTeam: 'Arsenal',
      awayTeam: 'Como',
      selection: 'Over 1.5',
      gainsMultiplier: 1.8,
      league: 'UCL',
      status: 'active',
      stakingClosesAt: new Date(Date.now() + 60 * 60 * 1000),
      matchDate: VALID_PODS[0].matchDate,
      currentExposure: 1,
      maxTotalExposure: 100,
    };
    chainPodFind([VALID_PODS[0], sameMatch]);
    bcExists.mockResolvedValue(null);
    bcCreate.mockResolvedValue({ code: 'K7M2Q9DX', expiresAt: new Date() });

    await expect(bookingCodeService.create('user-1', ['pod-1', 'pod-3']))
      .rejects.toThrow('Cannot combine multiple selections from the same match');
  });
});

describe('bookingCodeService.redeem', () => {
  it('throws for unknown codes', async () => {
    bcFindOne.mockResolvedValue(null);
    await expect(bookingCodeService.redeem('K7M2Q9DX')).rejects.toThrow('not found');
  });

  it('throws for expired codes', async () => {
    bcFindOne.mockResolvedValue({
      _id: 'bc-1',
      code: 'K7M2Q9DX',
      expiresAt: new Date(Date.now() - 1000),
      podIds: ['pod-1', 'pod-2'],
      legs: [],
    });
    await expect(bookingCodeService.redeem('K7M2Q9DX')).rejects.toThrow('expired');
  });

  it('returns fresh pod state and increments usage', async () => {
    chainPodFind(VALID_PODS);
    bcFindOne.mockResolvedValue({
      _id: 'bc-1',
      code: 'K7M2Q9DX',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      podIds: ['pod-1', 'pod-2'],
      legs: VALID_PODS.map(p => ({
        podId: String(p._id),
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        selection: p.selection,
        multiplier: p.gainsMultiplier,
      })),
    });
    bcUpdateOne.mockResolvedValue({ acknowledged: true });

    const result = await bookingCodeService.redeem('k7m2q9dx');

    expect(result.code).toBe('K7M2Q9DX');
    expect(result.legs.map(l => l.available)).toEqual([true, true]);
    expect(result.legs[0].status).toBe('active');
    expect(bcUpdateOne).toHaveBeenCalledWith({ _id: 'bc-1' }, { $inc: { usedCount: 1 } });
  });

  it('marks legs as unavailable once their match has started', async () => {
    const started = { ...VALID_PODS[0], matchDate: new Date(Date.now() - 60 * 60 * 1000) };
    chainPodFind([started, VALID_PODS[1]]);
    bcFindOne.mockResolvedValue({
      _id: 'bc-1',
      code: 'K7M2Q9DX',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      podIds: ['pod-1', 'pod-2'],
      legs: VALID_PODS.map(p => ({
        podId: String(p._id),
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        selection: p.selection,
        multiplier: p.gainsMultiplier,
      })),
    });
    bcUpdateOne.mockResolvedValue({ acknowledged: true });

    const result = await bookingCodeService.redeem('k7m2q9dx');

    expect(result.legs.map(l => l.available)).toEqual([false, true]);
  });

  it('dedupes legs from the same match when redeeming', async () => {
    const sameMatch = {
      _id: 'pod-3',
      title: 'Arsenal vs Como 2',
      homeTeam: 'Arsenal',
      awayTeam: 'Como',
      selection: 'Over 1.5',
      gainsMultiplier: 1.8,
      league: 'UCL',
      status: 'active',
      stakingClosesAt: new Date(Date.now() + 60 * 60 * 1000),
      matchDate: VALID_PODS[0].matchDate,
      currentExposure: 1,
      maxTotalExposure: 100,
    };
    chainPodFind([VALID_PODS[0], sameMatch, VALID_PODS[1]]);
    bcFindOne.mockResolvedValue({
      _id: 'bc-1',
      code: 'K7M2Q9DX',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      podIds: ['pod-1', 'pod-3', 'pod-2'],
      legs: [VALID_PODS[0], sameMatch, VALID_PODS[1]].map(p => ({
        podId: String(p._id),
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        selection: p.selection,
        multiplier: p.gainsMultiplier,
      })),
    });
    bcUpdateOne.mockResolvedValue({ acknowledged: true });

    const result = await bookingCodeService.redeem('k7m2q9dx');

    expect(result.legs).toHaveLength(2);
    expect(result.legs.map(l => l.podId)).toEqual(['pod-1', 'pod-2']);
  });
});
