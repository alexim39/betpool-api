import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { optionalAuth } from '../../middleware/auth.middleware';
import { apiLimiter } from '../../middleware/rateLimit.middleware';
import {
  validateSocialToggle,
  validateSocialFollowToggle,
  validateAddComment
} from '../../middleware/validate.middleware';
import { socialController } from './social.controller';

const router = Router();

// --- Public read-only profile (no login required) ---
// These use optionalAuth: guests see same cover/codes/badges/track-record,
// but `isFollowing`/`isSelf` resolve to false. No write operation is public.
router.get('/public/profile/:userId', optionalAuth, apiLimiter, socialController.getPublicProfile);
router.get('/public/creator-codes', optionalAuth, apiLimiter, socialController.getPublicCreatorCodes);
router.get('/public/followers', optionalAuth, apiLimiter, socialController.listPublicFollowers);
router.get('/public/following-list', optionalAuth, apiLimiter, socialController.listPublicFollowingUsers);
router.get('/public/leaderboard', apiLimiter, socialController.getLeaderboard);

router.post('/likes/toggle', authMiddleware, apiLimiter, validateSocialToggle, socialController.toggleLike);
router.post('/saves/toggle', authMiddleware, apiLimiter, validateSocialToggle, socialController.toggleSave);
router.post('/follows/toggle', authMiddleware, apiLimiter, validateSocialFollowToggle, socialController.toggleFollow);
router.post('/comments', authMiddleware, apiLimiter, validateAddComment, socialController.addComment);
router.get('/comments', authMiddleware, socialController.listComments);
router.get('/stats', authMiddleware, socialController.getStats);
router.get('/feed', authMiddleware, socialController.getFollowingFeed);
router.get('/activity', authMiddleware, socialController.getActivity);
router.get('/following', authMiddleware, socialController.listFollowing);
router.get('/creators', authMiddleware, socialController.listCreators);
router.get('/leaderboard', authMiddleware, socialController.getLeaderboard);
router.get('/saved', authMiddleware, socialController.listSavedPods);
router.get('/followers', authMiddleware, socialController.listFollowers);
router.get('/following-list', authMiddleware, socialController.listFollowingUsers);
router.get('/creator-codes', authMiddleware, socialController.getCreatorCodes);
router.get('/profile/:userId', authMiddleware, socialController.getProfile);

export default router;
