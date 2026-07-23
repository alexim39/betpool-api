import { Router } from 'express';
import { authController } from './auth.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { authLimiter } from '../../middleware/rateLimit.middleware';
import {
  validateSignupRequest,
  validateSignupVerify,
  validateSignupComplete,
  validateLoginRequest,
  validateLoginVerify,
  validatePinReset,
  validateUpdateProfile,
  validateLoginPin,
  validateLoginEmailRequest,
  validateLoginEmailVerify,
  validateKyc,
  validatePhoneVerificationRequest,
  validatePhoneVerificationConfirm
} from '../../middleware/validate.middleware';

const router = Router();

router.post('/signup/request', authLimiter, validateSignupRequest, authController.requestSignupOTP);
router.post('/signup/verify', authLimiter, validateSignupVerify, authController.verifySignupOTP);
router.post('/signup/complete', authLimiter, validateSignupComplete, authController.completeSignup);
router.post('/login/request', authLimiter, validateLoginRequest, authController.requestLoginOTP);
router.post('/login/verify', authLimiter, validateLoginVerify, authController.verifyLoginOTP);
router.post('/login/pin', authLimiter, validateLoginPin, authController.loginWithPin);
router.post('/login/email/request', authLimiter, validateLoginEmailRequest, authController.requestLoginEmailToken);
router.post('/login/email/verify', authLimiter, validateLoginEmailVerify, authController.verifyLoginEmailToken);
router.post('/otp/resend', authLimiter, authController.resendOTP);
router.post('/pin/reset/request', authLimiter, authController.requestPinReset);
router.post('/pin/reset', authLimiter, validatePinReset, authController.resetPin);
router.post('/pin/change', authMiddleware, authController.changePin);
router.post('/refresh', authController.refreshToken);
router.get('/verify', authMiddleware, authController.verifyToken);
router.get('/profile', authMiddleware, authController.getProfile);
router.put('/profile', authMiddleware, validateUpdateProfile, authController.updateProfile);
router.get('/referrals', authMiddleware, authController.getReferralStats);
router.get('/referral/:code', authController.checkReferralCode);
router.post('/verify-phone/request', authLimiter, validatePhoneVerificationRequest, authController.requestPhoneVerification);
router.post('/verify-phone/confirm', authLimiter, validatePhoneVerificationConfirm, authController.confirmPhoneVerification);
router.post('/kyc', authMiddleware, validateKyc, authController.submitKyc);
router.get('/kyc', authMiddleware, authController.getKycStatus);

export default router;
