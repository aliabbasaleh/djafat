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
  /** Cash on delivery not allowed for this customer/amount: pay first by mobile money (409) — FEAT-015. */
  'COD_LIMIT',
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
  /** Registration with a phone number another account already holds (409) — FEAT-020. */
  'PHONE_ALREADY_USED',
  /** Unknown email, no password, or wrong password: one answer for all three (401) — FEAT-020. */
  'INVALID_CREDENTIALS',
  /** Changing a password with a wrong current one (403, not 401: not an expired session) — FEAT-020. */
  'CURRENT_PASSWORD_INCORRECT',
  /** A password needs a verified email to log in with (409) — FEAT-020. */
  'EMAIL_REQUIRED',
  /** A phone code on an email account whose number was never confirmed (409) — FEAT-020. */
  'PHONE_NOT_CONFIRMED',
  /** FEAT-024 — DJAFAT sends no SMS to a foreign number: WhatsApp or e-mail instead (422, SPEC-024-01 R2). */
  'SMS_FOREIGN_NUMBER',
  /** FEAT-024 — a fixed line receives neither SMS nor WhatsApp (422, SPEC-024-01 R3). */
  'PHONE_FIXED_LINE',
  /** FEAT-022 — adding a role from « Mon profil » needs a verified e-mail (409, SPEC-022-08 R2). */
  'EMAIL_NOT_VERIFIED',
  /** FEAT-022 — the account is already a courier, or already owns a restaurant (409, SPEC-022-08 R3, R5). */
  'ROLE_ALREADY_HELD',
  /** FEAT-022 — a courier who signs up is 18 or older (422, SPEC-022-02 R2). */
  'UNDERAGE',
  /** FEAT-022 — a courier whose application is not approved cannot go online (409, SPEC-022-06 R5). */
  'COURIER_NOT_APPROVED',
  /** FEAT-022 — a neighbourhood id that is not in the active list (422, SPEC-022-09). */
  'NEIGHBOURHOOD_UNKNOWN',
  /** FEAT-022 — an active neighbourhood already has that name (409, SPEC-022-09 R4). */
  'NEIGHBOURHOOD_EXISTS',
  /** FEAT-022 — no such neighbourhood (404, SPEC-022-09 R4). */
  'NEIGHBOURHOOD_NOT_FOUND',
  /** FEAT-022 — no such city (404, SPEC-022-09). */
  'CITY_NOT_FOUND',
  /** FEAT-022 — a photo above 5 MB (413, SPEC-022-04 R2). */
  'FILE_TOO_LARGE',
  /** FEAT-022 — not a JPEG, PNG or WebP photo, or a malformed one (415, SPEC-022-04 R2). */
  'UNSUPPORTED_FILE',
  /** FEAT-022 — a private file's link is missing, wrong or expired (403, SPEC-022-04 R3). */
  'FILE_LINK_INVALID',
  /** FEAT-022 — no such public file (404, SPEC-022-04 R4). */
  'FILE_NOT_FOUND',
  /** FEAT-022 — photos cannot be stored on this server yet (503, SPEC-022-04). */
  'STORAGE_NOT_CONFIGURED',
  /** FEAT-022 — no application for this account, or no such application (404, SPEC-022-06, 07). */
  'APPLICATION_NOT_FOUND',
  /** FEAT-022 — sent with an item missing; `details.missing` lists them (409, SPEC-022-05, 06). */
  'APPLICATION_INCOMPLETE',
  /** FEAT-022 — being checked, or approved: no longer changed this way (409, SPEC-022-05, 06). */
  'APPLICATION_LOCKED',
  /** FEAT-022 — another admin already decided (409, SPEC-022-07 R7). */
  'ALREADY_DECIDED',
  /** FEAT-022 — an application not sent yet cannot be decided (409, SPEC-022-07 R7). */
  'APPLICATION_NOT_SUBMITTED',
  /** FEAT-022 — no such change waiting for this application, or replaced by a newer one (404, SPEC-022-07 R6). */
  'CHANGE_NOT_FOUND',
  /** FEAT-022 — a signed-up restaurant opens to customers only once approved (409, SPEC-022-03 R3). */
  'RESTAURANT_NOT_APPROVED',
  /** FEAT-022 — the server has no room left for photos; nothing was kept (507, SPEC-022-04). */
  'STORAGE_FULL',
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
