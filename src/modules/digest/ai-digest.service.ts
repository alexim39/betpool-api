import mongoose from 'mongoose';
import { UserModel } from '../../models/user.model';
import { WalletModel } from '../../models/wallet.model';
import { StakeModel } from '../../models/stake.model';
import { DigestSendLogModel } from '../../models/digest-send-log.model';
import { aiGamesService, TodayGame } from '../ai/ai-games.service';
import { sendEmail } from '../../services/email.service';
import { logger } from '../../services/logger.service';
import {
  DigestPickRow,
  DigestEmailData,
  computeEscalation,
  renderDigestEmail,
  digestToken,
  capErrors,
} from './digest-utils';

const DAY_MS = 86400000;

export interface RunReport {
  mode: 'full' | 'dry-run';
  startedAt: string;
  finishedAt?: string;
  scanned: number;
  sent: number;
  failed: number;
  errors: string[];
  recipients?: string;
}

interface ProcessUser {
  _id: mongoose.Types.ObjectId;
  email: string;
  fullName: string;
}

export class AIDigestService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastRunDay = '';
  private lastReport: RunReport | null = null;

  private get hour(): number {
    const h = parseInt(process.env.DAILY_DIGEST_HOUR || '8', 10);
    return Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 8;
  }

  private get batchSize(): number {
    const b = parseInt(process.env.DIGEST_BATCH_SIZE || '200', 10);
    return Number.isFinite(b) ? Math.min(1000, Math.max(10, b)) : 200;
  }

  private get concurrency(): number {
    const c = parseInt(process.env.DIGEST_CONCURRENCY || '5', 10);
    return Number.isFinite(c) ? Math.min(20, Math.max(1, c)) : 5;
  }

  private get poolSize(): number {
    const p = parseInt(process.env.DIGEST_POOL_SIZE || '10', 10);
    return Number.isFinite(p) ? Math.min(20, Math.max(5, p)) : 10;
  }

  private get emailCount(): number {
    const n = parseInt(process.env.DIGEST_PICK_COUNT || '5', 10);
    return Number.isFinite(n) ? Math.min(8, Math.max(3, n)) : 5;
  }

  start() {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.tick(), 60 * 1000);
    logger.info(`[Daily Digest] Scheduler started — fires at ${this.hour}:00 daily`);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
  }

  private tick() {
    const now = new Date();
    if (now.getHours() !== this.hour) return;
    const day = now.toISOString().slice(0, 10);
    if (this.lastRunDay === day) return;
    this.lastRunDay = day;
    this.runDailyDigest().catch(e => logger.error('[Daily Digest] Run failed', e));
  }

  getStatus() {
    return {
      enabled: this.intervalId !== null,
      running: this.running,
      hour: this.hour,
      batchSize: this.batchSize,
      concurrency: this.concurrency,
      lastRunDay: this.lastRunDay,
      lastReport: this.lastReport,
    };
  }

  async getUnsubscribedEmails(): Promise<string[]> {
    const users = await UserModel.find({ digestOptOut: true }).select('email').lean();
    return users.map(u => (u as any).email).filter(Boolean);
  }

  async runDailyDigest(opts: { dryRunTo?: string } = {}): Promise<RunReport> {
    if (this.running) {
      return { mode: opts.dryRunTo ? 'dry-run' : 'full', startedAt: new Date().toISOString(), scanned: 0, sent: 0, failed: 0, errors: ['Digest run already in progress'] };
    }
    this.running = true;
    const report: RunReport = { mode: opts.dryRunTo ? 'dry-run' : 'full', startedAt: new Date().toISOString(), scanned: 0, sent: 0, failed: 0, errors: [] };

    try {
      const pool = await this.buildPool();

      if (report.mode === 'dry-run') {
        const to = opts.dryRunTo as string;
        const user = await UserModel.findOne({ email: to }).select('_id email fullName').lean();
        const picks = user
          ? await this.picksForUser(pool, String((user as any)._id))
          : this.defaultPicks(pool);
        const data: DigestEmailData = {
          firstName: (user as any)?.fullName || 'Valued Bettor',
          bankroll: 125000,
          staked7d: 46500,
          net7d: -8400,
          stakes24h: 6,
          staked24h: 19200,
        };
        const html = renderDigestEmail(data, picks, `${process.env.API_URL || 'https://api.betpool.tech'}/digest/unsubscribe/sample/${digestToken('sample')}`, true);
        await sendEmail(to, 'Daily AI Briefing — dry run', html);
        report.sent = 1;
        report.recipients = to;
        return report;
      }

      await this.processAllUsers(pool, report);
      return report;
    } finally {
      this.running = false;
      report.finishedAt = new Date().toISOString();
      report.errors = capErrors(report.errors);
      this.lastReport = report;
    }
  }

  private async buildPool(): Promise<TodayGame[]> {
    try {
      const { items } = await aiGamesService.getToday(1);
      return items
        .filter(g => g.pick && g.confidence)
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
        .slice(0, this.poolSize);
    } catch (e: any) {
      logger.error('[Daily Digest] buildPool failed', e);
      return [];
    }
  }

  private defaultPicks(pool: TodayGame[]): DigestPickRow[] {
    return pool.slice(0, this.emailCount).map(g => this.toRow(g));
  }

  private toRow(g: TodayGame): DigestPickRow {
    return {
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      league: g.league || 'Football',
      kickoff: new Date(g.matchDate).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }),
      pick: g.pick,
      gainsMultiplier: g.gainsMultiplier || 0,
      confidence: g.confidence || 0,
      stakable: !!g.stakable,
      whyRecommended: g.whyRecommended,
    };
  }

  /** Re-ranks the day's pool against the user's profile; cold-start users keep the default order. */
  async picksForUser(pool: TodayGame[], userId: string): Promise<DigestPickRow[]> {
    if (!pool.length) return [];
    if (!userId) return this.defaultPicks(pool);
    const res = await aiGamesService.personalizeGames(pool, userId);
    return res.items.slice(0, this.emailCount).map(g => this.toRow(g));
  }

  private async processAllUsers(pool: TodayGame[], report: RunReport): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    let cursor: mongoose.Types.ObjectId | null = null;

    while (true) {
      const query: any = {
        email: { $exists: true, $ne: '' },
        isSuspended: { $ne: true },
        digestOptOut: { $ne: true },
      };
      if (cursor) query._id = { $gt: cursor };

      const users = await UserModel.find(query)
        .select('_id email fullName')
        .sort({ _id: 1 })
        .limit(this.batchSize)
        .lean() as unknown as ProcessUser[];

      if (users.length === 0) break;
      report.scanned += users.length;

      await this.processBatchUsers(users, day, pool, report);
      cursor = users[users.length - 1]._id;
      await new Promise(res => setImmediate(res));
    }
  }

  private async processBatchUsers(users: ProcessUser[], day: string, pool: TodayGame[], report: RunReport): Promise<void> {
    const ids = users.map(u => u._id);

    const [wallets, stakeAgg, recentStakes] = await Promise.all([
      WalletModel.find({ user: { $in: ids } }).select('user balance lockedBalance').lean(),
      StakeModel.aggregate([
        { $match: { user: { $in: ids }, createdAt: { $gte: new Date(Date.now() - 7 * DAY_MS) } } },
        { $group: {
            _id: '$user',
            staked7d: { $sum: '$stakeAmount' },
            paid: { $sum: { $cond: [{ $in: ['$status', ['won', 'cashed_out']] }, '$netPayout', 0] } },
            staked24h: { $sum: { $cond: [{ $gte: ['$createdAt', new Date(Date.now() - DAY_MS)] }, '$stakeAmount', 0] } },
            stakes24h: { $sum: { $cond: [{ $gte: ['$createdAt', new Date(Date.now() - DAY_MS)] }, 1, 0] } },
          } },
      ]),
      StakeModel.find({ user: { $in: ids }, createdAt: { $gte: new Date(Date.now() - 2 * DAY_MS) } })
        .select('user status createdAt stakeAmount')
        .sort({ createdAt: 1 })
        .lean(),
    ]);

    const walletMap = new Map<string, any>();
    for (const w of wallets) walletMap.set(String((w as any).user), w);
    const stakeMap = new Map<string, { staked7d: number; paid: number; staked24h: number; stakes24h: number }>();
    for (const s of stakeAgg) stakeMap.set(String(s._id), {
      staked7d: s.staked7d || 0,
      paid: s.paid || 0,
      staked24h: s.staked24h || 0,
      stakes24h: s.stakes24h || 0,
    });
    const recentMap = new Map<string, Array<{ status: string }>>();
    for (const r of recentStakes as any[]) {
      const key = String(r.user);
      if (!recentMap.has(key)) recentMap.set(key, []);
      recentMap.get(key)!.push(r);
    }

    const jobs = users.map((u) => {
      const wallet = walletMap.get(String(u._id));
      const agg = stakeMap.get(String(u._id)) || { staked7d: 0, paid: 0, staked24h: 0, stakes24h: 0 };
      const bankroll = wallet ? ((wallet.balance || 0) - (wallet.lockedBalance || 0)) : 0;
      const net7d = (agg.paid || 0) - (agg.staked7d || 0);

      const recent = (recentMap.get(String(u._id)) || []).slice().reverse();
      let lossStreak = 0;
      for (const r of recent) {
        if (r.status === 'lost') lossStreak++;
        else break;
      }

      const escalation = computeEscalation({
        stakes24h: agg.stakes24h || 0,
        staked24h: agg.staked24h || 0,
        bankroll,
        lossStreak,
      });

      const data: DigestEmailData = {
        firstName: u.fullName,
        bankroll,
        staked7d: agg.staked7d || 0,
        net7d,
        stakes24h: agg.stakes24h || 0,
        staked24h: agg.staked24h || 0,
      };
      return { u, data, escalation };
    });

    let idx = 0;
    const workers = Array.from({ length: Math.min(this.concurrency, jobs.length) }, async () => {
      while (idx < jobs.length) {
        const job = jobs[idx++];
        try {
          const picks = await this.picksForUser(pool, String(job.u._id));
          await this.sendOne(job.u, job.data, job.escalation, picks, day, report);
        } catch (err: any) {
          report.failed++;
          report.errors.push(`User ${job.u._id}: ${err.message}`);
        }
      }
    });
    await Promise.all(workers);
  }

  private async sendOne(u: ProcessUser, data: DigestEmailData, escalation: boolean, picks: DigestPickRow[], day: string, report: RunReport): Promise<void> {
    const claim = await DigestSendLogModel.findOneAndUpdate(
      { userId: u._id, day, status: { $ne: 'sent' } },
      { $set: { day: day, status: 'sending', userId: u._id, lastAttemptAt: new Date() }, $inc: { attempts: 1 } },
      { upsert: true, new: true }
    );
    if (!claim) return;

    const unsubUrl = `${process.env.API_URL || 'https://api.betpool.tech'}/digest/unsubscribe/${u._id}/${digestToken(String(u._id))}`;
    const first = (u.fullName || '').split(' ')[0];
    const subject = `Daily AI Briefing${first ? ` — ${first}` : ''}`;
    const html = renderDigestEmail({ ...data, firstName: first || 'Bettor' }, picks, unsubUrl, escalation);

    try {
      await sendEmail(u.email, subject, html);
      await DigestSendLogModel.updateOne({ userId: u._id, day }, { $set: { status: 'sent', sentAt: new Date(), error: null } });
      await UserModel.findByIdAndUpdate(u._id, { $set: { lastDigestSentAt: new Date() } });
      report.sent++;
    } catch (err: any) {
      await DigestSendLogModel.updateOne({ userId: u._id, day }, { $set: { status: 'failed', error: err.message } });
      report.failed++;
      report.errors.push(`User ${u._id}: ${err.message}`);
    }
  }
}

export const aiDigestService = new AIDigestService();