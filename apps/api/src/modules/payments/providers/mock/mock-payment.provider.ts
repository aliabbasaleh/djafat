import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  CancelInput,
  CaptureInput,
  GetStatusResult,
  InitiatePaymentInput,
  InitiatePaymentResult,
  PaymentProvider,
  PaymentStatus,
  ProviderCapabilities,
  RawWebhookRequest,
  RefundInput,
  RefundResult,
  WebhookParseResult,
} from '@djafat/types';
import { money } from '@djafat/core';

export type MockOutcome = 'succeed' | 'fail' | 'pending_then_succeed' | 'timeout';

/** Dev-only shared secret for signing mock webhooks. NEVER used in production. */
const MOCK_WEBHOOK_SECRET = 'djafat-mock-webhook-secret';

/**
 * Deterministic, permanent payment provider (docs/16 §G).
 *
 * - Lives in the repo forever; used by dev, CI and the Bloc 0.5 walking skeleton.
 * - Never enabled in a `payment_provider_configs` row for a production env.
 * - Outcome is driven by `metadata.mockOutcome` on the initiate input (default
 *   `succeed`) so tests can exercise FAILED / EXPIRED / delayed-webhook paths.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly code = 'mock';

  getCapabilities(): ProviderCapabilities {
    return {
      initiate: true,
      webhook: true,
      polling: true,
      cancel: true,
      refund: true,
      partialRefund: true,
      capture: false,
      requiresPayerPhone: false,
      async: false, // synchronous by default — the skeleton needs no webhook
      currencies: ['XAF', 'XOF', 'EUR'],
      // Accepts any payment and signs webhooks with a secret that is public in
      // this repository: never reachable in production (FEAT-002).
      sandboxOnly: true,
    };
  }

  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const outcome = this.outcomeOf(input);
    if (outcome === 'succeed') {
      return Promise.resolve({
        providerRef: this.ref(input.paymentId),
        status: 'succeeded' as PaymentStatus,
        action: { type: 'none' },
      });
    }
    if (outcome === 'fail') {
      return Promise.resolve({
        providerRef: this.ref(input.paymentId),
        status: 'failed' as PaymentStatus,
        action: { type: 'none' },
      });
    }
    // pending_then_succeed / timeout -> stay pending; the reconcile job / a mock
    // webhook resolves it later.
    return Promise.resolve({
      providerRef: this.ref(input.paymentId),
      status: 'pending' as PaymentStatus,
      action: { type: 'ussd_push', instructions: 'Validez le paiement (mock).' },
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
  }

  getStatus(providerRef: string): Promise<GetStatusResult> {
    // A ref that encodes `pending_then_succeed` flips to succeeded on first poll.
    const status: PaymentStatus = providerRef.includes(':pts') ? 'succeeded' : 'pending';
    return Promise.resolve({ status, raw: { providerRef, mock: true } });
  }

  verifyAndParseWebhook(req: RawWebhookRequest): Promise<WebhookParseResult> {
    const body =
      typeof req.rawBody === 'string' ? req.rawBody : Buffer.from(req.rawBody).toString('utf8');
    const provided = String(req.headers['x-mock-signature'] ?? '');
    const expected = createHmac('sha256', MOCK_WEBHOOK_SECRET).update(body).digest('hex');
    const signatureValid =
      provided.length === expected.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

    const parsed = safeJson(body) as {
      eventId?: string;
      providerRef?: string;
      status?: PaymentStatus;
      amountMinor?: string;
      currency?: string;
    };

    return Promise.resolve({
      eventId: parsed.eventId ?? expected.slice(0, 32),
      providerRef: parsed.providerRef ?? '',
      status: parsed.status ?? 'succeeded',
      signatureValid,
      ...(parsed.amountMinor && parsed.currency
        ? { amount: money(parsed.amountMinor, parsed.currency) }
        : {}),
      raw: parsed,
    });
  }

  cancel(_input: CancelInput): Promise<{ status: PaymentStatus }> {
    return Promise.resolve({ status: 'cancelled' as PaymentStatus });
  }

  capture(_input: CaptureInput): Promise<{ status: PaymentStatus }> {
    return Promise.resolve({ status: 'succeeded' as PaymentStatus });
  }

  refund(input: RefundInput): Promise<RefundResult> {
    return Promise.resolve({ status: 'succeeded', providerRef: `${input.providerRef}:refund` });
  }

  /** Build a dev signature for a webhook body (used by the mock-psp / tests). */
  static sign(body: string): string {
    return createHmac('sha256', MOCK_WEBHOOK_SECRET).update(body).digest('hex');
  }

  private outcomeOf(input: InitiatePaymentInput): MockOutcome {
    const raw = input.metadata?.['mockOutcome'];
    if (raw === 'fail' || raw === 'pending_then_succeed' || raw === 'timeout') return raw;
    return 'succeed';
  }

  private ref(paymentId: string): string {
    return `mock-${paymentId}`;
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
