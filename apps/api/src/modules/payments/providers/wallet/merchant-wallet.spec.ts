import { describe, expect, it } from 'vitest';
import { money } from '@djafat/core';
import { MerchantWalletPaymentProvider, walletProviders } from './merchant-wallet-payment.provider';

// FEAT-009 — docs/features/FEAT-009-mobile-money-transfer-matching (SPEC-009-02).

describe('SPEC-009-02 — Airtel Money and Tigo Cash at the merchant number', () => {
  // SPEC-009-02-SC01
  it('SPEC-009-02-SC01 — initiate: pending, own reference, instructions with amount and merchant number', async () => {
    const airtel = new MerchantWalletPaymentProvider('airtel_money', '+23560000010');
    const r = await airtel.initiate({
      paymentId: 'pay-1',
      amount: money(12_000n, 'XAF'),
      orderCode: 'DJF-1',
      idempotencyKey: 'k',
      payerPhone: '+23566123456',
    });
    expect(r.status).toBe('pending');
    expect(r.providerRef).toBe('airtel_money:pay-1');
    expect(r.action?.type).toBe('none');
    const text = r.action?.instructions ?? '';
    expect(text).toContain('12 000 FCFA');
    expect(text).toContain('+235 60 00 00 10');
    expect(text).toContain('Airtel Money');
    expect(text).toContain('numéro de transaction');
  });

  // SPEC-009-02-SC02
  it('SPEC-009-02-SC02 — only configured wallets are registered, with wallet capabilities', () => {
    const providers = walletProviders([{ code: 'airtel_money', merchantNumber: '+23560000010' }]);
    expect(providers.map((p) => p.code)).toEqual(['airtel_money']);
    expect(providers[0]?.getCapabilities()).toMatchObject({
      initiate: true,
      webhook: false,
      refund: false,
      requiresPayerPhone: true,
      async: true,
      currencies: ['XAF'],
      matchedByTransferReceipt: true,
    });
    expect(walletProviders([])).toEqual([]);
  });
});

describe('SPEC-009-02 — the customer receives the instructions', () => {
  // SPEC-009-02-SC01 — found by the end-to-end run: the provider built the
  // instructions but POST /v1/payments dropped them from its response.
  it('SPEC-009-02-SC01 — POST /v1/payments returns the provider action (instructions) with the payment', async () => {
    const { randomUUID } = await import('node:crypto');
    const { buildPaymentsService, makePaymentsRaceDb, ORDER_ID } = await import(
      '../../payments-test-support'
    );
    const { PaymentProviderRegistry } = await import('../../payment-provider.registry');
    const { db, ledgerGroups } = makePaymentsRaceDb();
    const { payments } = buildPaymentsService(
      db,
      ledgerGroups,
      new PaymentProviderRegistry([
        new MerchantWalletPaymentProvider('airtel_money', '+23560000010'),
      ]),
    );
    const res = await payments.createPayment(
      {
        orderId: ORDER_ID,
        providerCode: 'airtel_money',
        methodCode: 'mobile_money',
        payerPhone: '66 00 00 01',
      },
      randomUUID(),
    );
    expect(res.payment.status).toBe('pending');
    expect(res.payment.action?.instructions).toContain('+235 60 00 00 10');
  });
});
