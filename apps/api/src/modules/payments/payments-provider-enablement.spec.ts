import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPaymentsService,
  makePaymentsRaceDb,
  ORDER_ID,
  RESTAURANT_ID,
} from './payments-test-support';
import { MockPaymentProvider } from './providers/mock/mock-payment.provider';

/**
 * BUG-PAY-2 — a provider must be ENABLED for the request context, not merely
 * registered as a class.
 *
 * `doCreatePayment` used to validate only `registry.has(providerCode)` and
 * `registry.supportsAmount(...)`; it never read `payment_provider_configs`.
 * `MockPaymentProvider` is registered unconditionally and its default outcome
 * is `succeed`, so any authenticated customer could post
 * `{"providerCode":"mock"}` on their own order and obtain a `succeeded`
 * payment with a full `order_accrual` posted and the order placed — a free
 * order, self-approved, with complete accounting. Disabling `mock` in
 * `payment_provider_configs` changed nothing, because the write path never
 * consulted that table.
 *
 * The rule itself is NOT reinvented here: creation now resolves the same
 * `listAvailablePaymentMethods(...)` the discovery endpoint
 * (`GET /v1/config/payment-methods`) already uses, so the two can never
 * diverge again.
 */
describe('BUG-PAY-2 — provider enablement is enforced at payment creation', () => {
  afterEach(() => vi.restoreAllMocks());

  function setup() {
    const db = makePaymentsRaceDb();
    const { payments: service } = buildPaymentsService(db.db, db.ledgerGroups);
    // `makePaymentsRaceDb().payments` is the ROWS array; the builder's is the
    // SERVICE. Keep both under unambiguous names.
    return { ...db, paymentRows: db.payments, payments: service };
  }

  const create = (payments: ReturnType<typeof setup>['payments'], providerCode: string) =>
    payments.createPayment(
      { orderId: ORDER_ID, providerCode, methodCode: 'mobile_money' },
      `idem-${providerCode}-${Math.random()}`,
    );

  /** Every financial side effect the refusal must NOT produce. */
  function expectNothingHappened(ctx: ReturnType<typeof setup>) {
    expect(ctx.ledgerGroups).toHaveLength(0);
    expect(ctx.outboxEvents.filter((e) => e.aggregate === 'payment')).toHaveLength(0);
  }

  it('1. a registered AND enabled provider still works — normal behaviour preserved', async () => {
    const ctx = setup();
    const { payment } = await create(ctx.payments, 'mock');
    expect(payment.status).toBe('succeeded');
    expect(ctx.ledgerGroups).toHaveLength(1);
  });

  it('2. a registered but DISABLED provider is refused', async () => {
    const ctx = setup();
    ctx.providerConfigs.find((c) => c.providerCode === 'mock')!.enabled = false;

    await expect(create(ctx.payments, 'mock')).rejects.toMatchObject({
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
  });

  it('3. a disabled mock never reaches initiate(), never succeeds, posts no accrual', async () => {
    const ctx = setup();
    const initiate = vi.spyOn(MockPaymentProvider.prototype, 'initiate');
    ctx.providerConfigs.find((c) => c.providerCode === 'mock')!.enabled = false;

    await expect(create(ctx.payments, 'mock')).rejects.toThrow();

    expect(initiate).not.toHaveBeenCalled();
    expect(ctx.paymentRows).toHaveLength(0);
    expectNothingHappened(ctx);
  });

  it('4. an unknown provider is still refused with the pre-existing 404 contract', async () => {
    const ctx = setup();
    await expect(create(ctx.payments, 'definitely-not-a-provider')).rejects.toMatchObject({
      response: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expectNothingHappened(ctx);
  });

  it('5. a config scoped to ANOTHER currency does not enable the provider for this order', async () => {
    const ctx = setup();
    // The order is XAF (fakeOrderAmountPort). Narrow mock's only config to EUR.
    const cfg = ctx.providerConfigs.find((c) => c.providerCode === 'mock')!;
    cfg.currency = 'EUR';

    await expect(create(ctx.payments, 'mock')).rejects.toMatchObject({
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
    expectNothingHappened(ctx);
  });

  it('5b. a config scoped to ANOTHER restaurant does not enable the provider for this order', async () => {
    const ctx = setup();
    ctx.providerConfigs.find((c) => c.providerCode === 'mock')!.restaurantId = 'some-other-resto';

    await expect(create(ctx.payments, 'mock')).rejects.toMatchObject({
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
  });

  it('5c. an expired config (validTo in the past) does not enable the provider', async () => {
    const ctx = setup();
    ctx.providerConfigs.find((c) => c.providerCode === 'mock')!.validTo = new Date(
      '2021-01-01T00:00:00Z',
    );

    await expect(create(ctx.payments, 'mock')).rejects.toMatchObject({
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
  });

  it('6. NO configuration at all is a safe refusal, never a permissive default', async () => {
    const ctx = setup();
    ctx.providerConfigs.length = 0;

    await expect(create(ctx.payments, 'mock')).rejects.toMatchObject({
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
    expectNothingHappened(ctx);
  });

  it('7. a client picking providerCode cannot bypass the policy — only cash is enabled here', async () => {
    const ctx = setup();
    ctx.providerConfigs.find((c) => c.providerCode === 'mock')!.enabled = false;

    // cash IS enabled, so the policy is not "everything is off" — it is scoped.
    const { payment } = await create(ctx.payments, 'cash');
    expect(payment.status).toBe('pending'); // cash resolves at delivery, never here

    await expect(create(ctx.payments, 'mock')).rejects.toMatchObject({
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
  });

  it('8. discovery and creation apply the SAME policy', async () => {
    const ctx = setup();
    const context = {
      cityId: 'city-1',
      restaurantId: RESTAURANT_ID,
      currency: 'XAF',
      amountMinor: 10_000n,
    };

    const before = await ctx.payments.listAvailablePaymentMethods(context);
    expect(before.map((m) => m.providerCode)).toContain('mock');
    await expect(create(ctx.payments, 'mock')).resolves.toBeDefined();

    ctx.providerConfigs.find((c) => c.providerCode === 'mock')!.enabled = false;

    const after = await ctx.payments.listAvailablePaymentMethods(context);
    expect(after.map((m) => m.providerCode)).not.toContain('mock');
    await expect(create(ctx.payments, 'mock')).rejects.toMatchObject({
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
  });

  it('9. a deactivated payment_providers row also blocks creation (same source of truth)', async () => {
    const ctx = setup();
    ctx.providerRows.find((p) => p.code === 'mock')!.active = false;

    await expect(create(ctx.payments, 'mock')).rejects.toMatchObject({
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
    expectNothingHappened(ctx);
  });

  it('10. a refused creation leaves NO payment row, NO outbox event and NO ledger entry', async () => {
    const ctx = setup();
    ctx.providerConfigs.length = 0;

    await expect(create(ctx.payments, 'mock')).rejects.toThrow();

    expect(ctx.paymentRows).toHaveLength(0);
    expect(ctx.outboxEvents).toHaveLength(0);
    expect(ctx.ledgerGroups).toHaveLength(0);
  });
});
