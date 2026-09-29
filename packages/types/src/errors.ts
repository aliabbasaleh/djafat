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
  'PAYMENT_ALREADY_COMPLETED',
  'PAYMENT_INVALID_STATE',
  'PAYMENT_PROVIDER_ERROR',
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
  'CART_RESTAURANT_MISMATCH',
  'CART_ITEM_UNAVAILABLE',
  'CART_EMPTY',
  'CART_ITEM_INVALID_OPTIONS',
  'DELIVERY_NOT_FOUND',
  'DELIVERY_INVALID_STATE',
  'DELIVERY_NOT_ASSIGNED',
  'COURIER_NOT_ELIGIBLE',
  'DELIVERY_ALREADY_ASSIGNED',
  'OFFER_EXPIRED',
  'OFFER_NOT_FOUND',
  'DELIVERY_ALREADY_DELIVERED',
  'DELIVERY_ALREADY_CANCELLED',
  'INVALID_LOCATION',
  'COURIER_BUSY',
  'COURIER_SUSPENDED',
  'COURIER_OFFLINE',
  'INVALID_PROOF',
  /** Too many wrong delivery codes on one delivery (429) — Bloc 6.1, docs/25 §B6.1-7. */
  'PROOF_RATE_LIMITED',
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
