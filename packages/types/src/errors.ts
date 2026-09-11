/** Stable API error codes surfaced in `{ error: { code, ... } }`. See docs/07 §7.1. */
export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'AMOUNT_NOT_ACCEPTED',
  'CURRENCY_MISMATCH',
  'PAYMENT_METHOD_UNAVAILABLE',
  'PROVIDER_UNAVAILABLE',
  'ORDER_EXPIRED',
  'ORDER_INVALID_TRANSITION',
  'REFUND_EXCEEDS_PAYMENT',
  'OFFER_TAKEN',
  'STEP_UP_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'NOT_FOUND',
  'FORBIDDEN',
  'UNAUTHENTICATED',
  'RATE_LIMITED',
  'OTP_INVALID',
  'OTP_LOCKED',
  'MFA_INVALID',
  'MFA_REQUIRED',
  'ACCOUNT_INACTIVE',
  'INTERNAL',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly details?: unknown;
    readonly traceId: string;
  };
}

/** Money-domain error codes (thrown by `@djafat/core`). */
export type MoneyErrorCode =
  | 'INVALID_CURRENCY'
  | 'UNKNOWN_CURRENCY'
  | 'CURRENCY_MISMATCH'
  | 'NOT_AN_INTEGER'
  | 'INVALID_AMOUNT'
  | 'NEGATIVE_AMOUNT'
  | 'EMPTY_SUM';

/** Ledger-domain error codes (thrown by `@djafat/core`). */
export type LedgerErrorCode =
  | 'UNBALANCED_ENTRY_GROUP'
  | 'MIXED_CURRENCY'
  | 'NON_POSITIVE_AMOUNT'
  | 'EMPTY_ENTRY_GROUP';
