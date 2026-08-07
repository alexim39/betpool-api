import { WalletService } from '../../services/wallet.service';

jest.mock('../../models/wallet.model');
jest.mock('../../models/transaction.model');
jest.mock('../../models/stake.model');

const MockTransactionModel = require('../../models/transaction.model').TransactionModel;

function chainReturn(rows: unknown[] = []) {
  const mockLean = jest.fn().mockResolvedValue(rows);
  const mockLimit = jest.fn().mockReturnValue({ lean: mockLean });
  const mockSkip = jest.fn().mockReturnValue({ limit: mockLimit });
  const mockSort = jest.fn().mockReturnValue({ skip: mockSkip });
  MockTransactionModel.find.mockReturnValue({ sort: mockSort });
  return { mockLean, mockLimit, mockSkip, mockSort };
}

describe('WalletService.getTransactionHistory (hardened)', () => {
  let service: WalletService;

  beforeEach(() => {
    service = new WalletService();
    jest.clearAllMocks();
  });

  it('clamps page into [1, 10000] and limit into [5, 100]', async () => {
    const { mockSkip, mockLimit } = chainReturn([]);
    MockTransactionModel.countDocuments.mockResolvedValue(0);

    const result = await service.getTransactionHistory('u1', { page: 99999, limit: 999 });

    expect(result.page).toBe(10000);
    expect(result.limit).toBe(100);
    expect(mockSkip).toHaveBeenCalledWith((10000 - 1) * 100);
    expect(mockLimit).toHaveBeenCalledWith(100);
  });

  it('clamps limit 0 up to the 5 minimum instead of returning everything', async () => {
    const { mockLimit } = chainReturn([]);
    MockTransactionModel.countDocuments.mockResolvedValue(0);

    await service.getTransactionHistory('u1', { limit: 0 });

    expect(mockLimit).toHaveBeenCalledWith(5);
  });

  it('defaults page/limit/sort when params are missing', async () => {
    const { mockSort, mockLimit } = chainReturn([]);
    MockTransactionModel.countDocuments.mockResolvedValue(0);

    const result = await service.getTransactionHistory('u1', {});

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(mockSort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(mockLimit).toHaveBeenCalledWith(20);
  });

  it('ignores unknown type/status values (whitelist)', async () => {
    chainReturn([]);
    MockTransactionModel.countDocuments.mockResolvedValue(0);

    await service.getTransactionHistory('u1', { type: 'hack; drop table', status: 'whatever' });

    expect(MockTransactionModel.find).toHaveBeenCalledWith({ user: 'u1' });
  });

  it('escapes regex metacharacters in search terms', async () => {
    chainReturn([]);
    MockTransactionModel.countDocuments.mockResolvedValue(0);

    await service.getTransactionHistory('u1', { search: 'WDR_(.*)[b+]{2}' });

    const query = MockTransactionModel.find.mock.calls[0][0];
    const ors = query.$or;
    expect(ors.length).toBeGreaterThan(0);
    const refPattern = String(ors[0].reference.$regex);
    expect(refPattern).toContain('\\(');
    expect(refPattern).toContain('\\.');
    expect(refPattern).toContain('\\{');
    expect(/[^\\]\(/.test(refPattern)).toBe(false);
  });

  it('adds a numeric amount branch to the $or when search is numeric', async () => {
    chainReturn([]);
    MockTransactionModel.countDocuments.mockResolvedValue(0);

    await service.getTransactionHistory('u1', { search: '50,000' });

    const query = MockTransactionModel.find.mock.calls[0][0];
    expect(query.$or.some((o: any) => o.amount === 50000)).toBe(true);
  });

  it('supports whitelisted sort fields and ascending order', async () => {
    const { mockSort } = chainReturn([]);
    MockTransactionModel.countDocuments.mockResolvedValue(0);

    await service.getTransactionHistory('u1', { sortField: 'amount', sortOrder: 'asc' });

    expect(mockSort).toHaveBeenCalledWith({ amount: 1 });
  });

  it('falls back to createdAt desc for unknown sortField/order', async () => {
    const { mockSort } = chainReturn([]);
    MockTransactionModel.countDocuments.mockResolvedValue(0);

    await service.getTransactionHistory('u1', { sortField: 'balance;$where', sortOrder: 'sideways' as any });

    expect(mockSort).toHaveBeenCalledWith({ createdAt: -1 });
  });

  it('accepts from/to date aliases and rejects invalid dates', async () => {
    chainReturn([]);
    MockTransactionModel.countDocuments.mockResolvedValue(0);

    await service.getTransactionHistory('u1', { from: '2026-08-01', to: 'not-a-date' });

    const query = MockTransactionModel.find.mock.calls[0][0];
    expect(query.createdAt).toBeDefined();
    expect(query.createdAt.$gte).toBeInstanceOf(Date);
    expect(query.createdAt.$lte).toBeUndefined();
  });

  it('returns page and limit alongside transactions and total', async () => {
    chainReturn([{ _id: 't1' }]);
    MockTransactionModel.countDocuments.mockResolvedValue(42);

    const result = await service.getTransactionHistory('u1', { page: 2, limit: 10 });

    expect(result).toEqual({ transactions: [{ _id: 't1' }], total: 42, page: 2, limit: 10 });
  });
});
