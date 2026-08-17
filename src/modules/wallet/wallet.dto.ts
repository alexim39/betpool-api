export const WALLET_TYPES = ['deposit', 'withdrawal', 'stake', 'payout', 'refund', 'bonus', 'fee', 'adjustment', 'transfer'] as const;
export const WALLET_STATUSES = ['pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed'] as const;
export const WALLET_SORT_FIELDS = ['createdAt', 'amount', 'type', 'status'] as const;
export type WalletSortOrder = 'asc' | 'desc';

export const TRANSFER_STATUSES = ['pending', 'completed', 'failed', 'reversed'] as const;
export type TransferDirection = 'sent' | 'received';

/** Whitelist of transfer sort fields — anything else falls back to createdAt */
export const TRANSFER_SORT_FIELDS = ['createdAt', 'amount', 'status'] as const;

export interface TransferQuery {
  /** 1-based page number, clamped to [1, 10000] by the service */
  page?: number;
  /** Rows per page, clamped to [5, 100] by the service */
  limit?: number;
  /** 'sent' | 'received' — scopes to the user as sender or recipient */
  direction?: TransferDirection;
  /** One of TRANSFER_STATUSES — unknown values are ignored */
  status?: string;
  /** Free-text search across reference, counterparty name/phone and narration */
  search?: string;
  /** Inclusive start of the createdAt range (ISO date string) */
  from?: string;
  /** Inclusive end of the createdAt range (ISO date string) */
  to?: string;
  /** One of TRANSFER_SORT_FIELDS — anything else falls back to createdAt */
  sortField?: string;
  /** asc | desc — anything else falls back to desc */
  sortOrder?: 'asc' | 'desc';
}

export interface TransferRecordDTO {
  id: string;
  reference: string;
  amount: number;
  fee: number;
  netAmount: number;
  status: string;
  direction: TransferDirection;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyPhone: string;
  narration?: string;
  createdAt: string;
  completedAt?: string;
}

export interface TransferHistoryResult {
  transfers: TransferRecordDTO[];
  total: number;
  page: number;
  limit: number;
}

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
