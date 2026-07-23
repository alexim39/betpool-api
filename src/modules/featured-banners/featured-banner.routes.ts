import { Router } from 'express';
import { featuredBannerController } from './featured-banner.controller';
import { apiLimiter } from '../../middleware/rateLimit.middleware';

const router = Router();

// Public endpoint
router.get('/', apiLimiter, featuredBannerController.getActive);

export default router;
