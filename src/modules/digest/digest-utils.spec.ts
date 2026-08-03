import {
  computeEscalation,
  digestToken,
  verifyDigestToken,
  renderDigestEmail,
  naira,
  capErrors,
} from './digest-utils';

describe('digest-utils', () => {
  describe('computeEscalation', () => {
    it('flags high frequency (5+ stakes in 24h)', () => {
      expect(computeEscalation({ stakes24h: 5, staked24h: 1000, bankroll: 100000, lossStreak: 0 })).toBe(true);
    });

    it('flags stake volume >= 50% of bankroll in 24h', () => {
      expect(computeEscalation({ stakes24h: 1, staked24h: 50000, bankroll: 100000, lossStreak: 0 })).toBe(true);
    });

    it('flags a 3+ loss streak', () => {
      expect(computeEscalation({ stakes24h: 1, staked24h: 500, bankroll: 100000, lossStreak: 3 })).toBe(true);
    });

    it('does not flag normal activity', () => {
      expect(computeEscalation({ stakes24h: 2, staked24h: 2000, bankroll: 100000, lossStreak: 1 })).toBe(false);
    });
  });

  describe('digestToken', () => {
    it('is deterministic and userId-specific', () => {
      const a1 = digestToken('u1');
      const a2 = digestToken('u1');
      const b = digestToken('u2');
      expect(a1).toBe(a2);
      expect(a1).not.toBe(b);
    });

    it('verifies valid and rejects invalid/empty tokens', () => {
      const t = digestToken('abc123');
      expect(verifyDigestToken('abc123', t)).toBe(true);
      expect(verifyDigestToken('abc123', 'wrong')).toBe(false);
      expect(verifyDigestToken('', '')).toBe(false);
    });
  });

  describe('renderDigestEmail', () => {
    const base = {
      firstName: 'Ada',
      bankroll: 50000,
      staked7d: 20000,
      net7d: 5000,
      stakes24h: 2,
      staked24h: 2000,
    };
    const picks = [
      {
        homeTeam: 'Arsenal',
        awayTeam: 'Chelsea',
        league: 'Premier League',
        kickoff: 'Sat 15:00',
        pick: 'Over 2.5',
        gainsMultiplier: 1.85,
        confidence: 78,
        stakable: true,
      },
    ];
    const unsub = 'https://api.betpool.tech/digest/unsubscribe/x/yyz';

    it('renders branded shell, CTA and pick card', () => {
      const html = renderDigestEmail(base, picks, unsub, false);
      expect(html).toContain('Daily AI Briefing');
      expect(html).toContain('Hi <strong style="color:#FFFFFF">Ada</strong>');
      expect(html).toContain('Arsenal');
      expect(html).toContain('Over 2.5');
      expect(html).toContain('View Today\'s Picks');
      expect(html).toContain('Your bankroll');
      expect(html).toContain(unsub);
    });

    it('includes escalation block only when escalation', () => {
      const plain = renderDigestEmail(base, picks, unsub, false);
      const escalated = renderDigestEmail({ ...base, stakes24h: 7, staked24h: 30000 }, picks, unsub, true);
      expect(plain).not.toContain('Quick check-in');
      expect(escalated).toContain('Quick check-in');
      expect(escalated).toContain('support@betpool.tech');
    });
  });

  describe('naira / capErrors', () => {
    it('formats currency and escapes', () => {
      expect(naira(5000)).toBe('₦5,000');
      expect(naira(-2500)).toBe('-₦2,500');
    });

    it('caps error lists', () => {
      const many = Array.from({ length: 250 }, (_, i) => `e${i}`);
      const capped = capErrors(many);
      expect(capped.length).toBeLessThanOrEqual(201);
      expect(capped[capped.length - 1]).toContain('more errors');
    });
  });
});