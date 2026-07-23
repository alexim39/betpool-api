import { Router } from 'express';
import { adminController } from './admin.controller';
import { settingsController } from './settings.controller';
import { matchPoolController } from '../match-pools/match-pool.controller';
import { podSyncController } from '../pods/pod-sync.controller';
import { aiSettlementController } from '../ai/ai-settlement.controller';
import { aiKycController } from '../ai/ai-kyc.controller';
import { aiRiskController } from '../ai/ai-risk.controller';
import { aiBiController } from '../ai/ai-bi.controller';
import { aiCampaignController } from '../ai/ai-campaign.controller';
import { featuredBannerController } from '../featured-banners/featured-banner.controller';
import { adminChatController } from '../chat/admin-chat.controller';

const router = Router();

// Dashboard
router.get('/dashboard', adminController.getDashboard);

// Match Pool management
router.get('/match-pools', matchPoolController.adminListAll);
router.get('/match-pools/reports', matchPoolController.getReportsAggregate);
router.post('/match-pools', matchPoolController.createPool);
router.get('/match-pools/:id', matchPoolController.adminGetDetail);
router.get('/match-pools/:id/report', matchPoolController.getReport);
router.post('/match-pools/:id/close-staking', matchPoolController.closeStaking);
router.post('/match-pools/:id/settle', matchPoolController.settle);
router.post('/match-pools/:id/cancel', matchPoolController.cancel);

// Pod management
router.get('/pods', adminController.listPods);
router.get('/pods/ready-for-betting', adminController.listPodsReadyForBetting);
router.get('/pods/reserve-consumption', adminController.getReserveConsumption);
router.get('/pods/:id', adminController.getPod);
router.post('/pods', adminController.createPod);
router.put('/pods/:id', adminController.updatePod);
router.post('/pods/:id/publish', adminController.publishPod);
router.post('/pods/:id/activate', adminController.activatePod);
router.post('/pods/:id/settle', adminController.settlePod);
router.post('/pods/:id/ai-settle-check', aiSettlementController.checkPod);
router.post('/pods/:id/ai-settle', aiSettlementController.settlePod);
router.post('/pods/:id/toggle-external-booking', adminController.toggleExternalBooking);
router.post('/pods/:id/cancel', adminController.cancelPod);
router.post('/pods/sync', podSyncController.sync);
router.post('/ai/settle-all', aiSettlementController.settleAll);

// User management
router.get('/users', adminController.listUsers);
router.get('/users/:id', adminController.getUser);
router.post('/users/:id/toggle-status', adminController.toggleUserStatus);
router.post('/users/:id/verify-kyc', adminController.verifyUserKYC);
router.post('/users/:id/reject-kyc', adminController.rejectUserKYC);
router.post('/ai/kyc-review/:userId', aiKycController.reviewUser);
router.post('/ai/kyc-approve/:userId', aiKycController.approveUser);
router.post('/ai/kyc-reject/:userId', aiKycController.rejectUser);
router.post('/ai/kyc-review-all', aiKycController.reviewAll);

// AI Risk
router.get('/ai/risk-report', aiRiskController.getReport);
router.get('/ai/risk-pod/:podId', aiRiskController.getPodRisk);
router.post('/ai/risk-auto-cap', aiRiskController.applyAutoCaps);
router.post('/ai/risk-restore-caps', aiRiskController.restoreCaps);
router.post('/ai/risk-run-escalation', aiRiskController.runEscalation);
router.get('/ai/risk-escalation-state', aiRiskController.getEscalationState);

// AI BI
router.get('/ai/bi-report', aiBiController.getReport);
router.get('/ai/bi-forecast', aiBiController.getForecast);
router.get('/ai/bi-t4-advisory', aiBiController.getT4Advisory);

// AI Campaigns
router.get('/ai/campaigns/segments', aiCampaignController.segmentUsers);
router.post('/ai/campaigns/generate', aiCampaignController.generateCampaign);
router.post('/ai/campaigns/send', aiCampaignController.sendCampaign);

// AI Settlement disputes
router.get('/ai/settlement/disputed', aiSettlementController.listDisputed);
router.post('/ai/settlement/disputed/:podId/resolve', aiSettlementController.resolveDispute);
router.post('/ai/settlement/disputed/batch-resolve', aiSettlementController.batchResolveDisputes);
router.get('/ai/settlement/stuck', aiSettlementController.listStuck);
router.get('/ai/settlement/pending-count', aiSettlementController.countPendingReviews);

// Stake management
router.get('/stakes', adminController.listStakes);
router.get('/stakes/:id', adminController.getStake);
router.post('/stakes/:id/settle', adminController.settleStake);
router.post('/stakes/:id/void', adminController.voidStake);

// Transaction management
router.get('/transactions', adminController.listTransactions);

// Withdrawal management
router.get('/withdrawals', adminController.listWithdrawals);
router.get('/withdrawals/:id', adminController.getWithdrawal);
router.post('/withdrawals/:id/approve', adminController.approveWithdrawal);
router.post('/withdrawals/:id/reject', adminController.rejectWithdrawal);

// Loan management
router.get('/loans', adminController.listLoans);
router.get('/loans/:id', adminController.getLoan);
router.post('/loans', adminController.createLoan);
router.post('/loans/:id/approve', adminController.approveLoan);
router.post('/loans/:id/reject', adminController.rejectLoan);
router.post('/loans/:id/repay', adminController.repayLoan);

// Wallet adjustments
router.post('/wallet/adjust', adminController.manualAdjustment);

// Settings
router.get('/settings', settingsController.get);
router.put('/settings', settingsController.update);

// ORA Chat history
router.get('/chat/stats', adminChatController.getStats);
router.get('/chat/sessions', adminChatController.listSessions);
router.get('/chat/sessions/:id', adminChatController.getSession);
router.put('/chat/sessions/:id/resolve', adminChatController.resolveSession);

// Featured Games / Banners (admin)
router.get('/featured-games', featuredBannerController.adminList);
router.post('/featured-games', featuredBannerController.create);
router.post('/featured-games/generate-description', featuredBannerController.generateDescription);
router.put('/featured-games/:id', featuredBannerController.update);
router.delete('/featured-games/:id', featuredBannerController.remove);

export default router;
