import { Router } from 'express';
import { virtualGamesController } from './virtual-games.controller';
import { apiLimiter } from '../../middleware/rateLimit.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

router.get('/catalog', apiLimiter, virtualGamesController.catalog.bind(virtualGamesController));
router.post('/play', apiLimiter, virtualGamesController.play.bind(virtualGamesController));
router.get('/history', apiLimiter, virtualGamesController.history.bind(virtualGamesController));

export default router;