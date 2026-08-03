import crypto from 'crypto';
import { wrapEmail, brandedButton } from '../../services/email.service';

export interface EscalationInput {
  stakes24h: number;
  staked24h: number;
  bankroll: number;
  lossStreak: number;
}

export interface DigestPickRow {
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoff: string;
  pick: string;
  gainsMultiplier: number;
  confidence: number;
  stakable: boolean;
}

export interface DigestEmailData {
  firstName: string;
  bankroll: number;
  staked7d: number;
  net7d: number;
  stakes24h: number;
  staked24h: number;
}

const MAX_ERRORS = 200;

export function capErrors(errors: string[]): string[] {
  if (errors.length <= MAX_ERRORS) return errors;
  return [...errors.slice(0, MAX_ERRORS), `...and ${errors.length - MAX_ERRORS} more errors`];
}

export function computeEscalation(i: EscalationInput): boolean {
  if (i.stakes24h >= 5) return true;
  if (i.bankroll > 0 && i.staked24h >= 0.5 * i.bankroll) return true;
  if (i.lossStreak >= 3) return true;
  return false;
}

export function digestToken(userId: string): string {
  const secret = process.env.JWT_SECRET || process.env.EMAIL_PASS || 'betpool-digest-secret';
  return crypto.createHmac('sha256', secret).update(userId).digest('hex').slice(0, 24);
}

export function verifyDigestToken(userId: string, token: string): boolean {
  if (!userId || !token) return false;
  const expected = digestToken(userId);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token).slice(0, 24));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function naira(n: number): string {
  const safe = Number.isFinite(n) ? Math.round(n) : 0;
  const abs = Math.abs(safe).toLocaleString('en-US');
  return safe < 0 ? `-₦${abs}` : `₦${abs}`;
}

export function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}

function picksSection(picks: DigestPickRow[]): string {
  if (picks.length === 0) {
    return `
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0F1D36;border-radius:12px;border:1px solid rgba(255,255,255,0.06)">
        <tr><td style="padding:16px;font-size:13px;color:rgba(255,255,255,0.6)">Ora is still analyzing today's fixtures — check the app in a few minutes.</td></tr>
      </table>`;
  }
  return picks.map((p) => `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0F1D36;border-radius:12px;border:1px solid rgba(255,255,255,0.06)">
      <tr>
        <td style="padding:14px 16px">
          <div style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.6px">${esc(p.league || 'Football')}<span style="float:right;text-transform:none">${esc(p.kickoff)}</span></div>
          <div style="font-size:15px;font-weight:700;color:#FFFFFF;margin-top:5px">${esc(p.homeTeam)} <span style="color:rgba(255,255,255,0.35);font-weight:400">vs</span> ${esc(p.awayTeam)}</div>
          <div style="font-size:12px;color:#00E676;margin-top:5px;font-weight:600">Ora's pick — ${esc(p.pick)} <span style="color:rgba(255,255,255,0.5)">@</span> ${p.gainsMultiplier.toFixed(2)}x</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:3px">${p.confidence}% confidence${p.stakable ? '' : ' · staking closed for this pool'}</div>
        </td>
      </tr>
    </table>`).join('<br/>');
}

function bankrollSection(d: DigestEmailData): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0F1D36;border-radius:12px;border:1px solid rgba(255,255,255,0.06)">
      <tr>
        <td width="33%" style="padding:14px 16px">
          <div style="font-size:9px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.6px">Bankroll</div>
          <div style="font-size:18px;font-weight:700;color:#FFFFFF;margin-top:4px">${naira(d.bankroll)}</div>
        </td>
        <td width="33%" style="padding:14px 16px;border-left:1px solid rgba(255,255,255,0.06)">
          <div style="font-size:9px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.6px">Staked · 7 days</div>
          <div style="font-size:16px;font-weight:700;color:#FFFFFF;margin-top:4px">${naira(d.staked7d)}</div>
        </td>
        <td width="33%" style="padding:14px 16px;border-left:1px solid rgba(255,255,255,0.06)">
          <div style="font-size:9px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.6px">Net · 7 days</div>
          <div style="font-size:16px;font-weight:700;color:${d.net7d >= 0 ? '#00E676' : '#f44336'};margin-top:4px">${d.net7d >= 0 ? '+' : ''}${naira(d.net7d)}</div>
        </td>
      </tr>
    </table>`;
}

function escalationSection(d: DigestEmailData, escalation: boolean): string {
  if (!escalation) return '';
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:12px;border:1px solid rgba(232,185,35,0.45);background:rgba(232,185,35,0.06)">
      <tr>
        <td style="padding:14px 16px">
          <div style="color:#E8B923;font-weight:700;font-size:13px">Quick check-in</div>
          <p style="margin:6px 0 0;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.75)">Your activity today looks elevated — ${d.stakes24h} stake(s), ${naira(d.staked24h)} over the last 24 hours. Betting well means betting within your means. Consider setting a deposit limit, and reach out if it ever stops being fun.</p>
          <p style="margin:8px 0 0;font-size:11px;line-height:1.5;color:rgba(255,255,255,0.4)">Need support? <a href="mailto:support@betpool.tech" style="color:#E8B923;text-decoration:none;font-weight:600">support@betpool.tech</a> — we're here 24/7.</p>
        </td>
      </tr>
    </table>`;
}

export function renderDigestEmail(d: DigestEmailData, picks: DigestPickRow[], unsubUrl: string, escalation: boolean): string {
  const firstName = esc(d.firstName || 'Bettor');
  const ctaUrl = `${process.env.FRONTEND_URL || 'https://betpool.tech'}/games`;
  const cta = brandedButton('View Today\'s Picks', ctaUrl);
  const escalationHtml = escalationSection(d, escalation);
  const content = `
    <p style="margin:0 0 18px">Hi <strong style="color:#FFFFFF">${firstName}</strong>, here's today's briefing from Ora — the best-value plays, your bankroll snapshot, and a heads-up if your activity is ramping up.</p>
    <div style="font-size:10px;color:#00E676;text-transform:uppercase;font-weight:700;letter-spacing:0.8px;margin-bottom:8px">Today's best-value matches</div>
    ${picksSection(picks)}
    <div style="font-size:10px;color:#00E676;text-transform:uppercase;font-weight:700;letter-spacing:0.8px;margin:22px 0 8px">Your bankroll</div>
    ${bankrollSection(d)}
    ${escalationHtml ? `<div style="margin-top:18px">${escalationHtml}</div>` : ''}
    ${cta}
    <p style="margin:8px 0 0;font-size:11px;color:rgba(255,255,255,0.35)">You're receiving this because you have a BetPool account. <a href="${unsubUrl}" style="color:rgba(255,255,255,0.45);text-decoration:underline">Unsubscribe from the daily briefing</a>.</p>
  `;
  return wrapEmail('Daily AI Briefing', content, 'Today\'s best-value picks and your bankroll status');
}