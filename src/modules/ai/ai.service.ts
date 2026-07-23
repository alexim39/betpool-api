import { UserModel } from '../../models/user.model';
import { WalletModel } from '../../models/wallet.model';
import { StakeModel } from '../../models/stake.model';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const BETPOOL_KNOWLEDGE = `## About BetPool

BetPool is a betting intermediary platform that uses deep knowledge, AI, and long professional betting experience of humans to pick and list pods.

## How BetPool Works

**The Core Mechanic:**
BetPool is a betting intermediary. Users stake money on admin-curated "Pods" within the BetPool app. Each Pod bundles one or more underlying sporting events (football matches, basketball games, etc.) into a single betting unit with a fixed gains multiplier.

When a user stakes on a Pod:
- **If the Pod wins**, they get their stake back plus (stake × gains multiplier). BetPool takes a 30% cut of the gains.
- **If the Pod loses**, they get their full stake refunded. BetPool absorbs the loss.

BetPool pools all user stakes on a Pod and places one consolidated external bet. If that external bet wins, BetPool credits users. If it loses, BetPool's reserves cover the refund.

**Two timers per Pod:**
- A staking countdown (when you can no longer enter new bets)
- A settlement estimate (when you get your result and payout/refund)

**Early cashout:** Available but BetPool charges a 10% fee on your stake (you get 90% back).

**Business Model:**
- Revenue: (1) 30% commission on winning payouts, (2) 10% fee on early cashouts
- Risk: BetPool loses money when a Pod doesn't win — it refunds the full stake from reserves

**Key Features:**
- Users deposit via Paystack (instant, zero fees)
- Withdrawals go to Nigerian bank accounts (1-2 business days)
- KYC (BVN/NIN) unlocks higher withdrawal limits
- Referral codes to earn bonuses when friends join
- Each user has a 4-digit PIN for transaction authorization`;

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

Additional guidelines:
- Keep responses concise, helpful, and friendly. Use a warm but professional tone.
- When asked about the user's personal data (balance, stakes, etc.), use the Current User Data section above to answer accurately.
- If you don't have specific user data (e.g., they ask about a specific transaction), guide them to the relevant page in the app.
- Never share sensitive information like full phone numbers or transaction references.
- If asked about something outside BetPool, politely redirect to BetPool-related topics.`;
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
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
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
        return { content: `Your current wallet balance is ${balanceMatch[1]}. ${availableMatch ? `You have ${availableMatch[1]} available to use.` : ''} You can see all your transactions in the Wallet page.` };
      }
    }
    return { content: "Your wallet balance is displayed at the top of the Wallet page and in the navigation bar. Head over to the Wallet section to see your full balance, locked stakes, and transaction history!" };
  }
  if (lastMessage.includes('active') && (lastMessage.includes('stake') || lastMessage.includes('bet'))) {
    if (systemContext) {
      const match = systemContext.match(/Active stakes count: (\d+)/);
      if (match) return { content: `You currently have ${match[1]} active ${parseInt(match[1]) === 1 ? 'stake' : 'stakes'}. You can view them on the Bets page.` };
    }
    return { content: "Your active stakes are shown on the Bets page. You can see which pods you're currently in and check on cashout options there." };
  }
  if (lastMessage.includes('hello') || lastMessage.includes('hi') || lastMessage.includes('hey')) {
    return { content: "Hey there! 👋 I'm Ora, your BetPool assistant. How can I help you today?" };
  }
  if (lastMessage.includes('kyc') || lastMessage.includes('verify') || (lastMessage.includes('account') && lastMessage.includes('limit'))) {
    return { content: "KYC (Know Your Customer) verification helps secure your account and unlock higher withdrawal limits. On BetPool, you can submit your BVN or NIN from your Profile page under Security & PIN. Once verified, you'll have access to higher daily withdrawal limits!" };
  }
  if (lastMessage.includes('bet') || lastMessage.includes('stake') || lastMessage.includes('pod') || lastMessage.includes('how')) {
    return { content: "Great question! On BetPool, you browse available 'pods' (betting pools) on the Home page. Each pod has a fixed gains multiplier. Pick one, place a stake, and if the pod wins you get your stake back plus gains (minus BetPool's 30% commission). If it loses, you get your full stake refunded — no loss! Head to the Home page to see active pods!" };
  }
  if (lastMessage.includes('deposit') || lastMessage.includes('fund') || lastMessage.includes('add money')) {
    return { content: "Depositing is easy! Go to the Wallet page and tap 'Top Up'. You can deposit any amount from ₦500 to ₦500,000 instantly via Paystack with zero fees. Funds are credited to your wallet immediately." };
  }
  if (lastMessage.includes('withdraw') || lastMessage.includes('bank')) {
    return { content: "Withdrawals are processed to your Nigerian bank account. Go to the Wallet page, select Withdraw, enter the amount and your bank details. Withdrawals typically take 1-2 business days to reflect. There's a minimum withdrawal of ₦500 and higher limits if your KYC is verified." };
  }
  if (lastMessage.includes('cashout') || lastMessage.includes('early')) {
    return { content: "Early cashout lets you get your stake back before a pod settles, but there's a 10% fee. So if you staked ₦5,000, you'd get ₦4,500 back. You can check cashout options on your active stakes in the Bets page." };
  }
  if (lastMessage.includes('refer') || lastMessage.includes('invite') || lastMessage.includes('share')) {
    return { content: "Refer friends to BetPool using your unique referral code! You can find it on your Profile page. Share your code or referral link, and when friends sign up and bet, you earn bonuses. Keep sharing to earn more!" };
  }
  if (lastMessage.includes('thank')) {
    return { content: "You're welcome! 😊 If you ever need anything else, I'm just a message away. Happy betting with BetPool!" };
  }

  return { content: "Hi! I'm Ora, your BetPool AI assistant. I can help you with understanding how BetPool works, your wallet and balance, placing bets, withdrawals, KYC verification, referrals, and more. What would you like to know?" };
}

