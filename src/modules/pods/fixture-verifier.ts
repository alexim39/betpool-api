import axios from 'axios';
import { LEAGUE_NAMES } from '../ai/ai-curation.service';
import { GAME_LIVE_STATUSES, GAME_TERMINAL_STATUSES } from '../ai/ai-games.service';

export interface VerifiedFixture {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: Date;
  status: string;
}

export interface FixtureVerificationResult {
  ok: boolean;
  reason?: string;
  fixture?: VerifiedFixture;
}

// ---- Team-name helpers (mirrors ai-settlement.service.ts) --------------------
const pickTeamName = (v: any): string => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return v?.name ?? v?.name_long ?? v?.title ?? '';
};

const normalizeTeamName = (name: string): string =>
  (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(fc|cf|sc|wfc|afc|utd|club|football|soccer|womens|women)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const teamNamesMatch = (a: string, b: string): boolean => {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  return na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na));
};

/**
 * Verifies a user-published pick against the live sports API before the pod is
 * created. The pod may only be published when the fixture exists, the teams
 * match, the match has not started, and the kickoff is in the future.
 *
 * The returned fixture data (not the client payload) is what gets stored on the
 * pod, so free-text/spoofed team names can never reach settlement.
 */
export async function verifyFixture(
  fixtureId: number,
  opts: { homeTeam?: string; awayTeam?: string } = {}
): Promise<FixtureVerificationResult> {
  const apiKey = process.env.SPORTSAPI_KEY || '';
  if (!apiKey) return { ok: false, reason: 'Sports API is not configured on the server' };

  const baseUrl = (process.env.SPORTSAPI_BASE_URL || 'https://sports.bzzoiro.com/api/v2').replace(/\/+$/, '');

  let res;
  try {
    res = await axios.get(`${baseUrl}/events/${fixtureId}/`, {
      headers: { Authorization: `Token ${apiKey}` },
      timeout: 10000,
    });
  } catch {
    return { ok: false, reason: 'That game does not exist in our sports feed' };
  }

  const ev = res.data;
  if (!ev || typeof ev !== 'object' || !ev.id) {
    return { ok: false, reason: 'That game does not exist in our sports feed' };
  }

  const homeTeam = pickTeamName(ev.home_team);
  const awayTeam = pickTeamName(ev.away_team);
  const status = String(ev.status || ev.event_status || ev.match_status || 'unknown').toLowerCase();

  if (!homeTeam || !awayTeam) {
    return { ok: false, reason: 'That fixture has incomplete team data' };
  }
  if (GAME_TERMINAL_STATUSES.includes(status)) {
    return { ok: false, reason: `That game is ${status} — picks can only be published on upcoming games` };
  }
  if (status !== 'notstarted' && GAME_LIVE_STATUSES.includes(status)) {
    return { ok: false, reason: 'That game has already started — picks must close before kickoff' };
  }
  if (status !== 'notstarted') {
    return { ok: false, reason: 'That game is not available for publishing' };
  }

  const matchDate = new Date(ev.event_date);
  if (isNaN(matchDate.getTime()) || matchDate.getTime() <= Date.now()) {
    return { ok: false, reason: 'That game has already kicked off' };
  }

  if (opts.homeTeam && !teamNamesMatch(homeTeam, opts.homeTeam)) {
    return { ok: false, reason: `The home team does not match the game (got "${opts.homeTeam}", expected "${homeTeam}")` };
  }
  if (opts.awayTeam && !teamNamesMatch(awayTeam, opts.awayTeam)) {
    return { ok: false, reason: `The away team does not match the game (got "${opts.awayTeam}", expected "${awayTeam}")` };
  }

  const leagueId = Number(ev.league_id);
  const rawLeague = typeof ev.league?.name === 'string' ? ev.league.name : ev.league_name || '';
  const league = Number.isFinite(leagueId) && LEAGUE_NAMES[leagueId]
    ? LEAGUE_NAMES[leagueId]
    : rawLeague;

  return {
    ok: true,
    fixture: {
      fixtureId: Number(ev.id),
      homeTeam,
      awayTeam,
      league: league || 'Unknown League',
      matchDate,
      status,
    },
  };
}
