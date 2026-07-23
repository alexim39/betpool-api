import { Router } from 'express';
import { podController } from './pod.controller';
import { apiLimiter } from '../../middleware/rateLimit.middleware';

const router = Router();

router.get('/feed', apiLimiter, podController.getActiveFeed);
router.get('/feed/debug', apiLimiter, podController.getActiveFeedDebug);
router.get('/upcoming', apiLimiter, podController.getUpcoming);
router.get('/sports', apiLimiter, podController.getSports);
router.get('/sport/:sport', apiLimiter, podController.getBySport);
router.get('/search', apiLimiter, podController.search);
router.get('/:id', apiLimiter, podController.getById);
router.get('/:id/gains', apiLimiter, podController.getGains);

export default router;
