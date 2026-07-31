import { chatWithOra } from './ai.service';
import { PodModel } from '../../models/pod.model';

jest.mock('../../models/pod.model', () => ({
  PodModel: {
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
  },
}));

const findMock = PodModel.find as jest.Mock;
const findOneMock = PodModel.findOne as jest.Mock;
const findByIdMock = PodModel.findById as jest.Mock;

const mockPod = {
  _id: { toString: () => 'pod-1' },
  title: 'Arsenal vs Chelsea',
  homeTeam: 'Arsenal',
  awayTeam: 'Chelsea',
  selection: 'Arsenal',
  gainsMultiplier: 2.1,
  minStake: 1000,
  maxStake: 100000,
  status: 'active',
};

const awayPickPod = {
  _id: { toString: () => 'pod-2' },
  title: 'IK Start vs Viking FK',
  homeTeam: 'IK Start',
  awayTeam: 'Viking FK',
  selection: 'Away Win',
  gainsMultiplier: 1.7,
  minStake: 100,
  maxStake: 100,
  status: 'active',
};

const mockPod2 = {
  _id: { toString: () => 'pod-3' },
  title: 'Real Madrid vs Barcelona',
  homeTeam: 'Real Madrid',
  awayTeam: 'Barcelona',
  selection: 'Barcelona',
  gainsMultiplier: 1.9,
  minStake: 100,
  maxStake: 100000,
  status: 'active',
};

const multPods = [1.2, 1.3, 1.4, 1.5, 1.6].map((mult, i) => ({
  _id: { toString: () => `pod-m${i + 1}` },
  title: `Game ${i + 1}`,
  homeTeam: `Home ${i + 1}`,
  awayTeam: `Away ${i + 1}`,
  selection: 'Home Win',
  gainsMultiplier: mult,
  minStake: 100,
  maxStake: 100000,
  status: 'active',
}));

const bigMultPods = [1.5, 2, 3, 4, 5].map((mult, i) => ({
  _id: { toString: () => `pod-b${i + 1}` },
  title: `Big Game ${i + 1}`,
  homeTeam: `Big Home ${i + 1}`,
  awayTeam: `Big Away ${i + 1}`,
  selection: 'Home Win',
  gainsMultiplier: mult,
  minStake: 100,
  maxStake: 100000,
  status: 'active',
}));

function mockPodQuery(pods: any[]) {
  const lean = jest.fn().mockResolvedValue(pods);
  findMock.mockReturnValue({
    select: () => ({ sort: () => ({ limit: () => ({ lean }) }) }),
  });
}

function mockPodFindRaw(pods: any[]) {
  const lean = jest.fn().mockResolvedValue(pods);
  findMock.mockReturnValue({ select: () => ({ lean }) });
}

function mockPodById(pod: any) {
  const lean = jest.fn().mockResolvedValue(pod);
  findByIdMock.mockReturnValue({ select: () => ({ lean }) });
}

function mockPodByName(pod: any) {
  const lean = jest.fn().mockResolvedValue(pod);
  findOneMock.mockReturnValue({ select: () => ({ lean }) });
}

const realFetch = global.fetch;

function data(a: any): any {
  return a.data;
}

afterEach(() => {
  global.fetch = realFetch;
  jest.clearAllMocks();
  delete process.env.DEEPSEEK_API_KEY;
});

describe('chatWithOra — AI path (provider reachable)', () => {
  it('parses a multiline [STAKE] block and finalizes it against the real pod', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    mockPodQuery([]);
    mockPodByName(mockPod);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: 'You want to bet ₦5,000 on Arsenal vs Chelsea, right? [STAKE]{\n  "podTitle": "Arsenal vs Chelsea",\n  "amount": 5000\n}[/STAKE]',
          },
        }],
      }),
    } as any);

    const res = await chatWithOra([{ role: 'user', content: 'bet 5000 on arsenal' }]);

    expect(res.actions).toHaveLength(1);
    expect(res.actions[0].type).toBe('confirm_stake');
    expect(data(res.actions[0]).amount).toBe(5000);
    expect(data(res.actions[0]).podTitle).toBe('Arsenal vs Chelsea');
    expect(data(res.actions[0]).selection).toBe('Arsenal');
    expect(data(res.actions[0]).gainsMultiplier).toBe(2.1);
    const expectedPayout = Math.floor(5000 * 2.1);
    expect(data(res.actions[0]).potentialPayout).toBe(expectedPayout);
    expect(data(res.actions[0]).platformFee).toBe(Math.floor(expectedPayout * 0.1));
    expect(data(res.actions[0]).netPayout).toBe(expectedPayout - Math.floor(expectedPayout * 0.1));
    expect(res.content).not.toContain('[STAKE]');
  });

  it('parses an [ACCUM] block and finalizes legs against the real pods', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    mockPodFindRaw([mockPod, mockPod2]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: 'You want to bet ₦1,000 on a 2-game accumulator? [ACCUM]{"legs":[{"podId":"pod-1","podTitle":"Arsenal vs Chelsea","selection":"Arsenal","gainsMultiplier":2.1},{"podId":"pod-3","podTitle":"Real Madrid vs Barcelona","selection":"Barcelona","gainsMultiplier":1.9}],"stakeAmount":1000,"combinedMultiplier":3.99}[/ACCUM]',
          },
        }],
      }),
    } as any);

    const res = await chatWithOra([{ role: 'user', content: 'bet 1000 on 2 games' }]);

    expect(res.actions).toHaveLength(1);
    expect(res.actions[0].type).toBe('confirm_accumulator');
    expect(data(res.actions[0]).legs).toHaveLength(2);
    expect(data(res.actions[0]).combinedMultiplier).toBeCloseTo(2.1 * 1.9, 5);
    expect(data(res.actions[0]).stakeAmount).toBe(1000);
    expect(data(res.actions[0]).potentialPayout).toBe(Math.floor(1000 * (2.1 * 1.9)));
    expect(res.content).not.toContain('[ACCUM]');
  });

  it('drops the action card when the AI refers to a pod that does not exist', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    mockPodQuery([]);
    mockPodByName(null);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: 'You want to bet ₦5,000 on Arsenal vs Chelsea, right? [STAKE]{"podTitle":"Arsenal vs Chelsea","amount":5000}[/STAKE]',
          },
        }],
      }),
    } as any);

    const res = await chatWithOra([{ role: 'user', content: 'bet 5000 on arsenal' }]);

    expect(res.actions).toHaveLength(0);
  });

  it('uses the platform fee formula (10% of payout, floored) and clamps by maxPayout', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    mockPodQuery([]);
    mockPodByName({ ...mockPod, maxPayout: 8000 });
    mockPodById({ ...mockPod, maxPayout: 8000 });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: 'You want to bet ₦5,000 on Arsenal vs Chelsea, right? [STAKE]{"podId":"pod-1","podTitle":"Arsenal vs Chelsea","amount":5000}[/STAKE]',
          },
        }],
      }),
    } as any);

    const res = await chatWithOra([{ role: 'user', content: 'bet 5000 on arsenal' }]);

    expect(res.actions).toHaveLength(1);
    const amount = Math.floor(8000 / 2.1);
    expect(data(res.actions[0]).amount).toBe(amount);
    const payout = Math.floor(amount * 2.1);
    expect(data(res.actions[0]).potentialPayout).toBe(payout);
    expect(data(res.actions[0]).potentialPayout).toBeLessThanOrEqual(8000);
    expect(data(res.actions[0]).platformFee).toBe(Math.floor(payout * 0.1));
    expect(data(res.actions[0]).netPayout).toBe(payout - Math.floor(payout * 0.1));
  });

  it('drops the card when the pod is no longer stakable', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    mockPodQuery([]);
    mockPodById({ ...mockPod, status: 'settled' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: 'You want to bet ₦5,000 on Arsenal vs Chelsea, right? [STAKE]{"podId":"pod-1","podTitle":"Arsenal vs Chelsea","amount":5000}[/STAKE]',
          },
        }],
      }),
    } as any);

    const res = await chatWithOra([{ role: 'user', content: 'bet 5000 on arsenal' }]);

    expect(res.actions).toHaveLength(0);
    expect(res.content).not.toContain('[STAKE]');
  });
});

describe('chatWithOra — fallback paths (provider unreachable)', () => {
  it('falls back to mock and still returns a real action card from live pods', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('SSL handshake blocked'));
    mockPodQuery([mockPod]);

    const res = await chatWithOra([{ role: 'user', content: 'bet 5000 on arsenal' }]);

    expect(res.actions).toHaveLength(1);
    expect(res.actions[0].type).toBe('confirm_stake');
    expect(data(res.actions[0]).podId).toBe('pod-1');
    expect(data(res.actions[0]).selection).toBe('Arsenal');
    expect(data(res.actions[0]).amount).toBe(5000);
    const expectedPayout = Math.floor(5000 * 2.1);
    expect(data(res.actions[0]).potentialPayout).toBe(expectedPayout);
    expect(data(res.actions[0]).platformFee).toBe(Math.floor(expectedPayout * 0.1));
    expect(data(res.actions[0]).netPayout).toBe(expectedPayout - Math.floor(expectedPayout * 0.1));
    expect(res.content).not.toContain('[STAKE]');
    expect(res.content.toLowerCase()).toContain('pick: arsenal');
  });

  it('works the same when no API key is configured', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    mockPodQuery([mockPod]);

    const res = await chatWithOra([{ role: 'user', content: 'place 10k on arsenal to win' }]);

    expect(res.actions).toHaveLength(1);
    expect(data(res.actions[0]).amount).toBe(10000);
    expect(data(res.actions[0]).podId).toBe('pod-1');
  });

  it('clamps the requested amount to the pod stake range', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));
    mockPodQuery([mockPod]);

    const res = await chatWithOra([{ role: 'user', content: 'bet 9999999 on arsenal' }]);

    expect(data(res.actions[0]).amount).toBe(100000);
    expect(res.content).toContain('maximum stake');
  });

  it('builds a 5-game accumulator for "bet ₦200 on 5 games"', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));
    mockPodQuery(multPods);

    const res = await chatWithOra([{ role: 'user', content: 'bet 200 on 5 games' }]);

    expect(res.actions).toHaveLength(1);
    expect(res.actions[0].type).toBe('confirm_accumulator');
    expect(data(res.actions[0]).legs).toHaveLength(5);
    expect(data(res.actions[0]).stakeAmount).toBe(200);
    const expectedCombined = [1.2, 1.3, 1.4, 1.5, 1.6].reduce((a, m) => a * m, 1);
    expect(data(res.actions[0]).combinedMultiplier).toBeCloseTo(expectedCombined, 5);
    expect(data(res.actions[0]).netPayout).toBe(Math.floor(200 * expectedCombined) - Math.floor(200 * expectedCombined * 0.1));
    expect(res.content.toLowerCase()).toContain('accumulator');
    expect(res.content).not.toContain('[ACCUM]');
  });

  it('uses the 3 highest-confidence pods for "pick 3 best games and bet ₦300"', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));
    mockPodQuery([mockPod, mockPod2, ...multPods]);

    const res = await chatWithOra([{ role: 'user', content: 'pick 3 best games and bet 300 for me' }]);

    expect(res.actions).toHaveLength(1);
    expect(res.actions[0].type).toBe('confirm_accumulator');
    expect(data(res.actions[0]).legs.map(l => l.podId)).toEqual(['pod-1', 'pod-3', 'pod-m1']);
    expect(data(res.actions[0]).stakeAmount).toBe(300);
  });

  it('creates 5 separate singles for "bet ₦200 on each of 5 games"', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));
    mockPodQuery(multPods);

    const res = await chatWithOra([{ role: 'user', content: 'bet 200 on each of 5 games' }]);

    expect(res.actions).toHaveLength(5);
    for (const a of res.actions) {
      expect(a.type).toBe('confirm_stake');
      expect(data(a).amount).toBe(200);
    }
  });

  it('bets on the strongest single game for "bet ₦100 on winning game"', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));
    mockPodQuery([mockPod, mockPod2]);

    const res = await chatWithOra([{ role: 'user', content: 'bet 100 on winning game' }]);

    expect(res.actions).toHaveLength(1);
    expect(res.actions[0].type).toBe('confirm_stake');
    expect(data(res.actions[0]).podId).toBe('pod-1');
    expect(res.content).toContain('strongest game');
  });

  it('builds an accumulator from named teams: "bet ₦500 on arsenal and barcelona"', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));
    mockPodQuery([mockPod, mockPod2]);

    const res = await chatWithOra([{ role: 'user', content: 'bet 500 on arsenal and barcelona' }]);

    expect(res.actions).toHaveLength(1);
    expect(res.actions[0].type).toBe('confirm_accumulator');
    expect(data(res.actions[0]).legs.map(l => l.podId)).toEqual(['pod-1', 'pod-3']);
  });

  it('handles multiple bets in one message: single + accumulator', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));
    mockPodQuery(multPods);

    const res = await chatWithOra([{ role: 'user', content: 'bet 100 on winning game, bet 200 on 5 games' }]);

    expect(res.actions).toHaveLength(2);
    expect(res.actions[0].type).toBe('confirm_stake');
    expect(res.actions[1].type).toBe('confirm_accumulator');
    expect(data(res.actions[1]).legs).toHaveLength(5);
  });

  it('clamps over-requested games to 5 and notes it', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));
    mockPodQuery(multPods);

    const res = await chatWithOra([{ role: 'user', content: 'bet 200 on 9 games' }]);

    expect(res.actions).toHaveLength(1);
    expect(res.actions[0].type).toBe('confirm_accumulator');
    expect(data(res.actions[0]).legs).toHaveLength(5);
    expect(res.content).toContain('up to 5');
  });

  it('drops legs to keep combined odds at or below 50x', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));
    mockPodQuery(bigMultPods);

    const res = await chatWithOra([{ role: 'user', content: 'bet 500 on 5 games' }]);

    expect(res.actions).toHaveLength(1);
    expect(res.actions[0].type).toBe('confirm_accumulator');
    expect(data(res.actions[0]).legs).toHaveLength(4);
    expect(data(res.actions[0]).combinedMultiplier).toBeCloseTo(1.5 * 2 * 3 * 4, 5);
    expect(res.content).toContain('dropped 1 leg');
  });

  it('asks for confirmation when a named team does not match the pod pick', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));
    mockPodQuery([awayPickPod]);

    const res = await chatWithOra([{ role: 'user', content: 'bet 200 on ik start to win' }]);

    expect(res.actions).toHaveLength(0);
    expect(res.content).toContain('[PENDING]');
    expect(res.content).toContain('Away Win');
  });

  it('emits the real stake cards when the user confirms the pod pick', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));
    mockPodQuery([awayPickPod]);
    mockPodById(awayPickPod);

    const res = await chatWithOra([
      { role: 'user', content: 'bet 200 on ik start to win' },
      { role: 'assistant', content: '⚠️ Heads-up — that pod\'s pick is fixed as Away Win (1.7x), so I can\'t stake on the team you named. Want me to stake ₦200 on "IK Start vs Viking FK" — Away Win? Reply "yes" to confirm. [PENDING]{"intents":[{"amount":200,"teams":["ik start"],"winPick":false,"each":false,"mode":"single"}]}[/PENDING]' },
      { role: 'user', content: 'yes' },
    ]);

    expect(res.actions).toHaveLength(1);
    expect(res.actions[0].type).toBe('confirm_stake');
    expect(data(res.actions[0]).podId).toBe('pod-2');
    expect(data(res.actions[0]).selection).toBe('Away Win');
    expect(data(res.actions[0]).amount).toBe(100);
    expect(res.content).not.toContain('[PENDING]');
    expect(res.content).not.toContain('[STAKE]');
  });

  it('re-asks nothing on confirmation — rebuilds the whole batch without alignment checks', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));
    mockPodQuery([awayPickPod, mockPod]);

    const res = await chatWithOra([
      { role: 'user', content: 'bet 500 on ik start and arsenal' },
      { role: 'assistant', content: '⚠️ Heads-up — that pod\'s pick is fixed as Away Win (1.7x), so I can\'t stake on the team you named. Want me to stake ₦500 on "IK Start vs Viking FK" — Away Win? Reply "yes" to confirm. [PENDING]{"intents":[{"amount":500,"teams":["ik start","arsenal"],"winPick":false,"each":false,"mode":"accumulator"}]}[/PENDING]' },
      { role: 'user', content: 'yes' },
    ]);

    expect(res.actions).toHaveLength(1);
    expect(res.actions[0].type).toBe('confirm_accumulator');
    expect(data(res.actions[0]).legs.map(l => l.podId)).toEqual(['pod-2', 'pod-1']);
  });

  it('answers non-betting questions with canned content and no action cards', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));

    const res = await chatWithOra([{ role: 'user', content: 'what is my balance?' }]);

    expect(res.actions).toHaveLength(0);
    expect(res.content.toLowerCase()).toContain('balance');
  });

  it('does not emit action cards when no live pods exist', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));
    mockPodQuery([]);

    const res = await chatWithOra([{ role: 'user', content: 'bet 5000 on arsenal' }]);

    expect(res.actions).toHaveLength(0);
    expect(res.content.length).toBeGreaterThan(0);
  });

  it('tells the user to place the bet manually when the AI fails and no card can be built', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('unreachable'));
    findMock.mockReturnValue({ select: () => { throw new Error('db down'); } });

    const res = await chatWithOra([{ role: 'user', content: 'bet 5000 on arsenal' }]);

    expect(res.actions).toHaveLength(0);
    expect(res.content).toContain('manually');
    expect(res.content).toContain('Home feed');
  });

  it('does not tack on manual-placement guidance when a bet card was built or a question is pending', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('unreachable'));
    mockPodQuery([mockPod]);

    const res = await chatWithOra([{ role: 'user', content: 'bet 5000 on arsenal' }]);

    expect(res.actions).toHaveLength(1);
    expect(res.content).not.toContain('place it manually');
  });

  it('only queries pods that are open, active and not externally booked', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));
    mockPodQuery([mockPod]);

    await chatWithOra([{ role: 'user', content: 'bet 1000 on arsenal' }]);

    expect(findMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of findMock.mock.calls) {
      const q = call[0];
      if (q) {
        expect(q.status).toBe('active');
        expect(q.bookedExternally).toBe(false);
        expect(q.opensAt?.$lte).toBeInstanceOf(Date);
        expect(q.stakingClosesAt?.$gte).toBeInstanceOf(Date);
      }
    }
  });
});
