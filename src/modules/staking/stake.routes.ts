import { Router } from 'express';
import { stakeController } from './stake.controller';
import { bookingCodeController } from './booking-code.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { stakeLimiter } from '../../middleware/rateLimit.middleware';
import { validatePlaceStake } from '../../middleware/validate.middleware';

const router = Router();

router.post('/booking-codes', authMiddleware, stakeLimiter, bookingCodeController.create);
router.get('/booking-codes/:code', authMiddleware, stakeLimiter, bookingCodeController.redeem);
router.post('/', authMiddleware, stakeLimiter, validatePlaceStake, stakeController.placeStake);
router.get('/', authMiddleware, stakeController.getUserStakes);
router.get('/active', authMiddleware, stakeController.getActiveStakes);
router.get('/summary', authMiddleware, stakeController.getUserBetSummary);
router.get('/calculate', authMiddleware, stakeController.calculatePayout);
router.get('/:id', authMiddleware, stakeController.getStakeById);
router.get('/:id/cashout/quote', authMiddleware, stakeController.getCashoutQuote);
router.post('/:id/cashout/confirm', authMiddleware, stakeController.confirmCashout);

export default router;
