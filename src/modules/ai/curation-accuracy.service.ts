import { PickOutcomeModel } from '../../models/pick-outcome.model';
import { logger } from '../../services/logger.service';

const STATS_TTL_MS = 30 * 60 * 1000;

export interface LedgerStat {
  key: string;
  played: number;
  won: number;
  winRate: number;
}

export interface CurationAccuracyStats {
  played: number;
  won: number;
  winRate: number;
  byLeague: LedgerStat[];
  byMarket: LedgerStat[];
  sampledAt: string;
}

/**
 * Aggregates the settled-pick ledger (PickOutcome) into win-rate stats per
 * league and per market type, then derives deterministic curation adjustments.
 * The ledger only contains outcomes judged from real final scores
 * ('won' | 'lost'; 'skip' = void, excluded from accuracy).
 *
 * Cold start: with an empty ledger getStats() returns stats with played = 0,
 * and every adjustment stays 0 — curation behavior is unchanged.
 */
export class CurationAccuracyService {
  private cache: { stats: CurationAccuracyStats | null; expiresAt: number } | null = null;

  private get minSample(): number {
    const v = parseInt(process.env.CURATION_ACCURACY_MIN_SAMPLE || '5', 10);
    return Number.isFinite(v) && v > 0 ? v : 5;
  }

  invalidate(): void {
    this.cache = null;
  }

  async getStats(force = false): Promise<CurationAccuracyStats | null> {
    if (!force && this.cache && this.cache.expiresAt > Date.now()) return this.cache.stats;
    try {
      const [leagueRows, marketRows] = await Promise.all([
        PickOutcomeModel.aggregate([
          { $match: { outcome: { $in: ['won', 'lost'] } } },
          {
            $group: {
              _id: '$league',
              played: { $sum: 1 },
              won: { $sum: { $cond: [{ $eq: ['$outcome', 'won'] }, 1, 0] } },
            },
          },
        ]),
        PickOutcomeModel.aggregate([
          { $match: { outcome: { $in: ['won', 'lost'] } } },
          {
            $group: {
              _id: '$marketType',
              played: { $sum: 1 },
              won: { $sum: { $cond: [{ $eq: ['$outcome', 'won'] }, 1, 0] } },
            },
          },
        ]),
      ]);

      const toStat = (rows: any[]): LedgerStat[] => rows
        .filter(r => r._id)
        .map(r => ({
          key: String(r._id),
          played: r.played || 0,
          won: r.won || 0,
          winRate: r.played ? Math.round((r.won / r.played) * 100) : 0,
        }))
        .sort((a, b) => b.played - a.played);

      const byLeague = toStat(leagueRows);
      const byMarket = toStat(marketRows);
      const played = byLeague.reduce((s, r) => s + r.played, 0);
      const won = byLeague.reduce((s, r) => s + r.won, 0);

      const stats: CurationAccuracyStats = {
        played,
        won,
        winRate: played ? Math.round((won / played) * 100) : 0,
        byLeague,
        byMarket,
        sampledAt: new Date().toISOString(),
      };
      this.cache = { stats, expiresAt: Date.now() + STATS_TTL_MS };
      return stats;
    } catch (e: any) {
      logger.warn(`[CurationAccuracy] ledger aggregation failed: ${e.message}`);
      return null;
    }
  }

  private mapsOf(stats: CurationAccuracyStats | null): { leagueMap: Map<string, LedgerStat>; marketMap: Map<string, LedgerStat> } {
    return {
      leagueMap: new Map((stats?.byLeague || []).map(s => [s.key.toLowerCase(), s])),
      marketMap: new Map((stats?.byMarket || []).map(s => [s.key.toLowerCase(), s])),
    };
  }

  private adjustmentFor(stat: LedgerStat | undefined): number {
    if (!stat || stat.played < this.minSample) return 0;
    if (stat.winRate >= 65) return -5;
    if (stat.winRate >= 55) return -2;
    if (stat.winRate <= 40) return 10;
    if (stat.winRate <= 50) return 5;
    return 0;
  }

  /** Threshold delta for a league: negative = proven, positive = risky. */
  leagueAdjustment(league: string, stats?: CurationAccuracyStats): number {
    const { leagueMap } = this.mapsOf(stats ?? this.cache?.stats ?? null);
    return this.adjustmentFor(leagueMap.get((league || '').toLowerCase()));
  }

  /** Threshold delta for a market type (e.g. 'Over/Under 2.5'). */
  marketAdjustment(marketType: string, stats?: CurationAccuracyStats): number {
    const { marketMap } = this.mapsOf(stats ?? this.cache?.stats ?? null);
    return this.adjustmentFor(marketMap.get((marketType || '').toLowerCase()));
  }

  /** Compact ledger summary for the curation prompt. */
  promptBlock(league: string, stats?: CurationAccuracyStats): string {
    const effective = stats ?? this.cache?.stats ?? null;
    if (!effective) return 'No settled-outcome ledger data yet.';
    const { leagueMap, marketMap } = this.mapsOf(effective);
    const lines: string[] = [];
    lines.push(`Overall: ${effective.played} played, ${effective.won} won (${effective.winRate}%)`);
    const leagueStat = leagueMap.get((league || '').toLowerCase());
    if (leagueStat && leagueStat.played >= 1) {
      lines.push(`League (${league}): ${leagueStat.played} played, ${leagueStat.won} won (${leagueStat.winRate}%)`);
    } else {
      lines.push(`League (${league}): no settled data yet`);
    }
    const markets = [...marketMap.values()]
      .sort((a, b) => b.played - a.played)
      .slice(0, 4);
    if (markets.length) {
      lines.push(`Markets: ${markets.map(m => `${m.key} — ${m.played} played, ${m.winRate}% won`).join(' | ')}`);
    }
    return lines.join('\n');
  }
}

export const curationAccuracyService = new CurationAccuracyService();
