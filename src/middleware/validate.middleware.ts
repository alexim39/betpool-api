import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';

export const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(e => e.msg)
    });
  }
  next();
};

export const validateSignupRequest = [
  body('phone').notEmpty().withMessage('Phone number required'),
  body('email').optional().isEmail().withMessage('Invalid email address'),
  validate
];

export const validateSignupVerify = [
  body('phone').notEmpty().withMessage('Phone number required'),
  body('code').matches(/^\d{6}$/).withMessage('Code must be 6 digits'),
  validate
];

export const validateSignupComplete = [
  body('phone').notEmpty().withMessage('Phone number required'),
  body('fullName').isLength({ min: 2 }).withMessage('Full name must be at least 2 characters'),
  body('pin').matches(/^\d{4}$/).withMessage('PIN must be 4 digits'),
  body('code').matches(/^\d{6}$/).withMessage('Verification code must be 6 digits'),
  body('email').optional().isEmail().withMessage('Invalid email address'),
  body('referralCode').optional().matches(/^[A-Z0-9]{6}$/).withMessage('Invalid referral code'),
  validate
];

export const validateLoginPin = [
  body('phone').optional().notEmpty().withMessage('Phone number required'),
  body('email').optional().isEmail().withMessage('Invalid email address'),
  body('pin').matches(/^\d{4,6}$/).withMessage('PIN must be 4-6 digits'),
  body().custom((value, { req }) => {
    if (!req.body.phone && !req.body.email) {
      throw new Error('Phone or email required');
    }
    return true;
  }),
  validate
];

export const validateLoginRequest = [
  body('phone').notEmpty().withMessage('Phone number required'),
  validate
];

export const validateLoginVerify = [
  body('phone').notEmpty().withMessage('Phone number required'),
  body('code').matches(/^\d{6}$/).withMessage('Code must be 6 digits'),
  validate
];

export const validatePinReset = [
  body('phone').notEmpty().withMessage('Phone number required'),
  body('code').matches(/^\d{6}$/).withMessage('Code must be 6 digits'),
  body('newPin').matches(/^\d{4}$/).withMessage('PIN must be 4 digits'),
  validate
];

export const validatePlaceStake = [
  body('podId').optional().isMongoId().withMessage('Invalid pod ID'),
  body('oddsOfferId').optional().isMongoId().withMessage('Invalid odds offer ID'),
  body('podIds').optional().isArray({ min: 2, max: 5 }).withMessage('Accumulator requires 2-5 pod IDs'),
  body('podIds.*').optional().isMongoId().withMessage('Invalid pod ID in accumulator'),
  body('stakeAmount').isInt({ min: 10 }).withMessage('Stake amount must be at least 10'),
  validate
];

export const validateDeposit = [
  body('amount').isInt({ min: 5000 }).withMessage('Minimum deposit is ₦5,000'),
  body('amount').isInt({ max: 1000000 }).withMessage('Maximum deposit is ₦1,000,000'),
  body('provider').equals('paystack').withMessage('Invalid provider'),
  validate
];

export const validateWithdrawal = [
  body('amount').isInt({ min: 500 }).withMessage('Minimum withdrawal is ₦500'),
  body('bankCode').notEmpty().withMessage('Bank code required'),
  body('accountNumber').matches(/^\d{10}$/).withMessage('Account number must be 10 digits'),
  body('accountName').notEmpty().withMessage('Account name required'),
  body('pin').matches(/^\d{4}$/).withMessage('PIN must be 4 digits'),
  validate
];

export const validateUpdateProfile = [
  body('fullName').optional().isLength({ min: 2 }).withMessage('Full name must be at least 2 characters'),
  body('email').optional().isEmail().withMessage('Invalid email address'),
  validate
];

export const validateLoginEmailRequest = [
  body('email').isEmail().withMessage('Valid email required'),
  validate
];

export const validateLoginEmailVerify = [
  body('email').isEmail().withMessage('Valid email required'),
  body('code').matches(/^\d{6}$/).withMessage('Code must be 6 digits'),
  validate
];

export const validateKyc = [
  body('type').isIn(['bvn', 'nin']).withMessage('Type must be bvn or nin'),
  body('number').matches(/^\d{11}$/).withMessage('Number must be 11 digits'),
  validate
];

export const validatePhoneVerificationRequest = [
  body('phone').notEmpty().withMessage('Phone number required'),
  validate
];

export const validatePhoneVerificationConfirm = [
  body('phone').notEmpty().withMessage('Phone number required'),
  body('code').matches(/^\d{6}$/).withMessage('Code must be 6 digits'),
  validate
];

export const validateOraChat = [
  body('messages').isArray({ min: 1 }).withMessage('Messages must be a non-empty array'),
  body('messages.*.role').isIn(['system', 'user', 'assistant']).withMessage('Invalid message role'),
  body('messages.*.content').isString().notEmpty().withMessage('Message content is required'),
  validate
];
