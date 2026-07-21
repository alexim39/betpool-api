import { UserModel } from '../models/user.model';
import { StakeModel } from '../models/stake.model';
import { PodModel } from '../models/pod.model';
import { createInAppNotification } from './notification.service';
import { sendSms } from './sms.service';
import { sendEmail } from './email.service';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

export interface CampaignUser {
  userId: string;
  phone: string;
  fullName: string;
  email?: string;
  segment: 'churned' | 'at_risk' | 'high_value' | 'new' | 'active';
  daysSinceLastActivity: number;
  totalStaked: number;
  lastStakeAmount: number;
  lastSport?: string;
  lastLeague?: string;
  activeStakes: number;
  winRate: number;
  walletBalance: number;
}

export interface CampaignMessage {
  userId: string;
  phone: string;
  email?: string;
  fullName: string;
  segment: string;
  subject: string;
  inAppTitle: string;
  inAppMessage: string;
  smsText: string;
  emailHtml: string;
}

export interface CampaignResult {
  segment: string;
  total: number;
  sent: number;
  errors: string[];
  messages: CampaignMessage[];
}

const SEGMENT_CONFIG = {
  churned: { daysInactive: 14, minPastStakes: 1, label: 'Churned (14+ days)' },
  at_risk: { daysInactive: 7, minPastStakes: 2, label: 'At Risk (7+ days)' },
  high_value: { daysInactive: 0, minPastStakes: 5, label: 'High Value' },
  new: { daysInactive: 0, minPastStakes: 0, label: 'New (no stakes yet)' },
  active: { daysInactive: 0, minPastStakes: 1, label: 'Active' },
};

export class AICampaignService {
  private get deepseekKey(): string { return process.env.DEEPSEEK_API_KEY || ''; }

  async segmentUsers(): Promise<{ segments: Record<string, CampaignUser[]>; counts: Record<string, number> }> {
    const users = await UserModel.find({ isSuspended: false }).lean();
    const now = Date.now();
    const segments: Record<string, CampaignUser[]> = { churned: [], at_risk: [], high_value: [], new: [], active: [] };

    for (const user of users) {
      const recentStakes = await StakeModel.find({ user: user._id }).sort({ createdAt: -1 }).limit(20).lean();
      const lastStake = recentStakes[0];
      const daysSinceLastActivity = lastStake
        ? Math.floor((now - new Date(lastStake.createdAt).getTime()) / 86400000)
        : 999;

      const activeStakes = recentStakes.filter(s => ['pending', 'confirmed'].includes(s.status)).length;
      const totalStaked = recentStakes.reduce((sum, s) => sum + (s.stakeAmount || 0), 0);
      const wonStakes = recentStakes.filter(s => s.status === 'won').length;
      const winRate = recentStakes.length > 0 ? Math.round((wonStakes / recentStakes.length) * 100) : 0;

      let lastPod: any = null;
      if (lastStake?.pod) {
        lastPod = await PodModel.findById(lastStake.pod).select('sport league').lean();
      }

      const cu: CampaignUser = {
        userId: user._id.toString(),
        phone: user.phone,
        fullName: user.fullName || '',
        email: user.email,
        segment: 'active',
        daysSinceLastActivity,
        totalStaked,
        lastStakeAmount: lastStake?.stakeAmount || 0,
        lastSport: lastPod?.sport,
        lastLeague: lastPod?.league,
        activeStakes,
        winRate,
        walletBalance: 0,
      };

      if (daysSinceLastActivity >= 14 && totalStaked > 0) cu.segment = 'churned';
      else if (daysSinceLastActivity >= 7 && totalStaked > 0) cu.segment = 'at_risk';
      else if (totalStaked >= 50000) cu.segment = 'high_value';
      else if (totalStaked === 0) cu.segment = 'new';
      else cu.segment = 'active';

      segments[cu.segment].push(cu);
    }

    const counts: Record<string, number> = {};
    for (const [key, list] of Object.entries(segments)) {
      counts[key] = list.length;
    }

    return { segments, counts };
  }

  async generateCampaign(segment: string, maxUsers: number = 20): Promise<CampaignResult> {
    const { segments } = await this.segmentUsers();
    const users = (segments[segment] || []).slice(0, maxUsers);

    if (users.length === 0) {
      return { segment, total: 0, sent: 0, errors: [], messages: [] };
    }

    const messages: CampaignMessage[] = [];
    const errors: string[] = [];
    let sent = 0;

    for (const user of users) {
      try {
        const msg = await this.generateMessage(user);
        messages.push(msg);
        sent++;
      } catch (err: any) {
        errors.push(`User ${user.userId}: ${err.message}`);
      }
    }

    return { segment, total: users.length, sent, errors, messages };
  }

  private async generateMessage(user: CampaignUser): Promise<CampaignMessage> {
    let subject = '';
    let inAppTitle = '';
    let inAppMessage = '';
    let smsText = '';
    let emailHtml = '';

    if (this.deepseekKey && this.deepseekKey !== 'your_deepseek_api_key_here') {
      try {
        const aiMsg = await this.deepseekMessage(user);
        subject = aiMsg.subject;
        inAppTitle = aiMsg.inAppTitle;
        inAppMessage = aiMsg.inAppMessage;
        smsText = aiMsg.smsText;
        emailHtml = aiMsg.emailHtml;
      } catch {
        // Fallback to template
      }
    }

    // Fallback templates if AI fails
    if (!subject) {
      const templates: Record<string, { subject: string; inAppTitle: string; message: string; sms: string }> = {
        churned: {
          subject: `Come back to BetPool, ${user.fullName}!`,
          inAppTitle: 'We miss you!',
          message: `It's been a while! New pods are waiting for you. Deposit and get back in the game.`,
          sms: `BetPool: We miss you! New pods are live. Deposit now and start winning!`,
        },
        at_risk: {
          subject: `Don't miss out, ${user.fullName}!`,
          inAppTitle: 'New pods available!',
          message: `You haven't placed a bet in a while. Check out the latest pods.`,
          sms: `BetPool: New pods dropped! Check them out and place your stake.`,
        },
        high_value: {
          subject: `Exclusive pod picks for you, ${user.fullName}`,
          inAppTitle: 'Special picks for you',
          message: `As a top bettor, check out these recommended pods with the best odds.`,
          sms: `BetPool VIP: Check out our top recommended pods for today.`,
        },
        new: {
          subject: `Ready to place your first bet, ${user.fullName}?`,
          inAppTitle: 'Your first bet awaits!',
          message: `Deposit now and stake on any active pod. Good luck!`,
          sms: `BetPool: Ready to bet? Deposit now and stake on live pods.`,
        },
        active: {
          subject: `Hot picks today, ${user.fullName}!`,
          inAppTitle: 'Hot picks!',
          message: `Check out today's featured pods with the best value.`,
          sms: `BetPool: Hot picks today! Check out featured pods.`,
        },
      };

      const t = templates[user.segment] || templates.active;
      subject = t.subject;
      inAppTitle = t.inAppTitle;
      inAppMessage = t.message;
      smsText = t.sms;
      emailHtml = `<div style="font-family:sans-serif;max-width:600px"><h2>${t.subject}</h2><p>${t.message}</p><a href="${process.env.FRONTEND_URL || ''}" style="display:inline-block;padding:12px 24px;background:#00E676;color:#000;text-decoration:none;border-radius:8px;font-weight:600">Browse Pods</a></div>`;
    }

    return {
      userId: user.userId,
      phone: user.phone,
      email: user.email,
      fullName: user.fullName,
      segment: user.segment,
      subject,
      inAppTitle,
      inAppMessage,
      smsText,
      emailHtml,
    };
  }

  private async deepseekMessage(user: CampaignUser): Promise<{ subject: string; inAppTitle: string; inAppMessage: string; smsText: string; emailHtml: string }> {
    const prompt = `Generate a personalized marketing message for a BetPool user.

User Details:
- Name: ${user.fullName || 'Valued Bettor'}
- Segment: ${user.segment} (${SEGMENT_CONFIG[user.segment]?.label || user.segment})
- Days since last activity: ${user.daysSinceLastActivity}
- Total staked: ₦${user.totalStaked.toLocaleString()}
- Last bet: ${user.lastStakeAmount > 0 ? '₦' + user.lastStakeAmount.toLocaleString() : 'none'}
- Last sport: ${user.lastSport || 'N/A'}
- Last league: ${user.lastLeague || 'N/A'}
- Win rate: ${user.winRate}%
- Active stakes: ${user.activeStakes}
- Has email: ${!!user.email}

Return ONLY a JSON object:
{
  "subject": "Email subject line (max 60 chars)",
  "inAppTitle": "Short title (max 30 chars)",
  "inAppMessage": "One sentence (max 100 chars)",
  "smsText": "SMS text (max 140 chars)",
  "emailHtml": "HTML email body (no <html>/<body> tags, use inline styles)"
}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.deepseekKey}` },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          messages: [
            { role: 'system', content: 'You are Ora, BetPool\'s marketing AI. Generate personalized, engaging messages to retain users and drive deposits/stakes. Be concise and action-oriented.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.5,
          max_tokens: 500,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) throw new Error(`DeepSeek API ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response');

    return JSON.parse(content.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim());
  }

  async sendCampaign(messages: CampaignMessage[], channels: ('in_app' | 'sms' | 'email')[] = ['in_app', 'sms']): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    for (const msg of messages) {
      try {
        if (channels.includes('in_app') && msg.inAppTitle) {
          await createInAppNotification(msg.userId, 'system', msg.inAppTitle, msg.inAppMessage);
        }
        if (channels.includes('sms') && msg.smsText) {
          await sendSms(msg.phone, msg.smsText);
        }
        if (channels.includes('email') && msg.email && msg.emailHtml) {
          await sendEmail(msg.email, msg.subject || 'Message from BetPool', msg.emailHtml);
        }
        sent++;
      } catch {
        failed++;
      }
    }

    return { sent, failed };
  }
}

export const aiCampaignService = new AICampaignService();
