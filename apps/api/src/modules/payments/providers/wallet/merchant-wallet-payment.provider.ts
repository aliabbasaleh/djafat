import type {
  CancelInput,
  GetStatusResult,
  InitiatePaymentInput,
  InitiatePaymentResult,
  PaymentProvider,
  PaymentStatus,
  ProviderCapabilities,
  RefundInput,
  RefundResult,
  WebhookParseResult,
} from '@djafat/types';

/**
 * A mobile money wallet paid by a transfer to DJAFAT's merchant number, with
 * no operator API (FEAT-009, SPEC-009-02). The payment stays `pending` until
 * a recorded transfer receipt is matched to it (`MobileMoneyReceiptsService`).
 * One class, one instance per configured wallet (`MOBILE_MONEY_WALLETS`):
 * no `if (provider === …)` anywhere.
 */
export class MerchantWalletPaymentProvider implements PaymentProvider {
  constructor(
    readonly code: string,
    private readonly merchantNumber: string,
  ) {}

  /** `airtel_money` → « Airtel Money », `tigo_cash` → « Tigo Cash ». */
  get displayName(): string {
    return this.code
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  getCapabilities(): ProviderCapabilities {
    return {
      initiate: true,
      webhook: false,
      polling: false,
      cancel: true,
      refund: false, // refunds are done by hand outside the system for now (FEAT-009 scope)
      partialRefund: false,
      capture: false,
      requiresPayerPhone: true,
      async: true,
      currencies: ['XAF'],
      matchedByTransferReceipt: true,
    };
  }

  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const amount = formatAmountForDisplay(input.amount.minor, input.amount.currency);
    return Promise.resolve({
      providerRef: `${this.code}:${input.paymentId}`,
      status: 'pending' as PaymentStatus,
      action: {
        type: 'none',
        instructions: `Envoyez ${amount} au ${formatPhone(this.merchantNumber)} (DJAFAT) avec ${this.displayName}, puis indiquez le numéro de transaction reçu par SMS.`,
      },
    });
  }

  getStatus(providerRef: string): Promise<GetStatusResult> {
    return Promise.resolve({ status: 'pending' as PaymentStatus, raw: { providerRef } });
  }

  verifyAndParseWebhook(): Promise<WebhookParseResult> {
    return Promise.reject(
      new Error(`${this.code} has no webhook (transfer receipts are recorded)`),
    );
  }

  cancel(_input: CancelInput): Promise<{ status: PaymentStatus }> {
    return Promise.resolve({ status: 'cancelled' as PaymentStatus });
  }

  refund(_input: RefundInput): Promise<RefundResult> {
    return Promise.reject(new Error(`${this.code} refunds are not supported yet`));
  }
}

export function walletProviders(
  wallets: ReadonlyArray<{ code: string; merchantNumber: string }>,
): MerchantWalletPaymentProvider[] {
  return wallets.map((w) => new MerchantWalletPaymentProvider(w.code, w.merchantNumber));
}

const CURRENCY_LABELS: Readonly<Record<string, string>> = { XAF: 'FCFA' };

/** (12000n, 'XAF') → « 12 000 FCFA » (the franc CFA has no minor unit in practice). */
function formatAmountForDisplay(minor: bigint, currency: string): string {
  const digits = minor.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${digits} ${CURRENCY_LABELS[currency] ?? currency}`;
}

/** +23560000010 → « +235 60 00 00 10 »; other numbers unchanged. */
function formatPhone(e164: string): string {
  const m = /^\+235(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+235 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}
