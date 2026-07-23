import axios from 'axios';
import { PodModel, IPod } from '../../models/pod.model';
import { AdminService } from '../admin/admin.service';
import { UserModel } from '../../models/user.model';
import { createInAppNotification } from '../../services/notification.service';

export interface SettlementCheckResult {
  podId: string;
  title: string;
  fixtureId: number | null;
  matchFound: boolean;
  matchStatus: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  actualResult: 'home_win' | 'draw' | 'away_win' | 'unknown';
  podSelection: string;
  recommendedResult: 'win' | 'loss' | 'void' | 'cannot_determine';
  confidence: number;
  reasoning: string;
  disputed: boolean;
  disputeReason?: string;
}

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

export class AISettlementService {
  private get apiKey(): string { return process.env.SPORTSAPI_KEY || ''; }
  private get baseUrl(): string {
    return (process.env.SPORTSAPI_BASE_URL || 'https://sports.bzzoiro.com/api/v2').replace(/\/+$/, '');
  }
  private get deepseekKey(): string { return process.env.DEEPSEEK_API_KEY || ''; }
  private get headers(): Record<string, string> {
    return { 'Authorization': `Token ${this.apiKey}` };
  }

  async checkPod(podId: string): Promise<SettlementCheckResult> {
    const pod = await PodModel.findById(podId).populate('createdBy', 'fullName phone');
    if (!pod) throw new Error('Pod not found');

    const base: SettlementCheckResult = {
      podId: pod._id.toString(),
      title: pod.title,
      fixtureId: pod.metadata?.fixtureId || null,
      matchFound: false,
      matchStatus: 'unknown',
      homeTeam: pod.homeTeam,
      awayTeam: pod.awayTeam,
      homeScore: null,
      awayScore: null,
      actualResult: 'unknown',
      podSelection: pod.selection,
      recommendedResult: 'cannot_determine',
      confidence: 0,
      reasoning: '',
      disputed: false,
      disputeReason: undefined,
    };

    if (!base.fixtureId) {
      base.reasoning = 'Pod has no linked fixture (metadata.fixtureId is missing). Manual settlement required.';
      return base;
    }

    try {
      // === PRIMARY SOURCE: Direct event lookup ===
      const primaryRes = await axios.get(`${this.baseUrl}/events/${base.fixtureId}/`, {
        headers: this.headers,
        timeout: 15000,
      });

      const ev = primaryRes.data;
      base.matchFound = true;
      base.matchStatus = ev.status || 'unknown';

      const primaryHomeScore = ev.home_score ?? ev.scores?.home ?? ev.home_team?.score ?? null;
      const primaryAwayScore = ev.away_score ?? ev.scores?.away ?? ev.away_team?.score ?? null;
      base.homeScore = primaryHomeScore;
      base.awayScore = primaryAwayScore;

      if (base.matchStatus === 'finished' && primaryHomeScore !== null && primaryAwayScore !== null) {
        if (primaryHomeScore > primaryAwayScore) base.actualResult = 'home_win';
        else if (primaryHomeScore < primaryAwayScore) base.actualResult = 'away_win';
        else base.actualResult = 'draw';
      } else if (['postponed', 'cancelled', 'abandoned'].includes(base.matchStatus)) {
        base.actualResult = 'unknown';
        base.recommendedResult = 'void';
        base.confidence = 95;
        base.reasoning = `Match ${base.matchStatus}. Pod should be voided.`;
        return base;
      }

      // === SECONDARY SOURCE CROSS-CHECK: Verify via team's finished events list ===
      if (base.matchStatus === 'finished' && primaryHomeScore !== null && primaryAwayScore !== null && ev.home_team_id) {
        try {
          const matchDate = ev.event_date ? new Date(ev.event_date) : null;
          const dateStr = matchDate ? matchDate.toISOString().split('T')[0] : '';
          const nextDay = matchDate ? new Date(matchDate.getTime() + 86400000).toISOString().split('T')[0] : '';

          const secondaryRes = await axios.get(`${this.baseUrl}/events/`, {
            headers: this.headers,
            params: {
              status: 'finished',
              team_id: ev.home_team_id,
              date_from: dateStr,
              date_to: nextDay,
              limit: 10,
            },
            timeout: 10000,
          });

          const secondaryEvents: any[] = secondaryRes.data?.results || [];
          const matchedEvent = secondaryEvents.find(
            (e: any) => e.id === base.fixtureId || (e.home_team_id === ev.home_team_id && e.away_team_id === ev.away_team_id)
          );

          if (matchedEvent) {
            const secondaryHomeScore = matchedEvent.home_score ?? matchedEvent.scores?.home ?? null;
            const secondaryAwayScore = matchedEvent.away_score ?? matchedEvent.scores?.away ?? null;

            if (secondaryHomeScore !== null && secondaryAwayScore !== null &&
                (secondaryHomeScore !== primaryHomeScore || secondaryAwayScore !== primaryAwayScore)) {
              base.disputed = true;
              base.disputeReason = `Score mismatch: primary source says ${primaryHomeScore}-${primaryAwayScore}, secondary source says ${secondaryHomeScore}-${secondaryAwayScore}. Manual review required.`;
              base.confidence = 30;
              base.reasoning = base.disputeReason;
              return base;
            }
          } else {
            // Secondary source didn't find the match — reduce confidence but don't block
            if (base.confidence >= 95) {
              base.confidence = 85;
              base.reasoning += ' (verified by secondary source)';
            }
          }
        } catch {
          // Secondary source unavailable — proceed with primary at reduced confidence
          if (base.confidence >= 95) {
            base.confidence = 80;
            base.reasoning += ' (secondary source unavailable)';
          }
        }
      }

      // Map actual result to pod selection
      base.recommendedResult = 'cannot_determine';

      const sel = pod.selection?.trim().toLowerCase() || '';
      const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const homeName = pod.homeTeam?.toLowerCase() || '';
      const awayName = pod.awayTeam?.toLowerCase() || '';
      const hasHomeTeam = homeName && sel.includes(homeName);
      const hasAwayTeam = awayName && sel.includes(awayName);
      const hasBothTeams = hasHomeTeam && hasAwayTeam;
      const isHomeSel = /home(?!.*away)/.test(sel) || sel === '1' || (hasHomeTeam && !hasBothTeams);
      const isAwaySel = /away(?!.*home)/.test(sel) || sel === '2' || (hasAwayTeam && !hasBothTeams);
      const isDrawSel = /draw/.test(sel) || sel === 'x';
      // If both team names appear (e.g. "IFK Mariehamn vs FC Lahti"), fall through to loss calc only

      if (base.actualResult !== 'unknown') {
        if ((isHomeSel && base.actualResult === 'home_win') || (isAwaySel && base.actualResult === 'away_win') || (isDrawSel && base.actualResult === 'draw')) {
          base.recommendedResult = 'win';
          base.confidence = Math.max(base.confidence, 95);
          base.reasoning = `${pod.homeTeam} ${primaryHomeScore} - ${primaryAwayScore} ${pod.awayTeam}. Pod selected "${pod.selection}" — matches match result.`;
        } else if (isHomeSel || isAwaySel || isDrawSel) {
          base.recommendedResult = 'loss';
          base.confidence = Math.max(base.confidence, 95);
          base.reasoning = `${pod.homeTeam} ${primaryHomeScore} - ${primaryAwayScore} ${pod.awayTeam}. Pod selected "${pod.selection}" — does not match actual result (${base.actualResult.replace('_', ' ')}).`;
        }
      }

      if (base.recommendedResult === 'cannot_determine' && base.matchStatus === 'finished') {
        base.reasoning = `Match finished ${primaryHomeScore}-${primaryAwayScore} but pod selection "${pod.selection}" could not be mapped.`;
      } else if (base.recommendedResult === 'cannot_determine') {
        base.reasoning = `Match status is "${base.matchStatus}". Cannot determine result yet.`;
      }

      // For non-obvious cases, consult DeepSeek as tertiary opinion
      if (base.confidence < 95 && this.deepseekKey && this.deepseekKey !== 'your_deepseek_api_key_here') {
        try {
          const aiResult = await this.consultDeepSeek(pod, base);
          if (aiResult) {
            base.confidence = Math.max(base.confidence, aiResult.confidence);
            base.reasoning = aiResult.reasoning;
            if (aiResult.recommendedResult) base.recommendedResult = aiResult.recommendedResult;
          }
        } catch { /* fallback to mechanical result */ }
      }
    } catch (err: any) {
      const status = err.response?.status;
      base.reasoning = status === 404
        ? `Fixture ${base.fixtureId} not found on sports API. Manual settlement required.`
        : `Failed to fetch match data: ${err.message}`;
    }

    return base;
  }

  async settleAllSettleable(adminUserId: string): Promise<{ settled: number; disputed: number; stuck: number; errors: string[]; results: SettlementCheckResult[] }> {
    const now = new Date();
    const pods = await PodModel.find({
      status: { $in: ['active', 'published'] },
      'metadata.fixtureId': { $exists: true },
      matchDate: { $lte: now },
    });
    const adminService = new AdminService();
    let settled = 0;
    let disputed = 0;
    let stuck = 0;
    const errors: string[] = [];
    const results: SettlementCheckResult[] = [];

    for (const pod of pods) {
      try {
        const check = await this.checkPod(pod._id.toString());
        results.push(check);

        if (check.disputed) {
          disputed++;
          await PodModel.findByIdAndUpdate(pod._id, {
            $set: {
              settlementStatus: 'disputed',
              settlementDisputed: true,
              settlementDisputedReason: check.disputeReason,
            },
          });
          this.notifyAdmins(`Settlement Disputed: ${pod.title}`, `Pod "${pod.title}" (${pod.homeTeam} vs ${pod.awayTeam}) has a disputed settlement. Reason: ${check.disputeReason}`);
          continue;
        }

        // Path 1: AI settlement with high confidence
        if (check.recommendedResult !== 'cannot_determine' && check.confidence >= 90) {
          await adminService.settlePod(pod._id.toString(), check.recommendedResult as 'win' | 'loss' | 'void', adminUserId, `Auto-settled by Ora: ${check.reasoning}`, check.homeScore ?? undefined, check.awayScore ?? undefined);
          await PodModel.findByIdAndUpdate(pod._id, {
            $set: { settlementStatus: 'settled', settlementDisputed: false },
          });
          settled++;
          continue;
        }

        // Path 2: Mechanical fallback — actual scores available from sports API
        if (check.matchStatus === 'finished' && check.homeScore !== null && check.awayScore !== null && check.recommendedResult !== 'cannot_determine') {
          await adminService.settlePod(pod._id.toString(), check.recommendedResult as 'win' | 'loss', adminUserId, `Auto-settled by Ora (mechanical fallback): ${check.reasoning}`, check.homeScore, check.awayScore);
          await PodModel.findByIdAndUpdate(pod._id, {
            $set: { settlementStatus: 'settled', settlementDisputed: false },
          });
          settled++;
          continue;
        }

        // Path 3: Void for postponed/cancelled/abandoned matches
        if (check.recommendedResult === 'void' && check.confidence >= 80) {
          await adminService.settlePod(pod._id.toString(), 'void', adminUserId, `Auto-voided: ${check.reasoning}`);
          await PodModel.findByIdAndUpdate(pod._id, {
            $set: { settlementStatus: 'settled', settlementDisputed: false },
          });
          settled++;
          continue;
        }

        // Path 4: Mark as stuck for manual review
        if (check.recommendedResult === 'cannot_determine' && !check.disputed) {
          const isStuck = !check.fixtureId
            || check.reasoning.includes('not found')
            || check.reasoning.includes('Manual settlement required')
            || check.reasoning.includes('could not be mapped')
            || (check.matchFound && check.matchStatus !== 'finished' && !['postponed', 'cancelled', 'abandoned'].includes(check.matchStatus) && check.reasoning.includes('Cannot determine'));
          const isLiveStatus = ['1st_half','2nd_half','halftime','extra_time','penalties','inprogress','live','notstarted','scheduled'].includes(check.matchStatus?.toLowerCase());
          if (isStuck && !isLiveStatus) {
            stuck++;
            await PodModel.findByIdAndUpdate(pod._id, {
              $set: { settlementStatus: 'stuck', settlementDisputed: false, settlementStuckReason: check.reasoning },
            });
          }
        }
      } catch (err: any) {
        errors.push(`Pod ${pod._id}: ${err.message}`);
      }
    }

    return { settled, disputed, stuck, errors, results };
  }

  async batchResolveDisputes(podIds: string[], adminUserId: string, overrideResult: 'win' | 'loss' | 'void', reviewNote: string): Promise<{ resolved: number; errors: string[] }> {
    let resolved = 0;
    const errors: string[] = [];
    for (const podId of podIds) {
      try {
        await this.resolveDispute(podId, adminUserId, overrideResult, reviewNote);
        resolved++;
      } catch (err: any) {
        errors.push(`Pod ${podId}: ${err.message}`);
      }
    }
    return { resolved, errors };
  }

  async listStuck(): Promise<IPod[]> {
    return PodModel.find({
      status: { $in: ['active', 'published'] },
      matchDate: { $lte: new Date() },
      $or: [
        { 'metadata.fixtureId': { $exists: false } },
        { 'metadata.fixtureId': null },
        { settlementStatus: { $in: ['disputed', 'stuck'] } },
        { settlementStatus: { $exists: false } },
      ],
    })
      .populate('createdBy', 'fullName phone')
      .sort({ updatedAt: -1 });
  }

  async countPendingReviews(): Promise<{ disputed: number; stuck: number }> {
    const disputed = await PodModel.countDocuments({ settlementDisputed: true, status: { $in: ['active', 'published'] } });
    const stuck = await PodModel.countDocuments({
      status: { $in: ['active', 'published'] },
      $or: [
        { 'metadata.fixtureId': { $exists: false } },
        { 'metadata.fixtureId': null },
      ],
    });
    return { disputed, stuck };
  }

  private async notifyAdmins(title: string, message: string) {
    try {
      const admins = await UserModel.find({ role: 'admin' }).select('_id').lean();
      for (const admin of admins) {
        await createInAppNotification(admin._id.toString(), 'system', title, message);
      }
    } catch { /* notify failure is non-critical */ }
  }

  async resolveDispute(podId: string, adminUserId: string, overrideResult: 'win' | 'loss' | 'void', reviewNote: string): Promise<IPod | null> {
    const pod = await PodModel.findById(podId);
    if (!pod) throw new Error('Pod not found');
    if (!pod.settlementDisputed) throw new Error('Pod is not disputed');

    const adminService = new AdminService();
    const settled = await adminService.settlePod(podId, overrideResult, adminUserId, `Manual override after dispute review: ${reviewNote}`);

    await PodModel.findByIdAndUpdate(podId, {
      $set: {
        settlementStatus: 'reviewed',
        settlementDisputed: false,
        settlementReviewedBy: adminUserId,
        settlementReviewNote: reviewNote,
        settlementReviewedAt: new Date(),
      },
    });

    return settled;
  }

  async listDisputed(): Promise<IPod[]> {
    return PodModel.find({ settlementDisputed: true })
      .populate('createdBy', 'fullName phone')
      .sort({ updatedAt: -1 });
  }

  private async consultDeepSeek(pod: IPod, check: SettlementCheckResult) {
    const prompt = `Verify settlement for a BetPool pod:

Match: ${pod.homeTeam} vs ${pod.awayTeam}
Score: ${check.homeScore ?? '?'} - ${check.awayScore ?? '?'}
Status: ${check.matchStatus}
Pod selection: "${pod.selection}"
Mechanical result: ${check.recommendedResult}

Return ONLY a JSON object:
{
  "confidence": number 0-100,
  "recommendedResult": "win" | "loss" | "void" | "cannot_determine",
  "reasoning": "string"
}`;

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
            { role: 'system', content: 'You are Ora, BetPool\'s settlement verification AI. Verify match results against pod selections and return structured JSON.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 300,
        }),
        signal: controller.signal,
      });
    } catch (e: any) {
      clearTimeout(timeoutId);
      console.error(`[AI Settlement] DeepSeek call failed: ${e.message}`);
      return null;
    }
    clearTimeout(timeoutId);

    if (!response.ok) return null;
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    return JSON.parse(content.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim());
  }
}

export const aiSettlementService = new AISettlementService();

