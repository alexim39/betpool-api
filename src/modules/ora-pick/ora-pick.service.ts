import { UserModel } from '../../models/user.model';
import Notification from '../../models/notification.model';
import { aiGamesService, TodayGame } from '../ai/ai-games.service';
import { OraPickPushModel } from './ora-pick-push.model';
import { createInAppNotification } from '../../services/notification.service';

export interface OraPick {
  podId: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  pick: string;
  gainsMultiplier: number;
  confidence: number;
  whyRecommended?: string;
}

const PUSH_ENABLED = process.env.ORA_PICKS_PUSH !== 'disabled';
const PUSH_CHECK_MS = parseInt(process.env.ORA_PICKS_PUSH_CHECK_MS || '60000', 10);
const PUSH_BATCH = 500;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export class OraPickService {
  private pushTimer: NodeJS.Timeout | null = null;

  async getPickOfDay(userId?: string): Promise<OraPick | null> {
    const { items } = await aiGamesService.getToday(1, userId);
    const stakable = (items || []).filter(
      (g: TodayGame) => g.podId && g.pick && g.stakable !== false && g.matchDate
    );
    if (stakable.length === 0) return null;

    const best = [...stakable].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
    return {
      podId: best.podId,
      league: best.league,
      homeTeam: best.homeTeam,
      awayTeam: best.awayTeam,
      kickoff: best.matchDate.toISOString(),
      pick: best.pick,
      gainsMultiplier: best.gainsMultiplier,
      confidence: best.confidence,
      whyRecommended: best.whyRecommended,
    };
  }

  startDailyPush(): void {
    if (!PUSH_ENABLED || this.pushTimer) return;
    this.pushTimer = setInterval(() => {
      this.maybePushToday().catch(err => console.error('Ora pick push error', err));
    }, PUSH_CHECK_MS);
    this.pushTimer.unref?.();
    setTimeout(() => this.maybePushToday().catch(err => console.error('Ora pick push error', err)), 15_000).unref?.();
  }

  private async maybePushToday(): Promise<void> {
    const date = todayKey();
    const existing = await OraPickPushModel.findOne({ date }).select('_id').lean();
    if (existing) return;

    const pick = await this.getPickOfDay();
    if (!pick) return;

    const userIds = await UserModel.find({ isActive: true, isSuspended: { $ne: true }, digestOptOut: { $ne: true } })
      .select('_id')
      .lean();
    if (!userIds.length) {
      await OraPickPushModel.create({ date, podId: pick.podId, pick: pick.pick, sentTo: 0 });
      return;
    }

    let sent = 0;
    for (let i = 0; i < userIds.length; i += PUSH_BATCH) {
      const chunk = userIds.slice(i, i + PUSH_BATCH).map(u => ({
        user: u._id,
        type: 'system',
        title: 'Ora Pick of the Day',
        message: `Ora's top pick today: ${pick.homeTeam} vs ${pick.awayTeam} — ${pick.pick} @ ${pick.gainsMultiplier}x. Tap to stake instantly.`,
        data: { podId: pick.podId, type: 'ora_pick' },
      }));
      await Notification.create(chunk);
      sent += chunk.length;
    }

    await OraPickPushModel.create({ date, podId: pick.podId, pick: pick.pick, sentTo: sent });
    console.log(`[ora-pick] Daily pick pushed to ${sent} users`);
  }

  async notifyPickToUser(userId: string, pick: OraPick): Promise<void> {
    await createInAppNotification(userId, 'system', 'Ora Pick of the Day',
      `Ora's top pick: ${pick.homeTeam} vs ${pick.awayTeam} — ${pick.pick} @ ${pick.gainsMultiplier}x. Tap to stake instantly.`,
      { podId: pick.podId, type: 'ora_pick' });
  }
}

export const oraPickService = new OraPickService();
