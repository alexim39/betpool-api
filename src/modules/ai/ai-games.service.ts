import axios from 'axios';
import mongoose from 'mongoose';
import { PodModel } from '../../models/pod.model';
import { GameAnalysisModel, IGameAnalysis } from '../../models/game-analysis.model';
import { LEAGUE_NAMES } from './ai-curation.service';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const MAX_ANALYZE_PER_RUN = 80;
const FRESH_MS = 6 * 60 * 60 * 1000;

interface BSDEvent {
  id: number;
  league_id: number;
  league?: { name: string };
  league_name?: string;
  home_team_id: number;
  home_team: string;
  away_team_id: number;
  away_team: string;
  event_date: string;
  status: string;
  round_number?: number;
  head_to_head?: {
    total_matches: number;
    home_wins: number;
    draws: number;
    away_wins: number;
    home_goals: number;
    away_goals: number;
    avg_total_goals: number;
  };
}

interface TeamFormData {
  teamName: string;
  last5: string[];
  goalsScored: number;
  goalsConceded: number;
  homeRecord: { played: number; wins: number; draws: number; losses: number };
  awayRecord: { played: number; wins: number; draws: number; losses: number };
}

interface OddsMarket {
  code: string;
  outcomes: Array<{ code: string; name?: string; best_odds?: number; max_odds?: number; odds?: number }>;
}

export interface GamesAnalysisResult {
  success: boolean;
  fixturesFound: number;
  analyzed: number;
  skippedFresh: number;
  errors: string[];
  apiLog: string[];
}

export interface TodayGame {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: Date;
  pick: string;
  marketType: string;
  gainsMultiplier: number;
  confidence: number;
  reasoning: string;
  availableOdds: number;
  podId: string | null;
  stakable: boolean;
}

export class AIGamesService {
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

  private leagueName(leagueId: number | undefined | null, raw?: string): string {
    if (raw && !/^\d+$/.test(raw)) return raw;
    if (leagueId != null) return LEAGUE_NAMES[leagueId] || (raw || `League ${leagueId}`);
    return raw || '';
  }

  private async fetchFixtures(dateFrom: string, dateTo: string): Promise<BSDEvent[]> {
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
      } catch {
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

  private async fetchTeamForm(teamId: number): Promise<TeamFormData | null> {
    try {
      const res = await axios.get(`${this.baseUrl}/events/`, {
        headers: this.headers,
        params: { status: 'finished', team_id: teamId, limit: 5 },
        timeout: 15000,
      });
      const matches: any[] = res.data?.results || [];
      if (matches.length === 0) return null;

      const teamName = matches[0]?.home_team_id === teamId ? matches[0]?.home_team : matches[0]?.away_team || '';
      const last5: string[] = [];
      let goalsScored = 0, goalsConceded = 0;
      const homeRecord = { played: 0, wins: 0, draws: 0, losses: 0 };
      const awayRecord = { played: 0, wins: 0, draws: 0, losses: 0 };

      for (const m of matches) {
        const isHome = m.home_team_id === teamId;
        const hs = m.home_score ?? 0;
        const as = m.away_score ?? 0;
        goalsScored += isHome ? hs : as;
        goalsConceded += isHome ? as : hs;
        const won = isHome ? hs > as : as > hs;
        const drew = hs === as;
        last5.push(won ? 'W' : drew ? 'D' : 'L');
        if (isHome) {
          homeRecord.played++;
          if (won) homeRecord.wins++; else if (drew) homeRecord.draws++; else homeRecord.losses++;
        } else {
          awayRecord.played++;
          if (won) awayRecord.wins++; else if (drew) awayRecord.draws++; else awayRecord.losses++;
        }
      }

      return { teamName, last5, goalsScored, goalsConceded, homeRecord, awayRecord };
    } catch {
      return null;
    }
  }

  private oddsLeagueNames = new Map<number, string>();

  private async fetchOdds(fixtureId: number): Promise<OddsMarket[]> {
    try {
      const res = await axios.get(`${this.baseUrl}/events/${fixtureId}/odds/comparison/`, {
        headers: this.headers,
        timeout: 10000,
      });
      const data = res.data;
      if (data?.league_name) this.oddsLeagueNames.set(fixtureId, String(data.league_name));
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
    } catch {
      return [];
    }
  }

  private async deepseekPick(
    fixture: BSDEvent,
    homeForm: TeamFormData | undefined,
    awayForm: TeamFormData | undefined,
    odds: OddsMarket[]
  ): Promise<{ pick: string; marketType: string; multiplier: number; confidence: number; reasoning: string } | null> {
    try {
      const h2h = fixture.head_to_head;
      const homeFormStr = homeForm
        ? `Last 5: ${homeForm.last5.join(', ')} | Goals: ${homeForm.goalsScored} scored, ${homeForm.goalsConceded} conceded | Home: ${homeForm.homeRecord.wins}W/${homeForm.homeRecord.draws}D/${homeForm.homeRecord.losses}L | Away: ${homeForm.awayRecord.wins}W/${homeForm.awayRecord.draws}D/${homeForm.awayRecord.losses}L`
        : 'No recent form data';
      const awayFormStr = awayForm
        ? `Last 5: ${awayForm.last5.join(', ')} | Goals: ${awayForm.goalsScored} scored, ${awayForm.goalsConceded} conceded | Home: ${awayForm.homeRecord.wins}W/${awayForm.homeRecord.draws}D/${awayForm.homeRecord.losses}L | Away: ${awayForm.awayRecord.wins}W/${awayForm.awayRecord.draws}D/${awayForm.awayRecord.losses}L`
        : 'No recent form data';
      const oddsStr = odds.map(m => {
        const outcomes = m.outcomes?.map(o =>
          `${o.name || o.code}: ${o.best_odds || o.max_odds || o.odds || '?'}x`
        ).join(', ') || '';
        return `[${m.code}] ${outcomes}`;
      }).join(' | ') || 'No odds data';
      const h2hStr = h2h
        ? `Total: ${h2h.total_matches} | Home wins: ${h2h.home_wins} | Draws: ${h2h.draws} | Away wins: ${h2h.away_wins} | Goals avg: ${h2h.avg_total_goals.toFixed(2)}`
        : 'No H2H data';

      const prompt = `You are Ora, BetPool's daily games analyst. Pick the SINGLE best bet for each match.

MATCH: ${fixture.home_team} vs ${fixture.away_team}
LEAGUE: ${this.leagueName(fixture.league_id)} | Round: ${fixture.round_number || 'N/A'}
DATE: ${fixture.event_date}

TEAM FORM:
  HOME (${fixture.home_team}): ${homeFormStr}
  AWAY (${fixture.away_team}): ${awayFormStr}

HEAD-TO-HEAD:
${h2hStr}

CURRENT MARKET ODDS:
${oddsStr}

Rules:
- Pick ONE outcome from the available markets (1X2, Over/Under X.5, BTTS, Double Chance, Draw No Bet).
- Prefer outcomes with implied probability >= 55% and odds >= 1.2x. Never pick odds below 1.10x.
- If the match looks too close to call, prefer the most likely 1X2 outcome or an over/under based on scoring form.
- You must pick SOMETHING — always return one best pick with honest confidence.

Return ONLY valid JSON with no markdown:
{
  "selection": "e.g. Home Win | Draw | Away Win | Over 2.5 | Under 2.5 | BTTS Yes | BTTS No",
  "marketType": "e.g. 1X2 | Over/Under 2.5 | BTTS | Double Chance | Draw No Bet",
  "multiplier": number (1.10-10.0, must be an odds value present in the market odds or a fair estimate),
  "confidence": number (0-100),
  "reasoning": "One sentence justification"
}`;

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
              { role: 'system', content: 'You are Ora, BetPool\'s daily games analyst. Return ONLY valid JSON with no markdown.' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.2,
            max_tokens: 400,
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
      const selection = String(parsed.selection || '').trim();
      if (!selection) return null;

      return {
        pick: selection,
        marketType: String(parsed.marketType || '1X2'),
        multiplier: Math.round(Math.min(10, Math.max(1.01, Number(parsed.multiplier) || 0)) * 100) / 100,
        confidence: Math.round(Math.min(100, Math.max(0, Number(parsed.confidence) || 0))),
        reasoning: String(parsed.reasoning || '').trim(),
      };
    } catch (err: any) {
      return null;
    }
  }

  private normalize(sel: string): string {
    return sel.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private oddsBasedPick(fixture: BSDEvent, odds: OddsMarket[]): { pick: string; marketType: string; multiplier: number; confidence: number; reasoning: string } | null {
    const OUTCOME_MAP: Record<string, string> = { HOME: 'Home Win', DRAW: 'Draw', AWAY: 'Away Win' };
    const MARKET_NAME: Record<string, string> = {
      '1x2': '1X2', double_chance: 'Double Chance', draw_no_bet: 'Draw No Bet',
      over_under_15: 'Over/Under 1.5', over_under_25: 'Over/Under 2.5', over_under_35: 'Over/Under 3.5',
      btts: 'BTTS',
    };
    const WHITELIST = new Set(Object.keys(MARKET_NAME));

    const marketMap = new Map<string, OddsMarket[]>();
    for (const market of odds) {
      const code = String(market.code || '').toLowerCase();
      if (!WHITELIST.has(code)) continue;
      if (!marketMap.has(code)) marketMap.set(code, []);
      marketMap.get(code)!.push(market);
    }

    type Cand = { selection: string; marketType: string; odds: number; implied: number };
    const candidates = (code: string): Cand[] => {
      const out: Cand[] = [];
      for (const market of marketMap.get(code) || []) {
        for (const o of market.outcomes || []) {
          const oddsVal = o.best_odds || o.max_odds || o.odds || 0;
          if (!oddsVal || oddsVal < 1.2) continue;
          const rawName = (code === '1x2' && OUTCOME_MAP[o.code || ''])
            ? OUTCOME_MAP[o.code || ''] : (o.name || o.code || '');
          if (!rawName) continue;
          out.push({ selection: rawName, marketType: MARKET_NAME[code], odds: oddsVal, implied: 1 / oddsVal });
        }
      }
      return out;
    };
    const bestOf = (list: Cand[], minImplied: number): Cand | null => {
      const pass = list.filter(c => c.implied >= minImplied);
      if (!pass.length) return null;
      return pass.reduce((a, b) => (b.implied > a.implied ? b : a));
    };

    let best: Cand | null = bestOf(candidates('1x2'), 0.55)
      ?? bestOf(candidates('over_under_25'), 0.55)
      ?? bestOf(candidates('over_under_15'), 0.55)
      ?? bestOf(candidates('over_under_35'), 0.55)
      ?? bestOf(candidates('btts'), 0.55)
      ?? bestOf(candidates('double_chance'), 0.70)
      ?? bestOf(candidates('draw_no_bet'), 0.70)
      ?? bestOf(candidates('1x2'), 0);

    if (!best) return null;
    const impliedPct = Math.round(best.implied * 100);
    return {
      pick: best.selection,
      marketType: best.marketType,
      multiplier: Math.round(best.odds * 100) / 100,
      confidence: Math.min(impliedPct, 90),
      reasoning: `Odds-based pick — ${best.selection} has the highest implied probability (${impliedPct}%) of the available markets.`,
    };
  }

  private async linkPod(game: any): Promise<mongoose.Types.ObjectId | null> {
    try {
      const normalizedPick = this.normalize(game.pick);
      const homeNorm = this.normalize(game.homeTeam || '');
      const awayNorm = this.normalize(game.awayTeam || '');
      const pod = await PodModel.findOne({
        'metadata.source': 'bsd',
        'metadata.fixtureId': game.fixtureId,
        status: 'active',
        opensAt: { $lte: new Date() },
        stakingClosesAt: { $gte: new Date() },
        bookedExternally: false,
      }).sort({ gainsMultiplier: -1 });
      if (!pod) return null;
      const podSelNorm = this.normalize(pod.selection || '');
      const matches = podSelNorm === normalizedPick
        || (normalizedPick === 'homewin' && podSelNorm === homeNorm)
        || (normalizedPick === 'awaywin' && podSelNorm === awayNorm);
      if (!matches) return null;
      return pod._id;
    } catch {
      return null;
    }
  }

  async analyzeToday(): Promise<GamesAnalysisResult> {
    const result: GamesAnalysisResult = { success: true, fixturesFound: 0, analyzed: 0, skippedFresh: 0, errors: [], apiLog: [] };

    if (!this.apiKey || this.apiKey === 'your_api_key_here') {
      result.success = false;
      result.errors.push('SPORTSAPI_KEY not configured.');
      return result;
    }
    if (!this.deepseekKey || this.deepseekKey === 'your_deepseek_api_key_here') {
      result.success = false;
      result.errors.push('DEEPSEEK_API_KEY not configured.');
      return result;
    }

    const now = new Date();
    const dateFrom = now.toISOString().split('T')[0];
    const dateTo = new Date(now.getTime() + 2 * 86400000).toISOString().split('T')[0];

    const fixtures = await this.fetchFixtures(dateFrom, dateTo);
    result.fixturesFound = fixtures.length;
    result.apiLog.push(`games fixtures: ${fixtures.length} (${dateFrom}..${dateTo})`);
    if (fixtures.length === 0) return result;

    // Skip fixtures analyzed within the freshness window
    const existing = await GameAnalysisModel.find({
      fixtureId: { $in: fixtures.map(f => f.id) },
      analyzedAt: { $gte: new Date(now.getTime() - FRESH_MS) },
    }).select('fixtureId analyzedAt').lean();
    const freshIds = new Set(existing.map(e => e.fixtureId));
    const toAnalyze = fixtures.filter(f => !freshIds.has(f.id)).slice(0, MAX_ANALYZE_PER_RUN);
    result.skippedFresh = fixtures.length - toAnalyze.length;
    result.apiLog.push(`fresh-skipped: ${result.skippedFresh}, to analyze: ${toAnalyze.length} (${toAnalyze.map(f => f.id).join(',')})`);

    // Batch fetch form + odds
    const formCache = new Map<number, TeamFormData>();
    await Promise.all(toAnalyze.flatMap(f => [f.home_team_id, f.away_team_id].map(id =>
      this.fetchTeamForm(id).then(fd => { if (fd) formCache.set(id, fd); })
    )));
    const oddsCache = new Map<number, OddsMarket[]>();
    await Promise.all(toAnalyze.map(async f => {
      const odds = await this.fetchOdds(f.id);
      if (odds.length) oddsCache.set(f.id, odds);
    }));

    const BATCH_SIZE = 5;
    for (let i = 0; i < toAnalyze.length; i += BATCH_SIZE) {
      const batch = toAnalyze.slice(i, i + BATCH_SIZE);
      const analyses = await Promise.all(batch.map(fixture =>
        this.deepseekPick(fixture, formCache.get(fixture.home_team_id), formCache.get(fixture.away_team_id), oddsCache.get(fixture.id) || [])
      ));
      for (let b = 0; b < batch.length; b++) {
        const fixture = batch[b];
        let analysis = analyses[b];
        if (!analysis) {
          // Fallback: pick from odds when DeepSeek is unreachable
          analysis = this.oddsBasedPick(fixture, oddsCache.get(fixture.id) || []);
        }
        if (!analysis) {
          result.errors.push(`No odds data for fixture ${fixture.id}`);
          continue;
        }
        const league = this.leagueName(fixture.league_id, fixture.league?.name || fixture.league_name || this.oddsLeagueNames.get(fixture.id));
        const podId = await this.linkPod({ fixtureId: fixture.id, pick: analysis.pick, homeTeam: fixture.home_team, awayTeam: fixture.away_team });
        await GameAnalysisModel.updateOne(
          { fixtureId: fixture.id },
          {
            $set: {
              homeTeam: fixture.home_team,
              awayTeam: fixture.away_team,
              league,
              matchDate: new Date(fixture.event_date),
              pick: analysis.pick,
              marketType: analysis.marketType,
              gainsMultiplier: analysis.multiplier,
              confidence: analysis.confidence,
              reasoning: analysis.reasoning,
              availableOdds: analysis.multiplier,
              podId: podId || null,
              analyzedAt: new Date(),
            },
          },
          { upsert: true }
        );
        result.analyzed++;
      }
    }

    return result;
  }

  async getToday(days = 1): Promise<{ items: TodayGame[]; count: number }> {
    const now = new Date();
    const end = new Date(now.getTime() + Math.min(Math.max(parseInt(String(days), 10) || 1, 1), 7) * 86400000);

    const docs = await GameAnalysisModel.find({
      matchDate: { $gte: now, $lt: end },
    })
      .sort({ matchDate: 1, confidence: -1 })
      .limit(100)
      .lean();

    const items: TodayGame[] = docs.map((d: any) => ({
      fixtureId: d.fixtureId,
      homeTeam: d.homeTeam,
      awayTeam: d.awayTeam,
      league: d.league || '',
      matchDate: d.matchDate,
      pick: d.pick || '',
      marketType: d.marketType || '',
      gainsMultiplier: d.gainsMultiplier || 0,
      confidence: d.confidence || 0,
      reasoning: d.reasoning || '',
      availableOdds: d.availableOdds || 0,
      podId: d.podId ? d.podId.toString() : null,
      stakable: !!d.podId,
    }));

    return { items, count: items.length };
  }
}

export const aiGamesService = new AIGamesService();
