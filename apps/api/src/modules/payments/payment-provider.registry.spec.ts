import { describe, expect, it } from 'vitest';
import { money } from '@djafat/core';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { CashPaymentProvider } from './providers/cash/cash-payment.provider';
import { MockPaymentProvider } from './providers/mock/mock-payment.provider';

const registry = () =>
  new PaymentProviderRegistry([new CashPaymentProvider(), new MockPaymentProvider()]);

describe('PaymentProviderRegistry', () => {
  it('registers cash + mock and nothing else at Bloc 0', () => {
    const r = registry();
    expect(
      r
        .list()
        .map((p) => p.code)
        .sort(),
    ).toEqual(['cash', 'mock']);
    expect(r.has('airtel_money')).toBe(false);
    expect(r.has('moov_money')).toBe(false);
  });

  it('throws PROVIDER_UNAVAILABLE for an unknown code', () => {
    expect(() => registry().get('airtel_money')).toThrowError(/not registered/);
  });

  it('rejects duplicate provider codes', () => {
    expect(
      () => new PaymentProviderRegistry([new MockPaymentProvider(), new MockPaymentProvider()]),
    ).toThrow(/Duplicate payment provider/);
  });

  it('checks amount support from capabilities (no hard-coded PSP knowledge)', () => {
    const r = registry();
    expect(r.supportsAmount('mock', money(1000n, 'XAF'))).toBe(true);
    expect(r.supportsAmount('cash', money(1000n, 'EUR'))).toBe(false); // cash: XAF only
  });
});

describe('CashPaymentProvider', () => {
  it('is synchronous and stays pending until delivery', async () => {
    const p = new CashPaymentProvider();
    expect(p.getCapabilities().async).toBe(false);
    const res = await p.initiate({
      paymentId: 'p1',
      amount: money(10000n, 'XAF'),
      orderCode: 'DJF-1',
      idempotencyKey: 'k',
    });
    expect(res.status).toBe('pending');
    expect(res.action?.type).toBe('none');
  });
});

describe('MockPaymentProvider', () => {
  it('succeeds deterministically by default', async () => {
    const p = new MockPaymentProvider();
    const res = await p.initiate({
      paymentId: 'p1',
      amount: money(10000n, 'XAF'),
      orderCode: 'DJF-1',
      idempotencyKey: 'k',
    });
    expect(res.status).toBe('succeeded');
  });

  it('honours a requested failure / pending outcome', async () => {
    const p = new MockPaymentProvider();
    const fail = await p.initiate({
      paymentId: 'p2',
      amount: money(1n, 'XAF'),
      orderCode: 'DJF-2',
      idempotencyKey: 'k',
      // @ts-expect-error metadata is a test-only escape hatch on the mock
      metadata: { mockOutcome: 'fail' },
    });
    expect(fail.status).toBe('failed');
  });

  it('verifies its own HMAC webhook signature', async () => {
    const p = new MockPaymentProvider();
    const body = JSON.stringify({ providerRef: 'mock-p1', status: 'succeeded', eventId: 'evt-1' });
    const good = await p.verifyAndParseWebhook({
      headers: { 'x-mock-signature': MockPaymentProvider.sign(body) },
      rawBody: body,
    });
    expect(good.signatureValid).toBe(true);
    expect(good.providerRef).toBe('mock-p1');

    const bad = await p.verifyAndParseWebhook({
      headers: { 'x-mock-signature': 'deadbeef' },
      rawBody: body,
    });
    expect(bad.signatureValid).toBe(false);
  });
});
