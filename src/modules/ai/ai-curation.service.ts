import axios from 'axios';
import mongoose from 'mongoose';
import { StakeModel } from '../../models/stake.model';
import { WalletModel } from '../../models/wallet.model';
import { PodModel } from '../../models/pod.model';
import { curationAccuracyService, CurationAccuracyStats } from './curation-accuracy.service';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

interface BSDEvent {
  id: number;
  league_id: number;
  league?: { name: string };
  league_name?: string;
  season_id: number;
  home_team_id: number;
  home_team: string;
  away_team_id: number;
  away_team: string;
  event_date: string;
  status: string;
  round_number?: number;
  round_name?: string;
  home_score?: number | null;
  away_score?: number | null;
  head_to_head?: {
    total_matches: number;
    home_wins: number;
    draws: number;
    away_wins: number;
    home_goals: number;
    away_goals: number;
    avg_total_goals: number;
    home_win_rate: number;
    away_win_rate: number;
    recent_matches: Array<{ home: string; away: string; date: string; score: string }>;
  };
}

interface TeamFormData {
  teamId: number;
  teamName: string;
  last5: string[];
  homeWins: number;
  awayWins: number;
  draws: number;
  losses: number;
  goalsScored: number;
  goalsConceded: number;
  homeRecord: { played: number; wins: number; draws: number; losses: number };
  awayRecord: { played: number; wins: number; draws: number; losses: number };
}

interface OddsMarket {
  code: string;
  outcomes: Array<{
    code: string;
    name?: string;
    best_odds?: number;
    max_odds?: number;
    odds?: number;
  }>;
}

export interface CurationSelection {
  selection: string;
  confidence: number;
  recommendedMultiplier: number;
  reasoning: string;
}

export interface CurationResult {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;
  verdict: 'RECOMMEND' | 'SKIP';
  overallReasoning: string;
  recommendations: CurationSelection[];
  multiplier?: number;
  selection?: string;
  isCombined?: boolean;
  combinedLegs?: Array<{ marketType: string; selection: string; multiplier: number }>;
}

export interface CurationResponse {
  success: boolean;
  total: number;
  recommended: number;
  skipped: number;
  fixtures: CurationResult[];
  errors: string[];
  apiLog: string[];
  skippedReason: string | null;
  oraWinRate: number;
  oraTotalPods: number;
  oraWon: number;
  confidenceThreshold: number;
  ledgerAccuracy: CurationAccuracyStats | null;
  autoCreated?: boolean;
  createdPods?: Array<{ fixtureId: number; homeTeam: string; awayTeam: string; podId: string; title: string }>;
}

export const LEAGUE_NAMES: Record<number, string> = {
  1: 'Premier League',
  2: 'UEFA Champions League',
  3: 'La Liga',
  4: 'Serie A',
  5: 'Bundesliga',
  6: 'Ligue 1',
  7: 'Eredivisie',
  8: 'Primeira Liga',
  9: 'English Championship',
  10: 'Scottish Premiership',
  11: 'Belgian Pro League',
  12: 'Super Lig',
  13: 'Russian Premier League',
  14: 'Austrian Bundesliga',
  15: 'Swiss Super League',
  16: 'Greek Super League',
  17: 'Danish Superliga',
  18: 'Eliteserien',
  19: 'Allsvenskan',
  20: 'Ekstraklasa',
  21: 'Czech First League',
  22: 'Croatian HNL',
  23: 'Romanian Liga I',
  24: 'Bulgarian First League',
  25: 'MLS',
  26: 'J1 League',
  27: 'Saudi Pro League',
  54: 'Eliteserien',
  55: 'OBOS-ligaen',
  88: 'Championship',
  90: 'League One',
  91: 'League Two',
  94: 'Premier League 2',
  101: 'UEFA Europa League',
  102: 'UEFA Conference League',
  103: 'FA Cup',
  104: 'EFL Cup',
  105: 'Super Cup',
  106: 'Community Shield',
  107: 'Copa del Rey',
  108: 'DFB-Pokal',
  109: 'Coppa Italia',
  110: 'Coupe de France',
  111: 'KNVB Cup',
  112: 'Taça de Portugal',
  113: 'Scottish Cup',
  114: 'AFC Champions League',
  115: 'CAF Champions League',
  116: 'Copa Libertadores',
  117: 'Copa Sudamericana',
  118: 'CONCACAF Champions Cup',
  119: 'FIFA Club World Cup',
  120: 'FIFA World Cup',
  121: 'UEFA Euro',
  122: 'Copa America',
  123: 'Africa Cup of Nations',
  124: 'Asian Cup',
  125: 'Gold Cup',
  126: 'Olympics',
};

function isQuotaError(err: any): boolean {
  const status = err?.response?.status;
  const data = err?.response?.data;
  return status === 429 || data?.code === 'taster_exhausted' || String(data?.detail || '').toLowerCase().includes('free daily');
}
function quotaDetail(err: any): string | undefined {
  return err?.response?.data?.detail || err?.response?.data?.message;
}
export class AICurationService {
  private get apiKey(): string { return process.env.SPORTSAPI_KEY || ''; }
  private get baseUrl(): string {
    return (process.env.SPORTSAPI_BASE_URL || 'https://sports.bzzoiro.com/api/v2').replace(/\/+$/, '');
  }
  private get leagues(): string[] {
    return (process.env.SPORTSAPI_LEAGUES || '1,3,4,5,6,7,8,2').split(',').map(s => s.trim());
  }
  private get deepseekKey(): string { return process.env.DEEPSEEK_API_KEY || ''; }

  private get minPickOdds(): number {
    const v = parseFloat(process.env.ORA_MIN_PICK_ODDS || '1.20');
    return Number.isFinite(v) && v >= 1.01 ? v : 1.20;
  }

  private get verySureImplied(): number {
    const v = parseFloat(process.env.ORA_VERY_SURE_IMPLIED || '0.80');
    return Number.isFinite(v) && v > 0 && v < 1 ? v : 0.80;
  }
  private oddsLeagueNames = new Map<number, string>();

  private get headers(): Record<string, string> {
    return { 'Authorization': `Token ${this.apiKey}` };
  }

  private leagueName(leagueId: number | undefined | null, fixtureId?: number, raw?: string): string {
    if (fixtureId != null && this.oddsLeagueNames.has(fixtureId)) {
      const real = this.oddsLeagueNames.get(fixtureId);
      if (real) return real;
    }
    if (raw && !/^\d+$/.test(raw)) return raw;
    if (leagueId == null) return raw || '';
    return LEAGUE_NAMES[leagueId] || raw || `League ${leagueId}`;
  }

  private async fetchUpcomingFixtures(dateFrom: string, dateTo: string): Promise<BSDEvent[]> {
    const fixtures: BSDEvent[] = [];
    const seen = new Set<number>();
    let offset = 0;
    const PAGE = 50;
    for (let guard = 0; guard < 20; guard++) {
      let res;
      try {
        res = await axios.get(`${this.baseUrl}/events/`, {
          headers: this.headers,
          params: { status: 'notstarted', date_from: dateFrom, date_to: dateTo, limit: PAGE, offset },
          timeout: 20000,
        });
      } catch (err: any) {
        if (isQuotaError(err)) throw Object.assign(err, { isQuota: true, quotaDetail: quotaDetail(err) });
        break;
      }
      const events: BSDEvent[] = res.data?.results || [];
      if (!events.length) break;
      for (const ev of events) {
        if (!ev.id || seen.has(ev.id)) continue;
        if (!ev.home_team || !ev.away_team || !ev.event_date) continue;
        if (['finished', 'postponed', 'cancelled'].includes(ev.status)) continue;
        seen.add(ev.id);
        fixtures.push(ev);
      }
      if (events.length < PAGE) break;
      offset += PAGE;
    }
    return fixtures;
  }

  private parseOddsMarkets(data: any): OddsMarket[] {
    const markets: OddsMarket[] = [];
    if (Array.isArray(data?.markets)) {
      return data.markets as OddsMarket[];
    }
    if (data?.markets && typeof data.markets === 'object') {
      for (const [code, m] of Object.entries(data.markets)) {
        const outcomes: OddsMarket['outcomes'] = [];
        for (const [oc, o] of Object.entries((m as any) || {})) {
          const val = o as any;
          if (!val || typeof val !== 'object') continue;
          outcomes.push({
            code: oc,
            name: val.outcome_name || val.name || oc,
            best_odds: val.best_odds || val.odds || val.max_odds || 0,
          });
        }
        markets.push({ code, outcomes });
      }
      return markets;
    }
    if (data?.comparison) return data.comparison as OddsMarket[];
    return [];
  }

  async curate(): Promise<CurationResponse> {
    const result: CurationResponse = {
      success: true, total: 0, recommended: 0, skipped: 0,
      fixtures: [], errors: [], apiLog: [], skippedReason: null,
      oraWinRate: 50, oraTotalPods: 0, oraWon: 0, confidenceThreshold: 65,
      ledgerAccuracy: null,
    };

    if (!this.apiKey || this.apiKey === 'your_api_key_here') {
      result.success = false;
      result.errors.push('SPORTSAPI_KEY not configured. Sign up at https://sports.bzzoiro.com/register/ for a free key.');
      return result;
    }

    if (!this.deepseekKey || this.deepseekKey === 'your_deepseek_api_key_here') {
      result.skippedReason = 'DeepSeek API key not configured. Set DEEPSEEK_API_KEY in .env for AI curation.';
      return result;
    }

    // 1. Learn from Ora's past performance
    await this.loadOraHistory(result);

    // 1b. Load settled-pick ledger accuracy (league/market win rates)
    result.ledgerAccuracy = await curationAccuracyService.getStats();

    // 2. Fetch financial health
    const financialHealth = await this.getFinancialHealth();

    // 3. Fetch upcoming fixtures
    const today = new Date();
    const dateFrom = today.toISOString().split('T')[0];
    const dateTo = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];
    let fixtures: BSDEvent[] = [];
    try {
      fixtures = await this.fetchUpcomingFixtures(dateFrom, dateTo);
    } catch (err: any) {
      if ((err as any).isQuota || isQuotaError(err)) {
        const detail = (err as any).quotaDetail || quotaDetail(err);
        result.success = false;
        result.errors.push(`${detail || 'Daily football API quota exhausted'} — resets at midnight UTC (00:00 UTC). No curation possible until then. Reduce leagues/days or upgrade at https://sports.bzzoiro.com/pricing/.`);
        result.skippedReason = 'Quota exhausted — taster plan daily limit reached.';
        return result;
      }
      throw err;
    }

    result.total = fixtures.length;
    result.apiLog.push(`Total fixtures to analyze: ${fixtures.length}`);

    if (fixtures.length === 0) {
      result.skippedReason = 'No upcoming fixtures found in configured leagues.';
      return result;
    }

    // 4. Batch fetch form data for all unique teams
    const uniqueTeamIds = new Set<number>();
    for (const f of fixtures) {
      uniqueTeamIds.add(f.home_team_id);
      uniqueTeamIds.add(f.away_team_id);
    }
    const formCache = new Map<number, TeamFormData>();
    const formPromises: Promise<void>[] = [];
    for (const teamId of uniqueTeamIds) {
      formPromises.push(this.fetchTeamForm(teamId).then(fd => {
        if (fd) formCache.set(teamId, fd);
      }));
    }
    await Promise.all(formPromises);
    result.apiLog.push(`Fetched form data for ${formCache.size} teams`);

    // 5. Fetch odds for each fixture (parallel)
    const oddsCache = new Map<number, OddsMarket[]>();
    const oddsPromises: Promise<void>[] = [];
    for (const f of fixtures) {
      oddsPromises.push(this.fetchOdds(f.id).then(odds => {
        if (odds.length) oddsCache.set(f.id, odds);
      }));
    }
    await Promise.all(oddsPromises);
    result.apiLog.push(`Fetched odds for ${oddsCache.size} fixtures`);

    // 6. Analyze each fixture via DeepSeek with enhanced data
    const BATCH_SIZE = 5;
    for (let i = 0; i < fixtures.length; i += BATCH_SIZE) {
      const batch = fixtures.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(fixture => this.analyzeFixtureEnhanced(
          fixture,
          formCache.get(fixture.home_team_id),
          formCache.get(fixture.away_team_id),
          oddsCache.get(fixture.id) || [],
          financialHealth,
          result,
          result.ledgerAccuracy
        ))
      );
      for (const analysis of batchResults) {
        result.fixtures.push(analysis);
        if (analysis.verdict === 'RECOMMEND') {
          result.recommended++;
        } else {
          result.skipped++;
        }
      }
    }

    // 7. Enforce max 10 pods — keep highest value score (confidence × multiplier)
    if (result.recommended > 10) {
      result.fixtures.sort((a, b) => {
        const aScore = (a.recommendations?.[0]?.confidence || 0) * ((a.multiplier || 1.5) - 1);
        const bScore = (b.recommendations?.[0]?.confidence || 0) * ((b.multiplier || 1.5) - 1);
        return bScore - aScore;
      });
      let demoted = 0;
      for (const f of result.fixtures) {
        if (f.verdict === 'RECOMMEND' && result.recommended - demoted > 10) {
          f.verdict = 'SKIP';
          f.overallReasoning = 'Demoted: exceeded 10-pod quality cap. Higher-value picks prioritized.';
          demoted++;
        }
      }
      result.recommended = 10;
      result.skipped += demoted;
    }

    const summary = `${result.recommended} recommended, ${result.skipped} skipped of ${result.total}`;
    result.apiLog.push(summary);
    return result;
  }

  private async loadOraHistory(result: CurationResponse): Promise<void> {
    try {
      const oraPods = await PodModel.find({
        'metadata.oraCurated': true,
        status: 'settled'
      }).select('result metadata.createdAt').lean();

      result.oraTotalPods = oraPods.length;
      if (result.oraTotalPods > 0) {
        result.oraWon = oraPods.filter(p => p.result === 'win').length;
        result.oraWinRate = Math.round((result.oraWon / result.oraTotalPods) * 100);
      }

      // Adjust threshold based on performance
      // Base: 65% confidence required
      // If win rate < 60% over last 10: raise to 80%
      // If win rate > 80% over last 10: lower to 55%
      const last10 = oraPods.slice(-10);
      if (last10.length >= 5) {
        const recentWon = last10.filter(p => p.result === 'win').length;
        const recentRate = (recentWon / last10.length) * 100;
        if (recentRate < 60 && result.confidenceThreshold < 80) {
          result.confidenceThreshold = Math.min(80, result.confidenceThreshold + 10);
        } else if (recentRate >= 80 && result.confidenceThreshold > 55) {
          result.confidenceThreshold = Math.max(55, result.confidenceThreshold - 5);
        }
      }
    } catch {
      result.confidenceThreshold = 65;
    }
  }

  private async getFinancialHealth(): Promise<{ reserveRatio: number; totalReserves: number; totalExposure: number; activePodCount: number }> {
    try {
      const walletResult = await WalletModel.aggregate([
        { $group: { _id: null, totalBalance: { $sum: '$balance' } } }
      ]);
      const totalReserves = walletResult[0]?.totalBalance || 0;

      const podStats = await PodModel.aggregate([
        { $match: { status: { $in: ['active', 'published'] } } },
        { $group: { _id: null, totalExposure: { $sum: '$currentExposure' }, count: { $sum: 1 } } }
      ]);
      const totalExposure = podStats[0]?.totalExposure || 0;
      const activePodCount = podStats[0]?.count || 0;
      const reserveRatio = totalExposure > 0 ? Math.min(1, totalReserves / totalExposure) : 1;

      return { reserveRatio, totalReserves, totalExposure, activePodCount };
    } catch {
      return { reserveRatio: 0.5, totalReserves: 0, totalExposure: 0, activePodCount: 0 };
    }
  }

  private async fetchTeamForm(teamId: number): Promise<TeamFormData | null> {
    try {
      const res = await axios.get(`${this.baseUrl}/events/`, {
        headers: this.headers,
        params: { status: 'finished', team_id: teamId, limit: 5 },
        timeout: 15000,
      });
      const matches: any[] = res.data?.results || [];
      if (matches.length === 0) return null;

      const teamName = matches[0]?.home_team_id === teamId
        ? matches[0]?.home_team
        : matches[0]?.away_team || '';

      let homeWins = 0, awayWins = 0, draws = 0, goalsScored = 0, goalsConceded = 0;
      const homeRecord = { played: 0, wins: 0, draws: 0, losses: 0 };
      const awayRecord = { played: 0, wins: 0, draws: 0, losses: 0 };
      const last5: string[] = [];

      for (const m of matches) {
        const isHome = m.home_team_id === teamId;
        const hs = m.home_score ?? 0;
        const as = m.away_score ?? 0;
        const scored = isHome ? hs : as;
        const conceded = isHome ? as : hs;

        goalsScored += scored;
        goalsConceded += conceded;

        if (isHome) {
          homeRecord.played++;
          if (hs > as) { homeWins++; homeRecord.wins++; last5.push('W'); }
          else if (hs === as) { draws++; homeRecord.draws++; last5.push('D'); }
          else { homeRecord.losses++; last5.push('L'); }
        } else {
          awayRecord.played++;
          if (as > hs) { awayWins++; awayRecord.wins++; last5.push('W'); }
          else if (as === hs) { draws++; awayRecord.draws++; last5.push('D'); }
          else { awayRecord.losses++; last5.push('L'); }
        }
      }

      return {
        teamId,
        teamName,
        last5,
        homeWins, awayWins, draws,
        losses: matches.length - (homeWins + awayWins + draws),
        goalsScored, goalsConceded,
        homeRecord, awayRecord,
      };
    } catch {
      return null;
    }
  }

  /** Fallback guard: +adjustment when the league's settled ledger looks risky. */
  private leagueAdjGuard(fixture: BSDEvent, result: CurationResponse): number {
    return curationAccuracyService.leagueAdjustment(
      this.leagueName(fixture.league_id, fixture.id, fixture.league?.name || fixture.league_name),
      result.ledgerAccuracy
    );
  }

  private async fetchOdds(fixtureId: number): Promise<OddsMarket[]> {
    try {
      const res = await axios.get(`${this.baseUrl}/events/${fixtureId}/odds/comparison/`, {
        headers: this.headers,
        timeout: 10000,
      });
      const data = res.data;
      if (data?.league_name) this.oddsLeagueNames.set(fixtureId, String(data.league_name));
      return this.parseOddsMarkets(data);
    } catch {
      return [];
    }
  }

  private async analyzeFixtureEnhanced(
    fixture: BSDEvent,
    homeForm: TeamFormData | undefined,
    awayForm: TeamFormData | undefined,
    odds: OddsMarket[],
    financialHealth: { reserveRatio: number; totalReserves: number; totalExposure: number; activePodCount: number },
    context: CurationResponse,
    accuracy: CurationAccuracyStats | null = null
  ): Promise<CurationResult> {
    try {
      const h2h = fixture.head_to_head;
      const leagueName = this.leagueName(fixture.league_id, fixture.id, fixture.league?.name || fixture.league_name);

      // League ledger adjustment: proven leagues lower the bar, risky leagues raise it
      const leagueAdj = curationAccuracyService.leagueAdjustment(leagueName, accuracy);
      const effectiveThreshold = Math.min(90, Math.max(50, (context.confidenceThreshold || 65) + leagueAdj));

      // Build structured form strings
      const homeFormStr = homeForm
        ? `Last 5: ${homeForm.last5.join(', ')} | Goals: ${homeForm.goalsScored} scored, ${homeForm.goalsConceded} conceded | Home: ${homeForm.homeRecord.wins}W/${homeForm.homeRecord.draws}D/${homeForm.homeRecord.losses}L | Away: ${homeForm.awayRecord.wins}W/${homeForm.awayRecord.draws}D/${homeForm.awayRecord.losses}L`
        : 'No recent form data';

      const awayFormStr = awayForm
        ? `Last 5: ${awayForm.last5.join(', ')} | Goals: ${awayForm.goalsScored} scored, ${awayForm.goalsConceded} conceded | Home: ${awayForm.homeRecord.wins}W/${awayForm.homeRecord.draws}D/${awayForm.homeRecord.losses}L | Away: ${awayForm.awayRecord.wins}W/${awayForm.awayRecord.draws}D/${awayForm.awayRecord.losses}L`
        : 'No recent form data';

      // Build odds string
      const oddsStr = odds.map(m => {
        const outcomes = m.outcomes?.map(o =>
          `${o.name || o.code}: ${o.best_odds || o.max_odds || o.odds || '?'}x`
        ).join(', ') || '';
        return `[${m.code}] ${outcomes}`;
      }).join(' | ') || 'No odds data';

      // Build H2H string
      const h2hStr = h2h
        ? `Total: ${h2h.total_matches} | Home wins: ${h2h.home_wins} | Draws: ${h2h.draws} | Away wins: ${h2h.away_wins} | Goals avg: ${h2h.avg_total_goals.toFixed(2)}`
        : 'No H2H data';

      // Financial context
      const finStr = financialHealth.totalReserves > 0
        ? `Reserves: ₦${financialHealth.totalReserves.toLocaleString()} | Exposure: ₦${financialHealth.totalExposure.toLocaleString()} | Ratio: ${(financialHealth.reserveRatio * 100).toFixed(0)}% | Active pods: ${financialHealth.activePodCount}`
        : 'Financial data unavailable';

      // Build the enhanced prompt — Elite Multi-Sport Risk Analyst / High-Probability Engine
      const prompt = `Analyze this match for BetPool's ultra-safe pod curation. You are an Elite Multi-Sport Risk Analyst and High-Probability Prediction Engine. Consistent long-term winning streaks > high odds. Maximum probability, minimum risk.

MATCH: ${fixture.home_team} vs ${fixture.away_team}
SPORT: Football | LEAGUE: ${leagueName} | Round: ${fixture.round_number || 'N/A'}
DATE: ${fixture.event_date}

TEAM FORM:
  HOME (${fixture.home_team}): ${homeFormStr}
  AWAY (${fixture.away_team}): ${awayFormStr}

HEAD-TO-HEAD:
${h2hStr}

CURRENT MARKET ODDS:
${oddsStr}

FINANCIAL HEALTH:
${finStr}

ORA LEDGER PERFORMANCE (accuracy from settled outcomes — weight proven leagues/markets higher, be extra cautious in risky ones):
${curationAccuracyService.promptBlock(leagueName, accuracy)}

=== 1. MY CORE STRATEGY KEYS (BY SPORT) — YOU MUST SELECT STRICTLY FROM THESE ===
FOOTBALL:
* Double Chance: Home or Draw (1X), Away or Draw (X2).
* Draw No Bet (DNB): Home DNB or Away DNB.
* High-Probability Goal Lines: Over 1.5 Total Goals, or Under 3.5 / Under 4.5 Total Goals.
* Team Goal Lines: Home Team Over 0.5 Goals or Away Team Over 0.5 Goals.
* Asian Handicaps: Underdog +1.5 or Underdog +2.5.
* Safe Multi-Markets: Double Chance combined with Under 4.5 Goals (e.g., 1X & Under 4.5).
BASKETBALL (NBA / EUROLEAGUE):
* Alternative Point Spreads: Buying a massive safety cushion on a favorite (e.g., backing a favorite at +6.5 to +10.5 instead of a straight win).
* Alternative Game Totals (Under/Over): Setting a line 12 to 15 points safer than the bookmaker's standard line.
* Team Total Points: Backing a high-scoring team to cross an ultra-low, adjusted alternative points floor.
TENNIS (ATP / WTA):
* To Win a Set (Over 0.5 Sets): Backing a heavy favorite or highly consistent player to win at least one set in the match.
* Alternative Games Handicap: Giving a massive games advantage cushion to a reliable player (e.g., +4.5 or +5.5 games handicap).
* Alternative Match Games (Over): Setting an ultra-low alternative total games line (e.g., Over 16.5 or 17.5 total games).

=== 2. STRICT STATISTICAL FILTERS — MATCH MUST PASS BEFORE RECOMMEND ===
* For Football (1X / X2): The chosen team must have avoided defeat in at least 80% of their last 10 corresponding home/away matches.
* For Football (Over 1.5): Both competing teams must have seen Over 1.5 goals land in at least 85% of their respective matches this season.
* For Basketball (Alternative Spreads): The backed team must have covered your adjusted spread line in 90% of their last 10 games.
* For Tennis (To Win a Set / Handicaps): The chosen player must have successfully won at least one set in 90% of their last 15 matches on this specific court surface (Hard, Clay, or Grass).

=== 3. MANDATORY RED FLAGS (IMMEDIATE FILTER OUT — RETURN SKIP) ===
* Local Derbies / Fierce Rivalries: Form is irrelevant in these high-emotion games.
* Dead Rubber Matches: Late-season games where a team or player has already qualified or has nothing left to play for.
* Extreme Fatigue / Travel Strain: Basketball teams on a back-to-back (B2B) road trip, or a Tennis player who just won a tournament final in a different country/time zone less than 48 hours ago.
* Surface Disadvantage (Tennis): Avoid backing players who have a sub-50% career win rate on the specific tournament surface.
* Managerial Changes or Injury Crises: Football/Basketball teams with coaching changes within 14 days or missing core floor generals/goalkeepers. Any tennis player with reported medical timeouts or tape on major joints in their previous round.

=== 4. YOUR OUTPUT FORMAT ===
For every match that passes all filters, the reasoning must contain:
* Sport & Match: [Sport Name] - [Participant A] vs [Participant B] ([League/Tournament Name])
* Recommended Ultra-Safe Pick: [e.g., Home or Draw / Over 1.5 Goals / Player A to Win 1 Set / 1X & Under 4.5]
* Probability Confidence (%): [calculated percentage based on your data]
* Supporting Stat 1: [The selected team/player has hit this threshold in X% of recent matches]
* Supporting Stat 2: [Head-to-head records or specific structural metrics that guarantee high safety]
* Risk Warning: [Briefly note the only realistic scenario where this safe bet could fail]
Analyze the upcoming fixtures for the next 48 hours and give me the highest probability picks that fit this exact blueprint.

CRITICAL SURVIVAL RULES:
- You CARE ONLY about maximum probability and minimizing risk, NOT high odds. Winning probability beats odds size every time.
- NEVER recommend a multiplier below 1.20x (minimum floor).
- NEVER recommend with confidence below ${Math.min(70, effectiveThreshold)}% — otherwise SKIP.
- Prefer 10 excellent pods over 30 mediocre ones. Quality over quantity is the only path to survival.
- Never combine outcomes into parlays — set combinedRecommendation.enabled = false always. A safe single is safer than any parlay.
- If any RED FLAG is present or STRICT FILTER fails, return SKIP.

Return valid JSON matching this structure:
{
  "recommendations": [
    {
      "selection": "Home or Draw (1X)" | "Away or Draw (X2)" | "Home DNB" | "Away DNB" | "Over 1.5 Total Goals" | "Under 3.5 Total Goals" | "Under 4.5 Total Goals" | "Home Team Over 0.5 Goals" | "Away Team Over 0.5 Goals" | "Underdog +1.5" | "Underdog +2.5" | "1X & Under 4.5" | "X2 & Under 4.5" | "Alternative Spread +6.5" | "Alternative Total Under" | "Team Total Over" | "To Win a Set (Over 0.5 Sets)" | "+4.5 Games Handicap" | "Over 16.5 Total Games" | "Home or Draw" | "Away or Draw" | "Over 1.5" | "Under 3.5" | "Under 4.5",
      "confidence": number (0-100),
      "recommendedMultiplier": number (1.20-10.0),
      "reasoning": "Supporting Stat 1 + Supporting Stat 2 + Risk Warning",
      "supportingStat1": "The selected team/player has hit this threshold in X% of recent matches",
      "supportingStat2": "Head-to-head records or structural metrics that guarantee high safety",
      "riskWarning": "Briefly note the only realistic scenario where this safe bet could fail"
    }
  ],
  "verdict": "RECOMMEND" | "SKIP",
  "overallReasoning": "Sport & Match + Recommended Ultra-Safe Pick + Probability Confidence + red-flag check",
  "combinedRecommendation": {
    "enabled": boolean,
    "leg1Market": string,
    "leg1Selection": string,
    "leg1Multiplier": number,
    "leg2Market": string,
    "leg2Selection": string,
    "leg2Multiplier": number,
    "combinedMultiplier": number,
    "combinedConfidence": number,
    "reasoning": "Why combining these two outcomes"
  }
}

Rules:
- RECOMMEND only if at least one outcome has confidence >= ${effectiveThreshold} AND passes all Strict Statistical Filters AND no Red Flags.
- If no outcome reaches ${effectiveThreshold}% or any Red Flag present or filter fails, return SKIP
- The best recommendation is HIGHEST confidence (win probability) — never best odds
- combinedRecommendation.enabled must always be false
- SKIP if reserve ratio is below 0.20 (critical)
- Return ONLY the JSON object, no markdown or other text`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      let response;
      try {
        response = await fetch(DEEPSEEK_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.deepseekKey}`,
          },
          body: JSON.stringify({
            model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
            messages: [
              { role: 'system', content: 'You are now acting as an Elite Multi-Sport Risk Analyst and High-Probability Prediction Engine. My primary goal is consistent, long-term winning streaks. I do not care about high odd values. I care about maximum probability and minimizing risk. Your task is to analyze upcoming matches across Football, Basketball, and Tennis, and output ONLY selections that fit my ultra-safe, high-probability criteria. Select strictly from: Football Double Chance 1X/X2, DNB, Over 1.5/Under 3.5/4.5, Team Over 0.5, Asian Handicap +1.5/+2.5, 1X & Under 4.5; Basketball Alternative Spreads +6.5 to +10.5, Alternative Totals ±12-15pts, Team Total ultra-low floor; Tennis To Win a Set (Over 0.5 Sets), Alternative Games Handicap +4.5/+5.5, Alternative Over 16.5/17.5. Enforce Strict Statistical Filters (Football 1X/X2 80% avoid defeat last 10, Over 1.5 85% both teams, Basketball spread 90% last 10, Tennis set win 90% last 15 on surface) and Mandatory Red Flags (derbies, dead rubbers, fatigue/B2B, surface <50%, managerial/injury crises). Return ONLY valid JSON with no markdown.' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.2,
            max_tokens: 1200,
          }),
          signal: controller.signal,
        });
      } catch (e: any) {
        clearTimeout(timeoutId);
        throw new Error(`DeepSeek unreachable: ${e.message}`);
      }
      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`DeepSeek API ${response.status}: ${text}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response from DeepSeek');

      const parsed = JSON.parse(content.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim());

      // Parse recommendations
      const recommendations: CurationSelection[] = (parsed.recommendations || []).map((r: any) => ({
        selection: r.selection,
        confidence: Math.round(Math.min(100, Math.max(0, r.confidence))),
        recommendedMultiplier: Math.round(Math.min(10, Math.max(1.01, r.recommendedMultiplier)) * 100) / 100,
        reasoning: r.reasoning || '',
      }));

      const verdict = parsed.verdict === 'RECOMMEND' ? 'RECOMMEND' : 'SKIP';

      // Check if we should use a combined recommendation instead
      const combined = parsed.combinedRecommendation;
      let bestPick = recommendations.reduce(
        (best, r) => (r.confidence > (best?.confidence || 0) ? r : best),
        recommendations[0]
      );

      let isCombined = false;
      let combinedLegs: Array<{ marketType: string; selection: string; multiplier: number }> | undefined;

      if (combined?.enabled && combined.combinedConfidence >= effectiveThreshold) {
        isCombined = true;
        combinedLegs = [
          { marketType: combined.leg1Market, selection: combined.leg1Selection, multiplier: combined.leg1Multiplier },
          { marketType: combined.leg2Market, selection: combined.leg2Selection, multiplier: combined.leg2Multiplier },
        ];
        bestPick = {
          selection: `${combined.leg1Selection} + ${combined.leg2Selection}`,
          confidence: combined.combinedConfidence,
          recommendedMultiplier: combined.combinedMultiplier,
          reasoning: combined.reasoning,
        };
      }

      return {
        fixtureId: fixture.id,
        homeTeam: fixture.home_team,
        awayTeam: fixture.away_team,
        league: leagueName,
        matchDate: fixture.event_date,
        verdict: verdict === 'RECOMMEND' || isCombined ? 'RECOMMEND' : 'SKIP',
        overallReasoning: parsed.overallReasoning || '',
        recommendations,
        multiplier: bestPick?.recommendedMultiplier,
        selection: bestPick?.selection,
        isCombined,
        combinedLegs,
      };
    } catch (err: any) {
      context.errors.push(`AI analysis failed for ${fixture.home_team} vs ${fixture.away_team}: ${err.message}`);
      return {
        fixtureId: fixture.id,
        homeTeam: fixture.home_team,
        awayTeam: fixture.away_team,
        league: this.leagueName(fixture.league_id, fixture.id, fixture.league?.name || fixture.league_name),
        matchDate: fixture.event_date,
        verdict: 'SKIP',
        overallReasoning: `AI analysis failed: ${err.message}`,
        recommendations: [],
      };
    }
  }

  async basicFallbackCurate(): Promise<CurationResponse> {
    const result: CurationResponse = {
      success: true, total: 0, recommended: 0, skipped: 0,
      fixtures: [], errors: [], apiLog: [], skippedReason: null,
      oraWinRate: 50, oraTotalPods: 0, oraWon: 0, confidenceThreshold: 65,
      ledgerAccuracy: null,
    };

    if (!this.apiKey || this.apiKey === 'your_api_key_here') {
      result.errors.push('SPORTSAPI_KEY not configured');
      return result;
    }

    result.ledgerAccuracy = await curationAccuracyService.getStats();

    const today = new Date();
    const dateFrom = today.toISOString().split('T')[0];
    const dateTo = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];

    const fixtures: BSDEvent[] = await this.fetchUpcomingFixtures(dateFrom, dateTo);

    result.total = fixtures.length;
    if (fixtures.length === 0) {
      result.skippedReason = 'No upcoming fixtures found in configured leagues.';
      return result;
    }

    // Batch-fetch odds for all fixtures
    const oddsCache = new Map<number, OddsMarket[]>();
    await Promise.all(fixtures.map(async (f) => {
      try {
        const res = await axios.get(`${this.baseUrl}/events/${f.id}/odds/comparison/`, {
          headers: this.headers, timeout: 10000,
        });
        if (res.data?.league_name) this.oddsLeagueNames.set(f.id, String(res.data.league_name));
        const markets = this.parseOddsMarkets(res.data);
        if (markets.length) oddsCache.set(f.id, markets);
      } catch {
        // odds unavailable for this fixture
      }
    }));

    for (const fixture of fixtures) {
      const odds = oddsCache.get(fixture.id) || [];

      const OUTCOME_MAP: Record<string, string> = { HOME: 'Home Win', DRAW: 'Draw', AWAY: 'Away Win' };
      const DOUBLE_CHANCE_MAP: Record<string, string> = {
        '1X': 'Home or Draw', HOMEDRAW: 'Home or Draw', HOMEDRAWorDRAW: 'Home or Draw',
        'X2': 'Draw or Away', DRAW_AWAY: 'Draw or Away', DRAWorAWAY: 'Draw or Away',
        '12': 'Home or Away', HOME_AWAY: 'Home or Away', HOMEorAWAY: 'Home or Away',
      };
      const MARKET_PRIORITY: Record<string, number> = {
        double_chance: 0, over_under_15: 1, over_under_45: 1, over_under_35: 1, over_under_25: 1,
        '1x2': 2, btts: 3, draw_no_bet: 4,
      };
      const minOdds = this.minPickOdds;
      const verySure = this.verySureImplied;

      type Cand = { selection: string; code: string; rawOdds: number };
      const marketCandidates = (code: string, gate?: number): Cand[] => {
        const market = odds.find(m => (m.code || '').toLowerCase() === code);
        const out: Cand[] = [];
        for (const o of market?.outcomes || []) {
          const rawOdds = o.best_odds || o.max_odds || o.odds || 0;
          if (!rawOdds || rawOdds < minOdds) continue;
          const rawName = o.name || o.code || '';
          if (code === 'over_under_15' && !/over/i.test(rawName)) continue;
          if ((code === 'over_under_25' || code === 'over_under_35' || code === 'over_under_45') && /over/i.test(rawName)) continue;
          let selection = rawName;
          if (code === 'double_chance') {
            const key = String(o.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            selection = DOUBLE_CHANCE_MAP[key] || DOUBLE_CHANCE_MAP[rawName.toUpperCase().replace(/[^A-Z0-9]/g, '')] || rawName;
          } else if (code === '1x2' && OUTCOME_MAP[String(o.code || '').toUpperCase()]) {
            selection = OUTCOME_MAP[String(o.code || '').toUpperCase()];
          }
          if (gate && 1 / rawOdds < gate) continue;
          if (!selection) continue;
          out.push({ selection, code, rawOdds });
        }
        return out;
      };

      const all: Cand[] = [
        ...marketCandidates('double_chance'),
        ...marketCandidates('over_under_15'),
        ...marketCandidates('over_under_45'),
        ...marketCandidates('over_under_35'),
        ...marketCandidates('over_under_25'),
        ...marketCandidates('1x2', verySure),
        ...marketCandidates('btts', verySure),
        ...marketCandidates('draw_no_bet', verySure),
      ];

      if (all.length === 0) {
        result.skipped++;
        result.fixtures.push({
          fixtureId: fixture.id, homeTeam: fixture.home_team, awayTeam: fixture.away_team,
          league: this.leagueName(fixture.league_id, fixture.id, fixture.league?.name || fixture.league_name), matchDate: fixture.event_date,
          verdict: 'SKIP', overallReasoning: 'No outcome met the minimum odds floor',
          recommendations: [],
        });
        continue;
      }

      // Highest win probability wins; ties favour double chance and safe lines.
      const best = all.reduce((a, b) => {
        const aImplied = 1 / a.rawOdds;
        const bImplied = 1 / b.rawOdds;
        if (bImplied - aImplied > 0.005) return b;
        if (aImplied - bImplied > 0.005) return a;
        return MARKET_PRIORITY[b.code] < MARKET_PRIORITY[a.code] ? b : a;
      });
      const impliedPct = Math.round((1 / best.rawOdds) * 100);
      result.recommended++;
      result.fixtures.push({
        fixtureId: fixture.id, homeTeam: fixture.home_team, awayTeam: fixture.away_team,
        league: this.leagueName(fixture.league_id, fixture.id, fixture.league?.name || fixture.league_name), matchDate: fixture.event_date,
        verdict: 'RECOMMEND',
        overallReasoning: `Odds-based: ${best.selection} @ ${best.rawOdds.toFixed(2)}x (${impliedPct}% implied)`,
        recommendations: [{
          selection: best.selection,
          confidence: Math.min(impliedPct, 75),
          recommendedMultiplier: Math.round(best.rawOdds * 100) / 100,
          reasoning: `Odds-based fallback — highest win probability (${impliedPct}% implied)`,
        }],
        multiplier: best.rawOdds,
        selection: best.selection,
      });
    }

    return result;
  }
}

export const aiCurationService = new AICurationService();

