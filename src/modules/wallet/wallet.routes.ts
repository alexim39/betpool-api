import { Router } from 'express';
import { walletController } from './wallet.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { apiLimiter } from '../../middleware/rateLimit.middleware';
import {
  validateDeposit,
  validateWithdrawal,
  validateTransfer
} from '../../middleware/validate.middleware';

const router = Router();

router.get('/balance', authMiddleware, walletController.getBalance);
router.get('/transactions', authMiddleware, walletController.getTransactions);
router.post('/deposit', authMiddleware, apiLimiter, validateDeposit, walletController.initiateDeposit);
router.get('/deposit/callback', authMiddleware, apiLimiter, walletController.depositCallback);
router.post('/deposit/recover', authMiddleware, walletController.recoverDeposits);
router.post('/withdraw', authMiddleware, apiLimiter, validateWithdrawal, walletController.initiateWithdrawal);
router.get('/banks', apiLimiter, walletController.listBanks);
router.get('/resolve-account', apiLimiter, walletController.resolveBankAccount);
router.get('/limits', authMiddleware, walletController.getWithdrawalLimits);
router.post('/save-account', authMiddleware, walletController.saveAccount);
router.get('/saved-accounts', authMiddleware, walletController.getSavedAccounts);
router.delete('/saved-accounts/:id', authMiddleware, walletController.deleteSavedAccount);
router.put('/saved-accounts/:id/default', authMiddleware, walletController.setDefaultAccount);

// Wallet-to-wallet transfers
router.get('/transfer/resolve', authMiddleware, apiLimiter, walletController.resolveTransferRecipient);
router.post('/transfer', authMiddleware, apiLimiter, validateTransfer, walletController.initiateTransfer);
router.get('/transfers', authMiddleware, walletController.getTransfers);
router.get('/transfers/export', authMiddleware, apiLimiter, walletController.exportTransfersCsv);

export default router;
