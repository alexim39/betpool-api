import { chatWithOra } from './ai.service';
import { PodModel } from '../../models/pod.model';

jest.mock('../../models/pod.model', () => ({
  PodModel: { find: jest.fn() },
}));

const findMock = PodModel.find as jest.Mock;

const mockPod = {
  _id: { toString: () => 'pod-1' },
  title: 'Arsenal vs Chelsea',
  homeTeam: 'Arsenal',
  awayTeam: 'Chelsea',
  gainsMultiplier: 2.1,
  minStake: 1000,
  maxStake: 100000,
};

function mockPodQuery(pods: any[]) {
  const lean = jest.fn().mockResolvedValue(pods);
  findMock.mockReturnValue({
    select: () => ({ sort: () => ({ limit: () => ({ lean }) }) }),
  });
}

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  jest.clearAllMocks();
  delete process.env.DEEPSEEK_API_KEY;
});

describe('chatWithOra — AI path (provider reachable)', () => {
  it('parses a multiline [STAKE] block from the DeepSeek response into an action', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
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

    expect(res.action).toBeDefined();
    expect(res.action!.data.amount).toBe(5000);
    expect(res.action!.data.podTitle).toBe('Arsenal vs Chelsea');
    expect(res.action!.data.potentialPayout).toBe(7500);
    expect(res.content).not.toContain('[STAKE]');
  });
});

describe('chatWithOra — fallback paths (provider unreachable)', () => {
  it('falls back to mock and still returns a real action card from live pods', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('SSL handshake blocked'));
    mockPodQuery([mockPod]);

    const res = await chatWithOra([{ role: 'user', content: 'bet 5000 on arsenal' }]);

    expect(res.action).toBeDefined();
    expect(res.action!.data.podId).toBe('pod-1');
    expect(res.action!.data.podTitle).toBe('Arsenal vs Chelsea');
    expect(res.action!.data.amount).toBe(5000);
    expect(res.action!.data.gainsMultiplier).toBe(2.1);
    const expectedNet = 5000 * 2.1 - Math.round((5000 * 2.1 - 5000) * 0.1);
    expect(res.action!.data.netPayout).toBe(expectedNet);
    expect(res.content).not.toContain('[STAKE]');
  });

  it('works the same when no API key is configured', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    mockPodQuery([mockPod]);

    const res = await chatWithOra([{ role: 'user', content: 'place 10k on chelsea to win' }]);

    expect(res.action).toBeDefined();
    expect(res.action!.data.amount).toBe(10000);
    expect(res.action!.data.podId).toBe('pod-1');
  });

  it('clamps the requested amount to the pod stake range', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));
    mockPodQuery([mockPod]);

    const res = await chatWithOra([{ role: 'user', content: 'bet 9999999 on arsenal' }]);

    expect(res.action!.data.amount).toBe(100000);
  });

  it('answers non-betting questions with canned content and no action card', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));

    const res = await chatWithOra([{ role: 'user', content: 'what is my balance?' }]);

    expect(res.action).toBeUndefined();
    expect(res.content.toLowerCase()).toContain('balance');
  });

  it('does not emit an action card when no live pods exist', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockRejectedValue(new Error('blocked'));
    mockPodQuery([]);

    const res = await chatWithOra([{ role: 'user', content: 'bet 5000 on arsenal' }]);

    expect(res.action).toBeUndefined();
    expect(res.content.length).toBeGreaterThan(0);
  });
});
