import { Router } from 'express';
import { betManagerController } from './bet-manager.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();

router.get('/', authMiddleware, betManagerController.getAccounts);
router.get('/nav/:tier', authMiddleware, betManagerController.getNav);
router.get('/:tier', authMiddleware, betManagerController.getAccount);
router.get('/:tier/history', authMiddleware, betManagerController.getDepositHistory);
router.get('/:tier/performance', authMiddleware, betManagerController.getPerformance);
router.post('/deposit', authMiddleware, betManagerController.deposit);
router.post('/withdraw', authMiddleware, betManagerController.withdraw);

export default router;
