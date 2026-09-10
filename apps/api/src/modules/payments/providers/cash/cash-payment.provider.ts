import { Injectable } from '@nestjs/common';
import type {
  CancelInput,
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

/**
 * Cash on delivery. No external PSP call. Synchronous: the payment stays
 * `pending` until the courier confirms delivery (handled by the delivery flow),
 * at which point it becomes `succeeded`. See docs/08 §8.4.
 */
@Injectable()
export class CashPaymentProvider implements PaymentProvider {
  readonly code = 'cash';

  getCapabilities(): ProviderCapabilities {
    return {
      initiate: true,
      webhook: false,
      polling: false,
      cancel: true,
      refund: true, // "refund" = store credit / cash return, tracked in the ledger
      partialRefund: true,
      capture: false,
      requiresPayerPhone: false,
      async: false,
      currencies: ['XAF'],
    };
  }

  initiate(_input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    return Promise.resolve({
      providerRef: `cash-${_input.paymentId}`,
      status: 'pending' as PaymentStatus,
      action: { type: 'none', instructions: 'Payez le livreur à la réception.' },
    });
  }

  getStatus(providerRef: string): Promise<GetStatusResult> {
    return Promise.resolve({ status: 'pending' as PaymentStatus, raw: { providerRef } });
  }

  verifyAndParseWebhook(_req: RawWebhookRequest): Promise<WebhookParseResult> {
    return Promise.reject(new Error('cash provider has no webhook'));
  }

  cancel(_input: CancelInput): Promise<{ status: PaymentStatus }> {
    return Promise.resolve({ status: 'cancelled' as PaymentStatus });
  }

  refund(_input: RefundInput): Promise<RefundResult> {
    return Promise.resolve({
      status: 'succeeded',
      providerRef: `cash-refund-${_input.providerRef}`,
    });
  }
}
