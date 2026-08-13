import { PodModel } from '../../models/pod.model';
import BookingCodeModel from '../../models/booking-code.model';
import { bookingCodeService } from './booking-code.service';

jest.mock('../../models/pod.model', () => ({
  PodModel: { find: jest.fn() },
}));

jest.mock('../../models/booking-code.model', () => ({
  __esModule: true,
  default: { exists: jest.fn(), findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn() },
}));

const podFind = PodModel.find as jest.Mock;
const bcExists = BookingCodeModel.exists as jest.Mock;
const bcFindOne = BookingCodeModel.findOne as jest.Mock;
const bcCreate = BookingCodeModel.create as jest.Mock;
const bcUpdateOne = BookingCodeModel.updateOne as jest.Mock;

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
    currentExposure: 5,
    maxTotalExposure: 100,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.MAX_ACCUMULATOR_LEGS;
});

describe('bookingCodeService.create', () => {
  it('generates a code and stores a snapshot of the selections', async () => {
    chainPodFind(VALID_PODS);
    bcExists.mockResolvedValue(null);
    bcCreate.mockResolvedValue({
      code: 'K7M2Q9DX',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });

    const result = await bookingCodeService.create('user-1', ['pod-1', 'pod-2']);

    expect(result.code).toBe('K7M2Q9DX');
    expect(result.legs).toHaveLength(2);
    expect(result.legs[0]).toMatchObject({ podId: 'pod-1', available: true });
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
    process.env.MAX_ACCUMULATOR_LEGS = '2';
    await expect(bookingCodeService.create('user-1', ['pod-1', 'pod-2', 'pod-3']))
      .rejects.toThrow('up to 2 selections');
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
});
