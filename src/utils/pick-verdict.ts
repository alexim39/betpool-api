export type PickOutcome = 'won' | 'lost' | 'skip';

export interface PickVerdictInput {
  pick?: string;
  result?: string | null;
  matchStatus?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
}

function isFinishedStatus(matchStatus?: string | null): boolean {
  return !!matchStatus && matchStatus.toLowerCase() === 'finished';
}

/**
 * Server-side mirror of the client `pickOutcome()` in
 * workspace/projects/investbetz-platform/src/app/features/games/game-status.util.ts.
 * Judges 1X2, Over/Under (push => skip), BTTS, Double Chance and Draw No Bet
 * (draw => skip) from a finished match's result and final scores.
 */
export function pickOutcomeVerdict(g: PickVerdictInput): PickOutcome {
  if (g.matchStatus && !isFinishedStatus(g.matchStatus)) return 'skip';
  if (!g.result) return 'skip';
  const p = (g.pick || '').toLowerCase();

  const over = /over\s*(\d+(?:\.\d+)?)/.exec(p);
  const under = !over ? /under\s*(\d+(?:\.\d+)?)/.exec(p) : null;
  if (over || under) {
    if (g.homeScore == null || g.awayScore == null) return 'skip';
    const line = parseFloat((over || under)![1]);
    const total = Number(g.homeScore) + Number(g.awayScore);
    if (over) return total > line ? 'won' : total < line ? 'lost' : 'skip';
    return total < line ? 'won' : total > line ? 'lost' : 'skip';
  }

  if (/btts|both team/.test(p)) {
    if (g.homeScore == null || g.awayScore == null) return 'skip';
    return Number(g.homeScore) > 0 && Number(g.awayScore) > 0 ? 'won' : 'lost';
  }

  if (/double chance|draw no bet|\b1x\b|\bx2\b|\bor draw\b|\bor away\b|\bor home\b/.test(p)) {
    const homeCovered = /home|\b1\b|\b1x\b/.test(p);
    const awayCovered = /away|\b2\b|\bx2\b/.test(p);
    const drawCovered = /draw/.test(p);
    if (/draw no bet/.test(p)) {
      const homeSide = homeCovered && !awayCovered;
      const awaySide = awayCovered && !homeCovered;
      if (!homeSide && !awaySide) return 'skip';
      if (g.result === 'draw') return 'skip';
      if (homeSide) return g.result === 'home_win' ? 'won' : 'lost';
      return g.result === 'away_win' ? 'won' : 'lost';
    }
    const won =
      (homeCovered && g.result === 'home_win') ||
      (awayCovered && g.result === 'away_win') ||
      (drawCovered && g.result === 'draw');
    return won ? 'won' : 'lost';
  }

  if (p.includes('home')) return g.result === 'home_win' ? 'won' : 'lost';
  if (p.includes('away')) return g.result === 'away_win' ? 'won' : 'lost';
  if (p.includes('draw')) return g.result === 'draw' ? 'won' : 'lost';
  return 'skip';
}

export function matchResultFromScores(homeScore: number, awayScore: number): 'home_win' | 'draw' | 'away_win' {
  if (homeScore > awayScore) return 'home_win';
  if (homeScore < awayScore) return 'away_win';
  return 'draw';
}

/**
 * Verdict for a pod settled with a final score. The pod has no `matchStatus`,
 * so we treat it as finished and derive the match result from the scores.
 */
export function verdictFromFinalScores(pick: string, homeScore: number, awayScore: number): PickOutcome {
  return pickOutcomeVerdict({
    pick,
    result: matchResultFromScores(homeScore, awayScore),
    homeScore,
    awayScore,
  });
}
