import { UserModel } from '../../models/user.model';
import Notification from '../../models/notification.model';
import { aiGamesService } from '../ai/ai-games.service';
import { OraPickPushModel } from './ora-pick-push.model';
import { createInAppNotification } from '../../services/notification.service';
import { oraPickService } from './ora-pick.service';

jest.mock('../../models/user.model', () => ({
  UserModel: { find: jest.fn() },
}));

jest.mock('../../models/notification.model', () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));

jest.mock('../ai/ai-games.service', () => ({
  aiGamesService: { getToday: jest.fn() },
}));

jest.mock('./ora-pick-push.model', () => ({
  OraPickPushModel: {
    findOne: jest.fn(() => ({
      select: jest.fn(() => ({ lean: jest.fn(() => Promise.resolve(null)) })),
    })),
    create: jest.fn(),
  },
}));

jest.mock('../../services/notification.service', () => ({
  createInAppNotification: jest.fn(),
}));

const getToday = aiGamesService.getToday as jest.Mock;
const pushFindOne = OraPickPushModel.findOne as jest.Mock;
const pushCreate = OraPickPushModel.create as jest.Mock;
const userFind = UserModel.find as jest.Mock;
const notifCreate = Notification.create as jest.Mock;
const createNotif = createInAppNotification as jest.Mock;

const game = (overrides: any = {}) => ({
  fixtureId: 1001,
  homeTeam: 'Arsenal',
  awayTeam: 'Chelsea',
  league: 'Premier League',
  matchDate: new Date('2026-08-08T18:00:00Z'),
  pick: 'Home Win',
  marketType: '1X2',
  gainsMultiplier: 1.85,
  confidence: 78,
  reasoning: 'Strong home form',
  availableOdds: 1.85,
  podId: 'pod-1',
  stakable: true,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  userFind.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: 'u1' }, { _id: 'u2' }]) }) });
});

describe('OraPickService.getPickOfDay', () => {
  it('picks the highest-confidence stakable game', async () => {
    getToday.mockResolvedValue({ items: [game({ fixtureId: 1, confidence: 60 }), game({ fixtureId: 2, confidence: 88, podId: 'pod-2' })], count: 2 });

    const pick = await oraPickService.getPickOfDay('u1');

    expect(pick).toMatchObject({ podId: 'pod-2', pick: 'Home Win', gainsMultiplier: 1.85, confidence: 88 });
    expect(pick?.kickoff).toBe('2026-08-08T18:00:00.000Z');
  });

  it('skips games without a linked pod or pick', async () => {
    getToday.mockResolvedValue({ items: [game({ podId: null, confidence: 99 })], count: 1 });

    expect(await oraPickService.getPickOfDay()).toBeNull();
  });

  it('returns null when nothing is stakable', async () => {
    getToday.mockResolvedValue({ items: [], count: 0 });

    expect(await oraPickService.getPickOfDay()).toBeNull();
  });
});

describe('OraPickService push', () => {
  it('sends exactly once per day and persists the push record', async () => {
    getToday.mockResolvedValue({ items: [game()], count: 1 });

    await (oraPickService as any).maybePushToday();

    expect(notifCreate).toHaveBeenCalledTimes(1);
    const batch = notifCreate.mock.calls[0][0];
    expect(batch).toHaveLength(2);
    expect(batch[0]).toMatchObject({ type: 'system', title: 'Ora Pick of the Day', data: { podId: 'pod-1', type: 'ora_pick' } });
    expect(pushCreate).toHaveBeenCalledWith(expect.objectContaining({ podId: 'pod-1', sentTo: 2 }));
  });

  it('does not push twice on the same day', async () => {
    pushFindOne.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'existing' }) }),
    });

    await (oraPickService as any).maybePushToday();

    expect(getToday).not.toHaveBeenCalled();
    expect(notifCreate).not.toHaveBeenCalled();
  });

  it('notifies a single user on demand', async () => {
    await oraPickService.notifyPickToUser('u1', { podId: 'pod-1', homeTeam: 'A', awayTeam: 'B', pick: 'Home', gainsMultiplier: 1.5, confidence: 70 } as any);

    expect(createNotif).toHaveBeenCalledWith(
      'u1',
      'system',
      'Ora Pick of the Day',
      expect.stringContaining('A vs B'),
      { podId: 'pod-1', type: 'ora_pick' }
    );
  });
});
