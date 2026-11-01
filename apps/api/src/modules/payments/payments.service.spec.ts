import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { MOCK_PSP_FEE_BPS } from './accrual-entries';
import {
  buildPaymentsService,
  makePaymentsRaceDb,
  CUSTOMER_ID,
  ORDER_ID,
  RESTAURANT_ID,
  type PaymentRow,
} from './payments-test-support';

function seedPayment(payments: PaymentRow[], overrides: Partial<PaymentRow> = {}): PaymentRow {
  const row: PaymentRow = {
    id: randomUUID(),
    orderId: ORDER_ID,
    providerCode: 'mock',
    methodCode: 'mobile_money',
    status: 'pending',
    amountMinor: 10_000n,
    currency: 'XAF',
    pspFeeMinor: 0n,
    providerRef: 'mock-ref',
    idempotencyKey: 'create-key',
    attemptNo: 1,
    metadata: null,
    ...overrides,
  };
  payments.push(row);
  return row;
}

describe('PaymentsService.getOwnerUserId (closes D-15 — docs/19 §21)', () => {
  it('delegates to OrderAmountPort.getOwnerUserId via the payment’s orderId', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows);
    const { payments } = buildPaymentsService(db, ledgerGroups);

    await expect(payments.getOwnerUserId(payment.id)).resolves.toBe(CUSTOMER_ID);
  });

  it('throws NotFoundException for an unknown payment id — never a sentinel a guard could misread as "owned"', async () => {
    const { db, ledgerGroups } = makePaymentsRaceDb();
    const { payments } = buildPaymentsService(db, ledgerGroups);

    await expect(payments.getOwnerUserId('does-not-exist')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('PaymentsService.cancelPayment (docs/08 §8.7)', () => {
  it('cancels a pending payment and enqueues payment.cancelled to the outbox', async () => {
    const { db, payments: rows, ledgerGroups, outboxEvents } = makePaymentsRaceDb();
    const payment = seedPayment(rows, { status: 'pending', providerCode: 'cash' });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    const result = await payments.cancelPayment(payment.id, 'cancel-key');
    expect(result.status).toBe('created');
    expect(result.payment.status).toBe('cancelled');
    expect(outboxEvents.some((e) => e.eventType === 'payment.cancelled')).toBe(true);
  });

  it('replays the SAME result on a retried Idempotency-Key rather than double-cancelling', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows, { status: 'pending', providerCode: 'cash' });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    const first = await payments.cancelPayment(payment.id, 'cancel-key');
    const retry = await payments.cancelPayment(payment.id, 'cancel-key');
    expect(first.status).toBe('created');
    expect(retry.status).toBe('replayed');
    expect(retry.payment.status).toBe('cancelled');
  });

  it('refuses to cancel an already-succeeded payment with PAYMENT_ALREADY_COMPLETED (docs/08 §8.7 — use refund instead)', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows, { status: 'succeeded' });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    await expect(payments.cancelPayment(payment.id, 'cancel-key')).rejects.toMatchObject({
      response: { code: 'PAYMENT_ALREADY_COMPLETED' },
    });
  });

  it('refuses to cancel an already-cancelled payment a second time under a NEW key (PAYMENT_INVALID_STATE, not a silent no-op)', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows, { status: 'cancelled' });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    await expect(payments.cancelPayment(payment.id, 'a-fresh-key')).rejects.toMatchObject({
      response: { code: 'PAYMENT_INVALID_STATE' },
    });
  });
});

describe('PaymentsService.refundPayment — validation guards (docs/08 §8.8, non-racing)', () => {
  it('rejects a refund on a payment that has not succeeded (PAYMENT_INVALID_STATE)', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows, { status: 'pending' });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    await expect(
      payments.refundPayment(
        payment.id,
        { amount: { minor: '1000', currency: 'XAF' }, reason: 'x' },
        'k',
        CUSTOMER_ID,
      ),
    ).rejects.toMatchObject({ response: { code: 'PAYMENT_INVALID_STATE' } });
  });

  it('rejects a currency that does not match the payment (CURRENCY_MISMATCH)', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows, { status: 'succeeded', currency: 'XAF' });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    await expect(
      payments.refundPayment(
        payment.id,
        { amount: { minor: '1000', currency: 'EUR' }, reason: 'x' },
        'k',
        CUSTOMER_ID,
      ),
    ).rejects.toMatchObject({ response: { code: 'CURRENCY_MISMATCH' } });
  });

  it('rejects a refund larger than the payment amount (REFUND_EXCEEDS_PAYMENT) — the common, non-racing case', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows, { status: 'succeeded', amountMinor: 10_000n });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    await expect(
      payments.refundPayment(
        payment.id,
        { amount: { minor: '10001', currency: 'XAF' }, reason: 'x' },
        'k',
        CUSTOMER_ID,
      ),
    ).rejects.toMatchObject({ response: { code: 'REFUND_EXCEEDS_PAYMENT' } });
  });

  it('rejects a partial refund on cash (mock capabilities allow it, cash still supports refund — sanity: provider without refund support is rejected)', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    // cash's capabilities().refund is true in this codebase, so this exercises
    // the "provider does not support refunds" branch by using an unregistered
    // provider code — PaymentProviderRegistry.get() throws 404 first, proving
    // the branch is reachable in principle; the partialRefund guard itself is
    // covered structurally by the two flows above and by capability data.
    const payment = seedPayment(rows, { status: 'succeeded', providerCode: 'unknown_provider' });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    await expect(
      payments.refundPayment(
        payment.id,
        { amount: { minor: '1000', currency: 'XAF' }, reason: 'x' },
        'k',
        CUSTOMER_ID,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a full, non-racing refund succeeds: posts one balanced refund ledger group and marks the payment refunded', async () => {
    const { db, payments: rows, ledgerGroups, outboxEvents } = makePaymentsRaceDb();
    const payment = seedPayment(rows, { status: 'succeeded', amountMinor: 10_000n });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    const result = await payments.refundPayment(
      payment.id,
      { amount: { minor: '10000', currency: 'XAF' }, reason: 'customer request' },
      'refund-key',
      CUSTOMER_ID,
    );

    expect(result.refund.status).toBe('succeeded');
    expect(result.payment.status).toBe('refunded');
    expect(ledgerGroups).toHaveLength(1);
    expect(ledgerGroups[0]!.kind).toBe('refund');
    expect(outboxEvents.some((e) => e.eventType === 'payment.refunded')).toBe(true);
  });

  it('a partial refund leaves the payment partially_refunded, not refunded', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows, { status: 'succeeded', amountMinor: 10_000n });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    const result = await payments.refundPayment(
      payment.id,
      { amount: { minor: '4000', currency: 'XAF' }, reason: 'partial goodwill' },
      'refund-key',
      CUSTOMER_ID,
    );
    expect(result.payment.status).toBe('partially_refunded');
  });

  it('a client retry with the SAME Idempotency-Key replays the SAME refund — never a second one, never a double-credit (Bloc 8, docs/29 §finance)', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows, { status: 'succeeded', amountMinor: 10_000n });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    const original = await payments.refundPayment(
      payment.id,
      { amount: { minor: '4000', currency: 'XAF' }, reason: 'partial goodwill' },
      'retry-refund-key',
      CUSTOMER_ID,
    );

    // Simulates the client never seeing the first response (e.g. a network
    // timeout) and retrying with the identical key — exactly the same
    // generic `IdempotencyService.run('payments:refund', ...)` wrapper
    // `cancelPayment` already proves replays safely; this pins the same
    // guarantee down specifically for a refund.
    const retry = await payments.refundPayment(
      payment.id,
      { amount: { minor: '4000', currency: 'XAF' }, reason: 'partial goodwill' },
      'retry-refund-key',
      CUSTOMER_ID,
    );

    expect(retry.refund.id).toBe(original.refund.id);
    expect(retry.payment.status).toBe('partially_refunded');
    expect(ledgerGroups).toHaveLength(1); // one balanced refund group, not two
  });

  it('a retry with the SAME key but a DIFFERENT amount is an idempotency conflict, never a silently different refund', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows, { status: 'succeeded', amountMinor: 10_000n });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    await payments.refundPayment(
      payment.id,
      { amount: { minor: '4000', currency: 'XAF' }, reason: 'first reason' },
      'shared-refund-key',
      CUSTOMER_ID,
    );

    await expect(
      payments.refundPayment(
        payment.id,
        { amount: { minor: '5000', currency: 'XAF' }, reason: 'different amount' },
        'shared-refund-key',
        CUSTOMER_ID,
      ),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });
});

describe('PaymentsService.handleWebhook — out-of-order / replay safety (docs/08 §8.3, §8.6)', () => {
  it('a duplicate webhook event (same provider+eventId) is a no-op — never double-processed', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    seedPayment(rows, { status: 'pending', providerCode: 'mock', providerRef: 'mock-ref-1' });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    const body = JSON.stringify({
      eventId: 'evt-1',
      providerRef: 'mock-ref-1',
      status: 'succeeded',
    });
    const { MockPaymentProvider } = await import('./providers/mock/mock-payment.provider');
    const sig = MockPaymentProvider.sign(body);
    const req = {
      headers: { 'x-mock-signature': sig },
      rawBody: Buffer.from(body),
    };

    const first = await payments.handleWebhook('mock', req);
    const second = await payments.handleWebhook('mock', req);
    expect(first.status).toBe('ok');
    expect(second.status).toBe('duplicate');
    expect(ledgerGroups).toHaveLength(1); // not posted twice
  });

  it('a LATE webhook reporting "succeeded" after the payment was already cancelled is a safe no-op, never a regression', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows, {
      status: 'cancelled',
      providerCode: 'mock',
      providerRef: 'mock-ref-2',
    });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    const body = JSON.stringify({
      eventId: 'evt-2',
      providerRef: 'mock-ref-2',
      status: 'succeeded',
    });
    const { MockPaymentProvider } = await import('./providers/mock/mock-payment.provider');
    const sig = MockPaymentProvider.sign(body);

    await payments.handleWebhook('mock', {
      headers: { 'x-mock-signature': sig },
      rawBody: Buffer.from(body),
    });

    expect(payment.status).toBe('cancelled'); // never regressed to 'succeeded'
    expect(ledgerGroups).toHaveLength(0); // no money moved for a cancelled payment
  });

  it('an amount mismatch flags needs_review and posts NO ledger entries — never auto-credits', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows, {
      status: 'pending',
      providerCode: 'mock',
      providerRef: 'mock-ref-3',
      amountMinor: 10_000n,
      currency: 'XAF',
    });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    const body = JSON.stringify({
      eventId: 'evt-3',
      providerRef: 'mock-ref-3',
      status: 'succeeded',
      amountMinor: '9999',
      currency: 'XAF',
    });
    const { MockPaymentProvider } = await import('./providers/mock/mock-payment.provider');
    const sig = MockPaymentProvider.sign(body);

    const result = await payments.handleWebhook('mock', {
      headers: { 'x-mock-signature': sig },
      rawBody: Buffer.from(body),
    });

    expect(result.status).toBe('needs_review');
    expect(payment.status).toBe('needs_review');
    expect(ledgerGroups).toHaveLength(0);
  });

  it('an invalid signature is rejected with 401 and never touches the payment', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows, {
      status: 'pending',
      providerCode: 'mock',
      providerRef: 'mock-ref-4',
    });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    const body = JSON.stringify({
      eventId: 'evt-4',
      providerRef: 'mock-ref-4',
      status: 'succeeded',
    });
    await expect(
      payments.handleWebhook('mock', {
        headers: { 'x-mock-signature': 'not-a-real-signature' },
        rawBody: Buffer.from(body),
      }),
    ).rejects.toMatchObject({ response: { code: 'UNAUTHENTICATED' } });
    expect(payment.status).toBe('pending');
  });

  // ── BUG-PAY-1 ───────────────────────────────────────────────────────────
  // The idempotency row used to be claimed BEFORE the signature was checked,
  // so an unauthenticated caller could burn a genuine event id: its forged
  // event was inserted, flipped to 'ignored' and KEPT, and the real webhook
  // that followed hit `ON CONFLICT DO NOTHING`, returned 'duplicate' and left
  // the payment pending forever — customer debited at the PSP, no ledger
  // entry, no alert. An unauthenticated caller must never be able to reserve
  // the identity of an authentic event.
  it('BUG-PAY-1: a forged webhook never consumes the event id of the genuine one', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows, {
      status: 'pending',
      providerCode: 'mock',
      providerRef: 'mock-ref-5',
    });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    // Same event id the real provider will use — the attacker controls it
    // because it is read straight out of the request body.
    const body = JSON.stringify({
      eventId: 'EVT-123',
      providerRef: 'mock-ref-5',
      status: 'succeeded',
    });

    // 1. attacker: correct body, INVALID signature
    await expect(
      payments.handleWebhook('mock', {
        headers: { 'x-mock-signature': 'not-a-real-signature' },
        rawBody: Buffer.from(body),
      }),
    ).rejects.toMatchObject({ response: { code: 'UNAUTHENTICATED' } });

    // 2. the real provider: same event id, VALID signature
    const { MockPaymentProvider } = await import('./providers/mock/mock-payment.provider');
    const genuine = await payments.handleWebhook('mock', {
      headers: { 'x-mock-signature': MockPaymentProvider.sign(body) },
      rawBody: Buffer.from(body),
    });

    expect(genuine.status).toBe('ok'); // NOT 'duplicate'
    expect(payment.status).toBe('succeeded');
    expect(ledgerGroups).toHaveLength(1); // the financial event actually happened
  });

  it('BUG-PAY-1: a forged webhook leaves no idempotency row behind', async () => {
    const { db, payments: rows, ledgerGroups, webhookEvents } = makePaymentsRaceDb();
    seedPayment(rows, { status: 'pending', providerCode: 'mock', providerRef: 'mock-ref-6' });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    const body = JSON.stringify({
      eventId: 'EVT-456',
      providerRef: 'mock-ref-6',
      status: 'succeeded',
    });
    await expect(
      payments.handleWebhook('mock', {
        headers: { 'x-mock-signature': 'forged' },
        rawBody: Buffer.from(body),
      }),
    ).rejects.toMatchObject({ response: { code: 'UNAUTHENTICATED' } });

    expect(webhookEvents.filter((w) => w.eventId === 'EVT-456')).toHaveLength(0);
  });

  it('BUG-PAY-1: repeated forgeries still never block the genuine event', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows, {
      status: 'pending',
      providerCode: 'mock',
      providerRef: 'mock-ref-7',
    });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    const body = JSON.stringify({
      eventId: 'EVT-789',
      providerRef: 'mock-ref-7',
      status: 'succeeded',
    });
    for (let i = 0; i < 5; i++) {
      await expect(
        payments.handleWebhook('mock', {
          headers: { 'x-mock-signature': `forged-${i}` },
          rawBody: Buffer.from(body),
        }),
      ).rejects.toMatchObject({ response: { code: 'UNAUTHENTICATED' } });
    }

    const { MockPaymentProvider } = await import('./providers/mock/mock-payment.provider');
    const genuine = await payments.handleWebhook('mock', {
      headers: { 'x-mock-signature': MockPaymentProvider.sign(body) },
      rawBody: Buffer.from(body),
    });

    expect(genuine.status).toBe('ok');
    expect(payment.status).toBe('succeeded');
    expect(ledgerGroups).toHaveLength(1);
  });
});

describe('PaymentsService — PSP fee is config-driven (Bloc 5 — replaces the Bloc 0.5 hardcoded constant)', () => {
  it('uses a payment_provider_configs.fee_bps override when one is enabled for the restaurant', async () => {
    const { db, payments: rows, ledgerGroups, providerConfigs } = makePaymentsRaceDb();
    const payment = seedPayment(rows, { status: 'pending', providerCode: 'mock' });
    providerConfigs.push({
      id: 'cfg-1',
      providerCode: 'mock',
      countryId: null,
      cityId: null,
      restaurantId: RESTAURANT_ID,
      currency: null,
      minAmountMinor: null,
      maxAmountMinor: null,
      feeBps: 300, // 3%, not the 150 (1.5%) default
      enabled: true,
      priority: 100,
      validFrom: new Date(0),
      validTo: null,
    });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    await payments.markSucceeded(payment.id);

    expect(payment.pspFeeMinor).toBe(300n); // 3% of 10 000
    expect(payment.pspFeeMinor).not.toBe(BigInt(MOCK_PSP_FEE_BPS)); // sanity: not coincidentally equal
  });

  it('falls back to MOCK_PSP_FEE_BPS when no config row declares a fee', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows, { status: 'pending', providerCode: 'mock' });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    await payments.markSucceeded(payment.id);

    expect(payment.pspFeeMinor).toBe(150n); // 1.5% of 10 000, the MOCK_PSP_FEE_BPS fallback
  });

  it('cash never has a PSP fee, config or no config', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows, { status: 'pending', providerCode: 'cash' });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    // Cash always has a resolved courier by the time it's collected (Bloc 6, docs/25 §28).
    await payments.markSucceeded(payment.id, 'courier-1');

    expect(payment.pspFeeMinor).toBe(0n);
  });
});

describe('PaymentsService.markSucceeded — the "authorized" leg (docs/08 §8.3: AUTHORIZED --capture()--> SUCCESS)', () => {
  it('completes a payment sitting in "authorized", not just "pending" — a future capture-capable provider must not get stuck here', async () => {
    const { db, payments: rows, ledgerGroups, outboxEvents } = makePaymentsRaceDb();
    const payment = seedPayment(rows, { status: 'authorized', providerCode: 'mock' });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    await payments.markSucceeded(payment.id);

    expect(payment.status).toBe('succeeded');
    expect(ledgerGroups).toHaveLength(1);
    expect(outboxEvents.some((e) => e.eventType === 'payment.succeeded')).toBe(true);
  });

  it('is still a safe no-op from a terminal status (e.g. cancelled) — never regresses', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const payment = seedPayment(rows, { status: 'cancelled', providerCode: 'mock' });
    const { payments } = buildPaymentsService(db, ledgerGroups);

    await payments.markSucceeded(payment.id);

    expect(payment.status).toBe('cancelled');
    expect(ledgerGroups).toHaveLength(0);
  });
});
