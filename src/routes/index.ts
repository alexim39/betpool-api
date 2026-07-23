import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';

import { authRoutes } from '../modules/auth';
import { podRoutes } from '../modules/pods';
import { stakeRoutes } from '../modules/staking';
import { walletRoutes, walletController } from '../modules/wallet';
import { aiRoutes } from '../modules/ai';
import { notificationRoutes } from '../modules/notifications';
import { matchPoolRoutes } from '../modules/match-pools';
import { featuredBannerRoutes } from '../modules/featured-banners';
import { adminRoutes } from '../modules/admin';

import { authMiddleware } from '../middleware/auth.middleware';
import { adminMiddleware } from '../middleware/admin.middleware';
import { apiLimiter, adminLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

// Health check
router.get('/health', apiLimiter, (_req: Request, res: Response) => {
  const dbState = mongoose.connection?.readyState === 1 ? 'connected' : 'disconnected';
  res.json({
    success: true,
    message: 'BetPool API v2.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    dbStatus: dbState
  });
});

// Mount module routers
router.use('/auth', authRoutes);
router.use('/pods', podRoutes);
router.use('/stakes', stakeRoutes);
router.use('/wallet', walletRoutes);
router.use('/ai', aiRoutes);
router.use('/notifications', notificationRoutes);
router.use('/match-pools', matchPoolRoutes);
router.use('/featured-games', featuredBannerRoutes);

// Admin routes (auth + admin middleware applied at this level)
router.use('/admin', authMiddleware, adminMiddleware, adminLimiter, adminRoutes);

// Payment webhook (no auth — signature verified inside handler)
router.post('/webhook/paystack', walletController.paystackWebhook);

export default router;
