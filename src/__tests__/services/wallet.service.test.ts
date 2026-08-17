import { WalletService } from '../../services/wallet.service';

jest.mock('../../models/wallet.model');
jest.mock('../../models/transaction.model');
jest.mock('../../models/stake.model');
jest.mock('../../models/transfer.model');
jest.mock('../../models/user.model');
jest.mock('../../utils/transaction', () => ({
  runTransaction: jest.fn((executor) => executor({ session: {} }))
}));
jest.mock('../../services/notification.service', () => ({
  notifyDepositSuccess: jest.fn().mockResolvedValue(undefined),
  notifyDepositFailed: jest.fn().mockResolvedValue(undefined),
  notifyWithdrawalSubmitted: jest.fn().mockResolvedValue(undefined),
  notifyWithdrawalCompleted: jest.fn().mockResolvedValue(undefined),
  notifyWithdrawalFailed: jest.fn().mockResolvedValue(undefined),
  notifyTransferSent: jest.fn().mockResolvedValue(undefined),
  notifyTransferReceived: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/user.service', () => ({
  userService: { verifyPin: jest.fn().mockResolvedValue(true) }
}));

const MockWalletModel = require('../../models/wallet.model').WalletModel;
const MockTransactionModel = require('../../models/transaction.model').TransactionModel;
const MockTransferModel = require('../../models/transfer.model').TransferModel;
const MockUserModel = require('../../models/user.model').UserModel;

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
      const result = await service.initiateDeposit('user-id-1', 200, 'paystack');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Minimum deposit is ₦500');
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

  describe('initiateTransfer', () => {
    beforeEach(() => {
      MockTransferModel.aggregate.mockResolvedValue([]);
    });

    it('should reject an incorrect PIN', async () => {
      require('../../services/user.service').userService.verifyPin.mockResolvedValue(false);
      const result = await service.initiateTransfer('user-id-1', 'recipient-1', 1000, '000000');
      expect(result.success).toBe(false);
      expect(result.message).toBe('Incorrect PIN');
    });

    it('should reject transferring to yourself', async () => {
      const result = await service.initiateTransfer('user-id-1', 'user-id-1', 1000, '000000');
      expect(result.success).toBe(false);
      expect(result.message).toBe('You cannot transfer to yourself');
    });

    it('should reject amounts below the minimum', async () => {
      const result = await service.initiateTransfer('user-id-1', 'recipient-1', 100, '000000');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Minimum transfer');
    });

    it('should reject transfers to an inactive account', async () => {
      MockUserModel.findById.mockImplementation(() => ({
        select: jest.fn().mockResolvedValue({
          _id: 'recipient-1',
          fullName: 'Jane Doe',
          phone: '+2348000000000',
          isActive: false,
          isSuspended: true
        })
      }));
      const result = await service.initiateTransfer('user-id-1', 'recipient-1', 1000, '000000');
      expect(result.success).toBe(false);
      expect(result.message).toBe('Recipient account is not active');
    });

    it('should transfer funds, create double-entry ledger and a transfer record', async () => {
      MockUserModel.findById
        .mockImplementationOnce(() => ({
          select: jest.fn().mockResolvedValue({
            _id: 'recipient-1',
            fullName: 'Jane Doe',
            phone: '+2348000000000',
            isActive: true,
            isSuspended: false
          })
        }))
        .mockImplementationOnce(() => ({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue({ _id: 'user-id-1', fullName: 'John Doe', phone: '+2347000000000' })
          })
        }));

      // Sender debit (5000 - 1000) with the available-balance guard
      MockWalletModel.findOneAndUpdate.mockResolvedValueOnce({ _id: 'wallet-sender', balance: 4000 })
        .mockResolvedValueOnce({ _id: 'wallet-recipient', balance: 1000 });
      // Recipient wallet does not exist yet — created inside the transaction
      MockWalletModel.findOne.mockResolvedValueOnce(null);
      MockWalletModel.create.mockResolvedValue([{ _id: 'wallet-recipient', balance: 0 }]);

      MockTransactionModel.create
        .mockResolvedValueOnce([{ _id: 'txn-out' }])
        .mockResolvedValueOnce([{ _id: 'txn-in' }]);

      MockTransferModel.create.mockResolvedValue([{ _id: 'transfer-1', reference: 'TRF_1' }]);

      const result = await service.initiateTransfer('user-id-1', 'recipient-1', 1000, '000000');

      expect(result.success).toBe(true);
      expect(result.reference).toContain('TRF_');
      expect(MockTransactionModel.create).toHaveBeenCalledTimes(2);
      expect(MockTransactionModel.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
        user: 'user-id-1',
        type: 'transfer',
        status: 'completed',
        amount: 1000,
        provider: 'internal'
      }), { session: {} });
      expect(MockTransactionModel.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
        user: 'recipient-1',
        type: 'transfer',
        status: 'completed',
        amount: 1000
      }), { session: {} });
      expect(MockTransferModel.create).toHaveBeenCalledWith(expect.objectContaining({
        sender: 'user-id-1',
        recipient: 'recipient-1',
        amount: 1000,
        status: 'completed',
        senderBalanceBefore: 5000,
        senderBalanceAfter: 4000,
        recipientBalanceBefore: 0,
        recipientBalanceAfter: 1000
      }), { session: {} });
    });

    it('should return insufficient balance when the atomic debit guard fails', async () => {
      MockUserModel.findById.mockImplementation(() => ({
        select: jest.fn().mockResolvedValue({
          _id: 'recipient-1',
          fullName: 'Jane Doe',
          phone: '+2348000000000',
          isActive: true,
          isSuspended: false
        })
      }));
      MockWalletModel.findOneAndUpdate.mockResolvedValue(null);

      const result = await service.initiateTransfer('user-id-1', 'recipient-1', 1000, '000000');
      expect(result.success).toBe(false);
      expect(result.message).toBe('Insufficient balance');
    });
  });

  describe('getTransfers', () => {
    const mockTransfer = {
      _id: { toString: () => 'transfer-1' },
      sender: 'user-id-1',
      recipient: 'recipient-1',
      amount: 1000,
      fee: 0,
      netAmount: 1000,
      status: 'completed',
      reference: 'TRF_1',
      recipientName: 'Jane Doe',
      recipientPhone: '+2348000000000',
      senderName: 'John Doe',
      senderPhone: '+2347000000000',
      narration: 'Lunch money',
      createdAt: new Date('2026-08-10T12:00:00.000Z'),
      completedAt: new Date('2026-08-10T12:00:00.000Z')
    };

    beforeEach(() => {
      MockTransferModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue([mockTransfer])
            })
          })
        })
      });
      MockTransferModel.countDocuments.mockResolvedValue(1);
    });

    it('should scope history to the viewer and map direction/counterparty', async () => {
      const result = await service.getTransfers('user-id-1', { page: 1, limit: 10 });

      expect(MockTransferModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ $or: expect.arrayContaining([{ sender: 'user-id-1' }, { recipient: 'user-id-1' }]) })
      );
      expect(result.transfers[0].direction).toBe('sent');
      expect(result.transfers[0].counterpartyName).toBe('Jane Doe');
    });

    it('should apply the sent/received direction scope', async () => {
      await service.getTransfers('user-id-1', { direction: 'received' });
      expect(MockTransferModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ recipient: 'user-id-1' })
      );
    });

    it('must keep the user scope when a search term is applied', async () => {
      await service.getTransfers('user-id-1', { search: 'Jane' });
      const arg = MockTransferModel.find.mock.calls[0][0];
      expect(arg.$and).toBeDefined();
      expect(arg.$and[0]).toEqual(expect.objectContaining({ $or: expect.arrayContaining([{ sender: 'user-id-1' }, { recipient: 'user-id-1' }]) }));
      expect(arg.$and[2].$or).toEqual(expect.arrayContaining([{ recipientName: expect.objectContaining({ $regex: 'Jane' }) }]));
    });

    it('should export a CSV with header, direction and escaped fields', async () => {
      const csv = await service.exportTransfersCsv('user-id-1', {});
      expect(csv).toContain('Reference,Date,Direction,Counterparty,Phone');
      expect(csv).toContain('TRF_1');
      expect(csv).toContain('sent');
      expect(csv).toContain('Lunch money');
    });
  });
});
