import { Router } from 'express';
import { leaderboardController } from './leaderboard.controller';
import { apiLimiter } from '../../middleware/rateLimit.middleware';

const router = Router();

router.get('/', apiLimiter, leaderboardController.getLeaderboard.bind(leaderboardController));
router.get('/me', apiLimiter, leaderboardController.getMyRank.bind(leaderboardController));
router.get('/me/last-win', apiLimiter, leaderboardController.getLastWin.bind(leaderboardController));

export default router;
