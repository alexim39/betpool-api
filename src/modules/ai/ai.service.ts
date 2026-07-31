import { UserModel } from '../../models/user.model';
import { WalletModel } from '../../models/wallet.model';
import { StakeModel } from '../../models/stake.model';
import { PodModel } from '../../models/pod.model';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

export interface StakeAction {
  type: 'confirm_stake';
  data: {
    podId: string;
    podTitle: string;
    selection: string;
    amount: number;
    gainsMultiplier: number;
    potentialPayout: number;
    platformFee: number;
    netPayout: number;
  };
}

export interface AccumulatorAction {
  type: 'confirm_accumulator';
  data: {
    legs: Array<{
      podId: string;
      podTitle: string;
      selection: string;
      gainsMultiplier: number;
    }>;
    stakeAmount: number;
    combinedMultiplier: number;
    potentialPayout: number;
    platformFee: number;
    netPayout: number;
  };
}

export type ChatAction = StakeAction | AccumulatorAction;

export interface ChatResult {
  content: string;
  actions: ChatAction[];
  usage?: any;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const BETPOOL_KNOWLEDGE = `# BetPool User Guide

BetPool is an AI-powered betting platform. It lets you bet on Pods (AI-curated matche odds with a built-in stake-back guarantee), join Match Pools for shared prize pools, or let Ora AI manage your bets for you. Works on phone, tablet, and computer — the layout adjusts automatically.
## Account & Login

**Sign up:** Enter your full legal name, Nigerian phone number, and optionally email. Agree to Terms of Service. You'll get a 6-digit code by SMS (and email if provided). Enter it to confirm. Choose a 6-digit PIN — you use this to log in and withdraw.

**Log in:** Three ways — email code (enter email, receive 6-digit code), phone code (enter phone, receive 6-digit code), or PIN (enter your 6-digit PIN).

**Forgot/Change PIN:** Forgot PIN → choose "forgot PIN" option, verify code sent to your phone, set new PIN. Change PIN → Profile → Security → Change PIN, enter current PIN, then new one twice.

## Home Feed & Betting

Your home screen shows a live feed of **Pods** — ready-made betting opportunities picked by BetPool's experts or Ora AI, with a stake-back guarantee.

**Pod Card shows:** League (e.g., Premier League), odds/gains multiplier, exposure bar (how much of the pool is already staked), refund % (percentage of stake back if the bet loses).

**Single bet:** Tap "Place Stake" on a Pod, enter amount (or tap quick-select buttons), review potential payout and platform fee, tap "Confirm Stake".

**Accumulator (combine up to 5):** Tap "+" on each Pod, bet slip combines odds into one multiplier, enter one stake amount, tap "Place Accumulator". All selections must win.

**Top up while browsing:** Tap "Top Up" in the menu, choose amount, Paystack processes payment, you're brought back to BetPool.

## Wallet — Deposits & Withdrawals

**Wallet overview:** Total balance (available + locked in active bets), total staked/winnings (lifetime).

**Deposit:** Tap "Deposit" or "Top Up", choose amount (5k/10k/20k/50k/100k/500k NGN or custom), tap "Deposit" → Paystack (card, bank transfer, or USSD). Funds credited instantly.

**Withdraw:** Enter amount (min 500 NGN, max 5,000,000 NGN per withdrawal, daily limit 10,000,000 NGN). Choose bank from 50+ Nigerian banks. Enter 10-digit account number (name auto-verifies). Enter 6-digit withdrawal PIN. Optionally save account. Tap submit. Processing: 1-2 business days.

**Transaction History:** Filter All/Deposits/Withdrawals. Shows date, type, description, amount, status (Completed/Pending/Failed).

## My Bets — Tracking & Cashout

My Bets page shows: Won, Lost, Refunded, Cashed Out, Void bets.

**Cashout early:** Active Bets tab → tap "Cashout" on eligible bet → see cashout value (remaining stake minus 10% fee) → confirm. Bet settles instantly.

**History tab:** Every settled bet with date, selection, odds, stake, payout, result. Accumulators show each selection's status. Active bets refresh every 30 seconds.

## Match Pools — Shared Prize Pools

**Browse:** Open Pools (still accepting bets), My Stakes (pools you've bet in). Each pool has countdown and list of outcomes/markets with total staked, percentage, and rank (1st, 2nd, etc.).

**Place bet:** Tap an outcome, enter stake (check pool min/max), confirm. No refund if you lose — winners split the pool proportionally.

## Bet Manager — AI-Managed Betting

Works like an investment fund. Deposit into a risk tier, Ora AI spreads money across Pods and Match Pools daily. Returns grow the pool. BetPool takes 20% fee on profit only — never on deposit.

**Three tiers:**
- **Defender** (min 50,000 NGN) — Conservative, safer bets with strong refund protection
- **Midfielder** (min 100,000 NGN) — Balanced mix of Pods and Match Pools
- **Striker** (min 200,000 NGN) — Aggressive, higher multipliers, bigger potential returns

**Getting started:** Choose a tier, choose deposit amount (min/2x/5x/custom), review details (deposit, 30-day lock, 20% performance fee), confirm. Funds move from wallet to tier; you receive "units" based on pool's current value.

**Track investment:** Portfolio value, total deposited, profit/loss, history chart, performance breakdown, deposit/withdrawal record.

**Withdraw from Bet Manager:** Only unlocked portion (after 30-day lock per deposit). Withdrawals take ALL unlocked value at once — no partial withdrawal. You can deposit again right after.

## Profile & Account Settings

**Personal info:** Update name and email anytime. Phone number is fixed for security.

**Security:** Phone verification via one-time code. View login history. Change PIN (Profile → Security → Change PIN).

**KYC:** Verify identity with BVN or NIN to unlock higher withdrawal limits. Check status from Profile.

**Referrals:** Unique referral code on Profile. Share with friends — earn referral bonuses when they sign up. See total referrals, bonus earnings, and rules on Profile screen.

**Help:** FAQ with common questions, Ora AI chat support.

## Notifications

Inbox for account updates. Filter All/Unread. Mark individual items read/unread, delete, or mark all read. Types: Withdrawal processed, Payout credited, KYC verified, Platform updates.

**Key Terms:**
- **Pod** — Ready-made betting market with fixed odds and stake-back guarantee
- **Stake** — Amount you wager
- **Accumulator (Parlay)** — Multiple selections combined; all must win
- **Cashout** — End active bet early for guaranteed amount (10% fee)
- **Stake-Back Guarantee** — Get back a percentage of stake if Pod loses
- **Match Pool** — Shared pool; winners split proportionally, no refund on loss
- **Bet Manager** — AI-managed investment with 30-day lock and 20% performance fee on profit
- **NAV (Net Asset Value)** — Current price of one "unit" in a Bet Manager tier
- **Platform Fee** — 10% of profit on Pod bets, 15% of total on Match Pools

**Troubleshooting & FAQ:**
- **Login issues:** Forgot PIN? Use SMS code login, then set new PIN in Profile → Security.
- **Verification code not arriving:** Check SMS, check spam for email. Request resend after 60 seconds.
- **Deposit not showing:** Open Wallet page — it auto-checks pending deposits. If still missing, contact support via Ora AI or email.
- **Paystack says paid but wallet not updated:** Navigate to Wallet page to trigger pending deposit check. Contact support if problem persists.
- **Can't withdraw:** Four common causes — daily limit reached (10M NGN), insufficient available balance, KYC not verified, or wrong withdrawal PIN.
- **Withdrawal time:** Bank transfers complete within 24 hours on business days.
- **Bet Manager 30-day lock:** Gives Ora AI time to spread money across betting cycles. Once 30 days pass, that portion unlocks for withdrawal.
- **Partial withdrawal from Bet Manager:** Not available — withdrawing takes ALL unlocked value. You can deposit again immediately.
- **Is my money safe?** All Pods have a stake-back guarantee. Platform protected by Terms of Service.
- **Disputes:** Contact support via Ora AI chat or support@betpool.tech. Disputed results are personally reviewed by the team.`;

async function buildSystemPrompt(userId?: string): Promise<string> {
  let userContext = '';

  if (userId) {
    try {
      const [user, wallet, activeStakes] = await Promise.all([
        UserModel.findById(userId).select('fullName email phone kycVerified').lean(),
        WalletModel.findOne({ user: userId }).select('balance lockedBalance').lean(),
        StakeModel.countDocuments({ user: userId, status: { $in: ['pending', 'active'] } }).lean()
      ]);

      const parts: string[] = [];
      if (user) {
        parts.push(`User's name: ${user.fullName || 'Not set'}`);
        parts.push(`Email: ${user.email || 'Not set'}`);
        parts.push(`KYC verified: ${user.kycVerified ? 'Yes' : 'No'}`);
      }
      if (wallet) {
        parts.push(`Wallet balance: ₦${(wallet.balance || 0).toLocaleString('en-US')}`);
        parts.push(`Locked balance (in active stakes): ₦${(wallet.lockedBalance || 0).toLocaleString('en-US')}`);
        parts.push(`Available balance: ₦${((wallet.balance || 0) - (wallet.lockedBalance || 0)).toLocaleString('en-US')}`);
      }
      if (activeStakes !== undefined) {
        parts.push(`Active stakes count: ${activeStakes}`);
      }

      if (parts.length > 0) {
        userContext = `\n\n## Current User Data\nHere is the current user's account information. Use this to answer personal questions about their account:\n${parts.join('\n')}`;
      }
    } catch (err) {
      console.error('Failed to fetch user context for Ora:', err);
    }
  }

  let livePodsSection = '';
  try {
    const livePods = await PodModel.find({ status: 'active', bookedExternally: false, opensAt: { $lte: new Date() }, stakingClosesAt: { $gte: new Date() } })
      .select('title selection gainsMultiplier minStake maxStake')
      .sort({ 'metadata.oraConfidence': -1 })
      .limit(20)
      .lean();
    if (livePods.length > 0) {
      const lines = (livePods as any[]).map(p =>
        `- "${p.title}" → pick: ${p.selection || '—'}, ${p.gainsMultiplier || 1.5}x, min ₦${p.minStake || 1000}, max ₦${p.maxStake || 100000}`
      );
      livePodsSection = `\n\n## Live Pods Right Now\nThese are the betting offers currently open. Each pod has a FIXED pick — users can only stake on that pod's pick, not on any team they choose. Use these when the user asks to bet:\n${lines.join('\n')}`;
    }
  } catch (err) {
    console.error('Failed to load live pods for Ora:', err);
  }

  return `You are Ora, the friendly AI assistant for BetPool — a sports betting platform. Your name is Ora and you were created by the BetPool team.

${BETPOOL_KNOWLEDGE}${userContext}${livePodsSection}

Additional guidelines — VERY IMPORTANT:
- Respond like a real human in a chat conversation. Keep it SHORT, casual, and natural — like texting a friend.
- Use simple everyday language. Be friendly but not robotic. A little personality is good.
- Use emojis sparingly (one per message max) — 👍😊✅🎉
- When answering questions, give the essential info in 1-3 sentences. No long paragraphs.
- If someone asks about their balance, stakes, or personal data, use the Current User Data section to answer directly.
- If you don't have the specific data they need, just tell them which page to check in the app.
- Never share sensitive info like full phone numbers or transaction references.
- If asked about something outside BetPool, gently steer them back to BetPool topics.
- If a user asks to place a bet or says something like "put X on [team]", use the Live Pods section: pick the pod matching their request, and check that the team they want to bet on matches the pod's FIXED pick. If it doesn't match, tell them the pod only offers that pick and ask if they want to stake on it instead — do NOT fabricate a bet on a team the pod doesn't offer.
- Users can place MULTIPLE bets in one message, separated by commas (e.g. "bet ₦100 on the winning game, bet ₦200 on 5 games"). Emit one [STAKE] block per single bet and one [ACCUM] block per accumulator — ALL blocks in the same reply.
- "bet ₦X on N games" (N ≥ 2) means one ACCUMULATOR: a parlay of N live pods with a single total stake of ₦X and combined odds = product of all leg multipliers. "each" / "per game" means separate single bets of ₦X each. "winning game" / "best game" means the highest-confidence pod. "pick N best games" means the N highest-confidence pods.
- When you confirm a bet, respond naturally, ask a quick confirmation question like "You want to bet ₦X on [pod] — pick: [pick], right?", and include a [STAKE] JSON block at the very end of your message with the stake details. Example: "Sure! You want to bet ₦5,000 on Arsenal vs Chelsea — pick: Arsenal, right? [STAKE]{\"podId\":\"...\",\"podTitle\":\"Arsenal vs Chelsea\",\"selection\":\"Arsenal\",\"amount\":5000}[/STAKE]"
- For an accumulator, include an [ACCUM] JSON block: {"legs":[{"podId":"...","podTitle":"Arsenal vs Chelsea","selection":"Arsenal","gainsMultiplier":1.7}],"stakeAmount":200,"combinedMultiplier":2.89} — combinedMultiplier must equal the product of all legs' gainsMultiplier, and the block must contain 2-5 legs from DIFFERENT matches.`;
}

function computeStakeMath(amount: number, gains: number): { potentialPayout: number; platformFee: number; netPayout: number } {
  const potentialPayout = Math.floor(amount * gains);
  const platformFee = Math.floor(potentialPayout * 0.1);
  return { potentialPayout, platformFee, netPayout: potentialPayout - platformFee };
}

function parseActions(text: string): ChatAction[] {
  const actions: ChatAction[] = [];
  for (const match of text.matchAll(/\[STAKE\](\{[\s\S]*?\})\[\/STAKE\]/g)) {
    try {
      const raw = JSON.parse(match[1]);
      if (!raw.amount || !raw.podTitle) continue;
      const gains = raw.gainsMultiplier || 1.5;
      const math = computeStakeMath(raw.amount, gains);
      actions.push({
        type: 'confirm_stake',
        data: {
          podId: raw.podId || '',
          podTitle: raw.podTitle,
          selection: raw.selection || '',
          amount: raw.amount,
          gainsMultiplier: gains,
          potentialPayout: raw.potentialPayout || math.potentialPayout,
          platformFee: raw.platformFee || math.platformFee,
          netPayout: raw.netPayout || math.netPayout,
        }
      });
    } catch {
      // skip malformed block
    }
  }
  for (const match of text.matchAll(/\[ACCUM\](\{[\s\S]*?\})\[\/ACCUM\]/g)) {
    try {
      const raw = JSON.parse(match[1]);
      if (!Array.isArray(raw.legs) || raw.legs.length < 2 || !raw.stakeAmount) continue;
      const legs = raw.legs.map((l: any) => ({
        podId: l.podId || '',
        podTitle: l.podTitle || '',
        selection: l.selection || '',
        gainsMultiplier: l.gainsMultiplier || 1.5,
      }));
      if (legs.some((l: any) => !l.podId || !l.podTitle)) continue;
      const combined = legs.reduce((a: number, l: any) => a * l.gainsMultiplier, 1);
      actions.push({
        type: 'confirm_accumulator',
        data: {
          legs,
          stakeAmount: raw.stakeAmount,
          combinedMultiplier: raw.combinedMultiplier || combined,
          potentialPayout: raw.potentialPayout || Math.floor(raw.stakeAmount * combined),
          platformFee: raw.platformFee || Math.floor(Math.floor(raw.stakeAmount * combined) * 0.1),
          netPayout: raw.netPayout || Math.floor(raw.stakeAmount * combined) - (raw.platformFee || Math.floor(Math.floor(raw.stakeAmount * combined) * 0.1)),
        }
      });
    } catch {
      // skip malformed block
    }
  }
  return actions;
}

function stripActionTags(text: string): string {
  return text
    .replace(/\s*\[STAKE\]\{[\s\S]*?\}\[\/STAKE\]\s*/g, ' ')
    .replace(/\s*\[ACCUM\]\{[\s\S]*?\}\[\/ACCUM\]\s*/g, ' ')
    .trim();
}

/**
 * Fallback used when the DeepSeek endpoint is unreachable, misconfigured or
 * returns an error. Falls back to the local mock, and when a bet couldn't be
 * built (and it wasn't a pending-question or already-guided reply), tells the
 * user how to place the bet manually.
 */
async function fallbackResponse(messages: ChatMessage[], systemContext: string): Promise<ChatResult> {
  const mock = await mockOraResponse(messages, systemContext);
  const actions = parseActions(mock.content);
  let content = actions.length ? stripActionTags(mock.content) : mock.content;
  const last = messages[messages.length - 1]?.content || '';
  if (
    actions.length === 0 &&
    !content.includes('[PENDING]') &&
    !/Home feed/i.test(content) &&
    parseBetInstructions(last).length > 0
  ) {
    content += `\n\n⚠️ The AI betting service is temporarily unavailable, so I couldn't place that bet for you. No worries — you can still place it manually from the Home feed: tap "Place Stake" on any pod you like.`;
  }
  return { content, actions };
}

export async function chatWithOra(
  messages: ChatMessage[],
  userId?: string
): Promise<ChatResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  const systemPrompt: ChatMessage = {
    role: 'system',
    content: await buildSystemPrompt(userId)
  };

  if (!apiKey || apiKey === 'your_deepseek_api_key_here') {
    return fallbackResponse(messages, systemPrompt.content);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
          messages: [systemPrompt, ...messages],
          temperature: 0.7,
          max_tokens: 800
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('DeepSeek API error:', response.status, errorText);
      return fallbackResponse(messages, systemPrompt.content);
    }

    const data = await response.json();
    const rawContent = data.choices[0].message.content;
    const parsed = parseActions(rawContent);
    const actions = await finalizeActions(parsed);
    if (parsed.length > 0 && actions.length === 0) {
      // Every tag the AI emitted was dropped at finalize (missing/closed pods).
      // Rebuild from real live pods instead of showing an orphaned question.
      return fallbackResponse(messages, systemPrompt.content);
    }
    return {
      content: actions.length ? stripActionTags(rawContent) : rawContent,
      actions,
      usage: data.usage
    };
  } catch (err) {
    console.error('DeepSeek fetch failed:', err);
    return fallbackResponse(messages, systemPrompt.content);
  }
}

interface BetIntent {
  amount: number;
  teams: string[];
  count?: number;
  countClamped: boolean;
  winPick: boolean;
  each: boolean;
  mode: 'single' | 'accumulator';
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/\s/g, '');
  let amount = parseFloat(cleaned.replace(/,/g, ''));
  if (/k/i.test(cleaned)) amount *= 1000;
  return amount;
}

function parseBetInstructions(text: string): BetIntent[] {
  const parts = text.split(/\s*(?:,|;|\balso\b|\bthen\b)\s*/i).filter(p => p.trim().length > 0);
  const intents: BetIntent[] = [];
  for (const part of parts) {
    if ((part.match(/\bbet\b/gi) || []).length > 1 && /\band\s+bet\b/i.test(part)) {
      const sub = part.split(/\s*and\s+bet\s*/i);
      for (let i = 0; i < sub.length; i++) {
        const intent = parseSingleInstruction(i === 0 ? sub[i] : `bet ${sub[i]}`);
        if (intent) intents.push(intent);
      }
    } else {
      const intent = parseSingleInstruction(part);
      if (intent) intents.push(intent);
    }
  }
  return intents;
}

function parseSingleInstruction(text: string): BetIntent | null {
  const amountMatch = text.match(/(?:place|put|bet|stake|wager)\s+(?:a\s+)?(?:bet\s+)?(?:of\s+)?(?:₦|n|ngn)?\s*([\d,]+(?:\s*k)?)/i);
  if (!amountMatch) return null;
  const amount = parseAmount(amountMatch[1]);
  if (!amount || amount <= 0) return null;
  const after = text.slice((amountMatch.index || 0) + amountMatch[0].length);

  const each = /each|per\s*game|every\s*game/i.test(after);
  const winPick = /winning\s*game|the\s*winner|best\s*game\b/i.test(after);
  const pickCount = text.match(/pick\s+(\d+)\s*(?:best\s*)?games?\b/i);
  const onCount = after.match(/(\d+)\s*(?:best\s*)?games?\b/i);
  let count: number | undefined = pickCount ? parseInt(pickCount[1]) : onCount ? parseInt(onCount[1]) : undefined;
  let countClamped = false;
  if (winPick && count === undefined) count = 1;
  if (count !== undefined) {
    if (count > 5) {
      countClamped = true;
      count = 5;
    }
    if (count < 1) count = 1;
  }

  const teams = after
    .replace(/\b(?:each|per game|every game)\b/gi, ' ')
    .replace(/\b(?:winning game|the winner|best game)\b/gi, ' ')
    .replace(/(?:\d+\s*(?:best\s*)?games?)/gi, ' ')
    .replace(/^\s*(?:on|to win|for|in|with|at)\s*/i, '')
    .split(/\s+(?:and|vs|to win|to beat|winning)\s+/i)
    .map(s => s.trim().replace(/[?!.,]/g, ''))
    .filter(s => s.length >= 3 && !/^(game|games|win|wins|winner)$/i.test(s));

  const selectionCount = count !== undefined ? count : teams.length;
  const mode: 'single' | 'accumulator' = each ? 'single' : (selectionCount >= 2 ? 'accumulator' : 'single');
  return { amount, teams, count, countClamped, winPick, each, mode };
}

function podMatches(pod: any, teams: string[]): boolean {
  const haystack = `${pod.title || ''} ${pod.homeTeam || ''} ${pod.awayTeam || ''}`.toLowerCase();
  return teams.some(t => t.toLowerCase().split(/\s+/).some(word => word.length >= 3 && haystack.includes(word)));
}

async function queryLivePods(limit = 40): Promise<any[]> {
  return (await PodModel.find({ status: 'active', bookedExternally: false, opensAt: { $lte: new Date() }, stakingClosesAt: { $gte: new Date() } })
    .select('title homeTeam awayTeam selection gainsMultiplier minStake maxStake')
    .sort({ 'metadata.oraConfidence': -1 })
    .limit(limit)
    .lean()) as any[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Re-validates AI-generated actions against the real pods so the cards
 * always show real picks, ranges and payouts — never fabricated ones.
 */
async function finalizeActions(actions: ChatAction[]): Promise<ChatAction[]> {
  const out: ChatAction[] = [];
  for (const a of actions) {
    if (a.type === 'confirm_stake') {
      const f = await finalizeAction(a);
      if (f) out.push(f);
    } else {
      const f = await finalizeAccumulatorAction(a);
      if (f) out.push(f);
    }
  }
  return out;
}

/**
 * Mirrors the staking window checks used by the stake service (stake.service.ts),
 * so Ora never offers a pod the backend would refuse.
 */
function isStakable(p: any, now = new Date()): boolean {
  return (
    p.status === 'active' &&
    !p.bookedExternally &&
    (!p.opensAt || p.opensAt <= now) &&
    (!p.stakingClosesAt || p.stakingClosesAt >= now)
  );
}

async function finalizeAccumulatorAction(action: AccumulatorAction): Promise<AccumulatorAction | undefined> {
  try {
    const pods = await PodModel.find({ _id: { $in: action.data.legs.map(l => l.podId) } })
      .select('title homeTeam awayTeam selection gainsMultiplier minStake maxStake status opensAt stakingClosesAt bookedExternally')
      .lean();
    const byId = new Map((pods as any[]).map(p => [p._id.toString(), p]));
    const ordered = action.data.legs
      .map(l => byId.get(l.podId))
      .filter((p): p is any => !!p && isStakable(p));
    if (ordered.length < 2) return undefined;

    const seen = new Set<string>();
    const unique = ordered.filter(p => {
      const key = `${p.homeTeam || ''}|${p.awayTeam || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (unique.length < 2) return undefined;

    let legs = unique.map(p => ({
      podId: p._id.toString(),
      podTitle: p.title,
      selection: p.selection || '',
      gainsMultiplier: p.gainsMultiplier || 1.5,
    }));
    let combined = legs.reduce((a, l) => a * l.gainsMultiplier, 1);
    while (legs.length > 2 && combined > 50) {
      const idx = legs.reduce((maxI, l, i, arr) => l.gainsMultiplier > arr[maxI].gainsMultiplier ? i : maxI, 0);
      legs = legs.filter((_, i) => i !== idx);
      combined = legs.reduce((a, l) => a * l.gainsMultiplier, 1);
    }
    if (combined > 50) return undefined;

    const maxAmount = Math.min(5000, ...unique.map(p => p.maxStake || 100000));
    const stakeAmount = Math.min(Math.max(action.data.stakeAmount, 100), maxAmount);
    const math = computeStakeMath(stakeAmount, combined);
    return {
      type: 'confirm_accumulator',
      data: {
        legs,
        stakeAmount,
        combinedMultiplier: combined,
        potentialPayout: math.potentialPayout,
        platformFee: math.platformFee,
        netPayout: math.netPayout,
      },
    };
  } catch {
    return undefined;
  }
}

async function finalizeAction(action: StakeAction): Promise<StakeAction | undefined> {
  try {
    let pod: any = null;
    if (action.data.podId) {
      pod = await PodModel.findById(action.data.podId)
        .select('title selection gainsMultiplier minStake maxStake maxPayout status opensAt stakingClosesAt bookedExternally')
        .lean();
    } else {
      pod = await PodModel.findOne({ title: new RegExp(`^${escapeRegExp(action.data.podTitle)}$`, 'i') })
        .select('title selection gainsMultiplier minStake maxStake maxPayout status opensAt stakingClosesAt bookedExternally')
        .lean();
    }
    if (!pod || !isStakable(pod)) return undefined;

    const gains = pod.gainsMultiplier || 1.5;
    let amount = Math.min(Math.max(action.data.amount, pod.minStake || 1000), pod.maxStake || 100000);
    const maxByPayout = pod.maxPayout ? Math.floor(pod.maxPayout / gains) : Infinity;
    if (amount > maxByPayout) amount = maxByPayout;
    const math = computeStakeMath(amount, gains);
    return {
      type: 'confirm_stake',
      data: {
        podId: pod._id.toString(),
        podTitle: pod.title,
        selection: pod.selection || action.data.selection || '',
        amount,
        gainsMultiplier: gains,
        potentialPayout: math.potentialPayout,
        platformFee: math.platformFee,
        netPayout: math.netPayout,
      },
    };
  } catch {
    return undefined;
  }
}

function stripPendingTag(text: string): string {
  return text.replace(/\s*\[PENDING\]\{[\s\S]*?\}\[\/PENDING\]\s*/g, ' ').trim();
}

function userSideForPod(teams: string[], pod: any): 'home' | 'away' | 'unknown' {
  const home = `${pod.homeTeam || ''}`.toLowerCase();
  const away = `${pod.awayTeam || ''}`.toLowerCase();
  const words = teams.flatMap(t => t.toLowerCase().split(/\s+/));
  const hitHome = words.some(w => w.length >= 3 && home.includes(w));
  const hitAway = words.some(w => w.length >= 3 && away.includes(w));
  if (hitHome && hitAway) return 'unknown';
  if (hitHome) return 'home';
  if (hitAway) return 'away';
  return 'unknown';
}

function podPickSide(pod: any): { side: 'home' | 'away' | 'other'; label: string } {
  const sel = `${pod.selection || ''}`.trim();
  const home = `${pod.homeTeam || ''}`.toLowerCase();
  const away = `${pod.awayTeam || ''}`.toLowerCase();
  const selLower = sel.toLowerCase();
  if (selLower && home && away) {
    if (home.includes(selLower) || selLower.includes(home)) return { side: 'home', label: sel };
    if (away.includes(selLower) || selLower.includes(away)) return { side: 'away', label: sel };
    if (/home win/i.test(selLower)) return { side: 'home', label: sel };
    if (/away win/i.test(selLower)) return { side: 'away', label: sel };
  }
  return { side: 'other', label: sel || 'the pod pick' };
}

function buildStakeCard(pod: any, amount: number, intro?: string): { content: string } {
  const requested = amount;
  amount = Math.min(Math.max(amount, pod.minStake || 1000), pod.maxStake || 100000);
  const gains = pod.gainsMultiplier || 1.5;
  const maxByPayout = pod.maxPayout ? Math.floor(pod.maxPayout / gains) : Infinity;
  if (amount > maxByPayout) amount = maxByPayout;
  const math = computeStakeMath(amount, gains);
  const pick = podPickSide(pod);
  const tag = JSON.stringify({
    podId: pod._id.toString(),
    podTitle: pod.title,
    selection: pick.side === 'other' ? '' : pick.label,
    amount,
    gainsMultiplier: gains,
    potentialPayout: math.potentialPayout,
    platformFee: math.platformFee,
    netPayout: math.netPayout,
  });
  const clampedNotes: string[] = [];
  if (requested < (pod.minStake || 1000)) clampedNotes.push(`minimum stake on this pod is ₦${(pod.minStake || 1000).toLocaleString()}`);
  if (requested > (pod.maxStake || 100000)) clampedNotes.push(`maximum stake on this pod is ₦${(pod.maxStake || 100000).toLocaleString()}`);
  if (pod.maxPayout && math.potentialPayout > pod.maxPayout) clampedNotes.push(`maximum payout on this pod is ₦${pod.maxPayout.toLocaleString()}`);
  const note = clampedNotes.length ? ` Heads-up — the ${clampedNotes.join(' and ')}, so I set it to ₦${amount.toLocaleString()}.` : '';
  return {
    content: `${intro || ''}You want to stake ₦${amount.toLocaleString()} on "${pod.title}" — pick: ${pick.label} at ${gains}x.${note} Confirm below to place it. [STAKE]${tag}[/STAKE]`,
  };
}

function buildPickMismatchMessage(pod: any, amount: number, pick: { side: string; label: string }): { content: string } {
  const gains = pod.gainsMultiplier || 1.5;
  return {
    content: `⚠️ Heads-up — that pod's pick is fixed as ${pick.label} (${gains}x), so I can't stake on the team you named. Want me to stake ₦${amount.toLocaleString()} on "${pod.title}" — ${pick.label}? Reply "yes" to confirm.`,
  };
}

function buildAccumulatorCard(pods: any[], amount: number, extraNote?: string): { content: string } | null {
  let legs = pods.map(p => {
    const pick = podPickSide(p);
    return {
      podId: p._id.toString(),
      podTitle: p.title,
      selection: pick.side === 'other' ? '' : pick.label,
      gainsMultiplier: p.gainsMultiplier || 1.5,
    };
  });
  let combined = legs.reduce((a, l) => a * l.gainsMultiplier, 1);
  const droppedCount = (() => {
    let count = 0;
    while (legs.length > 2 && combined > 50) {
      const idx = legs.reduce((maxI, l, i, arr) => l.gainsMultiplier > arr[maxI].gainsMultiplier ? i : maxI, 0);
      legs = legs.filter((_, i) => i !== idx);
      combined = legs.reduce((a, l) => a * l.gainsMultiplier, 1);
      count++;
    }
    return count;
  })();
  if (legs.length < 2 || combined > 50) return null;

  const requestedAmount = amount;
  const maxAmount = Math.min(5000, ...pods.map(p => p.maxStake || 100000));
  amount = Math.min(Math.max(amount, 100), maxAmount);
  const math = computeStakeMath(amount, combined);
  const tag = JSON.stringify({
    legs,
    stakeAmount: amount,
    combinedMultiplier: combined,
    potentialPayout: math.potentialPayout,
    platformFee: math.platformFee,
    netPayout: math.netPayout,
  });

  const notes: string[] = [];
  if (droppedCount > 0) notes.push(`I dropped ${droppedCount} ${droppedCount === 1 ? 'leg' : 'legs'} to keep the combined odds at or below 50x`);
  if (extraNote) notes.push(extraNote);
  if (amount > requestedAmount) notes.push(`the minimum accumulator stake is ₦100, so I set it to ₦100`);
  if (amount < requestedAmount) notes.push(`the maximum accumulator stake is ₦${maxAmount.toLocaleString()}, so I set it to ₦${amount.toLocaleString()}`);
  const note = notes.length ? ` ${notes.join('. ')}.` : '';

  const legLines = legs.map((l, i) => `${i + 1}) "${l.podTitle}" — ${l.selection || 'the pod pick'} at ${l.gainsMultiplier}x`).join('\n');
  return {
    content: `You want to stake ₦${amount.toLocaleString()} on a ${legs.length}-game accumulator:\n${legLines}\nCombined odds: ${combined.toFixed(2)}x.${note} Confirm below to place it. [ACCUM]${tag}[/ACCUM]`,
  };
}

interface BetBuildResult {
  cards: { content: string }[];
  pending?: { content: string };
}

async function buildBetFromIntent(intent: BetIntent, pods: any[], skipAlignment = false): Promise<BetBuildResult> {
  const cards: { content: string }[] = [];
  let selected: any[] = [];

  if (intent.teams.length > 0) {
    const ordered: any[] = [];
    const missing: string[] = [];
    for (const team of intent.teams) {
      const pod = pods.find(p => podMatches(p, [team]) && !ordered.includes(p));
      if (pod) ordered.push(pod);
      else missing.push(team);
    }
    if (ordered.length === 0) {
      return { cards: [], pending: { content: `Hmm, I couldn't find a live pod for ${missing.join(', ')}. Check the Home feed for open pods and tell me which ones you'd like!` } };
    }
    selected = ordered;
  } else {
    selected = pods.slice(0, intent.count ?? 1);
  }
  if (selected.length === 0) return { cards };

  if (!skipAlignment && intent.teams.length > 0) {
    for (const pod of selected) {
      const side = userSideForPod(intent.teams, pod);
      const pick = podPickSide(pod);
      if (side !== 'unknown' && pick.side !== 'other' && side !== pick.side) {
        return { cards: [], pending: buildPickMismatchMessage(pod, intent.amount, pick) };
      }
    }
  }

  const intro = intent.winPick ? "I've picked the strongest game for you — " : undefined;

  if (intent.each) {
    for (const pod of selected) {
      cards.push(buildStakeCard(pod, intent.amount, intro));
    }
    return { cards };
  }

  if (intent.mode === 'accumulator' && selected.length >= 2) {
    const card = buildAccumulatorCard(selected, intent.amount, intent.countClamped ? 'Accumulators take up to 5 games, so I used the 5 best.' : undefined);
    if (card) cards.push(card);
    return { cards };
  }

  cards.push(buildStakeCard(selected[0], intent.amount, intro));
  return { cards };
}

function isAffirmation(text: string): boolean {
  const t = text.trim().toLowerCase();
  return ['yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'confirm', 'do it', 'go ahead', 'yes please'].includes(t);
}

async function buildCardsFromPending(messages: ChatMessage[]): Promise<{ content: string } | null> {
  const history = [...messages].reverse();
  for (let i = 0; i < history.length - 1; i++) {
    if (history[i].role !== 'user' || !isAffirmation(history[i].content)) continue;
    const pending = history[i + 1].content.match(/\[PENDING\](\{[\s\S]*?\})\[\/PENDING\]/);
    if (!pending) continue;
    try {
      const raw = JSON.parse(pending[1]);
      if (Array.isArray(raw.intents) && raw.intents.length > 0) {
        const pods = await queryLivePods(40);
        const cards: { content: string }[] = [];
        for (const intent of raw.intents) {
          const r = await buildBetFromIntent(intent, pods, true);
          cards.push(...r.cards);
        }
        if (cards.length === 0) return null;
        return { content: cards.map(c => c.content).join('\n\n') };
      }
      if (raw.podId) {
        const pod = await PodModel.findById(raw.podId)
          .select('title homeTeam awayTeam selection gainsMultiplier minStake maxStake')
          .lean();
        if (!pod) return null;
        const amount = Math.min(Math.max(raw.amount || (pod.minStake || 1000), pod.minStake || 1000), pod.maxStake || 100000);
        return buildStakeCard(pod, amount);
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

async function mockOraResponse(messages: ChatMessage[], systemContext?: string): Promise<{ content: string }> {
  const lastMessage = messages[messages.length - 1]?.content?.toLowerCase() || '';

  // Affirmation of a pending pick-confirmation question → emit the real stake cards
  if (isAffirmation(lastMessage)) {
    const cards = await buildCardsFromPending(messages);
    if (cards) return cards;
  }

  // Bet placement intent → build real [STAKE] / [ACCUM] action cards from live pods
  const intents = parseBetInstructions(lastMessage);
  if (intents.length > 0) {
    try {
      const pods = await queryLivePods(40);
      const cards: { content: string }[] = [];
      for (const intent of intents) {
        const r = await buildBetFromIntent(intent, pods);
        if (r.pending) {
          const tag = JSON.stringify({ intents });
          return { content: `${r.pending.content} [PENDING]${tag}[/PENDING]` };
        }
        cards.push(...r.cards);
      }
      if (cards.length === 0) {
        return { content: 'Hmm, I couldn\'t find live pods for that right now. Check the Home feed for open pods and tell me which ones you\'d like!' };
      }
      return { content: cards.map(c => c.content).join('\n\n') };
    } catch (err) {
      console.error('Mock stake lookup failed:', err);
    }
  }

  if (lastMessage.includes('balance') || lastMessage.includes('how much') || (lastMessage.includes('wallet') && (lastMessage.includes('balance') || lastMessage.includes('money') || lastMessage.includes('have')))) {
    if (systemContext) {
      const balanceMatch = systemContext.match(/Wallet balance: (₦[\d,]+)/);
      const availableMatch = systemContext.match(/Available balance: (₦[\d,]+)/);
      if (balanceMatch) {
        const available = availableMatch ? ` You've got ${availableMatch[1]} available to use.` : '';
        return { content: `Your balance is ${balanceMatch[1]}.${available} Check the Wallet page for details.` };
      }
    }
    return { content: "Your balance shows at the top of the Wallet page. Pop over there to see the full breakdown 👍" };
  }
  if (lastMessage.includes('active') && (lastMessage.includes('stake') || lastMessage.includes('bet'))) {
    if (systemContext) {
      const match = systemContext.match(/Active stakes count: (\d+)/);
      if (match) return { content: `You've got ${match[1]} active ${parseInt(match[1]) === 1 ? 'one' : 'ones'} right now. Check the Bets page for details.` };
    }
    return { content: "Your active bets are on the Bets page. You can see your pods and cashout options there." };
  }
  if (lastMessage.includes('hello') || lastMessage.includes('hi') || lastMessage.includes('hey')) {
    return { content: "Hey! 👋 I'm Ora. What can I help you with?" };
  }
  if (lastMessage.includes('kyc') || lastMessage.includes('verify') || (lastMessage.includes('account') && lastMessage.includes('limit'))) {
    return { content: "KYC helps unlock higher withdrawal limits. Submit your BVN or NIN from Profile → Security & PIN. Once verified, you'll get access to bigger withdrawals." };
  }
  if (lastMessage.includes('bet') || lastMessage.includes('stake') || lastMessage.includes('pod') || lastMessage.includes('how')) {
    return { content: "Simple! Browse pods on the Home page, pick one, and place a stake. If the pod wins, you get your stake + gains. If it loses, you get your stake back — no loss. Head to the Home page to see what's available!" };
  }
  if (lastMessage.includes('deposit') || lastMessage.includes('fund') || lastMessage.includes('add money')) {
    return { content: "Go to Wallet → Top Up. Pick an amount (₦500 to ₦500k) and pay via Paystack. Instant, zero fees. Easy!" };
  }
  if (lastMessage.includes('withdraw') || lastMessage.includes('bank')) {
    return { content: "Wallet → Withdraw. Choose your bank, enter account number, and your PIN. Min ₦500, takes 1-2 business days. Higher limits if KYC is done." };
  }
  if (lastMessage.includes('cashout') || lastMessage.includes('early')) {
    return { content: "You can cash out early from the Bets page. There's a 10% fee, so you get 90% of your stake back instantly. Tap Cashout on any eligible bet." };
  }
  if (lastMessage.includes('refer') || lastMessage.includes('invite') || lastMessage.includes('share')) {
    return { content: "Share your referral code from the Profile page. When friends sign up and bet, you earn bonuses. The more you refer, the more you earn!" };
  }
  if (lastMessage.includes('thank')) {
    return { content: "Anytime! 😊 Happy betting!" };
  }
  if (lastMessage.includes('bet manager') || lastMessage.includes('betmanager')) {
    return { content: "Bet Manager is like an investment fund — Ora AI bets for you. Choose Defender (conservative), Midfielder (balanced), or Striker (aggressive). 30-day lock, 20% fee only on profit." };
  }
  if (lastMessage.includes('match pool') || lastMessage.includes('matchpool')) {
    return { content: "Match Pools are shared prize pools. Bet on an outcome, and if it wins you share the pool with others. No refund if you lose though — winners split everything." };
  }

  return { content: "Hi! I'm Ora. I can help with betting, deposits, withdrawals, KYC, referrals, Bet Manager, and more. What do you need?" };
}

