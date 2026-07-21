import axios from 'axios';
import mongoose from 'mongoose';
import { StakeModel } from '../models/stake.model';
import { WalletModel } from '../models/wallet.model';
import { PodModel } from '../models/pod.model';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

interface BSDEvent {
  id: number;
  league_id: number;
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

  private get headers(): Record<string, string> {
    return { 'Authorization': `Token ${this.apiKey}` };
  }

  async curate(): Promise<CurationResponse> {
    const result: CurationResponse = {
      success: true, total: 0, recommended: 0, skipped: 0,
      fixtures: [], errors: [], apiLog: [], skippedReason: null,
      oraWinRate: 50, oraTotalPods: 0, oraWon: 0, confidenceThreshold: 65,
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

    // 2. Fetch financial health
    const financialHealth = await this.getFinancialHealth();

    // 3. Fetch upcoming fixtures
    const today = new Date();
    const dateFrom = today.toISOString().split('T')[0];
    const dateTo = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];
    const fixtures: BSDEvent[] = [];

    for (const leagueId of this.leagues) {
      try {
        const res = await axios.get(`${this.baseUrl}/events/`, {
          headers: this.headers,
          params: { status: 'notstarted', date_from: dateFrom, date_to: dateTo, league: leagueId },
          timeout: 20000,
        });
        const events: BSDEvent[] = res.data?.results || [];
        result.apiLog.push(`league=${leagueId}: ${events.length} fixtures`);
        for (const ev of events) {
          if (!ev.id || !ev.home_team || !ev.away_team || !ev.event_date) continue;
          if (['finished', 'postponed', 'cancelled'].includes(ev.status)) continue;
          fixtures.push(ev);
        }
      } catch (err: any) {
        result.apiLog.push(`league=${leagueId}: ERROR — ${err.message}`);
        result.errors.push(`league ${leagueId}: ${err.message}`);
      }
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
          result
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

    // 7. Enforce max 15 pods — keep highest confidence
    if (result.recommended > 15) {
      result.fixtures.sort((a, b) => {
        const aConf = a.recommendations?.[0]?.confidence || 0;
        const bConf = b.recommendations?.[0]?.confidence || 0;
        return bConf - aConf;
      });
      let demoted = 0;
      for (const f of result.fixtures) {
        if (f.verdict === 'RECOMMEND' && result.recommended - demoted > 15) {
          f.verdict = 'SKIP';
          f.overallReasoning = 'Demoted: exceeded 15-pod quality cap. Higher-confidence picks prioritized.';
          demoted++;
        }
      }
      result.recommended = 15;
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

  private async fetchOdds(fixtureId: number): Promise<OddsMarket[]> {
    try {
      const res = await axios.get(`${this.baseUrl}/events/${fixtureId}/odds/comparison/`, {
        headers: this.headers,
        timeout: 10000,
      });
      const data = res.data;
      if (data?.markets) return data.markets as OddsMarket[];
      if (data?.comparison) return data.comparison as OddsMarket[];
      return [];
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
    context: CurationResponse
  ): Promise<CurationResult> {
    try {
      const h2h = fixture.head_to_head;

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

      // Build the enhanced prompt
      const prompt = `Analyze this football match for BetPool's pod curation:

MATCH: ${fixture.home_team} vs ${fixture.away_team}
LEAGUE: ${fixture.league_id ? `League ID ${fixture.league_id}` : 'Unknown'} | Round: ${fixture.round_number || 'N/A'}
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

CRITICAL RULES:
- BetPool's profit model: we earn commission ONLY when pods WIN. Every losing pod earns zero revenue.
- We need HIGH WINNING CONSISTENCY above all else. This is a survival requirement.
- We should create FEW high-confidence pods (15-30 total) rather than many low-confidence ones.
- If the best single outcome has a multiplier below 1.5x, consider combining 2 high-confidence outcomes from this SAME fixture as a parlay to get reasonable odds (1.8x - 5.0x target).
- Never combine outcomes from different fixtures. Both legs must be from this same match.

Return valid JSON matching this structure:
{
  "recommendations": [
    {
      "selection": "Home Win" | "Draw" | "Away Win" | "Over X.5" | "Under X.5" | "BTTS Yes" | "BTTS No",
      "confidence": number (0-100),
      "recommendedMultiplier": number (1.0-10.0),
      "reasoning": "Brief justification"
    }
  ],
  "verdict": "RECOMMEND" | "SKIP",
  "overallReasoning": "Brief explanation",
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
- RECOMMEND only if at least one outcome has confidence >= ${context.confidenceThreshold}
- If no outcome reaches ${context.confidenceThreshold}%, return SKIP
- If the best outcome's multiplier is < 1.5x, set combinedRecommendation.enabled = true suggesting a parlay
- The combined confidence should be both outcomes' average confidence * 0.9 (penalty for two events)
- The combined multiplier = leg1Multiplier * leg2Multiplier
- SKIP if reserve ratio is below 0.20 (critical)
- Return ONLY the JSON object, no markdown or other text`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      let response;
      try {
        response = await fetch(DEEPSEEK_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.deepseekKey}`,
          },
          body: JSON.stringify({
            model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
            messages: [
              { role: 'system', content: 'You are Ora, BetPool\'s senior odds analyst. Our survival depends on winning consistency. You are cautious and analytical. You prioritize high-confidence picks over high-odds gambles. You combine markets from the same fixture only when the single outcome odds are too low. Return ONLY valid JSON with no markdown.' },
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

      const leagueName = fixture.league_id?.toString() || '';

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

      if (combined?.enabled && combined.combinedConfidence >= context.confidenceThreshold) {
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
      return {
        fixtureId: fixture.id,
        homeTeam: fixture.home_team,
        awayTeam: fixture.away_team,
        league: fixture.league_id?.toString() || '',
        matchDate: fixture.event_date,
        verdict: 'SKIP',
        overallReasoning: `AI analysis failed: ${err.message}`,
        recommendations: [],
      };
    }
  }
}

export const aiCurationService = new AICurationService();
