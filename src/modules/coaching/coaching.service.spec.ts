import { StakeModel } from '../../models/stake.model';
import Notification from '../../models/notification.model';
import { walletService } from '../../services/wallet.service';
import { createInAppNotification } from '../../services/notification.service';
import { coachingService } from './coaching.service';

jest.mock('../../models/stake.model', () => ({
  StakeModel: { aggregate: jest.fn(), find: jest.fn() },
}));

jest.mock('../../models/notification.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock('../../services/wallet.service', () => ({
  walletService: { getBalance: jest.fn() },
}));

jest.mock('../../services/notification.service', () => ({
  createInAppNotification: jest.fn(),
}));

const stakeAgg = StakeModel.aggregate as jest.Mock;
const stakeFind = StakeModel.find as jest.Mock;
const notifFindOne = Notification.findOne as jest.Mock;
const getBalance = walletService.getBalance as jest.Mock;
const createNotif = createInAppNotification as jest.Mock;

function chainFind(statuses: string[]) {
  stakeFind.mockReturnValue({
    select: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(statuses.map(s => ({ status: s }))) }) }) }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  stakeAgg.mockResolvedValue([{ _id: null, count: 4, total: 55_000 }]);
  chainFind(['won', 'won', 'lost', 'lost']);
  notifFindOne.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
});

describe('CoachingService.insights', () => {
  it('flags high risk when 24h staking exceeds half the bankroll', async () => {
    getBalance.mockResolvedValue({ available: 100_000, balance: 100_000 });

    const i = await coachingService.insights('user-1');

    expect(i).toMatchObject({ bankroll: 100_000, staked24h: 55_000, stakes24h: 4, winRate30d: 50, riskLevel: 'high' });
    expect(i.nudges.length).toBeGreaterThan(0);
    expect(i.tip).toContain('5%');
  });

  it('reports ok when pace is healthy', async () => {
    getBalance.mockResolvedValue({ available: 500_000, balance: 500_000 });
    stakeAgg.mockResolvedValue([{ _id: null, count: 2, total: 20_000 }]);

    const i = await coachingService.insights('user-1');

    expect(i.riskLevel).toBe('ok');
  });

  it('adds a low win-rate nudge below 40%', async () => {
    getBalance.mockResolvedValue({ available: 100_000, balance: 100_000 });
    stakeAgg.mockResolvedValue([{ _id: null, count: 1, total: 5000 }]);
    chainFind(['lost', 'lost', 'lost', 'lost', 'lost', 'won']);

    const i = await coachingService.insights('user-1');

    expect(i.winRate30d).toBeLessThan(40);
    expect(i.nudges.some(n => n.includes('win rate'))).toBe(true);
  });
});

describe('CoachingService.flagIfHighRisk', () => {
  it('notifies once per 24h when risk is high', async () => {
    getBalance.mockResolvedValue({ available: 100_000, balance: 100_000 });

    await coachingService.flagIfHighRisk('user-1');

    expect(createNotif).toHaveBeenCalledWith(
      'user-1',
      'system',
      'A quick check from Ora',
      expect.stringContaining('bankroll'),
      { coaching: true }
    );
  });

  it('stays silent on the cooldown when recently notified', async () => {
    getBalance.mockResolvedValue({ available: 100_000, balance: 100_000 });
    notifFindOne.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'recent' }) }) });

    await coachingService.flagIfHighRisk('user-1');

    expect(createNotif).not.toHaveBeenCalled();
  });

  it('does nothing when risk is low', async () => {
    getBalance.mockResolvedValue({ available: 500_000, balance: 500_000 });
    stakeAgg.mockResolvedValue([{ _id: null, count: 1, total: 10_000 }]);

    await coachingService.flagIfHighRisk('user-1');

    expect(createNotif).not.toHaveBeenCalled();
  });
});