import { Router } from 'express';
import { oraPickController } from './ora-pick.controller';
import { apiLimiter } from '../../middleware/rateLimit.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();

router.get('/pick-of-day', authMiddleware, apiLimiter, oraPickController.getPickOfDay.bind(oraPickController));

export default router;
