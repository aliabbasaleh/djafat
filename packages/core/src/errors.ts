import type { LedgerErrorCode, MoneyErrorCode } from '@djafat/types';

/** Thrown by money operations. Carries a stable `code` for i18n at the edge. */
export class MoneyError extends Error {
  public readonly code: MoneyErrorCode;

  constructor(code: MoneyErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'MoneyError';
    this.code = code;
  }
}

/** Thrown by ledger operations (unbalanced group, mixed currency, ...). */
export class LedgerError extends Error {
  public readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'LedgerError';
    this.code = code;
  }
}

/** Thrown when an order state transition is not allowed. */
export class OrderTransitionError extends Error {
  public readonly from: string;
  public readonly to: string;

  constructor(from: string, to: string) {
    super(`Illegal order transition: ${from} -> ${to}`);
    this.name = 'OrderTransitionError';
    this.from = from;
    this.to = to;
  }
}
