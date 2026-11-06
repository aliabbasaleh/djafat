import type { Money } from './money.js';
import type { PaymentStatus } from './enums.js';

/**
 * What a payment provider actually supports. The registry / PaymentService
 * reads this instead of hard-coding knowledge about a PSP. See docs/08 §8.2.
 */
export interface ProviderCapabilities {
  readonly initiate: boolean;
  readonly webhook: boolean;
  /** `getStatus()` is reliable enough to reconcile from. */
  readonly polling: boolean;
  readonly cancel: boolean;
  readonly refund: boolean;
  readonly partialRefund: boolean;
  /** Separate authorize / capture flow. */
  readonly capture: boolean;
  readonly requiresPayerPhone: boolean;
  /** `true` = confirmation arrives via webhook/poll; `false` = synchronous (cash, mock). */
  readonly async: boolean;
  readonly currencies: readonly string[];
  /**
   * `true` = a test/demo provider that must never be reachable in production
   * (FEAT-002). The API does not register it when NODE_ENV=production and the
   * seed does not activate it there. Absent = `false`.
   */
  readonly sandboxOnly?: boolean;
  readonly minAmount?: Money;
  readonly maxAmount?: Money;
}

export type PaymentActionType = 'ussd_push' | 'redirect' | 'none';

export interface PaymentAction {
  readonly type: PaymentActionType;
  readonly url?: string;
  readonly instructions?: string;
}

export interface InitiatePaymentInput {
  readonly paymentId: string;
  readonly amount: Money;
  readonly orderCode: string;
  readonly idempotencyKey: string;
  readonly payerPhone?: string;
  readonly returnUrl?: string;
  /** Provider-specific hints (e.g. `MockPaymentProvider`'s `mockOutcome`). Real PSPs ignore unknown keys. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface InitiatePaymentResult {
  readonly providerRef: string;
  readonly status: PaymentStatus;
  readonly action?: PaymentAction;
  readonly expiresAt?: string;
}

export interface GetStatusResult {
  readonly status: PaymentStatus;
  readonly raw: unknown;
}

export interface WebhookParseResult {
  /** Provider event id, or a hash of the body when the provider has no stable id. */
  readonly eventId: string;
  readonly providerRef: string;
  readonly status: PaymentStatus;
  /** Cryptographic signature check — the ONLY source of trust. See docs/08 §8.6. */
  readonly signatureValid: boolean;
  readonly amount?: Money;
  readonly raw: unknown;
}

export interface RefundInput {
  readonly providerRef: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
}

export interface RefundResult {
  readonly status: 'succeeded' | 'processing' | 'failed';
  readonly providerRef: string;
}

export interface CancelInput {
  readonly providerRef: string;
  readonly idempotencyKey: string;
}

export interface CaptureInput {
  readonly providerRef: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
}

/**
 * Provider-agnostic payment abstraction. The order/cart/pricing core NEVER
 * depends on a concrete PSP — only on this interface. See docs/08 §8.2, AD-03.
 */
export interface PaymentProvider {
  readonly code: string;
  getCapabilities(): ProviderCapabilities;
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  getStatus(providerRef: string): Promise<GetStatusResult>;
  verifyAndParseWebhook(rawRequest: RawWebhookRequest): Promise<WebhookParseResult>;
  cancel(input: CancelInput): Promise<{ status: PaymentStatus }>;
  /** Present only when `getCapabilities().capture` is true. */
  capture?(input: CaptureInput): Promise<{ status: PaymentStatus }>;
  refund(input: RefundInput): Promise<RefundResult>;
}

/** Minimal transport-agnostic view of an inbound webhook request. */
export interface RawWebhookRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** Raw, unparsed body — a Node `Buffer` is assignable to `Uint8Array`. */
  readonly rawBody: Uint8Array | string;
  readonly query?: Readonly<Record<string, string | string[] | undefined>>;
}
