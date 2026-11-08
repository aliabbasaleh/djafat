import type { MoneyJson } from '@djafat/types';
import type { ApiHttp } from './http.js';

/** Payment client bindings for the customer screens (FEAT-009 backend). */

export interface PaymentMethodOption {
  readonly providerCode: string;
  readonly methodCode: string;
  readonly displayName: string;
  readonly capabilities: {
    readonly collectedOnDelivery?: boolean;
    readonly matchedByTransferReceipt?: boolean;
    readonly requiresPayerPhone?: boolean;
  };
}

export interface PaymentAction {
  readonly type: 'ussd_push' | 'redirect' | 'none';
  readonly url?: string;
  readonly instructions?: string;
}

export interface Payment {
  readonly id: string;
  readonly orderId: string;
  readonly providerCode: string;
  readonly methodCode: string;
  readonly status: string;
  readonly amount: MoneyJson;
  readonly providerRef: string | null;
  /** Creation response only: what the customer must do next. */
  readonly action?: PaymentAction | null;
}

export type TransferClaimOutcome = 'paid' | 'pending' | 'amount_mismatch';

export function createPaymentsClient(http: ApiHttp) {
  return {
    /** Methods available for one of the caller's orders (its city, restaurant, amount). */
    methodsForOrder: (orderId: string) =>
      http.get<PaymentMethodOption[]>(`/payments/methods-for-order/${encodeURIComponent(orderId)}`),
    create: (
      idempotencyKey: string,
      input: { orderId: string; providerCode: string; methodCode: string; payerPhone?: string },
    ) =>
      http.post<{ status: 'created' | 'replayed'; payment: Payment }>('/payments', {
        body: input,
        idempotencyKey,
      }),
    get: (paymentId: string) => http.get<Payment>(`/payments/${encodeURIComponent(paymentId)}`),
    /** The customer gives the transaction number from the operator SMS (FEAT-009). */
    claimTransfer: (paymentId: string, input: { transactionRef?: string; payerPhone?: string }) =>
      http.post<{ outcome: TransferClaimOutcome; payment: Payment }>(
        `/payments/${encodeURIComponent(paymentId)}/mobile-money/claim`,
        { body: input },
      ),
  };
}
