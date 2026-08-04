import { aiDigestService } from './ai-digest.service';
import { UserModel } from '../../models/user.model';
import { WalletModel } from '../../models/wallet.model';
import { StakeModel } from '../../models/stake.model';
import { DigestSendLogModel } from '../../models/digest-send-log.model';
import { aiGamesService } from '../ai/ai-games.service';
import * as emailService from '../../services/email.service';

jest.mock('../../models/user.model', () => ({
  UserModel: { find: jest.fn(), findOne: jest.fn(), findByIdAndUpdate: jest.fn() },
}));
jest.mock('../../models/wallet.model', () => ({ WalletModel: { find: jest.fn() } }));
jest.mock('../../models/stake.model', () => ({ StakeModel: { aggregate: jest.fn(), find: jest.fn() } }));
jest.mock('../../models/digest-send-log.model', () => ({
  DigestSendLogModel: { findOneAndUpdate: jest.fn(), updateOne: jest.fn() },
}));

const findMock = UserModel.find as jest.Mock;
const findOneMock = UserModel.findOne as jest.Mock;
const updateUserMock = UserModel.findByIdAndUpdate as jest.Mock;
const walletFindMock = WalletModel.find as jest.Mock;
const stakeAggMock = StakeModel.aggregate as jest.Mock;
const stakeFindMock = StakeModel.find as jest.Mock;
const claimMock = DigestSendLogModel.findOneAndUpdate as jest.Mock;
const logUpdateMock = DigestSendLogModel.updateOne as jest.Mock;
const sendMock = jest.spyOn(emailService, 'sendEmail');

function game(fixtureId: number, confidence: number, extra: any = {}): any {
  return {
    fixtureId,
    homeTeam: 'Arsenal',
    awayTeam: 'Chelsea',
    league: 'Premier League',
    matchDate: new Date(Date.now() + 3600000),
    pick: 'Over 2.5',
    marketType: 'Over/Under 2.5',
    gainsMultiplier: 1.85,
    confidence,
    reasoning: 'Form favours the home side.',
    availableOdds: 1.85,
    podId: null,
    stakable: false,
    matchStatus: 'notstarted',
    homeScore: null,
    awayScore: null,
    result: null,
    ...extra,
  };
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('AIDigestService picks', () => {
  it('builds a confidence-sorted pool capped at the configured size', async () => {
    const items = Array.from({ length: 12 }, (_, i) => game(i + 1, 40 + i * 5));
    jest.spyOn(aiGamesService, 'getToday').mockResolvedValue({ items, count: items.length, personalized: false });
    const pool = await (aiDigestService as any).buildPool();
    expect(pool.length).toBe(10);
    expect(pool[0].confidence).toBe(95);
  });

  it('buildPool drops games without a pick or confidence', async () => {
    const items = [game(1, 0), game(2, 80), { ...game(3, 70), pick: '' }];
    jest.spyOn(aiGamesService, 'getToday').mockResolvedValue({ items, count: items.length, personalized: false });
    const pool = await (aiDigestService as any).buildPool();
    expect(pool.map((p: any) => p.fixtureId)).toEqual([2]);
  });

  it('returns the default order for cold-start users without calling personalize', async () => {
    const personalizeSpy = jest.spyOn(aiGamesService, 'personalizeGames');
    const pool = [game(2, 80), game(1, 70)];
    const picks = await aiDigestService.picksForUser(pool, '');
    expect(personalizeSpy).not.toHaveBeenCalled();
    expect(picks.map(p => p.confidence)).toEqual([80, 70]);
    expect(picks[0].whyRecommended).toBeUndefined();
  });

  it('re-ranks the pool per user and attaches why reasons', async () => {
    jest.spyOn(aiGamesService, 'personalizeGames').mockResolvedValue({
      items: [
        game(2, 80, { whyRecommended: 'Your league, your edge.' }),
        game(1, 70, { whyRecommended: 'Arsenal fits your form.' }),
      ],
      personalized: true,
    });
    const picks = await aiDigestService.picksForUser([game(1, 70), game(2, 80)], 'u-1');
    expect(picks.map(p => p.confidence)).toEqual([80, 70]);
    expect(picks[0].whyRecommended).toBe('Your league, your edge.');
  });
});

describe('AIDigestService.runDailyDigest', () => {
  it('dry-run personalizes picks for the target user and emails the reason', async () => {
    jest.spyOn(aiGamesService, 'getToday').mockResolvedValue({
      items: [game(1, 70), game(2, 80)],
      count: 2,
      personalized: false,
    });
    const personalizeSpy = jest.spyOn(aiGamesService, 'personalizeGames').mockResolvedValue({
      items: [game(2, 80, { whyRecommended: 'Your league, your edge.' }), game(1, 70)],
      personalized: true,
    });
    findOneMock.mockReturnValue({
      select: () => ({ lean: jest.fn().mockResolvedValue({ _id: 'u-1', email: 'ada@betpool.tech', fullName: 'Ada Obi' }) }),
    });
    sendMock.mockResolvedValue({} as any);

    const res = await aiDigestService.runDailyDigest({ dryRunTo: 'ada@betpool.tech' });

    expect(res.sent).toBe(1);
    expect(personalizeSpy).toHaveBeenCalledWith(expect.any(Array), 'u-1');
    expect(sendMock).toHaveBeenCalledWith(
      'ada@betpool.tech',
      expect.stringContaining('Daily AI Briefing'),
      expect.stringContaining('Your league, your edge.')
    );
  });

  it('sends personalized picks to each user in a full run', async () => {
    jest.spyOn(aiGamesService, 'getToday').mockResolvedValue({
      items: [game(1, 70), game(2, 80)],
      count: 2,
      personalized: false,
    });
    const personalizeSpy = jest.spyOn(aiGamesService, 'personalizeGames').mockResolvedValue({
      items: [game(2, 80, { whyRecommended: 'Your league, your edge.' }), game(1, 70)],
      personalized: true,
    });
    findMock
      .mockReturnValueOnce({
        select: () => ({
          sort: () => ({
            limit: () => ({
              lean: jest.fn().mockResolvedValue([
                { _id: 'u-1', email: 'ada@betpool.tech', fullName: 'Ada Obi' },
              ]),
            }),
          }),
        }),
      })
      .mockReturnValue({
        select: () => ({
          sort: () => ({
            limit: () => ({
              lean: jest.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });
    walletFindMock.mockReturnValue({ select: () => ({ lean: jest.fn().mockResolvedValue([]) }) });
    stakeAggMock.mockResolvedValue([]);
    stakeFindMock.mockReturnValue({
      select: () => ({ sort: () => ({ lean: jest.fn().mockResolvedValue([]) }) }),
    });
    claimMock.mockResolvedValue({ _id: 'claim-1' });
    logUpdateMock.mockResolvedValue({});
    updateUserMock.mockResolvedValue({});
    sendMock.mockResolvedValue({} as any);

    const res = await aiDigestService.runDailyDigest();

    expect(res.scanned).toBe(1);
    expect(res.sent).toBe(1);
    expect(personalizeSpy).toHaveBeenCalledWith(expect.any(Array), 'u-1');
    expect(sendMock).toHaveBeenCalledWith(
      'ada@betpool.tech',
      expect.stringContaining('Daily AI Briefing — Ada'),
      expect.stringContaining('Your league, your edge.')
    );
  });
});
