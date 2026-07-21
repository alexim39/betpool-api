import mongoose from 'mongoose';
import { OtpModel, IOtp } from '../models/otp.model';
import { UserModel, IUser } from '../models/user.model';
import { sendSms } from './sms.service';
import { sendEmail, wrapEmail, brandedButton } from './email.service';
import { logger } from './logger.service';

export class OtpService {
  private readonly CODE_LENGTH = 6;
  private readonly EXPIRY_MINUTES = 5;
  private readonly MAX_ATTEMPTS = 3;

  private generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  formatPhoneNumber(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('234')) return cleaned;
    if (cleaned.startsWith('0')) return '234' + cleaned.slice(1);
    return '234' + cleaned;
  }

  async sendOTP(phone: string, code: string, purpose: string): Promise<boolean> {
    const formattedPhone = this.formatPhoneNumber(phone);
    const apiToken = process.env.BULKSMS_API_TOKEN;

    logger.debug('OTP sent', { purpose, phone: formattedPhone });

    if (!apiToken) {
      logger.warn('BULKSMS_API_TOKEN not configured - SMS not sent');
      return false;
    }

    const message = `Your BetPool ${purpose} code is: ${code}. Valid for ${this.EXPIRY_MINUTES} minutes. Do not share.`;

    try {
      await sendSms(formattedPhone, message, {
        apiToken,
        from: process.env.BULKSMS_SENDER_ID || 'betpool'
      });
      return true;
    } catch (error: any) {
      logger.error('Failed to send OTP via BulkSMS', error.message || error);
      return false;
    }
  }

  async sendOTPEmail(email: string, code: string, purpose: string): Promise<boolean> {
    const subject = purpose === 'email_login' ? 'Sign In to BetPool' : 'Your BetPool Verification Code';
    const preheader = `Your ${purpose === 'email_login' ? 'login' : 'verification'} code is ${code}`;
    const content = `
      <p style="margin:0 0 16px">Hello,</p>
      <p style="margin:0 0 8px">Use the code below to ${purpose === 'email_login' ? 'sign in to your' : 'verify your'} BetPool account:</p>
      <div style="text-align:center;margin:24px 0">
        <span style="display:inline-block;padding:14px 32px;background:#162245;border:1px solid rgba(255,255,255,0.1);border-radius:10px;font-size:28px;font-weight:700;color:#00E676;letter-spacing:6px;font-family:'Inter',Arial,sans-serif">${code}</span>
      </div>
      <p style="margin:0 0 4px">This code expires in ${this.EXPIRY_MINUTES} minutes. Do not share it with anyone.</p>
      <p style="margin:0;color:rgba(255,255,255,0.4);font-size:13px">If you didn't request this, you can safely ignore this email.</p>
    `;
    const html = wrapEmail(subject, content, preheader);

    try {
      await sendEmail(email, subject, html);
      return true;
    } catch (err) {
      logger.error('Failed to send OTP email', err);
      return false;
    }
  }

  async createOTP(phone: string, purpose: 'signup' | 'login' | 'reset_pin' | 'verify_phone' | 'email_login'): Promise<IOtp> {
    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + this.EXPIRY_MINUTES * 60 * 1000);

    const otp = new OtpModel({
      phone,
      code,
      purpose,
      expiresAt,
      attempts: 0,
      maxAttempts: this.MAX_ATTEMPTS,
      consumed: false
    });

    await otp.save();

    if (purpose === 'email_login') {
      const sent = await this.sendOTPEmail(phone, code, purpose);
      if (!sent) {
        await OtpModel.deleteOne({ _id: otp._id });
        throw new Error('Failed to send verification email. Please check your email address and try again.');
      }
    } else {
      await this.sendOTP(phone, code, purpose);
    }

    return otp;
  }

  async verifyOTP(phone: string, code: string, purpose: 'signup' | 'login' | 'reset_pin' | 'verify_phone' | 'email_login'): Promise<{ valid: boolean; message?: string; user?: IUser }> {
    const otp = await OtpModel.findOne({ 
      phone, 
      purpose, 
      consumed: false,
      expiresAt: { $gt: new Date() }
    }).sort({ createdAt: -1 });

    if (!otp) {
      return { valid: false, message: 'Invalid or expired code. Request a new one.' };
    }

    if (otp.attempts >= otp.maxAttempts) {
      otp.consumed = true;
      await otp.save();
      return { valid: false, message: 'Too many failed attempts. Request a new code.' };
    }

    otp.attempts += 1;
    await otp.save();

    if (otp.code !== code) {
      const remaining = otp.maxAttempts - otp.attempts;
      return { 
        valid: false, 
        message: `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` 
      };
    }

    otp.consumed = true;
    await otp.save();

    if (purpose === 'signup' || purpose === 'login') {
      const user = await UserModel.findOne({ phone });
      if (purpose === 'signup' && !user) {
        return { valid: true, message: 'Phone verified. Complete registration.' };
      }
      if (purpose === 'login' && user) {
        user.lastLoginAt = new Date();
        await user.save();
        return { valid: true, user };
      }
    }

    if (purpose === 'email_login') {
      const user = await UserModel.findOne({ email: phone.toLowerCase() });
      if (user) {
        user.lastLoginAt = new Date();
        await user.save();
        return { valid: true, user };
      }
      return { valid: false, message: 'Account not found with that email' };
    }

    return { valid: true, message: 'Code verified successfully' };
  }

  async resendOTP(phone: string, purpose: 'signup' | 'login' | 'reset_pin' | 'verify_phone' | 'email_login'): Promise<IOtp> {
    await OtpModel.updateMany(
      { phone, purpose, consumed: false },
      { consumed: true }
    );
    return this.createOTP(phone, purpose);
  }
}

export const otpService = new OtpService();