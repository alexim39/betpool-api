import { Request, Response } from 'express';
import { userService } from '../services/user.service';
import { otpService } from '../services/otp.service';
import { notifyWelcome, notifyPinChanged, notifyKycApproved, notifyReferralUsed } from '../services/notification.service';
import { UserModel } from '../models/user.model';
import { logger } from '../services/logger.service';

export class AuthController {
  async requestSignupOTP(req: Request, res: Response): Promise<void> {
    try {
      const { phone, email } = req.body;
      if (!phone) {
        res.status(400).json({ success: false, message: 'Phone number required' });
        return;
      }

      const existing = await userService.getUserByPhone(phone);
      if (existing) {
        res.status(400).json({ success: false, message: 'Phone number already registered' });
        return;
      }

      const otp = await otpService.createOTP(phone, 'signup');

      if (email) {
        otpService.sendOTPEmail(email.toLowerCase().trim(), otp.code, 'signup').catch(e => logger.error('Signup email OTP send failed', e));
      }

      const isDev = process.env.NODE_ENV === 'development';
      res.json({
        success: true,
        message: 'Verification code sent via SMS and email',
        ...(isDev ? { debugCode: otp.code } : {})
      });
    } catch (error) {
      console.error('Request signup OTP error:', error);
      res.status(500).json({ success: false, message: 'Failed to send OTP' });
    }
  }

  async verifySignupOTP(req: Request, res: Response): Promise<void> {
    try {
      const { phone, code } = req.body;
      if (!phone || !code) {
        res.status(400).json({ success: false, message: 'Phone and code required' });
        return;
      }

      const result = await otpService.verifyOTP(phone, code, 'signup');
      if (!result.valid) {
        res.status(400).json({ success: false, message: result.message });
        return;
      }

      res.json({ success: true, message: 'Phone verified. Complete registration.' });
    } catch (error) {
      console.error('Verify signup OTP error:', error);
      res.status(500).json({ success: false, message: 'Verification failed' });
    }
  }

  async completeSignup(req: Request, res: Response): Promise<void> {
    try {
      const { phone, fullName, pin, referralCode, email, code } = req.body;
      if (!phone || !fullName || !pin || !code) {
        res.status(400).json({ success: false, message: 'Phone, name, PIN, and verification code required' });
        return;
      }

      if (!/^\d{4}$/.test(pin)) {
        res.status(400).json({ success: false, message: 'PIN must be 4 digits' });
        return;
      }

      const result = await userService.signup({ phone, fullName, pin, referralCode, email, code });
      await notifyWelcome(result.user._id.toString()).catch(e => console.error('notifyWelcome error:', e));
      if (result.user.referredBy) {
        const referrer = await UserModel.findById(result.user.referredBy).select('fullName').lean();
        if (referrer) {
          notifyReferralUsed(result.user.referredBy.toString(), result.user.fullName).catch(e => console.error('notifyReferralUsed error:', e));
        }
      }
      res.json({ success: true, data: { user: result.user, token: result.token } });
    } catch (error: any) {
      console.error('Complete signup error:', error);
      res.status(400).json({ success: false, message: error.message || 'Registration failed' });
    }
  }

  async requestLoginOTP(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = req.body;
      if (!phone) {
        res.status(400).json({ success: false, message: 'Phone number required' });
        return;
      }

      const user = await userService.getUserByPhone(phone);
      if (!user) {
        res.status(400).json({ success: false, message: 'Account not found' });
        return;
      }
      if (!user.isActive || user.isSuspended) {
        res.status(403).json({ success: false, message: 'Account suspended. Contact support.' });
        return;
      }

      const otp = await otpService.createOTP(phone, 'login');
      const isDev = process.env.NODE_ENV === 'development';
      res.json({
        success: true,
        message: 'Login code sent via SMS',
        ...(isDev ? { debugCode: otp.code } : {})
      });
    } catch (error) {
      console.error('Request login OTP error:', error);
      res.status(500).json({ success: false, message: 'Failed to send login code' });
    }
  }

  async verifyLoginOTP(req: Request, res: Response): Promise<void> {
    try {
      const { phone, code } = req.body;
      if (!phone || !code) {
        res.status(400).json({ success: false, message: 'Phone and code required' });
        return;
      }

      const result = await userService.verifyLoginOTP(phone, code);
      if (!result) {
        res.status(400).json({ success: false, message: 'Invalid or expired code' });
        return;
      }

      res.json({ success: true, data: { user: result.user, token: result.token } });
    } catch (error: any) {
      console.error('Verify login OTP error:', error);
      res.status(400).json({ success: false, message: error.message || 'Login failed' });
    }
  }

  async requestLoginEmailToken(req: Request, res: Response): Promise<void> {
    try {
      const { email } = req.body;
      if (!email) {
        res.status(400).json({ success: false, message: 'Email required' });
        return;
      }

      const user = await userService.getUserByEmail(email);

      if (!user) {
        const existingAdmin = await UserModel.findOne({ role: 'admin' }).lean();
        if (existingAdmin) {
          res.status(400).json({ success: false, message: 'Account not found with that email' });
          return;
        }
        await userService.provisionFirstAdmin(email);
      }

      await otpService.createOTP(email.toLowerCase().trim(), 'email_login');
      res.json({ success: true, message: 'Login token sent to your email' });
    } catch (error) {
      console.error('Request email login token error:', error);
      res.status(500).json({ success: false, message: 'Failed to send email token' });
    }
  }

  async verifyLoginEmailToken(req: Request, res: Response): Promise<void> {
    try {
      const { email, code } = req.body;
      if (!email || !code) {
        res.status(400).json({ success: false, message: 'Email and code required' });
        return;
      }

      const result = await userService.verifyLoginEmailToken(email, code);
      if (!result) {
        res.status(400).json({ success: false, message: 'Invalid or expired code' });
        return;
      }

      res.json({ success: true, data: { user: result.user, token: result.token } });
    } catch (error: any) {
      console.error('Verify email login error:', error);
      res.status(400).json({ success: false, message: error.message || 'Login failed' });
    }
  }

  async loginWithPin(req: Request, res: Response): Promise<void> {
    try {
      const { phone, email, pin } = req.body;
      if ((!phone && !email) || !pin) {
        res.status(400).json({ success: false, message: 'Phone or email and PIN required' });
        return;
      }

      let user;
      if (email) {
        user = await userService.getUserByEmail(email.toLowerCase().trim());
        if (!user) {
          res.status(400).json({ success: false, message: 'Account not found with that email' });
          return;
        }
        if (!user.isActive || user.isSuspended) {
          res.status(403).json({ success: false, message: 'Account suspended. Contact support.' });
          return;
        }
        const isValid = await userService.verifyPin(user._id.toString(), pin);
        if (!isValid) {
          res.status(401).json({ success: false, message: 'Invalid PIN' });
          return;
        }
      } else {
        const result = await userService.login({ phone, pin });
        user = result.user;
      }

      const token = userService.generateToken(user._id.toString(), user.role);
      user.lastLoginAt = new Date();
      await user.save();
      res.json({ success: true, data: { user, token } });
    } catch (error: any) {
      console.error('PIN login error:', error);
      res.status(401).json({ success: false, message: error.message || 'Invalid credentials' });
    }
  }

  async requestPinReset(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = req.body;
      if (!phone) {
        res.status(400).json({ success: false, message: 'Phone number required' });
        return;
      }

      await userService.requestPinReset(phone);
      res.json({ success: true, message: 'PIN reset code sent via SMS' });
    } catch (error) {
      console.error('Request PIN reset error:', error);
      res.status(500).json({ success: false, message: 'Failed to send reset code' });
    }
  }

  async resetPin(req: Request, res: Response): Promise<void> {
    try {
      const { phone, code, newPin } = req.body;
      if (!phone || !code || !newPin) {
        res.status(400).json({ success: false, message: 'Phone, code, and new PIN required' });
        return;
      }

      if (!/^\d{4}$/.test(newPin)) {
        res.status(400).json({ success: false, message: 'PIN must be 4 digits' });
        return;
      }

      await userService.resetPin(phone, code, newPin);
      res.json({ success: true, message: 'PIN reset successfully' });
    } catch (error: any) {
      console.error('Reset PIN error:', error);
      res.status(400).json({ success: false, message: error.message || 'PIN reset failed' });
    }
  }

  async changePin(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { currentPin, newPin } = req.body;
      if (!currentPin || !newPin) {
        res.status(400).json({ success: false, message: 'Current and new PIN required' });
        return;
      }

      if (!/^\d{4}$/.test(newPin)) {
        res.status(400).json({ success: false, message: 'PIN must be 4 digits' });
        return;
      }

      await userService.changePin(userId, currentPin, newPin);
      await notifyPinChanged(userId).catch(e => console.error('notifyPinChanged error:', e));
      res.json({ success: true, message: 'PIN changed successfully' });
    } catch (error: any) {
      console.error('Change PIN error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to change PIN' });
    }
  }

  async getProfile(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const user = await userService.getUserById(userId);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      res.json({ success: true, data: user });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch profile' });
    }
  }

  async updateProfile(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { fullName, email } = req.body;
      const user = await userService.updateProfile(userId, { fullName, email });
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      res.json({ success: true, data: user });
    } catch (error: any) {
      console.error('Update profile error:', error.message);
      const message = error.message?.includes('already in use')
        ? error.message
        : 'Failed to update profile';
      res.status(500).json({ success: false, message });
    }
  }

  async resendOTP(req: Request, res: Response): Promise<void> {
    try {
      const { phone, email, purpose } = req.body;
      const identifier = email || phone;
      if (!identifier || !purpose) {
        res.status(400).json({ success: false, message: 'Phone/email and purpose required' });
        return;
      }

      const otp = await otpService.resendOTP(identifier, purpose);
      const isDev = process.env.NODE_ENV === 'development';
      res.json({
        success: true,
        message: 'OTP resent',
        ...(isDev ? { debugCode: otp.code } : {})
      });
    } catch (error) {
      console.error('Resend OTP error:', error);
      res.status(500).json({ success: false, message: 'Failed to resend OTP' });
    }
  }

  async refreshToken(req: Request, res: Response): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ success: false, message: 'No token provided' });
        return;
      }

      const token = authHeader.slice(7);
      const newToken = await userService.refreshToken(token);
      if (!newToken) {
        res.status(401).json({ success: false, message: 'Invalid or expired token' });
        return;
      }

      res.json({ success: true, token: newToken });
    } catch (error) {
      console.error('Refresh token error:', error);
      res.status(500).json({ success: false, message: 'Token refresh failed' });
    }
  }

  async verifyToken(req: Request, res: Response): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ success: false, message: 'No token provided' });
        return;
      }

      const token = authHeader.slice(7);
      const user = await userService.verifyToken(token);
      if (!user) {
        res.status(401).json({ success: false, message: 'Invalid or expired token' });
        return;
      }

      res.json({ success: true, data: user });
    } catch (error) {
      console.error('Verify token error:', error);
      res.status(500).json({ success: false, message: 'Token verification failed' });
    }
  }

  async getReferralStats(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const stats = await userService.getReferralStats(userId);
      res.json({ success: true, data: stats });
    } catch (error: any) {
      console.error('Referral stats error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to fetch referral stats' });
    }
  }

  async checkReferralCode(req: Request, res: Response): Promise<void> {
    try {
      const { code } = req.params;
      if (!code) {
        res.status(400).json({ success: false, message: 'Referral code required' });
        return;
      }

      const result = await userService.checkReferralCode(code);
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Check referral code error:', error);
      res.status(500).json({ success: false, message: 'Failed to check referral code' });
    }
  }

  async requestPhoneVerification(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = req.body;
      const user = await userService.getUserByPhone(phone);
      if (!user) {
        res.status(404).json({ success: false, message: 'Account not found with that phone number' });
        return;
      }

      if (user.phoneVerified) {
        res.status(400).json({ success: false, message: 'Phone already verified' });
        return;
      }

      await userService.requestPhoneVerification(phone);
      const isDev = process.env.NODE_ENV === 'development';
      res.json({
        success: true,
        message: 'Verification code sent via SMS',
        ...(isDev ? { debugCode: 'Use /auth/otp/resend for debug' } : {})
      });
    } catch (error) {
      console.error('Request phone verification error:', error);
      res.status(500).json({ success: false, message: 'Failed to send verification code' });
    }
  }

  async confirmPhoneVerification(req: Request, res: Response): Promise<void> {
    try {
      const { phone, code } = req.body;
      const user = await userService.verifyPhoneOTP(phone, code);
      if (!user) {
        res.status(400).json({ success: false, message: 'Invalid or expired code' });
        return;
      }

      const userJson = user.toJSON();
      delete (userJson as any).pinHash;
      res.json({ success: true, message: 'Phone verified successfully', data: { phoneVerified: true, user: userJson } });
    } catch (error: any) {
      console.error('Confirm phone verification error:', error);
      res.status(400).json({ success: false, message: error.message || 'Verification failed' });
    }
  }

  async submitKyc(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { type, number } = req.body;
      const user = await userService.getUserById(userId);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      if (user.kycVerified) {
        res.status(400).json({ success: false, message: 'KYC already verified' });
        return;
      }

      const updatedUser = await userService.submitKyc(userId, type, number);
      await notifyKycApproved(userId).catch(e => console.error('notifyKycApproved error:', e));
      res.json({ success: true, data: { kycVerified: updatedUser.kycVerified, kycType: updatedUser.kycType } });
    } catch (error) {
      console.error('Submit KYC error:', error);
      res.status(500).json({ success: false, message: 'KYC submission failed' });
    }
  }

  async getKycStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId || (req as any).user?._id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const user = await userService.getUserById(userId);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      res.json({
        success: true,
        data: {
          kycVerified: user.kycVerified,
          kycType: user.kycType,
          kycSubmittedAt: user.kycSubmittedAt,
          kycReviewedAt: user.kycReviewedAt,
          kycReviewNote: user.kycReviewNote
        }
      });
    } catch (error) {
      console.error('Get KYC status error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch KYC status' });
    }
  }
}

export const authController = new AuthController();