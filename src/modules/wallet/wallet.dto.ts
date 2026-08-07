export const WALLET_TYPES = ['deposit', 'withdrawal', 'stake', 'payout', 'refund', 'bonus', 'fee', 'adjustment'] as const;
export const WALLET_STATUSES = ['pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed'] as const;
export const WALLET_SORT_FIELDS = ['createdAt', 'amount', 'type', 'status'] as const;
export type WalletSortOrder = 'asc' | 'desc';

export interface TransactionHistoryQuery {
  /** 1-based page number, clamped to [1, 10000] by the service */
  page?: number;
  /** Rows per page, clamped to [5, 100] by the service */
  limit?: number;
  /** One of WALLET_TYPES — unknown values are ignored */
  type?: string;
  /** One of WALLET_STATUSES — unknown values are ignored */
  status?: string;
  /** Free-text search across reference, description and numeric amount */
  search?: string;
  /** Inclusive start of the createdAt range (ISO date string) */
  from?: string;
  /** Inclusive end of the createdAt range (ISO date string) */
  to?: string;
  /** Legacy aliases for from/to (Date objects) */
  startDate?: Date;
  endDate?: Date;
  /** One of WALLET_SORT_FIELDS — anything else falls back to createdAt */
  sortField?: string;
  /** asc | desc — anything else falls back to desc */
  sortOrder?: WalletSortOrder;
}

export interface TransactionHistoryResult {
  transactions: unknown[];
  total: number;
  page: number;
  limit: number;
}
