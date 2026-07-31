import { StakeModel } from '../../models/stake.model';
import { logger } from '../../services/logger.service';

const DEFAULT_LLM_URL = 'https://api.deepseek.com/v1/chat/completions';

export interface BettingProfile {
  preferredSports: string[];
  preferredTeams: string[];
  preferredLeagues: string[];
  riskTolerance: 'low' | 'medium' | 'high';
  style: 'singles' | 'accumulators' | 'mixed';
  source: 'ai' | 'rules';
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

export class AIPersonalizationService {
  private cache = new Map<string, { profile: BettingProfile; expiresAt: number }>();

  private get deepseekKey(): string { return process.env.DEEPSEEK_API_KEY || ''; }
  private get llmUrl(): string { return process.env.LLM_API_URL || DEFAULT_LLM_URL; }
  private get llmModel(): string { return process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'; }

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
    } catch (err: any) {
      profile = this.rulesProfile(await this.loadHistory(userId).catch(() => null));
      ttl = FAILURE_TTL_MS;
      logger.error(`[Ora Personalization] Profile build failed — ${err.message}`);
    }

    this.cache.set(userId, { profile, expiresAt: Date.now() + ttl });
    return profile;
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
