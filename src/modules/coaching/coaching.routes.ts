import { Router } from 'express';
import { coachingController } from './coaching.controller';
import { apiLimiter } from '../../middleware/rateLimit.middleware';

const router = Router();

router.get('/insights', apiLimiter, coachingController.getInsights.bind(coachingController));

export default router;
