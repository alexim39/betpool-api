import { Router } from 'express';
import { loyaltyController } from './loyalty.controller';
import { apiLimiter } from '../../middleware/rateLimit.middleware';

const router = Router();

router.get('/snapshot', apiLimiter, loyaltyController.getSnapshot.bind(loyaltyController));

export default router;
