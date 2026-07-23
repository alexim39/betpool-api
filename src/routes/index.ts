import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { authController } from '../controllers/auth.controller';
import { adminController } from '../controllers/admin.controller';
import { podController } from '../controllers/pod.controller';
import { podSyncController } from '../controllers/pod-sync.controller';
import { stakeController } from '../controllers/stake.controller';
import { walletController } from '../controllers/wallet.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { chat } from '../controllers/ai.controller';
import { aiCurationController } from '../controllers/ai-curation.controller';
import { aiSettlementController } from '../controllers/ai-settlement.controller';
import { aiKycController } from '../controllers/ai-kyc.controller';
import { aiRiskController } from '../controllers/ai-risk.controller';
import { aiBiController } from '../controllers/ai-bi.controller';
import { aiCampaignController } from '../controllers/ai-campaign.controller';
import { aiAutomationController } from '../controllers/ai-automation.controller';
import { notificationController } from '../controllers/notification.controller';
import { matchPoolController } from '../controllers/match-pool.controller';
import { apiLimiter, authLimiter, stakeLimiter, adminLimiter } from '../middleware/rateLimit.middleware';
import {
  validate,
  validateSignupRequest,
  validateSignupVerify,
  validateSignupComplete,
  validateLoginRequest,
  validateLoginVerify,
  validatePinReset,
  validatePlaceStake,
  validateDeposit,
  validateWithdrawal,
  validateUpdateProfile,
  validateLoginPin,
  validateLoginEmailRequest,
  validateLoginEmailVerify,
  validateKyc,
  validatePhoneVerificationRequest,
  validatePhoneVerificationConfirm,
  validateOraChat
} from '../middleware/validate.middleware';

const router = Router();

router.get('/health', apiLimiter, (_req: Request, res: Response) => {
  const dbState = mongoose.connection?.readyState === 1 ? 'connected' : 'disconnected';
  res.json({
    success: true,
    message: 'BetPool API v2.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    dbStatus: dbState
  });
});

// Auth routes (authLimiter + validation)
router.post('/auth/signup/request', authLimiter, validateSignupRequest, authController.requestSignupOTP);
router.post('/auth/signup/verify', authLimiter, validateSignupVerify, authController.verifySignupOTP);
router.post('/auth/signup/complete', authLimiter, validateSignupComplete, authController.completeSignup);
router.post('/auth/login/request', authLimiter, validateLoginRequest, authController.requestLoginOTP);
router.post('/auth/login/verify', authLimiter, validateLoginVerify, authController.verifyLoginOTP);
router.post('/auth/login/pin', authLimiter, validateLoginPin, authController.loginWithPin);
router.post('/auth/login/email/request', authLimiter, validateLoginEmailRequest, authController.requestLoginEmailToken);
router.post('/auth/login/email/verify', authLimiter, validateLoginEmailVerify, authController.verifyLoginEmailToken);
router.post('/auth/otp/resend', authLimiter, authController.resendOTP);
router.post('/auth/pin/reset/request', authLimiter, authController.requestPinReset);
router.post('/auth/pin/reset', authLimiter, validatePinReset, authController.resetPin);
router.post('/auth/pin/change', authMiddleware, authController.changePin);
router.post('/auth/refresh', authController.refreshToken);
router.get('/auth/verify', authMiddleware, authController.verifyToken);
router.get('/auth/profile', authMiddleware, authController.getProfile);
router.put('/auth/profile', authMiddleware, validateUpdateProfile, authController.updateProfile);
router.get('/auth/referrals', authMiddleware, authController.getReferralStats);
router.get('/auth/referral/:code', authController.checkReferralCode);
router.post('/auth/verify-phone/request', authLimiter, validatePhoneVerificationRequest, authController.requestPhoneVerification);
router.post('/auth/verify-phone/confirm', authLimiter, validatePhoneVerificationConfirm, authController.confirmPhoneVerification);
router.post('/auth/kyc', authMiddleware, validateKyc, authController.submitKyc);
router.get('/auth/kyc', authMiddleware, authController.getKycStatus);

// Pod routes (apiLimiter for public endpoints)
router.get('/pods/feed', apiLimiter, podController.getActiveFeed);
router.get('/pods/feed/debug', apiLimiter, podController.getActiveFeedDebug);
router.get('/pods/upcoming', apiLimiter, podController.getUpcoming);
router.get('/pods/sports', apiLimiter, podController.getSports);
router.get('/pods/sport/:sport', apiLimiter, podController.getBySport);
router.get('/pods/search', apiLimiter, podController.search);
router.get('/pods/:id', apiLimiter, podController.getById);
router.get('/pods/:id/gains', apiLimiter, podController.getGains);

// Stake routes (stakeLimiter on POST)
router.post('/stakes', authMiddleware, stakeLimiter, validatePlaceStake, stakeController.placeStake);
router.get('/stakes', authMiddleware, stakeController.getUserStakes);
router.get('/stakes/active', authMiddleware, stakeController.getActiveStakes);
router.get('/stakes/:id', authMiddleware, stakeController.getStakeById);
router.get('/stakes/calculate', authMiddleware, stakeController.calculatePayout);
router.get('/stakes/:id/cashout/quote', authMiddleware, stakeController.getCashoutQuote);
router.post('/stakes/:id/cashout/confirm', authMiddleware, stakeController.confirmCashout);

// Wallet routes
router.get('/wallet/balance', authMiddleware, walletController.getBalance);
router.get('/wallet/transactions', authMiddleware, walletController.getTransactions);
router.post('/wallet/deposit', authMiddleware, validateDeposit, walletController.initiateDeposit);
router.get('/wallet/deposit/callback', apiLimiter, walletController.depositCallback);
router.post('/wallet/deposit/recover', authMiddleware, walletController.recoverDeposits);
router.post('/wallet/withdraw', authMiddleware, validateWithdrawal, walletController.initiateWithdrawal);
router.get('/wallet/banks', apiLimiter, walletController.listBanks);
router.get('/wallet/resolve-account', apiLimiter, walletController.resolveBankAccount);
router.get('/wallet/limits', authMiddleware, walletController.getWithdrawalLimits);
router.post('/wallet/save-account', authMiddleware, walletController.saveAccount);
router.get('/wallet/saved-accounts', authMiddleware, walletController.getSavedAccounts);
router.delete('/wallet/saved-accounts/:id', authMiddleware, walletController.deleteSavedAccount);
router.put('/wallet/saved-accounts/:id/default', authMiddleware, walletController.setDefaultAccount);

// AI / Ora chatbot routes
router.post('/ai/chat', authMiddleware, validateOraChat, chat);

// Notification routes
router.get('/notifications', authMiddleware, notificationController.getNotifications);
router.put('/notifications/read-all', authMiddleware, notificationController.markAllAsRead);
router.put('/notifications/:id/read', authMiddleware, notificationController.markAsRead);
router.put('/notifications/:id/unread', authMiddleware, notificationController.markAsUnread);
router.delete('/notifications/:id', authMiddleware, notificationController.deleteNotification);

// Match Pool routes
router.get('/match-pools', apiLimiter, matchPoolController.listOpen);
router.get('/match-pools/my-stakes', authMiddleware, matchPoolController.getMyStakes);
router.get('/match-pools/:id', apiLimiter, matchPoolController.getById);
router.post('/match-pools/:id/stakes', authMiddleware, matchPoolController.createStake);

// Payment webhooks (no auth middleware — signature verified inside handler)
router.post('/webhook/paystack', walletController.paystackWebhook);

// =================== ADMIN ROUTES ===================
import { adminMiddleware } from '../middleware/admin.middleware';

// All admin routes require auth + admin role + rate limited
router.use('/admin', authMiddleware, adminMiddleware, adminLimiter);

router.get('/admin/dashboard', adminController.getDashboard);

// Match Pool management (admin)
router.get('/admin/match-pools', matchPoolController.adminListAll);
router.get('/admin/match-pools/reports', matchPoolController.getReportsAggregate);
router.post('/admin/match-pools', matchPoolController.createPool);
router.get('/admin/match-pools/:id', matchPoolController.adminGetDetail);
router.get('/admin/match-pools/:id/report', matchPoolController.getReport);
router.post('/admin/match-pools/:id/close-staking', matchPoolController.closeStaking);
router.post('/admin/match-pools/:id/settle', matchPoolController.settle);
router.post('/admin/match-pools/:id/cancel', matchPoolController.cancel);

// Pod management
router.get('/admin/pods', adminController.listPods);
router.get('/admin/pods/ready-for-betting', adminController.listPodsReadyForBetting);
router.get('/admin/pods/reserve-consumption', adminController.getReserveConsumption);
router.get('/admin/pods/:id', adminController.getPod);
router.post('/admin/pods', adminController.createPod);
router.put('/admin/pods/:id', adminController.updatePod);
router.post('/admin/pods/:id/publish', adminController.publishPod);
router.post('/admin/pods/:id/activate', adminController.activatePod);
router.post('/admin/pods/:id/settle', adminController.settlePod);
router.post('/admin/pods/:id/ai-settle-check', aiSettlementController.checkPod);
router.post('/admin/pods/:id/ai-settle', aiSettlementController.settlePod);
router.post('/admin/pods/:id/toggle-external-booking', adminController.toggleExternalBooking);
router.post('/admin/pods/:id/cancel', adminController.cancelPod);
router.post('/admin/pods/sync', podSyncController.sync);
// router.post('/admin/ai/curate', aiCurationController.curate); // DISABLED
router.post('/admin/ai/settle-all', aiSettlementController.settleAll);

// User management
router.get('/admin/users', adminController.listUsers);
router.get('/admin/users/:id', adminController.getUser);
router.post('/admin/users/:id/toggle-status', adminController.toggleUserStatus);
router.post('/admin/users/:id/verify-kyc', adminController.verifyUserKYC);
router.post('/admin/users/:id/reject-kyc', adminController.rejectUserKYC);
router.post('/admin/ai/kyc-review/:userId', aiKycController.reviewUser);
router.post('/admin/ai/kyc-approve/:userId', aiKycController.approveUser);
router.post('/admin/ai/kyc-reject/:userId', aiKycController.rejectUser);
router.post('/admin/ai/kyc-review-all', aiKycController.reviewAll);
router.get('/admin/ai/risk-report', aiRiskController.getReport);
router.get('/admin/ai/risk-pod/:podId', aiRiskController.getPodRisk);
router.post('/admin/ai/risk-auto-cap', aiRiskController.applyAutoCaps);
router.post('/admin/ai/risk-restore-caps', aiRiskController.restoreCaps);
router.post('/admin/ai/risk-run-escalation', aiRiskController.runEscalation);
router.get('/admin/ai/risk-escalation-state', aiRiskController.getEscalationState);
router.get('/admin/ai/bi-report', aiBiController.getReport);
router.get('/admin/ai/bi-forecast', aiBiController.getForecast);
router.get('/admin/ai/bi-t4-advisory', aiBiController.getT4Advisory);
router.get('/admin/ai/campaigns/segments', aiCampaignController.segmentUsers);
router.post('/admin/ai/campaigns/generate', aiCampaignController.generateCampaign);
router.post('/admin/ai/campaigns/send', aiCampaignController.sendCampaign);

// Ora Automation — full cycle (curate → create → settle) DISABLED
// router.post('/admin/ai/automation/run', aiAutomationController.runCycle);
// router.get('/admin/ai/automation/status', aiAutomationController.status);

// Settlement dispute management
router.get('/admin/ai/settlement/disputed', aiSettlementController.listDisputed);
router.post('/admin/ai/settlement/disputed/:podId/resolve', aiSettlementController.resolveDispute);
router.post('/admin/ai/settlement/disputed/batch-resolve', aiSettlementController.batchResolveDisputes);
router.get('/admin/ai/settlement/stuck', aiSettlementController.listStuck);
router.get('/admin/ai/settlement/pending-count', aiSettlementController.countPendingReviews);

// Stake management
router.get('/admin/stakes', adminController.listStakes);
router.get('/admin/stakes/:id', adminController.getStake);
router.post('/admin/stakes/:id/settle', adminController.settleStake);
router.post('/admin/stakes/:id/void', adminController.voidStake);

// Transaction management
router.get('/admin/transactions', adminController.listTransactions);

// Withdrawal management
router.get('/admin/withdrawals', adminController.listWithdrawals);
router.get('/admin/withdrawals/:id', adminController.getWithdrawal);
router.post('/admin/withdrawals/:id/approve', adminController.approveWithdrawal);
router.post('/admin/withdrawals/:id/reject', adminController.rejectWithdrawal);

// Loan management
router.get('/admin/loans', adminController.listLoans);
router.get('/admin/loans/:id', adminController.getLoan);
router.post('/admin/loans', adminController.createLoan);
router.post('/admin/loans/:id/approve', adminController.approveLoan);
router.post('/admin/loans/:id/reject', adminController.rejectLoan);
router.post('/admin/loans/:id/repay', adminController.repayLoan);

// Wallet adjustments
router.post('/admin/wallet/adjust', adminController.manualAdjustment);

// Settings
import { settingsController } from '../controllers/settings.controller';
router.get('/admin/settings', settingsController.get);
router.put('/admin/settings', settingsController.update);

// Featured Games / Banners
import { featuredBannerController } from '../controllers/featured-banner.controller';
import { adminChatController } from '../controllers/admin-chat.controller';

// ORA Chat History
router.get('/admin/chat/stats', adminChatController.getStats);
router.get('/admin/chat/sessions', adminChatController.listSessions);
router.get('/admin/chat/sessions/:id', adminChatController.getSession);
router.put('/admin/chat/sessions/:id/resolve', adminChatController.resolveSession);
router.get('/featured-games', apiLimiter, featuredBannerController.getActive);
router.get('/admin/featured-games', featuredBannerController.adminList);
router.post('/admin/featured-games', featuredBannerController.create);
router.post('/admin/featured-games/generate-description', featuredBannerController.generateDescription);
router.put('/admin/featured-games/:id', featuredBannerController.update);
router.delete('/admin/featured-games/:id', featuredBannerController.remove);

export default router;
