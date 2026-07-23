import { Router } from 'express';
import { matchPoolController } from './match-pool.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { apiLimiter } from '../../middleware/rateLimit.middleware';

const router = Router();

router.get('/', apiLimiter, matchPoolController.listOpen);
router.get('/my-stakes', authMiddleware, matchPoolController.getMyStakes);
router.get('/:id', apiLimiter, matchPoolController.getById);
router.post('/:id/stakes', authMiddleware, matchPoolController.createStake);

export default router;
