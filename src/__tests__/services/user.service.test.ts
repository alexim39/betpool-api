import bcrypt from 'bcryptjs';
import type { UserService as UserServiceType } from '../../services/user.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const { UserService } = require('../../services/user.service');
type UserService = UserServiceType;

jest.mock('mongoose', () => {
  const mockSession = {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn().mockResolvedValue(undefined)
  };
  const actual = jest.requireActual('mongoose');
  return { ...actual, startSession: jest.fn().mockResolvedValue(mockSession) };
});

jest.mock('../../models/user.model');
jest.mock('../../models/wallet.model');
jest.mock('../../models/transaction.model');
jest.mock('../../services/sms.service');
jest.mock('../../services/notification.service', () => ({
  notifyReferralBonusPaid: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../services/otp.service', () => ({
  otpService: {
    generateOTP: jest.fn(),
    verifyOTP: jest.fn().mockResolvedValue({ valid: true }),
    consumeOTP: jest.fn().mockResolvedValue(true),
    createOTP: jest.fn(),
    sendOTPEmail: jest.fn(),
    formatPhoneNumber: jest.fn().mockImplementation((phone: string) => {
      return phone.startsWith('0') ? '234' + phone.slice(1) : phone;
    })
  }
}));
jest.mock('bcryptjs');

const MockUserModel = require('../../models/user.model').UserModel;
const MockWalletModel = require('../../models/wallet.model').WalletModel;
const MockTransactionModel = require('../../models/transaction.model').TransactionModel;
const mockBcryptHash = bcrypt.hash as jest.Mock;
const mockBcryptCompare = bcrypt.compare as jest.Mock;

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    service = new UserService();
    jest.clearAllMocks();
    const chainSession = jest.fn().mockResolvedValue(undefined);
    const chainable = { session: chainSession };
    MockWalletModel.deleteOne.mockReturnValue(chainable);
    MockWalletModel.findOne.mockReturnValue(chainable);
  });

  describe('signup', () => {
    const signupData = {
      phone: '08031234567',
      fullName: 'Test User',
      pin: '123456',
      code: '123456'
    };

    it('should create a user and wallet', async () => {
      MockUserModel.findOne.mockResolvedValue(null);
      mockBcryptHash.mockResolvedValue('hashed-pin-123');
      const mockUser = {
        _id: 'user-id-1',
        phone: '2348031234567',
        fullName: 'Test User',
        pinHash: 'hashed-pin-123',
        referralCode: 'ABC123',
        phoneVerified: false,
        kycVerified: false,
        isActive: true,
        isSuspended: false,
        lastLoginAt: undefined,
        save: jest.fn().mockResolvedValue(undefined)
      };
      MockUserModel.create.mockResolvedValue([mockUser]);
      MockWalletModel.create.mockResolvedValue([{ _id: 'wallet-id-1' }]);

      const result = await service.signup(signupData);

      expect(MockUserModel.findOne).toHaveBeenCalledWith({ phone: '2348031234567' });
      expect(MockUserModel.create).toHaveBeenCalled();
      expect(MockWalletModel.create).toHaveBeenCalled();
      expect(result.user).toBe(mockUser);
      expect(result.token).toBeTruthy();
      expect(result.isNewUser).toBe(true);
    });

    it('should throw if phone already registered', async () => {
      MockUserModel.findOne.mockResolvedValue({ phone: '2348031234567' });

      await expect(service.signup(signupData)).rejects.toThrow(
        'Phone number already registered'
      );
    });

    it('should link referral code if valid referrer found', async () => {
      MockUserModel.findOne
        .mockResolvedValueOnce(null) // no existing user
        .mockResolvedValueOnce({ _id: 'referrer-id-1', referralCode: 'REF123' }); // referrer found
      mockBcryptHash.mockResolvedValue('hashed-pin');
      const mockUser = {
        _id: 'user-id-2',
        phone: '2348031234567',
        referralCode: 'XYZ789',
        referredBy: 'referrer-id-1',
        save: jest.fn().mockResolvedValue(undefined)
      };
      MockUserModel.create.mockResolvedValue([mockUser]);
      MockWalletModel.create.mockResolvedValue([{ _id: 'wallet-id-2' }]);

      const result = await service.signup({ ...signupData, referralCode: 'REF123' });

      expect(result.user.referredBy).toBe('referrer-id-1');
    });
  });

  describe('login', () => {
    const loginData = { phone: '08031234567', pin: '123456' };

    it('should return user and token for valid credentials', async () => {
      const mockUser = {
        _id: 'user-id-1',
        phone: '2348031234567',
        pinHash: 'hashed-pin',
        isActive: true,
        isSuspended: false,
        lastLoginAt: undefined,
        save: jest.fn().mockResolvedValue(undefined)
      };
      MockUserModel.findOne.mockResolvedValue(mockUser);
      mockBcryptCompare.mockResolvedValue(true);

      const result = await service.login(loginData);

      expect(result.user).toBe(mockUser);
      expect(result.token).toBeTruthy();
      expect(mockUser.lastLoginAt).toBeInstanceOf(Date);
    });

    it('should throw for non-existent user', async () => {
      MockUserModel.findOne.mockResolvedValue(null);

      await expect(service.login(loginData)).rejects.toThrow('Invalid credentials');
    });

    it('should throw for suspended account', async () => {
      MockUserModel.findOne.mockResolvedValue({
        phone: '2348031234567',
        isActive: true,
        isSuspended: true
      });

      await expect(service.login(loginData)).rejects.toThrow('Account suspended');
    });

    it('should throw for wrong PIN', async () => {
      MockUserModel.findOne.mockResolvedValue({
        _id: 'user-id-1',
        phone: '2348031234567',
        pinHash: 'hashed-pin',
        isActive: true,
        isSuspended: false,
        save: jest.fn().mockResolvedValue(undefined)
      });
      mockBcryptCompare.mockResolvedValue(false);

      await expect(service.login(loginData)).rejects.toThrow('Invalid credentials');
    });
  });

  describe('verifyToken', () => {
    it('should return user for valid token', async () => {
      const mockUser = { _id: 'user-id-1', phone: '2348031234567' };
      MockUserModel.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUser)
      });

      const token = (service as any).generateToken('user-id-1');
      const result = await service.verifyToken(token);

      expect(result).toEqual(mockUser);
      expect(MockUserModel.findById).toHaveBeenCalledWith('user-id-1');
    });

    it('should return null for invalid token', async () => {
      const result = await service.verifyToken('invalid-token');
      expect(result).toBeNull();
    });

    it('should return null when user not found', async () => {
      MockUserModel.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue(null)
      });

      const token = (service as any).generateToken('nonexistent-id');
      const result = await service.verifyToken(token);

      expect(result).toBeNull();
    });
  });

  describe('changePin', () => {
    it('should update pin hash when current pin is correct', async () => {
      const mockUser = {
        _id: 'user-id-1',
        pinHash: 'old-hash',
        save: jest.fn().mockResolvedValue(undefined)
      };
      MockUserModel.findById.mockResolvedValue(mockUser);
      mockBcryptCompare.mockResolvedValue(true);
      mockBcryptHash.mockResolvedValue('new-hash');

      await service.changePin('user-id-1', '123456', '654321');

      expect(mockBcryptCompare).toHaveBeenCalledWith('123456', 'old-hash');
      expect(mockBcryptHash).toHaveBeenCalledWith('654321', 10);
      expect(mockUser.pinHash).toBe('new-hash');
      expect(mockUser.save).toHaveBeenCalled();
    });

    it('should throw if user not found', async () => {
      MockUserModel.findById.mockResolvedValue(null);

      await expect(
        service.changePin('user-id-1', '123456', '654321')
      ).rejects.toThrow('User not found');
    });

    it('should throw if current pin is incorrect', async () => {
      MockUserModel.findById.mockResolvedValue({
        _id: 'user-id-1',
        pinHash: 'old-hash'
      });
      mockBcryptCompare.mockResolvedValue(false);

      await expect(
        service.changePin('user-id-1', 'wrong', '654321')
      ).rejects.toThrow('Current PIN is incorrect');
    });
  });

  describe('getReferralStats', () => {
    const VALID_OID = '5f7c8a9b0c1d2e3f4a5b6c7d';
    const VALID_OID_2 = '5f7c8a9b0c1d2e3f4a5b6c7e';

    it('should sum only referral bonus transactions (not other bonus types)', async () => {
      MockUserModel.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({ referralCode: 'ABC123' })
      });
      MockUserModel.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue([{ fullName: 'Jane Doe', createdAt: new Date() }])
      });
      MockTransactionModel.aggregate.mockResolvedValue([{ total: 500 }]);

      const result = await service.getReferralStats(VALID_OID);

      expect(result.referralCode).toBe('ABC123');
      expect(result.totalReferrals).toBe(1);
      expect(result.referralBonus).toBe(500);

      const pipeline = MockTransactionModel.aggregate.mock.calls[0][0];
      const match = pipeline[0].$match;
      expect(match.type).toBe('bonus');
      expect(match.status).toBe('completed');
      expect(match.$or[0]['metadata.referralBonus']).toBe(true);
      expect(match.$or[1].description).toBeInstanceOf(RegExp);
    });

    it('should return zero bonus when there are no bonus transactions', async () => {
      MockUserModel.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({ referralCode: 'ZZZ999' })
      });
      MockUserModel.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue([])
      });
      MockTransactionModel.aggregate.mockResolvedValue([]);

      const result = await service.getReferralStats(VALID_OID_2);

      expect(result.totalReferrals).toBe(0);
      expect(result.referralBonus).toBe(0);
    });
  });

  describe('payReferralBonusOnStake', () => {
    it('should tag the bonus transaction for referral tracking', async () => {
      MockUserModel.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          referredBy: '5f7c8a9b0c1d2e3f4a5b6c7d',
          referralBonusPaid: false,
          fullName: 'Referee',
          save: jest.fn().mockResolvedValue(undefined)
        })
      });
      MockWalletModel.findOneAndUpdate.mockResolvedValue({ balance: 1000 });
      MockTransactionModel.create.mockResolvedValue(undefined);

      await service.payReferralBonusOnStake('5f7c8a9b0c1d2e3f4a5b6c7e');

      expect(MockUserModel.findById).toHaveBeenCalledWith('5f7c8a9b0c1d2e3f4a5b6c7e');
      expect(MockWalletModel.findOneAndUpdate).toHaveBeenCalled();
      expect(MockTransactionModel.create).toHaveBeenCalled();
      const tx = MockTransactionModel.create.mock.calls[0][0][0];
      expect(tx.type).toBe('bonus');
      expect(tx.amount).toBe(500);
      expect(tx.metadata).toEqual({ referralBonus: true });
    });
  });
});