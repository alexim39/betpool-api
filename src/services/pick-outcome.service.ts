import mongoose from 'mongoose';
import { PodModel, IPod } from '../models/pod.model';
import { StakeModel, IStake } from '../models/stake.model';
import { PickOutcomeModel } from '../models/pick-outcome.model';
import { verdictFromFinalScores, PickOutcome } from '../utils/pick-verdict';
import { aiPersonalizationService } from '../modules/ai/ai-personalization.service';
import { curationAccuracyService } from '../modules/ai/curation-accuracy.service';
import { logger } from './logger.service';

const SETTLED_STATUSES = ['won', 'lost', 'void'];

export class PickOutcomeService {
  /**
   * Writes one PickOutcome ledger record per settled stake that referenced the
   * pod (singles plus parlay legs). Verdict is judged from the final scores
   * when available (mirroring the client `pickOutcome()`), otherwise it falls
   * back to the pod-level result. Void pods always record 'skip'.
   * Runs inside the caller's transaction when a session is provided.
   */
  async recordPodSettlement(
    podId: string | mongoose.Types.ObjectId,
    session?: mongoose.ClientSession
  ): Promise<number> {
    const findPod = session ? PodModel.findById(podId).session(session) : PodModel.findById(podId);
    const pod = await findPod;
    if (!pod) return 0;

    const query = (m: any) => (session ? m.session(session) : m);
    const [singles, parlays] = await Promise.all([
      query(StakeModel.find({ pod: podId, status: { $in: SETTLED_STATUSES } })),
      query(StakeModel.find({ 'items.pod': podId, status: { $in: SETTLED_STATUSES } })),
    ]);

    const stakes = new Map<string, IStake>();
    for (const s of singles) if (!s.isParlay) stakes.set(s._id.toString(), s);
    for (const s of parlays) if (s.isParlay) stakes.set(s._id.toString(), s);
    if (stakes.size === 0) return 0;

    const outcome = this.outcomeFor(pod);
    const settledAt = pod.settledAt || new Date();
    const records = [...stakes.values()].map(s => ({
      user: s.user,
      pod: pod._id,
      sport: pod.sport,
      league: pod.league,
      homeTeam: pod.homeTeam,
      awayTeam: pod.awayTeam,
      selection: pod.selection,
      marketType: pod.marketType,
      gainsMultiplier: pod.gainsMultiplier,
      refundPercent: pod.refundPercent || 0,
      stakeAmount: s.stakeAmount,
      isParlay: s.isParlay,
      outcome,
      settledAt,
    }));

    if (session) {
      await PickOutcomeModel.insertMany(records, { session });
    } else {
      await PickOutcomeModel.insertMany(records);
    }

    for (const userId of [...stakes.values()].map(s => s.user.toString())) {
      aiPersonalizationService.invalidateProfile(userId);
    }

    // Settled ledger changed — drop cached league/market accuracy stats.
    curationAccuracyService.invalidate();

    return records.length;
  }

  private outcomeFor(pod: IPod): PickOutcome {
    if (pod.result === 'void') return 'skip';
    const hs = pod.homeScore;
    const as = pod.awayScore;
    if (
      typeof hs === 'number' && typeof as === 'number' &&
      Number.isFinite(hs) && Number.isFinite(as)
    ) {
      return verdictFromFinalScores(pod.selection, hs, as);
    }
    return pod.result === 'win' ? 'won' : 'lost';
  }
}

export const pickOutcomeService = new PickOutcomeService();
