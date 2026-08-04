import { Router } from 'express';
import { gamesController } from './games.controller';
import { apiLimiter } from '../../middleware/rateLimit.middleware';
import { authMiddleware, optionalAuth } from '../../middleware/auth.middleware';
import { adminMiddleware } from '../../middleware/admin.middleware';

const router = Router();

router.get('/', optionalAuth, apiLimiter, gamesController.list);
router.get('/today', optionalAuth, apiLimiter, gamesController.getToday);
router.post('/analyze', authMiddleware, adminMiddleware, gamesController.analyzeToday);

export default router;
