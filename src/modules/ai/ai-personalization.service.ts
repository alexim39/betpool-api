import { StakeModel } from '../../models/stake.model';
import { PickOutcomeModel } from '../../models/pick-outcome.model';
import { UserModel } from '../../models/user.model';
import { logger } from '../../services/logger.service';

const DEFAULT_LLM_URL = 'https://api.deepseek.com/v1/chat/completions';

export interface BettingProfile {
  preferredSports: string[];
  preferredTeams: string[];
  preferredLeagues: string[];
  riskTolerance: 'low' | 'medium' | 'high';
  style: 'singles' | 'accumulators' | 'mixed';
  source: 'ai' | 'rules';
  // Rules-derived behavioral signals (overlay, always computed from the ledger)
  winRate90d?: number;
  lossStreak?: number;
  stakingCadence30d?: number;
  avgStake?: number;
  historyCount?: number;
  dampen?: number;
}

interface BettingSignals {
  winRate90d: number;
  lossStreak: number;
  stakingCadence30d: number;
  avgStake: number;
  historyCount: number;
  dampen: number;
}

export interface PersonalizedFeed {
  items: any[];
  personalized: boolean;
  protective: boolean;
}

interface HistorySummary {
  count: number;
  sports: Array<{ name: string; count: number }>;
  teams: Array<{ name: string; count: number }>;
  leagues: Array<{ name: string; count: number }>;
  avgStake: number;
  avgMultiplier: number;
  maxMultiplier: number;
  avgRefund: number;
  parlayShare: number;
}

const PROFILE_TTL_MS = 12 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const EMPTY_TTL_MS = 30 * 60 * 1000;
const LLM_TIMEOUT_MS = 8000;
const WHY_TIMEOUT_MS = 2500;
const WHY_TTL_MS = 12 * 60 * 60 * 1000;
const WARM_INTERVAL_MS = 20 * 60 * 60 * 1000;
const LOSS_STREAK_PROTECTIVE_THRESHOLD = 3;
const COLD_START_HISTORY_TARGET = 10;
const SIGNALS_WINDOW_DAYS = 90;

export class AIPersonalizationService {
  private cache = new Map<string, { profile: BettingProfile; expiresAt: number }>();
  private whyCache = new Map<string, { text: string; expiresAt: number }>();
  private lastWarmAt: number | null = null;

  private get deepseekKey(): string { return process.env.DEEPSEEK_API_KEY || ''; }
  private get llmUrl(): string { return process.env.LLM_API_URL || DEFAULT_LLM_URL; }
  private get llmModel(): string { return process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'; }
  private get llmReasonsEnabled(): boolean { return process.env.PERSONALIZATION_LLM_REASONS === '1'; }

  async getProfile(userId: string): Promise<BettingProfile> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.profile;

    let profile: BettingProfile;
    let ttl = PROFILE_TTL_MS;

    try {
      const summary = await this.loadHistory(userId);
      if (summary.count === 0) {
        profile = this.rulesProfile(summary);
        ttl = EMPTY_TTL_MS;
      } else {
        const aiProfile = await this.tryGenerateAIProfile(summary);
        if (aiProfile) {
          profile = { ...aiProfile, source: 'ai' };
          logger.info(`[Ora Personalization] AI profile generated for user ${userId}`);
        } else {
          profile = this.rulesProfile(summary);
          ttl = FAILURE_TTL_MS;
          logger.info(`[Ora Personalization] AI unreachable — rules profile for user ${userId}`);
        }
      }
      profile = { ...profile, ...(await this.loadSignals(userId)) };
    } catch (err: any) {
      profile = this.rulesProfile(await this.loadHistory(userId).catch(() => null));
      ttl = FAILURE_TTL_MS;
      logger.error(`[Ora Personalization] Profile build failed — ${err.message}`);
    }

    this.cache.set(userId, { profile, expiresAt: Date.now() + ttl });
    return profile;
  }

  invalidateProfile(userId: string): void {
    this.cache.delete(userId);
  }

  /**
   * Hybrid reranking: deterministic base score + recency-weighted affinity
   * boost. Cold-start dampening scales the boost by settled-pick history, and
   * a risk gate skips personalization for suspended users entirely or dampens
   * it after 3+ consecutive losses. Never hides pools — reorders only.
   */
  async personalize(pods: any[], userId: string): Promise<PersonalizedFeed> {
    const user = await UserModel.findById(userId).lean();
    if (!user || !user.isActive || user.isSuspended) {
      return { items: [...pods], personalized: false, protective: false };
    }

    const profile = await this.getProfile(userId);
    const historyCount = profile.historyCount || 0;
    if (historyCount === 0) {
      return { items: [...pods], personalized: false, protective: false };
    }

    const protective = (profile.lossStreak || 0) >= LOSS_STREAK_PROTECTIVE_THRESHOLD;
    const streakDampen = protective ? 0.3 : 1;

    const scored = pods.map(p => ({
      pod: p,
      score: this.scorePod(p, profile) + this.affinityBoost(p, profile, streakDampen),
    }));
    scored.sort((a, b) =>
      b.score - a.score ||
      new Date(a.pod.opensAt || 0).getTime() - new Date(b.pod.opensAt || 0).getTime()
    );

    const items = scored.map(s => {
      s.pod.whyRecommended = this.whyRecommended(s.pod, profile, protective);
      s.pod.personalizationScore = Math.round(s.score);
      return s.pod;
    });

    if (this.llmReasonsEnabled) {
      await this.polishReasons(userId, items.slice(0, 3));
    }

    return { items, personalized: true, protective };
  }

  scorePod(pod: any, profile: BettingProfile): number {
    const confidence = (pod.metadata?.oraConfidence as number) || 0;
    let score = confidence;

    const sport = (pod.sport || '').toLowerCase();
    if (profile.preferredSports.some(s => s.toLowerCase() === sport)) score += 20;

    const league = (pod.league || '').toLowerCase();
    if (profile.preferredLeagues.some(l => l.toLowerCase() === league)) score += 15;

    const teamText = `${pod.homeTeam || ''} ${pod.awayTeam || ''}`.toLowerCase();
    if (profile.preferredTeams.some(t => t && teamText.includes(t.toLowerCase()))) score += 25;

    const multiplier = pod.gainsMultiplier || 1.5;
    const inRiskBand = profile.riskTolerance === 'low'
      ? multiplier <= 1.8
      : profile.riskTolerance === 'medium'
        ? multiplier <= 2.5
        : multiplier > 2.5;
    score += inRiskBand ? 10 : -5;

    const isParlay = pod.marketType === 'parlay';
    if (profile.style === 'singles' && !isParlay) score += 8;
    if (profile.style === 'accumulators' && isParlay) score += 8;

    if ((pod.refundPercent || 0) >= 50) score += 5;

    return score;
  }

  private affinityBoost(pod: any, profile: BettingProfile, streakDampen: number): number {
    const dampen = profile.dampen ?? 0;
    const sportFit = this.matchWeight(profile.preferredSports, pod.sport);
    const teamFit = Math.max(
      this.matchWeight(profile.preferredTeams, pod.homeTeam),
      this.matchWeight(profile.preferredTeams, pod.awayTeam)
    );
    const leagueFit = this.matchWeight(profile.preferredLeagues, pod.league);
    const affinity = 0.35 * sportFit + 0.4 * teamFit + 0.25 * leagueFit;
    return affinity * 30 * dampen * streakDampen;
  }

  private matchWeight(list: string[], value: string): number {
    const v = (value || '').toLowerCase();
    if (!v) return 0;
    for (let i = 0; i < list.length; i++) {
      const l = (list[i] || '').toLowerCase();
      if (l && v.includes(l)) return Math.max(0.6, 1 - i * 0.2);
    }
    return 0;
  }

  private bestMatch(list: string[], value: string): string | null {
    const v = (value || '').toLowerCase();
    if (!v) return null;
    for (const entry of list) {
      if (entry && v.includes(entry.toLowerCase())) return entry;
    }
    return null;
  }

  private whyRecommended(pod: any, profile: BettingProfile, protective: boolean): string {
    const team = this.bestMatch(profile.preferredTeams, pod.homeTeam) ||
      this.bestMatch(profile.preferredTeams, pod.awayTeam);
    const league = this.bestMatch(profile.preferredLeagues, pod.league);
    const sport = this.bestMatch(profile.preferredSports, pod.sport);

    let reason: string;
    if (team) {
      reason = `You often back ${team} — matches a team on your list.`;
    } else if (league) {
      reason = `You regularly bet on ${league}.`;
    } else if (sport) {
      reason = `${sport} is one of your usual sports.`;
    } else {
      const confidence = Math.round((pod.metadata?.oraConfidence as number) || 0);
      reason = confidence > 0
        ? `Ora-curated pick with ${confidence}% confidence.`
        : 'High-probability pick aligned with your betting style.';
    }

    return protective ? `Safeguard after losses — ${reason.toLowerCase()}` : reason;
  }

  private async polishReasons(userId: string, pods: any[]): Promise<void> {
    if (!this.deepseekKey || this.deepseekKey === 'your_deepseek_api_key_here' || pods.length === 0) return;

    const systemPrompt = 'You are Ora, BetPool\'s recommendation explainer. Rewrite each product-card reason as ONE short, friendly sentence (max 20 words) for a betting app. Reply with a JSON array of strings in the same order. No markdown.';
    const userPrompt = `Card ${pods.length}: ${pods.map(p => `"${p.title}: ${p.whyRecommended}"`).join(' | ')}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), WHY_TIMEOUT_MS);
      let raw = '';
      try {
        const response = await fetch(this.llmUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.deepseekKey}`,
          },
          body: JSON.stringify({
            model: this.llmModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            max_tokens: 120,
          }),
          signal: controller.signal,
        });
        if (response.ok) {
          const data = await response.json();
          raw = data.choices?.[0]?.message?.content || '';
        }
      } finally {
        clearTimeout(timeoutId);
      }

      const parsed = this.parseReasonList(raw);
      if (!parsed) return;
      pods.forEach((p, i) => {
        if (parsed[i]) {
          this.whyCache.set(`why:${userId}:${p._id}`, { text: parsed[i], expiresAt: Date.now() + WHY_TTL_MS });
          p.whyRecommended = parsed[i];
        }
      });
    } catch (err: any) {
      logger.warn(`[Ora Personalization] Why-explainer LLM call failed: ${err.message}`);
    }
  }

  private parseReasonList(raw: string): string[] | null {
    try {
      const cleaned = raw.replace(/```(?:json)?/g, '').trim();
      const start = cleaned.indexOf('[');
      const end = cleaned.lastIndexOf(']');
      if (start === -1 || end === -1) return null;
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (!Array.isArray(parsed)) return null;
      return parsed.map((r: any) => (typeof r === 'string' ? r.trim() : '')).filter((r: string) => r.length > 0);
    } catch {
      return null;
    }
  }

  /**
   * Daily batched profile recompute: warms the in-memory profile cache for all
   * users with settled activity in the last 30 days. Guarded to run at most
   * once per WARM_INTERVAL_MS.
   */
  async warmAllProfiles(options: { limit?: number } = {}): Promise<number> {
    if (this.lastWarmAt && Date.now() - this.lastWarmAt < WARM_INTERVAL_MS) return 0;
    this.lastWarmAt = Date.now();

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const userIds = (await PickOutcomeModel.distinct('user', { settledAt: { $gte: since } }))
      .slice(0, options.limit ?? 500)
      .map(String);

    await Promise.allSettled(userIds.map(id => this.getProfile(id).catch(() => null)));
    logger.info(`[Ora Personalization] Warmed profiles for ${userIds.length} users`);
    return userIds.length;
  }

  private async loadSignals(userId: string): Promise<BettingSignals> {
    const since = new Date(Date.now() - SIGNALS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const records = await PickOutcomeModel.find({ user: userId, settledAt: { $gte: since } })
      .sort({ settledAt: -1 })
      .limit(500)
      .lean() as any[];

    const wins = records.filter(r => r.outcome === 'won').length;
    let lossStreak = 0;
    for (const r of records) {
      if (r.outcome === 'lost') lossStreak++;
      else if (r.outcome === 'won') break;
    }

    let stakeSum = 0;
    for (const r of records) stakeSum += r.stakeAmount || 0;

    const n = records.length;
    return {
      winRate90d: n > 0 ? wins / n : 0,
      lossStreak,
      stakingCadence30d: Math.round((n / SIGNALS_WINDOW_DAYS) * 30 * 100) / 100,
      avgStake: n > 0 ? Math.round(stakeSum / n) : 0,
      historyCount: n,
      dampen: Math.min(1, n / COLD_START_HISTORY_TARGET),
    };
  }

  private async loadHistory(userId: string): Promise<HistorySummary> {
    const stakes = await StakeModel.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('pod', 'sport league homeTeam awayTeam gainsMultiplier refundPercent')
      .lean() as any[];

    const sports = new Map<string, number>();
    const teams = new Map<string, number>();
    const leagues = new Map<string, number>();
    let totalStake = 0;
    let multiplierSum = 0;
    let maxMultiplier = 0;
    let refundSum = 0;
    let parlayCount = 0;

    for (const s of stakes) {
      const pod = s.pod || {};
      if (!s.status || s.status === 'void') continue;
      if (pod.sport) sports.set(pod.sport, (sports.get(pod.sport) || 0) + 1);
      if (pod.league) leagues.set(pod.league, (leagues.get(pod.league) || 0) + 1);
      for (const t of [pod.homeTeam, pod.awayTeam]) {
        if (t) teams.set(t, (teams.get(t) || 0) + 1);
      }
      totalStake += s.stakeAmount || 0;
      const mult = pod.gainsMultiplier || 0;
      if (mult) {
        multiplierSum += mult;
        maxMultiplier = Math.max(maxMultiplier, mult);
      }
      refundSum += pod.refundPercent || 0;
      if (s.isParlay) parlayCount++;
    }

    const byCount = (m: Map<string, number>) => [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const n = stakes.length || 1;
    return {
      count: stakes.length,
      sports: byCount(sports),
      teams: byCount(teams),
      leagues: byCount(leagues),
      avgStake: Math.round(totalStake / n),
      avgMultiplier: Math.round((multiplierSum / n) * 100) / 100,
      maxMultiplier,
      avgRefund: Math.round(refundSum / n),
      parlayShare: Math.round((parlayCount / n) * 100),
    };
  }

  private async tryGenerateAIProfile(summary: HistorySummary): Promise<Omit<BettingProfile, 'source'> | null> {
    if (!this.deepseekKey || this.deepseekKey === 'your_deepseek_api_key_here') return null;

    const systemPrompt = `You are Ora, BetPool's personalization engine. You analyze a bettor's history and produce a compact betting profile as strict JSON. Respond with ONLY a JSON object — no markdown, no commentary.

Schema:
{
  "preferredSports": ["sport names the bettor favours, max 3"],
  "preferredTeams": ["team names the bettor backs most, max 3"],
  "preferredLeagues": ["league names the bettor bets in most, max 3"],
  "riskTolerance": "low" | "medium" | "high",
  "style": "singles" | "accumulators" | "mixed"
}

Rules:
- riskTolerance "low" = prefers low multipliers (under 1.8x), "high" = comfortable with 2.5x+, "medium" = in between.
- style "singles" = mostly single bets, "accumulators" = mostly parlays, "mixed" = both.
- Only include values supported by the history. Empty arrays are fine.
- riskTolerance and style are required.`;

    const userPrompt = `Here is the bettor's history summary:
- Total stakes: ${summary.count}
- By sport: ${summary.sports.map(s => `${s.name} (${s.count})`).join(', ') || 'none'}
- By league: ${summary.leagues.map(l => `${l.name} (${l.count})`).join(', ') || 'none'}
- Most backed teams: ${summary.teams.map(t => `${t.name} (${t.count})`).join(', ') || 'none'}
- Average stake: ₦${summary.avgStake.toLocaleString()}
- Average multiplier: ${summary.avgMultiplier}x (max ${summary.maxMultiplier}x)
- Average refund % chosen: ${summary.avgRefund}%
- Parlay share: ${summary.parlayShare}% of stakes

Return the JSON profile now.`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(this.llmUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.deepseekKey}`,
          },
          body: JSON.stringify({
            model: this.llmModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.2,
            max_tokens: 300,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        logger.warn(`[Ora Personalization] LLM HTTP ${response.status}`);
        return null;
      }

      const data = await response.json();
      const raw = data.choices?.[0]?.message?.content || '';
      return this.parseProfile(raw);
    } catch (err: any) {
      logger.warn(`[Ora Personalization] LLM call failed: ${err.message}`);
      return null;
    }
  }

  private parseProfile(raw: string): Omit<BettingProfile, 'source'> | null {
    try {
      const cleaned = raw.replace(/```(?:json)?/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) return null;
      const parsed = JSON.parse(cleaned.slice(start, end + 1));

      const arr = (v: any) => (Array.isArray(v) ? v.filter((x: any) => typeof x === 'string' && x.trim()).slice(0, 3) : []);
      const risk: BettingProfile['riskTolerance'] = ['low', 'medium', 'high'].includes(parsed.riskTolerance) ? parsed.riskTolerance : 'medium';
      const style: BettingProfile['style'] = ['singles', 'accumulators', 'mixed'].includes(parsed.style) ? parsed.style : 'mixed';

      return {
        preferredSports: arr(parsed.preferredSports),
        preferredTeams: arr(parsed.preferredTeams),
        preferredLeagues: arr(parsed.preferredLeagues),
        riskTolerance: risk,
        style,
      };
    } catch {
      return null;
    }
  }

  private rulesProfile(summary: HistorySummary | null): BettingProfile {
    const s = summary || {
      count: 0, sports: [], teams: [], leagues: [],
      avgStake: 0, avgMultiplier: 0, maxMultiplier: 0, avgRefund: 0, parlayShare: 0,
    };
    const avgMultiplier = s.avgMultiplier || 0;
    const riskTolerance: BettingProfile['riskTolerance'] = avgMultiplier >= 2.5 ? 'high' : avgMultiplier >= 1.8 ? 'medium' : 'low';
    const style: BettingProfile['style'] = s.parlayShare >= 60 ? 'accumulators' : s.parlayShare >= 25 ? 'mixed' : 'singles';

    return {
      preferredSports: s.sports.map(x => x.name),
      preferredTeams: s.teams.map(x => x.name),
      preferredLeagues: s.leagues.map(x => x.name),
      riskTolerance,
      style,
      source: 'rules',
    };
  }
}

export const aiPersonalizationService = new AIPersonalizationService();
