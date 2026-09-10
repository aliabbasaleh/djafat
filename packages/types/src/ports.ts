import type { Money } from './money.js';
import type { PostEntryGroupInput, PostedEntryGroup, WalletBalance } from './ledger.js';

/**
 * Ports (hexagonal interfaces) shared across API modules.
 *
 * They live in `@djafat/types` — not inside a feature module — so that the
 * dependency DAG stays acyclic and lint-enforceable. In particular `orders`
 * consumes `OrderAmountPort` WITHOUT importing the `payments` module.
 * See docs/05 §5.3, docs/15 AD-09, and docs/17 for the Bloc-0 placement note.
 */

/** Implemented by `ledger`. The ONLY way to write the general ledger. */
export interface LedgerPort {
  postEntryGroup(input: PostEntryGroupInput): Promise<PostedEntryGroup>;
  getWalletBalance(
    ownerType: 'restaurant' | 'courier',
    ownerId: string,
    currency: string,
  ): Promise<WalletBalance>;
}

/** Implemented by `orders`. Consumed by `payments` and `deliveries`. */
export interface OrderAmountPort {
  /** The frozen, server-authoritative total for an order. */
  getAuthoritativeAmount(orderId: string): Promise<Money>;
  getPaymentContext(orderId: string): Promise<OrderPaymentContext>;
}

export interface OrderPaymentContext {
  readonly orderId: string;
  readonly orderCode: string;
  readonly countryId: string;
  readonly cityId: string;
  readonly restaurantId: string;
  readonly currency: string;
}

/** Implemented by `payments`. Consumed by `orders` reactions only via events. */
export interface PaymentPort {
  createPayment(input: {
    orderId: string;
    methodCode: string;
    providerCode: string;
    idempotencyKey: string;
    payerPhone?: string;
  }): Promise<{ paymentId: string; status: string }>;
}

/** S3-compatible object storage. No vendor SDK in business code (decision A6). */
export interface ObjectStoragePort {
  putObject(key: string, body: Uint8Array, contentType: string): Promise<{ key: string }>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
}

/** OTP delivery. `sms` impl for MVP; extensible to whatsapp/email (decision A9). */
export interface OtpDeliveryPort {
  readonly channel: 'sms' | 'whatsapp' | 'email';
  send(input: { to: string; code: string; ttlSeconds: number; locale: string }): Promise<void>;
}
