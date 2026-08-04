import { pickOutcomeVerdict, verdictFromFinalScores, matchResultFromScores } from './pick-verdict';

const finished = { matchStatus: 'finished' as const };

describe('pickOutcomeVerdict — mirrors client pickOutcome()', () => {
  describe('over/under', () => {
    it('Under 2.5 wins on a low-scoring draw', () => {
      expect(pickOutcomeVerdict({ ...finished, pick: 'Under 2.5', result: 'draw', homeScore: 1, awayScore: 1 })).toBe('won');
    });

    it('Under 2.50 parses a two-decimal line', () => {
      expect(pickOutcomeVerdict({ ...finished, pick: 'Under 2.50', result: 'draw', homeScore: 1, awayScore: 1 })).toBe('won');
    });

    it('Under 2.5 loses when the total exceeds the line', () => {
      expect(pickOutcomeVerdict({ ...finished, pick: 'Under 2.5', result: 'away_win', homeScore: 1, awayScore: 2 })).toBe('lost');
    });

    it('Over 1.5 wins on a 2-0 home win', () => {
      expect(pickOutcomeVerdict({ ...finished, pick: 'Over 1.5', result: 'home_win', homeScore: 2, awayScore: 0 })).toBe('won');
    });

    it('Over 2.5 loses on a 2-0 home win', () => {
      expect(pickOutcomeVerdict({ ...finished, pick: 'Over 2.5', result: 'home_win', homeScore: 2, awayScore: 0 })).toBe('lost');
    });

    it('exact line push returns skip', () => {
      expect(pickOutcomeVerdict({ ...finished, pick: 'Over 2', result: 'home_win', homeScore: 2, awayScore: 0 })).toBe('skip');
    });

    it('skips when scores are missing', () => {
      expect(pickOutcomeVerdict({ ...finished, pick: 'Under 2.5', homeScore: null, awayScore: null })).toBe('skip');
    });
  });

  describe('BTTS', () => {
    it('wins when both teams score', () => {
      expect(pickOutcomeVerdict({ ...finished, pick: 'BTTS', result: 'draw', homeScore: 1, awayScore: 1 })).toBe('won');
    });

    it('loses when only one team scores', () => {
      expect(pickOutcomeVerdict({ ...finished, pick: 'BTTS Yes', result: 'home_win', homeScore: 2, awayScore: 0 })).toBe('lost');
    });
  });

  describe('1X2 and double chance', () => {
    it('Home wins on a home win', () => {
      expect(pickOutcomeVerdict({ ...finished, pick: 'Home', result: 'home_win', homeScore: 2, awayScore: 1 })).toBe('won');
    });

    it('Home loses on an away win', () => {
      expect(pickOutcomeVerdict({ ...finished, pick: 'Home', result: 'away_win', homeScore: 1, awayScore: 2 })).toBe('lost');
    });

    it('Draw wins on a draw', () => {
      expect(pickOutcomeVerdict({ ...finished, pick: 'Draw', result: 'draw' })).toBe('won');
    });

    it('Home or Draw wins on a draw', () => {
      expect(pickOutcomeVerdict({ ...finished, pick: 'Home or Draw', result: 'draw' })).toBe('won');
    });

    it('Home or Draw loses on an away win', () => {
      expect(pickOutcomeVerdict({ ...finished, pick: 'Home or Draw', result: 'away_win', homeScore: 0, awayScore: 1 })).toBe('lost');
    });

    it('Draw No Bet skips on a draw', () => {
      expect(pickOutcomeVerdict({ ...finished, pick: 'Home Draw No Bet', result: 'draw' })).toBe('skip');
    });
  });

  describe('guards', () => {
    it('skips unfinished matches', () => {
      expect(pickOutcomeVerdict({ pick: 'Under 2.5', matchStatus: 'notstarted', result: null })).toBe('skip');
    });

    it('skips unrecognized picks', () => {
      expect(pickOutcomeVerdict({ ...finished, pick: 'Arsenal to win the tournament' })).toBe('skip');
    });
  });
});

describe('verdictFromFinalScores', () => {
  it('derives the match result from scores', () => {
    expect(matchResultFromScores(2, 1)).toBe('home_win');
    expect(matchResultFromScores(1, 1)).toBe('draw');
    expect(matchResultFromScores(0, 3)).toBe('away_win');
  });

  it('judges a 1X2 pick from the final score', () => {
    expect(verdictFromFinalScores('Home', 2, 1)).toBe('won');
    expect(verdictFromFinalScores('Home', 0, 3)).toBe('lost');
  });

  it('judges an over pick and returns skip on a push', () => {
    expect(verdictFromFinalScores('Over 2.5', 2, 1)).toBe('won');
    expect(verdictFromFinalScores('Over 2', 2, 0)).toBe('skip');
  });

  it('skips Draw No Bet on a draw', () => {
    expect(verdictFromFinalScores('Home Draw No Bet', 1, 1)).toBe('skip');
  });
});
