import { sendEmail, wrapEmail, brandedButton } from './email.service';
import { sendSms } from './sms.service';
import { UserModel } from '../models/user.model';
import Notification from '../models/notification.model';
import { logger } from './logger.service';

// --- In-App Notification ---
export async function createInAppNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  data?: Record<string, any>
) {
  try {
    await Notification.create({ user: userId, type, title, message, data });
  } catch (err) {
    logger.error('Failed to create in-app notification', err);
  }
}

// --- Email + SMS helpers ---
async function getUser(userId: string) {
  return UserModel.findById(userId).select('email phone fullName');
}

async function sendEmailIfConfigured(to: string, subject: string, html: string) {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) {
    logger.debug('Email skipped - SMTP not configured', { subject, to });
    return;
  }
  try {
    await sendEmail(to, subject, html);
  } catch (err) {
    logger.error('Failed to send email', { subject, to, error: err });
  }
}

async function sendSmsIfConfigured(to: string, message: string) {
  if (!process.env.BULKSMS_API_TOKEN) {
    logger.debug('SMS skipped - not configured', { to });
    return;
  }
  try {
    await sendSms(to, message);
  } catch (err) {
    logger.error('Failed to send SMS', { to, error: err });
  }
}

// ========================
// AUTH / ACCOUNT
// ========================

export async function notifyWelcome(userId: string) {
  const user = await getUser(userId);
  if (!user?.email) return;
  const html = wrapEmail(
    'Welcome to BetPool!',
    `
    <p>Hi ${user.fullName || 'there'},</p>
    <p>Welcome to <strong>BetPool</strong> — your ultimate sports betting platform!</p>
    <p>Here's what you can do right now:</p>
    <ul>
      <li>Browse active betting pools (pods) on the Home page</li>
      <li>Deposit funds instantly via Paystack</li>
      <li>Place your first stake and win real payouts</li>
    </ul>
    <p>Start exploring and good luck!</p>
    `,
    'Welcome to BetPool'
  );
  await sendEmailIfConfigured(user.email, 'Welcome to BetPool!', html);
  await createInAppNotification(userId, 'auth', 'Welcome to BetPool!', 'Your account is ready. Start betting today!');
}

export async function notifyPinChanged(userId: string) {
  const user = await getUser(userId);
  const message = 'Your BetPool PIN was changed successfully. If you did not request this, contact support immediately.';
  await createInAppNotification(userId, 'auth', 'PIN Changed', message);
  if (user?.email) {
    const html = wrapEmail('PIN Changed', `<p>Hi ${user.fullName || 'there'},</p><p>${message}</p>`);
    await sendEmailIfConfigured(user.email, 'BetPool PIN Changed', html);
  }
  if (user?.phone) {
    await sendSmsIfConfigured(user.phone, `BetPool: Your PIN was changed. If you didn't do this, contact support.`);
  }
}

export async function notifyKycApproved(userId: string) {
  const user = await getUser(userId);
  const message = 'Your KYC verification has been approved! You now have higher withdrawal limits.';
  await createInAppNotification(userId, 'kyc', 'KYC Approved', message);
  if (user?.email) {
    const html = wrapEmail('KYC Verified', `<p>Hi ${user.fullName || 'there'},</p><p>${message}</p>`);
    await sendEmailIfConfigured(user.email, 'KYC Verification Approved', html);
  }
}

export async function notifyKycRejected(userId: string, reason: string) {
  const user = await getUser(userId);
  const message = `Your KYC verification was not approved. Reason: ${reason}. Please resubmit with correct details.`;
  await createInAppNotification(userId, 'kyc', 'KYC Update', message);
  if (user?.email) {
    const html = wrapEmail('KYC Update', `<p>Hi ${user.fullName || 'there'},</p><p>${message}</p>`);
    await sendEmailIfConfigured(user.email, 'KYC Verification Update', html);
  }
}

// ========================
// WALLET — DEPOSITS
// ========================

export async function notifyDepositSuccess(userId: string, amount: number, reference: string) {
  const user = await getUser(userId);
  const formatted = '₦' + amount.toLocaleString('en-US');
  const message = `Deposit of ${formatted} was successful! Ref: ${reference}`;
  
  await createInAppNotification(userId, 'deposit', 'Deposit Received', `💵 ${formatted} credited to your wallet.`, { amount, reference });
  
  if (user?.email) {
    const html = wrapEmail(
      'Deposit Successful',
      `<p>Hi ${user.fullName || 'there'},</p>
      <p>Your deposit of <strong>${formatted}</strong> has been credited to your BetPool wallet.</p>
      <p>Reference: ${reference}</p>
      <p>Start staking and winning!</p>`,
      `${formatted} deposited`
    );
    await sendEmailIfConfigured(user.email, `Deposit Successful — ${formatted}`, html);
  }
  if (user?.phone) {
    await sendSmsIfConfigured(user.phone, `BetPool: ${formatted} deposited successfully. Ref: ${reference}. Stake now!`);
  }
}

export async function notifyDepositFailed(userId: string, amount: number, reason: string) {
  const user = await getUser(userId);
  const formatted = '₦' + amount.toLocaleString('en-US');
  const message = `Deposit of ${formatted} failed. ${reason}`;
  await createInAppNotification(userId, 'deposit', 'Deposit Failed', message, { amount, reason });
  if (user?.email) {
    const html = wrapEmail('Deposit Failed', `<p>Hi ${user.fullName || 'there'},</p><p>${message}</p><p>Please try again or contact support.</p>`);
    await sendEmailIfConfigured(user.email, 'Deposit Failed', html);
  }
}

// ========================
// WALLET — WITHDRAWALS
// ========================

export async function notifyWithdrawalSubmitted(userId: string, amount: number, accountInfo: string) {
  const user = await getUser(userId);
  const formatted = '₦' + amount.toLocaleString('en-US');
  const message = `Withdrawal of ${formatted} to ${accountInfo} is being processed.`;
  await createInAppNotification(userId, 'withdrawal', 'Withdrawal Submitted', message, { amount, accountInfo });
  if (user?.email) {
    const html = wrapEmail('Withdrawal Submitted', `<p>Hi ${user.fullName || 'there'},</p><p>${message}</p><p>You'll receive a confirmation once completed.</p>`);
    await sendEmailIfConfigured(user.email, `Withdrawal Submitted — ${formatted}`, html);
  }
}

export async function notifyWithdrawalCompleted(userId: string, amount: number, accountInfo: string) {
  const user = await getUser(userId);
  const formatted = '₦' + amount.toLocaleString('en-US');
  const message = `Withdrawal of ${formatted} to ${accountInfo} has been completed!`;
  await createInAppNotification(userId, 'withdrawal', 'Withdrawal Completed', `✅ ${formatted} sent to your bank.`, { amount, accountInfo });
  if (user?.email) {
    const html = wrapEmail(
      'Withdrawal Successful',
      `<p>Hi ${user.fullName || 'there'},</p>
      <p>Your withdrawal of <strong>${formatted}</strong> has been sent to your bank account.</p>
      <p>${accountInfo}</p>
      <p>It may take 1-2 business days to reflect in your account.</p>`,
      `${formatted} withdrawn`
    );
    await sendEmailIfConfigured(user.email, `Withdrawal Completed — ${formatted}`, html);
  }
  if (user?.phone) {
    await sendSmsIfConfigured(user.phone, `BetPool: ${formatted} sent to your bank (${accountInfo}). May take 1-2 business days.`);
  }
}

export async function notifyWithdrawalFailed(userId: string, amount: number, reason: string) {
  const user = await getUser(userId);
  const formatted = '₦' + amount.toLocaleString('en-US');
  const message = `Withdrawal of ${formatted} failed. ${reason}. The amount has been refunded to your wallet.`;
  await createInAppNotification(userId, 'withdrawal', 'Withdrawal Failed', message, { amount, reason });
  if (user?.email) {
    const html = wrapEmail('Withdrawal Failed', `<p>Hi ${user.fullName || 'there'},</p><p>${message}</p><p>Please update your bank details and try again.</p>`);
    await sendEmailIfConfigured(user.email, 'Withdrawal Failed', html);
  }
  if (user?.phone) {
    await sendSmsIfConfigured(user.phone, `BetPool: Withdrawal of ${formatted} failed. ${reason.substring(0, 60)}. Funds refunded.`);
  }
}

// ========================
// STAKES
// ========================

export async function notifyStakePlaced(userId: string, podTitle: string, amount: number, potentialPayout: number) {
  const user = await getUser(userId);
  const formatted = '₦' + amount.toLocaleString('en-US');
  const formattedPayout = '₦' + potentialPayout.toLocaleString('en-US');
  const message = `Stake of ${formatted} placed on "${podTitle}". Potential payout: ${formattedPayout}`;
  await createInAppNotification(userId, 'stake', 'Stake Placed', `🎯 ${formatted} on "${podTitle}"`, { podTitle, amount, potentialPayout });
  if (user?.email) {
    const html = wrapEmail(
      'Stake Confirmed',
      `<p>Hi ${user.fullName || 'there'},</p>
      <p>Your stake has been placed!</p>
      <ul>
        <li><strong>Pod:</strong> ${podTitle}</li>
        <li><strong>Stake:</strong> ${formatted}</li>
        <li><strong>Potential Payout:</strong> ${formattedPayout}</li>
      </ul>
      <p>Good luck! 🍀</p>`,
      `${formatted} staked`
    );
    await sendEmailIfConfigured(user.email, `Stake Placed — ${formatted} on "${podTitle}"`, html);
  }
}

export async function notifyStakeWon(userId: string, podTitle: string, payout: number) {
  const user = await getUser(userId);
  const formatted = '₦' + payout.toLocaleString('en-US');
  const message = `You won ${formatted} on "${podTitle}"! Payout credited to your wallet.`;
  await createInAppNotification(userId, 'payout', 'Bet Won! 🎉', `🏆 ${formatted} credited from "${podTitle}"`, { podTitle, payout });
  if (user?.email) {
    const html = wrapEmail(
      'You Won! 🎉',
      `<p>Congratulations ${user.fullName || 'there'}!</p>
      <p>Your bet on <strong>"${podTitle}"</strong> won!</p>
      <p><strong>${formatted}</strong> has been credited to your wallet.</p>
      ${brandedButton('Keep Staking', process.env.FRONTEND_URL || '')}`,
      `${formatted} won!`
    );
    await sendEmailIfConfigured(user.email, `You Won! ${formatted} Credited`, html);
  }
  if (user?.phone) {
    await sendSmsIfConfigured(user.phone, `BetPool: Congratulations! You won ${formatted} on "${podTitle}". Login to see your updated balance.`);
  }
}

export async function notifyStakeLost(userId: string, podTitle: string, amount: number) {
  const user = await getUser(userId);
  const formatted = '₦' + amount.toLocaleString('en-US');
  const message = `Your bet on "${podTitle}" did not win. ${formatted} has been settled.`;
  await createInAppNotification(userId, 'stake', 'Bet Settled', `❌ "${podTitle}" — ${formatted}`, { podTitle, amount });
  if (user?.email) {
    const html = wrapEmail('Bet Result', `<p>Hi ${user.fullName || 'there'},</p><p>${message}</p><p>Try again — there are always more pods to play!</p>`);
    await sendEmailIfConfigured(user.email, `Bet Result — "${podTitle}"`, html);
  }
}

export async function notifyStakeCashedOut(userId: string, podTitle: string, cashoutAmount: number) {
  const user = await getUser(userId);
  const formatted = '₦' + cashoutAmount.toLocaleString('en-US');
  const message = `You cashed out ${formatted} from "${podTitle}".`;
  await createInAppNotification(userId, 'stake', 'Cashout Received', `💰 ${formatted} from "${podTitle}"`, { podTitle, cashoutAmount });
  if (user?.email) {
    const html = wrapEmail('Cashout Successful', `<p>Hi ${user.fullName || 'there'},</p><p>${message}</p><p>${formatted} has been credited to your wallet.</p>`);
    await sendEmailIfConfigured(user.email, `Cashout — ${formatted} Received`, html);
  }
}

// ========================
// REFERRAL
// ========================

export async function notifyReferralUsed(userId: string, referredName: string) {
  const user = await getUser(userId);
  const message = `${referredName} signed up using your referral code!`;
  await createInAppNotification(userId, 'referral', 'Referral Used', `🎉 ${message}`, { referredName });
  if (user?.email) {
    const html = wrapEmail('Referral Used', `<p>Hi ${user.fullName || 'there'},</p><p>${message}</p><p>Keep sharing your code to earn more!</p>`);
    await sendEmailIfConfigured(user.email, 'Someone Used Your Referral Code!', html);
  }
}
