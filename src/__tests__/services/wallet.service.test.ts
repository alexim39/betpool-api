import { WalletService } from '../../services/wallet.service';

jest.mock('../../models/wallet.model');
jest.mock('../../models/transaction.model');
jest.mock('../../models/stake.model');

const MockWalletModel = require('../../models/wallet.model').WalletModel;
const MockTransactionModel = require('../../models/transaction.model').TransactionModel;

describe('WalletService', () => {
  let service: WalletService;

  beforeEach(() => {
    service = new WalletService();
    jest.clearAllMocks();
  });

  describe('getBalance', () => {
    it('should return balance, locked, and available', async () => {
      MockWalletModel.findOne.mockResolvedValue({
        balance: 5000,
        lockedBalance: 1000
      });

      const result = await service.getBalance('user-id-1');

      expect(result).toEqual({
        balance: 5000,
        locked: 1000,
        available: 4000
      });
    });

    it('should create wallet if not found', async () => {
      MockWalletModel.findOne.mockResolvedValue(null);
      MockWalletModel.create.mockResolvedValue({
        balance: 0,
        lockedBalance: 0
      });

      const result = await service.getBalance('user-id-1');

      expect(MockWalletModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ user: 'user-id-1', balance: 0, currency: 'NGN' })
      );
      expect(result).toEqual({ balance: 0, locked: 0, available: 0 });
    });
  });

  describe('initiateDeposit', () => {
    it('should fail for amount below minimum', async () => {
      const result = await service.initiateDeposit('user-id-1', 50, 'paystack');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Minimum deposit is ₦100');
    });

    it('should create transaction and return authorization URL for paystack', async () => {
      MockWalletModel.findOne.mockResolvedValue({
        _id: 'wallet-id-1',
        balance: 1000,
        lockedBalance: 0
      });
      MockTransactionModel.create.mockResolvedValue({
        _id: 'txn-1',
        reference: 'DEP_123'
      });

      const result = await service.initiateDeposit('user-id-1', 5000, 'paystack');

      expect(result.success).toBe(true);
      expect(result.reference).toBeTruthy();
      expect(result.authorizationUrl).toContain('checkout.paystack.com');
      expect(result.message).toBe('Deposit initiated. Complete payment to credit your wallet.');
      expect(MockTransactionModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user: 'user-id-1',
          type: 'deposit',
          status: 'pending',
          amount: 5000,
          provider: 'paystack'
        })
      );
    });

  });

  describe('getTransactionHistory', () => {
    it('should return paginated transactions', async () => {
      const mockTransactions = [
        { _id: 'txn-1', amount: 5000, type: 'deposit' },
        { _id: 'txn-2', amount: 2000, type: 'withdrawal' }
      ];
      MockTransactionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue(mockTransactions)
            })
          })
        })
      });
      MockTransactionModel.countDocuments.mockResolvedValue(10);

      const result = await service.getTransactionHistory('user-id-1', { page: 1, limit: 2 });

      expect(result.transactions).toEqual(mockTransactions);
      expect(result.total).toBe(10);
    });

    it('should apply type and status filters', async () => {
      MockTransactionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue([])
            })
          })
        })
      });
      MockTransactionModel.countDocuments.mockResolvedValue(0);

      await service.getTransactionHistory('user-id-1', {
        type: 'deposit',
        status: 'completed'
      });

      expect(MockTransactionModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          user: 'user-id-1',
          type: 'deposit',
          status: 'completed'
        })
      );
    });

    it('should apply date range filters', async () => {
      MockTransactionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue([])
            })
          })
        })
      });
      MockTransactionModel.countDocuments.mockResolvedValue(0);

      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-12-31');

      await service.getTransactionHistory('user-id-1', { startDate, endDate });

      expect(MockTransactionModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          user: 'user-id-1',
          createdAt: expect.objectContaining({
            $gte: startDate,
            $lte: endDate
          })
        })
      );
    });

    it('should cap limit at 100', async () => {
      const mockLean = jest.fn().mockResolvedValue([]);
      const mockLimit = jest.fn().mockReturnValue({ lean: mockLean });
      const mockSkip = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockSort = jest.fn().mockReturnValue({ skip: mockSkip });
      MockTransactionModel.find.mockReturnValue({ sort: mockSort });
      MockTransactionModel.countDocuments.mockResolvedValue(0);

      await service.getTransactionHistory('user-id-1', { limit: 999 });

      expect(mockLimit).toHaveBeenCalledWith(100);
    });
  });
});
