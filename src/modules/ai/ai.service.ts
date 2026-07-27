import { UserModel } from '../../models/user.model';
import { WalletModel } from '../../models/wallet.model';
import { StakeModel } from '../../models/stake.model';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

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

  return `You are Ora, the friendly AI assistant for BetPool — a sports betting platform. Your name is Ora and you were created by the BetPool team.

${BETPOOL_KNOWLEDGE}${userContext}

Additional guidelines — VERY IMPORTANT:
- Respond like a real human in a chat conversation. Keep it SHORT, casual, and natural — like texting a friend.
- Use simple everyday language. Be friendly but not robotic. A little personality is good.
- Use emojis sparingly (one per message max) — 👍😊✅🎉
- When answering questions, give the essential info in 1-3 sentences. No long paragraphs.
- If someone asks about their balance, stakes, or personal data, use the Current User Data section to answer directly.
- If you don't have the specific data they need, just tell them which page to check in the app.
- Never share sensitive info like full phone numbers or transaction references.
- If asked about something outside BetPool, gently steer them back to BetPool topics.`;
}

export async function chatWithOra(
  messages: ChatMessage[],
  userId?: string
): Promise<{ content: string; usage?: any }> {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  const systemPrompt: ChatMessage = {
    role: 'system',
    content: await buildSystemPrompt(userId)
  };

  if (!apiKey || apiKey === 'your_deepseek_api_key_here') {
    return mockOraResponse(messages, systemPrompt.content);
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
          max_tokens: 500
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('DeepSeek API error:', response.status, errorText);
      return mockOraResponse(messages, systemPrompt.content);
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      usage: data.usage
    };
  } catch (err) {
    console.error('DeepSeek fetch failed:', err);
    return mockOraResponse(messages, systemPrompt.content);
  }
}

function mockOraResponse(messages: ChatMessage[], systemContext?: string): { content: string } {
  const lastMessage = messages[messages.length - 1]?.content?.toLowerCase() || '';

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

