import bcrypt from 'bcryptjs';
import { UserService } from '../../services/user.service';

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
jest.mock('../../services/sms.service');
jest.mock('../../services/otp.service', () => ({
  otpService: {
    generateOTP: jest.fn(),
    verifyOTP: jest.fn().mockResolvedValue({ valid: true }),
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
        isSuspended: false
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
});
