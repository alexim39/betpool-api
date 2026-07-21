import axios from 'axios';
import { PodModel } from '../models/pod.model';
import mongoose from 'mongoose';

const MARKET_DEFAULT_MULTIPLIERS = [
  { selection: 'Home Win', marketType: '1X2', defaultMultiplier: 2.0 },
  { selection: 'Draw', marketType: '1X2', defaultMultiplier: 3.5 },
  { selection: 'Away Win', marketType: '1X2', defaultMultiplier: 2.0 },
];

const MARKET_CODE_MAP: Record<string, string> = {
  '1x2': '1X2',
  'over_under_15': 'Over/Under 1.5',
  'over_under_25': 'Over/Under 2.5',
  'over_under_35': 'Over/Under 3.5',
  'btts': 'BTTS',
  'double_chance': 'Double Chance',
  'draw_no_bet': 'Draw No Bet',
};

const OUTCOME_MAP: Record<string, string> = {
  HOME: 'Home Win',
  DRAW: 'Draw',
  AWAY: 'Away Win',
};

interface SyncSuccess {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  pods: number;
}

export interface SyncResult {
  success: boolean;
  created: number;
  skipped: number;
  details: string[];
  errors: string[];
  apiLog: string[];
  successes: SyncSuccess[];
}

export class PodSyncService {
  private get apiKey(): string { return process.env.SPORTSAPI_KEY || ''; }
  private get baseUrl(): string {
    return (process.env.SPORTSAPI_BASE_URL || 'https://sports.bzzoiro.com/api/v2').replace(/\/+$/, '');
  }

  private get leagues(): string[] {
    return (process.env.SPORTSAPI_LEAGUES || '1,3,4,5,6,7,8,2').split(',').map(s => s.trim());
  }

  private get daysAhead(): number {
    return parseInt(process.env.SPORTSAPI_SYNC_DAYS || '7', 10);
  }

  private get defaultMinStake(): number { return parseInt(process.env.POD_DEFAULT_MIN_STAKE || '100', 10); }
  private get defaultMaxStake(): number { return parseInt(process.env.POD_DEFAULT_MAX_STAKE || '100000', 10); }
  private get defaultMaxExposure(): number { return parseInt(process.env.POD_DEFAULT_EXPOSURE || '1000000', 10); }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { 'Authorization': `Token ${this.apiKey}` };
    return h;
  }

  private async fetchAllEvents(dateFrom: string, dateTo: string): Promise<any[]> {
    const all: any[] = [];
    let url: string | null = `${this.baseUrl}/events/`;
    const params: Record<string, string> = {
      status: 'notstarted',
      date_from: dateFrom,
      date_to: dateTo,
    };

    while (url) {
      const res = await axios.get(url, { headers: this.headers, params, timeout: 20000 });
      const events = res.data?.results || [];
      all.push(...events);
      url = res.data?.next || null;
      // Clear params after first call so URL query string handles pagination
      if (url) params.status = 'notstarted';
    }
    return all;
  }

  async sync(adminUserId: string, _options?: { daysAhead?: number }): Promise<SyncResult> {
    const result: SyncResult = { success: true, created: 0, skipped: 0, details: [], errors: [], apiLog: [], successes: [] };

    if (!this.apiKey || this.apiKey === 'your_api_key_here') {
      result.success = false;
      result.errors.push('SPORTSAPI_KEY not configured. Sign up at https://sports.bzzoiro.com/register/ for a free key.');
      return result;
    }

    const days = _options?.daysAhead || this.daysAhead;
    const today = new Date();
    const dateFrom = today.toISOString().split('T')[0];
    const dateTo = new Date(today.getTime() + days * 86400000).toISOString().split('T')[0];

    const adminObjectId = new mongoose.Types.ObjectId(adminUserId);

    try {
      const events = await this.fetchAllEvents(dateFrom, dateTo);
      result.details.push(`BSD sync: ${events.length} unique fixtures, ${dateFrom}..${dateTo}`);
      result.apiLog.push(`fetched ${events.length} events total`);

      let fixturesWithOdds = 0;
      let fixturesProcessed = 0;

      for (const ev of events) {
        const eventId = ev.id;
        const homeName = ev.home_team?.name || ev.home_team;
        const awayName = ev.away_team?.name || ev.away_team;
        const eventDate = ev.event_date || ev.date;
        const leagueName = ev.league?.name || ev.league_name || 'Football';
        const status = ev.status || '';

        if (!eventId || !homeName || !awayName || !eventDate) continue;
        if (['finished', 'postponed', 'cancelled'].includes(status)) continue;

        fixturesProcessed++;

        let selections: Array<{ selection: string; marketType: string; multiplier: number }> = [];
        try {
          const oddsRes = await axios.get(`${this.baseUrl}/events/${eventId}/odds/comparison/`, {
            headers: this.headers,
            timeout: 10000,
          });
          const oddsData = oddsRes.data;

          if (oddsData?.markets && typeof oddsData.markets === 'object') {
            const relevantMarkets = new Set(['1x2', 'double_chance', 'btts', 'draw_no_bet']);
            for (const [marketCode, marketData] of Object.entries(oddsData.markets)) {
              if (!marketData || typeof marketData !== 'object') continue;
              if (!relevantMarkets.has(marketCode) && !marketCode.startsWith('over_under_')) continue;
              const marketType = MARKET_CODE_MAP[marketCode] || marketCode || '1X2';
              for (const [outcomeKey, outcome] of Object.entries(marketData)) {
                if (!outcome || typeof outcome !== 'object') continue;
                const selName = marketCode === '1x2' && OUTCOME_MAP[outcome.outcome]
                  ? OUTCOME_MAP[outcome.outcome] : outcome.outcome_name || outcome.outcome || outcomeKey || '';
                const selection = selName;
                const multiplier = outcome.best_odds;
                if (selection && multiplier && multiplier >= 1.01) {
                  selections.push({ selection, marketType, multiplier });
                }
              }
            }
          } else if (oddsData?.comparison) {
            for (const market of oddsData.comparison) {
              const marketType = MARKET_CODE_MAP[market.code] || market.code || '1X2';
              for (const outcome of market.outcomes || market.prices || []) {
                const selection = outcome.outcome_name || outcome.code || outcome.name || '';
                const multiplier = outcome.best_odds || outcome.odds;
                if (selection && multiplier && multiplier >= 1.01) {
                  selections.push({ selection, marketType, multiplier });
                }
              }
            }
          }

          if (selections.length > 0) fixturesWithOdds++;
          result.apiLog.push(`odds event=${eventId}: ${selections.length} selections`);
        } catch {
          // odds unavailable — skip this fixture entirely rather than use defaults
        }

        // Skip fixture if no odds data available (no fallback to defaults)
        if (selections.length === 0) continue;

        let podsCreated = 0;

        for (const sel of selections) {
          const existing = await PodModel.findOne({
            'metadata.source': 'bsd',
            'metadata.fixtureId': eventId,
            selection: sel.selection,
          });

          if (existing) { result.skipped++; continue; }

          const matchDateObj = new Date(eventDate);
          const opensAt = new Date(matchDateObj.getTime() - 2 * 60 * 60 * 1000);
          const stakingClosesAt = new Date(matchDateObj.getTime() - 24 * 60 * 60 * 1000);

          const spreadFactor = 0.85;
          const adjustedMult = Math.round(sel.multiplier * spreadFactor * 100) / 100;
          // Skip selections where adjusted odds would be too low or invalid
          if (adjustedMult < 1.01) {
            result.details.push(`Skipped ${sel.selection} (${sel.marketType}): adj. odds ${adjustedMult}x too low`);
            continue;
          }
          const rawRefundPct = adjustedMult >= 1.9 ? 5 : adjustedMult >= 1.7 ? 20 : adjustedMult >= 1.5 ? 35 : 0;
          const maxSafeRefund = Math.max(0, Math.floor((1 - 1 / adjustedMult) * 100));
          const refundPct = Math.min(rawRefundPct, maxSafeRefund);

          await PodModel.create({
            title: `${homeName} vs ${awayName}`,
            sport: 'Football',
            league: leagueName,
            homeTeam: homeName,
            awayTeam: awayName,
            matchDate: matchDateObj,
            marketType: sel.marketType,
            selection: sel.selection,
            gainsMultiplier: adjustedMult,
            marketOdds: sel.multiplier,
            impliedProbability: 1 / adjustedMult,
            refundPercent: refundPct,
            minStake: this.defaultMinStake,
            maxStake: this.defaultMaxStake,
            maxPayout: Math.floor(this.defaultMaxStake * sel.multiplier),
            maxTotalExposure: this.defaultMaxExposure,
            currentExposure: 0,
            opensAt: opensAt > new Date() ? opensAt : new Date(),
            stakingClosesAt,
            settlementEstimateLabel: '1 day after match',
            status: 'draft',
            isLive: false,
            metadata: { source: 'bsd', fixtureId: eventId },
            createdBy: adminObjectId,
          });

          podsCreated++;
        }

        if (podsCreated > 0) {
          result.created += podsCreated;
          result.successes.push({ fixtureId: eventId, homeTeam: homeName, awayTeam: awayName, pods: podsCreated });
        }
      }

      result.details.push(`${fixturesProcessed} fixtures checked, ${fixturesWithOdds} had odds data`);
      if (result.created > 0) {
        result.details.push(`Created ${result.created} pods with live odds`);
      }
      if (result.created === 0 && result.errors.length === 0) {
        result.details.push('No new fixtures with odds data found. Try increasing SPORTSAPI_SYNC_DAYS.');
      }
    } catch (err: any) {
      const status = err.response?.status;
      const data = err.response?.data;
      result.apiLog.push(`FATAL: ${err.message}`);
      result.errors.push(
        status === 401 ? 'Auth failed — check SPORTSAPI_KEY. Sign up at https://sports.bzzoiro.com/register/' :
        `sync error: ${err.message}${data ? ' ' + JSON.stringify(data).slice(0, 150) : ''}`
      );
    }

    return result;
  }
}

export const podSyncService = new PodSyncService();
