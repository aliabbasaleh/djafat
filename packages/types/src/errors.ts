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
  /** This transaction number is already recorded for this operator (409) — FEAT-009. */
  'RECEIPT_ALREADY_RECORDED',
  /** A courier remittance larger than the cash the courier holds (409) — FEAT-010. */
  'REMITTANCE_EXCEEDS_CASH_HELD',
  /** A withdrawal under the minimum, or a second one while one is open (409) — FEAT-014. */
  'PAYOUT_NOT_ALLOWED',
  'OFFER_TAKEN',
  'STEP_UP_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'NOT_FOUND',
  'FORBIDDEN',
  'UNAUTHENTICATED',
  'RATE_LIMITED',
  'OTP_INVALID',
  'OTP_LOCKED',
  /** The SMS gateway could not deliver the login code (503, retryable) — FEAT-006. */
  'OTP_DELIVERY_FAILED',
  /** Email login/verification is not configured on this deployment (503) — FEAT-007. */
  'EMAIL_UNAVAILABLE',
  /** SMS login is switched off on this deployment (503) — FEAT-008. */
  'SMS_UNAVAILABLE',
  /** WhatsApp login is not configured on this deployment (503) — FEAT-008. */
  'WHATSAPP_UNAVAILABLE',
  /** The email is already verified on another account (409) — FEAT-007. */
  'EMAIL_ALREADY_USED',
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
  /**
   * The restaurant is not taking orders right now — outside its opening
   * hours, on an exceptional closure, or paused (409). Found by the second
   * pilot run (docs/36 §6): availability was computed on the READ paths only,
   * so the catalogue showed `CLOSED` while `POST /orders` still accepted the
   * order, captured the payment, and left it `placed` forever — `order-expiry`
   * only reaps `awaiting_payment`, and no job times out an unconfirmed order.
   */
  'RESTAURANT_CLOSED',
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
