import { OtpService } from '../../services/otp.service';

jest.mock('../../models/otp.model');
jest.mock('../../models/user.model');
jest.mock('../../services/sms.service');

const MockOtpModel = require('../../models/otp.model').OtpModel;
const MockUserModel = require('../../models/user.model').UserModel;
const mockSendSms = require('../../services/sms.service').sendSms;

describe('OtpService', () => {
  let service: OtpService;

  beforeEach(() => {
    service = new OtpService();
    jest.clearAllMocks();
  });

  describe('generateCode', () => {
    it('should return a 6-digit string', () => {
      const code = (service as any).generateCode();
      expect(code).toMatch(/^\d{6}$/);
    });

    it('should return different codes on successive calls', () => {
      const code1 = (service as any).generateCode();
      const code2 = (service as any).generateCode();
      expect(code1).not.toBe(code2);
    });
  });

  describe('formatPhoneNumber', () => {
    it('should format 0803... to 234803...', () => {
      expect(service.formatPhoneNumber('08031234567')).toBe('2348031234567');
    });

    it('should return 234... numbers unchanged', () => {
      expect(service.formatPhoneNumber('2348031234567')).toBe('2348031234567');
    });

    it('should strip non-digit characters', () => {
      expect(service.formatPhoneNumber('+234 803 123 4567')).toBe('2348031234567');
    });
  });

  describe('sendOTP', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...OLD_ENV };
    });

    afterEach(() => {
      process.env = OLD_ENV;
    });

    it('should log to console and return true when BULKSMS_API_TOKEN is not set', async () => {
      delete process.env.BULKSMS_API_TOKEN;
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = await service.sendOTP('2348031234567', '123456', 'signup');

      expect(result).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'BULKSMS_API_TOKEN not configured - OTP would be sent in production'
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[DEV] OTP for 2348031234567: 123456 (purpose: signup)'
      );

      consoleWarnSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should call sendSms and return true when API token is set', async () => {
      mockSendSms.mockResolvedValue({ status: 'success' });

      const result = await service.sendOTP('2348031234567', '123456', 'login');

      expect(result).toBe(true);
      expect(mockSendSms).toHaveBeenCalledWith(
        '2348031234567',
        expect.stringContaining('123456'),
        expect.objectContaining({ apiToken: 'test-bulksms-token' })
      );
    });

    it('should return false when sendSms throws', async () => {
      mockSendSms.mockRejectedValue(new Error('API error'));
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await service.sendOTP('2348031234567', '123456', 'signup');

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('createOTP', () => {
    it('should create an OTP document and send it', async () => {
      mockSendSms.mockResolvedValue({ status: 'success' });
      const testOtp = {
        phone: '2348031234567',
        code: '654321',
        purpose: 'signup',
        attempts: 0,
        maxAttempts: 3,
        consumed: false,
        expiresAt: new Date(Date.now() + 300000),
        save: jest.fn().mockResolvedValue(undefined)
      };
      MockOtpModel.mockImplementation(() => testOtp);

      const otp = await service.createOTP('2348031234567', 'signup');

      expect(otp).toBeDefined();
      expect(otp.phone).toBe('2348031234567');
      expect(otp.code).toMatch(/^\d{6}$/);
      expect(otp.purpose).toBe('signup');
      expect(otp.attempts).toBe(0);
      expect(otp.maxAttempts).toBe(3);
      expect(otp.consumed).toBe(false);
      expect(otp.expiresAt).toBeInstanceOf(Date);
      expect(mockSendSms).toHaveBeenCalled();
    });
  });

  describe('verifyOTP', () => {
    function makeFindOneSortable(result: any) {
      return {
        sort: jest.fn().mockResolvedValue(result)
      };
    }

    it('should return invalid when no matching OTP found', async () => {
      MockOtpModel.findOne.mockReturnValue(makeFindOneSortable(null));

      const result = await service.verifyOTP('2348031234567', '123456', 'signup');

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Invalid or expired code. Request a new one.');
    });

    it('should return invalid when max attempts exceeded', async () => {
      const mockOtp = {
        attempts: 3,
        maxAttempts: 3,
        consumed: false,
        save: jest.fn().mockResolvedValue(undefined)
      };
      MockOtpModel.findOne.mockReturnValue(makeFindOneSortable(mockOtp));

      const result = await service.verifyOTP('2348031234567', '123456', 'signup');

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Too many failed attempts. Request a new code.');
      expect(mockOtp.consumed).toBe(true);
    });

    it('should return invalid for wrong code with remaining attempts message', async () => {
      const mockOtp = {
        code: '654321',
        attempts: 0,
        maxAttempts: 3,
        consumed: false,
        save: jest.fn().mockResolvedValue(undefined)
      };
      MockOtpModel.findOne.mockReturnValue(makeFindOneSortable(mockOtp));

      const result = await service.verifyOTP('2348031234567', '123456', 'signup');

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Incorrect code. 2 attempts remaining.');
      expect(mockOtp.attempts).toBe(1);
    });

    it('should return valid for matching code with signup purpose and no user', async () => {
      const mockOtp = {
        code: '123456',
        attempts: 0,
        maxAttempts: 3,
        consumed: false,
        save: jest.fn().mockResolvedValue(undefined)
      };
      MockOtpModel.findOne.mockReturnValue(makeFindOneSortable(mockOtp));
      MockUserModel.findOne.mockResolvedValue(null);

      const result = await service.verifyOTP('2348031234567', '123456', 'signup');

      expect(result.valid).toBe(true);
      expect(result.message).toBe('Phone verified. Complete registration.');
      expect(mockOtp.consumed).toBe(true);
    });

    it('should return valid with user for login purpose', async () => {
      const mockOtp = {
        code: '123456',
        attempts: 0,
        maxAttempts: 3,
        consumed: false,
        save: jest.fn().mockResolvedValue(undefined)
      };
      const mockUser = {
        phone: '2348031234567',
        lastLoginAt: undefined,
        save: jest.fn().mockResolvedValue(undefined)
      };
      MockOtpModel.findOne.mockReturnValue(makeFindOneSortable(mockOtp));
      MockUserModel.findOne.mockResolvedValue(mockUser);

      const result = await service.verifyOTP('2348031234567', '123456', 'login');

      expect(result.valid).toBe(true);
      expect(result.user).toBe(mockUser);
      expect(mockUser.lastLoginAt).toBeInstanceOf(Date);
    });
  });

  describe('resendOTP', () => {
    it('should invalidate old OTPs and create a new one', async () => {
      mockSendSms.mockResolvedValue({ status: 'success' });
      MockOtpModel.updateMany.mockResolvedValue({ modifiedCount: 2 });
      const testOtp = {
        phone: '2348031234567',
        code: '123456',
        purpose: 'signup',
        attempts: 0,
        maxAttempts: 3,
        consumed: false,
        expiresAt: new Date(Date.now() + 300000),
        save: jest.fn().mockResolvedValue(undefined)
      };
      MockOtpModel.mockImplementation(() => testOtp);

      const otp = await service.resendOTP('2348031234567', 'signup');

      expect(MockOtpModel.updateMany).toHaveBeenCalledWith(
        { phone: '2348031234567', purpose: 'signup', consumed: false },
        { consumed: true }
      );
      expect(otp).toBeDefined();
      expect(otp.phone).toBe('2348031234567');
      expect(otp.purpose).toBe('signup');
    });
  });
});
