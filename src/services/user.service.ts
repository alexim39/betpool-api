import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { UserModel, IUser } from '../models/user.model';
import { WalletModel, IWallet } from '../models/wallet.model';
import { TransactionModel } from '../models/transaction.model';
import { otpService } from './otp.service';
import { paymentService } from './payment.service';
import { logger } from './logger.service';

export interface SignupData {
  phone: string;
  fullName: string;
  pin: string;
  referralCode?: string;
  email?: string;
  code: string;
}

export interface LoginData {
  phone: string;
  pin: string;
}

export interface AuthResult {
  user: IUser;
  token: string;
  isNewUser?: boolean;
}

export class UserService {
  private readonly PIN_SALT_ROUNDS = 10;
  private readonly JWT_SECRET = (() => {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
    return process.env.JWT_SECRET;
  })();
  private readonly JWT_EXPIRY = process.env.JWT_EXPIRY || '7d';

  private generateReferralCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  generateToken(userId: string, role?: string): string {
    return jwt.sign({ userId, role: role || 'user' }, this.JWT_SECRET, { expiresIn: this.JWT_EXPIRY } as jwt.SignOptions);
  }

  async refreshToken(token: string): Promise<string | null> {
    try {
      const decoded = jwt.verify(token, this.JWT_SECRET, { ignoreExpiration: true }) as { userId: string; role?: string };
      const user = await UserModel.findById(decoded.userId).select('_id role');
      if (!user) return null;
      return this.generateToken(decoded.userId, decoded.role || user.role);
    } catch {
      return null;
    }
  }

  private decodeToken(token: string): { userId: string; role?: string } | null {
    try {
      const decoded = jwt.verify(token, this.JWT_SECRET) as { userId: string; role?: string };
      return { userId: decoded.userId, role: decoded.role };
    } catch {
      return null;
    }
  }

  async provisionFirstAdmin(email: string): Promise<void> {
    const pinHash = await bcrypt.hash(Math.random().toString(), this.PIN_SALT_ROUNDS);
    const referralCode = this.generateReferralCode();

    await UserModel.create({
      phone: `+234${Math.random().toString().slice(2, 12)}`,
      fullName: 'Admin',
      email: email.toLowerCase().trim(),
      pinHash,
      role: 'admin',
      referralCode,
      phoneVerified: true,
      kycVerified: true,
      isActive: true,
      isSuspended: false
    });

    logger.info('First admin provisioned', email);
  }

  async signup(data: SignupData): Promise<AuthResult> {
    const formattedPhone = otpService.formatPhoneNumber(data.phone);

    const existing = await UserModel.findOne({ phone: formattedPhone });
    if (existing) {
      throw new Error('Phone number already registered');
    }

    let referredBy: mongoose.Types.ObjectId | undefined;
    if (data.referralCode) {
      const referrer = await UserModel.findOne({ referralCode: data.referralCode });
      if (referrer) referredBy = referrer._id;
    }

    const pinHash = await bcrypt.hash(data.pin, this.PIN_SALT_ROUNDS);
    const referralCode = this.generateReferralCode();

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Clean up any stale wallet with null userId before creating new user
      await WalletModel.deleteOne({ user: null }).session(session);

      const [user] = await UserModel.create([{
        phone: formattedPhone,
        fullName: data.fullName,
        pinHash,
        email: data.email || undefined,
        referralCode,
        referredBy,
        phoneVerified: true,
        kycVerified: false,
        isActive: true,
        isSuspended: false
      }], { session });

      logger.info('User created', user._id);
      const [wallet] = await WalletModel.create([{
        user: user._id,
        balance: 0,
        lockedBalance: 0,
        currency: 'NGN'
      }], { session });
      logger.info('Wallet created', wallet._id);

      // Credit referrer bonus
      if (referredBy) {
        const referrerWallet = await WalletModel.findOne({ user: referredBy }).session(session);
        if (referrerWallet) {
          const BONUS_AMOUNT = 500;
          referrerWallet.balance += BONUS_AMOUNT;
          await referrerWallet.save({ session });
          await TransactionModel.create([{
            user: referredBy,
            type: 'bonus',
            status: 'completed',
            amount: BONUS_AMOUNT,
            netAmount: BONUS_AMOUNT,
            description: `Referral bonus — ${data.fullName} signed up using your code`,
            reference: `REFBONUS-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
          }], { session });
        }
      }

      user.lastLoginAt = new Date();
      await user.save({ session });

      await session.commitTransaction();

      const token = this.generateToken(user._id.toString(), user.role);
      return { user, token, isNewUser: true };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async login(data: LoginData): Promise<AuthResult> {
    const formattedPhone = otpService.formatPhoneNumber(data.phone);

    const user = await UserModel.findOne({ phone: formattedPhone });
    if (!user) {
      throw new Error('Invalid credentials');
    }

    if (!user.isActive || user.isSuspended) {
      throw new Error('Account suspended. Contact support.');
    }

    const isValid = await bcrypt.compare(data.pin, user.pinHash);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    const token = this.generateToken(user._id.toString(), user.role);
    user.lastLoginAt = new Date();
    await user.save();

    return { user, token };
  }

  async verifyPin(userId: string, pin: string): Promise<boolean> {
    const user = await UserModel.findById(userId).select('+pinHash');
    if (!user) return false;
    return bcrypt.compare(pin, user.pinHash);
  }

  async verifyPhoneOTP(phone: string, code: string): Promise<IUser | null> {
    const result = await otpService.verifyOTP(phone, code, 'verify_phone');
    if (!result.valid) {
      throw new Error(result.message || 'Verification failed');
    }

    const formattedPhone = otpService.formatPhoneNumber(phone);
    const user = await UserModel.findOneAndUpdate(
      { phone: formattedPhone },
      { phoneVerified: true },
      { new: true }
    );

    return user;
  }

  async requestPhoneVerification(phone: string): Promise<void> {
    await otpService.createOTP(phone, 'verify_phone');
  }

  async requestLoginOTP(phone: string): Promise<void> {
    await otpService.createOTP(phone, 'login');
  }

  async verifyLoginOTP(phone: string, code: string): Promise<AuthResult> {
    const result = await otpService.verifyOTP(phone, code, 'login');
    if (!result.valid) {
      throw new Error(result.message || 'Verification failed');
    }

    const formattedPhone = otpService.formatPhoneNumber(phone);
    const user = await UserModel.findOne({ phone: formattedPhone });
    if (!user) throw new Error('User not found');
    if (!user.isActive || user.isSuspended) throw new Error('Account suspended. Contact support.');

    const token = this.generateToken(user._id.toString());
    user.lastLoginAt = new Date();
    await user.save();

    return { user, token };
  }

  async verifyLoginEmailToken(email: string, code: string): Promise<AuthResult> {
    const result = await otpService.verifyOTP(email.toLowerCase().trim(), code, 'email_login');
    if (!result.valid) {
      throw new Error(result.message || 'Verification failed');
    }

    const user = await UserModel.findOne({ email: email.toLowerCase().trim() });
    if (!user) throw new Error('User not found');
    if (!user.isActive || user.isSuspended) throw new Error('Account suspended. Contact support.');

    const token = this.generateToken(user._id.toString(), user.role);
    user.lastLoginAt = new Date();
    await user.save();

    return { user, token };
  }

  async changePin(userId: string, currentPin: string, newPin: string): Promise<void> {
    const user = await UserModel.findById(userId);
    if (!user) throw new Error('User not found');

    const isValid = await bcrypt.compare(currentPin, user.pinHash);
    if (!isValid) throw new Error('Current PIN is incorrect');

    user.pinHash = await bcrypt.hash(newPin, this.PIN_SALT_ROUNDS);
    await user.save();
  }

  async requestPinReset(phone: string): Promise<void> {
    await otpService.createOTP(phone, 'reset_pin');
  }

  async resetPin(phone: string, code: string, newPin: string): Promise<void> {
    const result = await otpService.verifyOTP(phone, code, 'reset_pin');
    if (!result.valid) {
      throw new Error(result.message || 'Invalid reset code');
    }

    const formattedPhone = otpService.formatPhoneNumber(phone);
    const user = await UserModel.findOne({ phone: formattedPhone });
    if (!user) throw new Error('User not found');

    user.pinHash = await bcrypt.hash(newPin, this.PIN_SALT_ROUNDS);
    await user.save();
  }

  async getUserById(userId: string): Promise<IUser | null> {
    return UserModel.findById(userId).select('-pinHash');
  }

  async getUserByPhone(phone: string): Promise<IUser | null> {
    const formattedPhone = otpService.formatPhoneNumber(phone);
    return UserModel.findOne({ phone: formattedPhone }).select('-pinHash');
  }

  async getUserByEmail(email: string): Promise<IUser | null> {
    return UserModel.findOne({ email: email.toLowerCase().trim() }).select('-pinHash');
  }

  async updateProfile(userId: string, data: Partial<Pick<IUser, 'fullName' | 'email'>>): Promise<IUser | null> {
    if (data.email) {
      const existing = await UserModel.findOne({ email: data.email, _id: { $ne: userId } }).lean();
      if (existing) {
        throw new Error('This email is already in use by another account');
      }
    }
    return UserModel.findByIdAndUpdate(
      userId,
      { $set: data },
      { new: true, select: '-pinHash' }
    );
  }

  async verifyToken(token: string): Promise<IUser | null> {
    const decoded = this.decodeToken(token);
    if (!decoded) return null;

    return UserModel.findById(decoded.userId).select('-pinHash');
  }

  async getReferralStats(userId: string): Promise<{
    referralCode: string;
    totalReferrals: number;
    referralBonus: number;
    referrals: Array<{ fullName: string; joinedAt: Date }>;
  }> {
    const user = await UserModel.findById(userId).select('referralCode');
    if (!user) throw new Error('User not found');

    const referredUsers = await UserModel.find({ referredBy: userId })
      .select('fullName createdAt')
      .sort({ createdAt: -1 });

    const bonusResult = await TransactionModel.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId), type: 'bonus', status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const referralBonus = bonusResult.length > 0 ? bonusResult[0].total : 0;

    return {
      referralCode: user.referralCode,
      totalReferrals: referredUsers.length,
      referralBonus,
      referrals: referredUsers.map(u => ({
        fullName: u.fullName,
        joinedAt: u.createdAt
      }))
    };
  }

  async checkReferralCode(code: string): Promise<{ valid: boolean; referrer?: string }> {
    const user = await UserModel.findOne({ referralCode: code.toUpperCase() }).select('fullName');
    if (!user) return { valid: false };
    return { valid: true, referrer: user.fullName };
  }

  async submitKyc(userId: string, type: 'bvn' | 'nin', number: string): Promise<IUser> {
    const user = await UserModel.findById(userId);
    if (!user) throw new Error('User not found');

    const kycData: any = {};
    if (type === 'bvn') {
      if (!/^\d{11}$/.test(number)) throw new Error('BVN must be exactly 11 digits');
      kycData.bvn = number;

      const bvnData = await paymentService.verifyBvn(number);
      if (!bvnData) throw new Error('BVN verification failed. Check the number and try again.');

      kycData.bvnVerifiedName = `${bvnData.firstName} ${bvnData.lastName}`;
      // Auto-verify if name matches the user's registered name
      if (user.fullName && bvnData.firstName && bvnData.lastName) {
        const userName = user.fullName.toLowerCase().replace(/\s+/g, ' ');
        const bvnName = `${bvnData.firstName} ${bvnData.lastName}`.toLowerCase().replace(/\s+/g, ' ');
        if (userName.includes(bvnName) || bvnName.includes(userName)) {
          user.kycVerified = true;
        }
      }
    }
    if (type === 'nin') {
      if (!/^\d{11}$/.test(number)) throw new Error('NIN must be exactly 11 digits');
      kycData.nin = number;

      const ninData = await paymentService.verifyNin(number);
      if (!ninData) throw new Error('NIN verification failed. Check the number and try again.');

      kycData.ninVerifiedName = `${ninData.firstName} ${ninData.lastName}`;
      if (user.fullName && ninData.firstName && ninData.lastName) {
        const userName = user.fullName.toLowerCase().replace(/\s+/g, ' ');
        const ninName = `${ninData.firstName} ${ninData.lastName}`.toLowerCase().replace(/\s+/g, ' ');
        if (userName.includes(ninName) || ninName.includes(userName)) {
          user.kycVerified = true;
        }
      }
    }

    user.kycType = type;
    user.kycNumber = number;
    user.kycSubmittedAt = new Date();
    user.kycData = { ...user.kycData, ...kycData };

    // If auto-verification wasn't triggered, mark as pending review
    if (user.kycVerified) {
      user.kycReviewedAt = new Date();
    }

    await user.save();
    return user;
  }
}

export const userService = new UserService();