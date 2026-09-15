import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConflictException, type HttpException } from '@nestjs/common';
import {
  buildPaymentsService,
  makePaymentsRaceDb,
  CUSTOMER_ID,
  ORDER_ID,
} from './payments-test-support';

function seedSucceededPayment(payments: ReturnType<typeof makePaymentsRaceDb>['payments']) {
  const row = {
    id: randomUUID(),
    orderId: ORDER_ID,
    providerCode: 'mock',
    methodCode: 'mobile_money',
    status: 'succeeded',
    amountMinor: 10_000n,
    currency: 'XAF',
    pspFeeMinor: 150n,
    providerRef: 'mock-ref',
    idempotencyKey: 'create-key',
    attemptNo: 1,
    metadata: null,
  };
  payments.push(row);
  return row;
}

/**
 * Real concurrency, not sequential simulation — same discipline as
 * `orders-checkout-race.spec.ts` and docs/23's Bloc 4 QA pass. This is the
 * DB-trigger-backed guard (`refunds_guard_over_refund`, migration 0021)
 * doing its job under an ACTUAL race: two `refundPayment()` calls fired via
 * `Promise.allSettled` at the same instant, both for amounts that individually
 * fit but together would over-refund.
 */
describe('PaymentsService.refundPayment — REAL concurrency against a lock-aware fake DB (docs/24 §concurrency)', () => {
  it('two concurrent full-amount refunds on the SAME payment: exactly one succeeds, the other gets a clean REFUND_EXCEEDS_PAYMENT — never both, never a raw DB error', async () => {
    const { db, payments: paymentRows, refunds, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedSucceededPayment(paymentRows);
    const { payments } = buildPaymentsService(db, ledgerGroups);

    const [a, b] = await Promise.allSettled([
      payments.refundPayment(
        payment.id,
        { amount: { minor: '10000', currency: 'XAF' }, reason: 'customer request A' },
        'refund-key-A',
        CUSTOMER_ID,
      ),
      payments.refundPayment(
        payment.id,
        { amount: { minor: '10000', currency: 'XAF' }, reason: 'customer request B' },
        'refund-key-B',
        CUSTOMER_ID,
      ),
    ]);

    const outcomes = [a, b];
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejection = (rejected[0] as PromiseRejectedResult).reason as HttpException;
    expect(rejection).toBeInstanceOf(ConflictException);
    expect(rejection.getResponse()).toMatchObject({ code: 'REFUND_EXCEEDS_PAYMENT' });

    // The DATABASE, not just the promise outcomes: exactly one succeeded refund row.
    const succeededRefunds = refunds.filter((r) => r.status === 'succeeded');
    expect(succeededRefunds).toHaveLength(1);
    expect(succeededRefunds[0]!.amountMinor).toBe(10_000n);

    // The loser's row is marked failed, not left dangling in 'pending'/'processing'.
    const failedRefunds = refunds.filter((r) => r.status === 'failed');
    expect(failedRefunds).toHaveLength(1);
    expect(failedRefunds[0]!.lastError).toContain('would exceed payment');

    // The ledger only ever posted ONE refund entry group — never double-credited.
    const refundGroups = ledgerGroups.filter((g) => g.kind === 'refund');
    expect(refundGroups).toHaveLength(1);

    // The payment ends up fully refunded exactly once, not double-refunded.
    expect(payment.status).toBe('refunded');
  });

  it('a full refund followed by a genuinely concurrent second attempt on the (now empty) remainder never double-refunds', async () => {
    const { db, payments: paymentRows, refunds, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedSucceededPayment(paymentRows);
    const { payments } = buildPaymentsService(db, ledgerGroups);

    const first = await payments.refundPayment(
      payment.id,
      { amount: { minor: '10000', currency: 'XAF' }, reason: 'full refund' },
      'refund-key-1',
      CUSTOMER_ID,
    );
    expect(first.refund.status).toBe('succeeded');
    expect(payment.status).toBe('refunded');

    await expect(
      payments.refundPayment(
        payment.id,
        { amount: { minor: '1', currency: 'XAF' }, reason: 'tiny extra refund' },
        'refund-key-2',
        CUSTOMER_ID,
      ),
    ).rejects.toMatchObject({
      response: { code: 'PAYMENT_INVALID_STATE' },
    });

    expect(refunds.filter((r) => r.status === 'succeeded')).toHaveLength(1);
    expect(ledgerGroups.filter((g) => g.kind === 'refund')).toHaveLength(1);
  });

  it('two concurrent PARTIAL refunds that individually fit but together exceed the payment: only one wins', async () => {
    const { db, payments: paymentRows, refunds, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedSucceededPayment(paymentRows); // 10 000 XAF total

    const { payments } = buildPaymentsService(db, ledgerGroups);

    const [a, b] = await Promise.allSettled([
      payments.refundPayment(
        payment.id,
        { amount: { minor: '6000', currency: 'XAF' }, reason: 'partial A' },
        'partial-key-A',
        CUSTOMER_ID,
      ),
      payments.refundPayment(
        payment.id,
        { amount: { minor: '6000', currency: 'XAF' }, reason: 'partial B' },
        'partial-key-B',
        CUSTOMER_ID,
      ),
    ]);

    const fulfilled = [a, b].filter((o) => o.status === 'fulfilled');
    const rejected = [a, b].filter((o) => o.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const totalSucceeded = refunds
      .filter((r) => r.status === 'succeeded')
      .reduce((acc, r) => acc + r.amountMinor, 0n);
    expect(totalSucceeded).toBe(6000n); // never 12 000
    expect(totalSucceeded <= payment.amountMinor).toBe(true);
    expect(payment.status).toBe('partially_refunded');
  });
});
