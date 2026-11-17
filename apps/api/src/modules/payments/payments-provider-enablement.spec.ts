import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPaymentsService,
  makePaymentsRaceDb,
  ORDER_ID,
  RESTAURANT_ID,
} from './payments-test-support';
import { MockPaymentProvider } from './providers/mock/mock-payment.provider';

/**
 * Audit finding PAY-01 (the owner's BUG-PAY-2; cases 1 to 10 ported from
 * `6cf7c9b`): a provider must be ENABLED for the order, not merely registered.
 *
 * `doCreatePayment` used to check only `registry.has()` and the currency, never
 * `payment_provider_configs`: with `mock` disabled there, `POST /v1/payments
 * {"providerCode":"mock"}` still answered `succeeded` and placed the order. In
 * production FEAT-002 already leaves `mock` unregistered, but the same gap let a
 * customer pick a cash or wallet method an operator had switched off. Creation
 * now resolves the very `listAvailablePaymentMethods` the payment screen uses.
 */
describe('PAY-01 — provider enablement is enforced at payment creation', () => {
  afterEach(() => vi.restoreAllMocks());

  function setup() {
    const db = makePaymentsRaceDb();
    const { payments: service } = buildPaymentsService(db.db, db.ledgerGroups);
    // `db.payments` is the ROWS array; the builder's `payments` is the SERVICE.
    return { ...db, paymentRows: db.payments, payments: service };
  }

  const create = (
    payments: ReturnType<typeof setup>['payments'],
    providerCode: string,
    methodCode = 'mobile_money',
  ) =>
    payments.createPayment(
      { orderId: ORDER_ID, providerCode, methodCode },
      `idem-${providerCode}-${Math.random()}`,
    );

  /** The financial side effects a refusal must NOT produce. */
  function expectNothingHappened(ctx: ReturnType<typeof setup>) {
    expect(ctx.paymentRows).toHaveLength(0);
    expect(ctx.ledgerGroups).toHaveLength(0);
    expect(ctx.outboxEvents.filter((e) => e.aggregate === 'payment')).toHaveLength(0);
  }

  const mockConfig = (ctx: ReturnType<typeof setup>) =>
    ctx.providerConfigs.find((c) => c.providerCode === 'mock')!;

  it('1. a registered AND enabled provider still works', async () => {
    const ctx = setup();
    const { payment } = await create(ctx.payments, 'mock');
    expect(payment.status).toBe('succeeded');
    expect(ctx.ledgerGroups).toHaveLength(1);
  });

  it('2. a registered but disabled provider is refused (409 PAYMENT_METHOD_UNAVAILABLE)', async () => {
    const ctx = setup();
    mockConfig(ctx).enabled = false;
    await expect(create(ctx.payments, 'mock')).rejects.toMatchObject({
      status: 409,
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
  });

  it('3. a disabled mock never reaches initiate() and leaves nothing behind', async () => {
    const ctx = setup();
    const initiate = vi.spyOn(MockPaymentProvider.prototype, 'initiate');
    mockConfig(ctx).enabled = false;
    await expect(create(ctx.payments, 'mock')).rejects.toThrow();
    expect(initiate).not.toHaveBeenCalled();
    expectNothingHappened(ctx);
  });

  it('4. an unknown provider keeps its 404 PROVIDER_UNAVAILABLE', async () => {
    const ctx = setup();
    await expect(create(ctx.payments, 'definitely-not-a-provider')).rejects.toMatchObject({
      response: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expectNothingHappened(ctx);
  });

  it('5. a config scoped to another currency does not enable the provider', async () => {
    const ctx = setup();
    mockConfig(ctx).currency = 'EUR'; // the order is in XAF
    await expect(create(ctx.payments, 'mock')).rejects.toMatchObject({
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
    expectNothingHappened(ctx);
  });

  it('5b. a config scoped to another restaurant does not enable the provider', async () => {
    const ctx = setup();
    mockConfig(ctx).restaurantId = 'some-other-restaurant';
    await expect(create(ctx.payments, 'mock')).rejects.toMatchObject({
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
  });

  it('5c. an expired config does not enable the provider', async () => {
    const ctx = setup();
    mockConfig(ctx).validTo = new Date('2021-01-01T00:00:00Z');
    await expect(create(ctx.payments, 'mock')).rejects.toMatchObject({
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
  });

  it('5d. an amount above the config maximum does not enable the provider', async () => {
    const ctx = setup();
    mockConfig(ctx).maxAmountMinor = 9_999n; // the order totals 10 000 XAF
    await expect(create(ctx.payments, 'mock')).rejects.toMatchObject({
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
    expectNothingHappened(ctx);
  });

  it('6. no configuration at all is a refusal, never a permissive default', async () => {
    const ctx = setup();
    ctx.providerConfigs.length = 0;
    await expect(create(ctx.payments, 'mock')).rejects.toMatchObject({
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
    expectNothingHappened(ctx);
  });

  it('7. the refusal is per provider: cash still works while mock is off', async () => {
    const ctx = setup();
    mockConfig(ctx).enabled = false;
    const { payment } = await create(ctx.payments, 'cash', 'cash_on_delivery');
    expect(payment.status).toBe('pending'); // cash is collected at delivery
    await expect(create(ctx.payments, 'mock')).rejects.toMatchObject({
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
  });

  it('8. the payment screen and creation apply the same policy', async () => {
    const ctx = setup();
    const context = {
      cityId: 'city-1',
      restaurantId: RESTAURANT_ID,
      currency: 'XAF',
      amountMinor: 10_000n,
    };
    expect(
      (await ctx.payments.listAvailablePaymentMethods(context)).map((m) => m.providerCode),
    ).toContain('mock');
    await expect(create(ctx.payments, 'mock')).resolves.toBeDefined();

    mockConfig(ctx).enabled = false;
    expect(
      (await ctx.payments.listAvailablePaymentMethods(context)).map((m) => m.providerCode),
    ).not.toContain('mock');
    await expect(create(ctx.payments, 'mock')).rejects.toMatchObject({
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
  });

  it('9. a deactivated payment_providers row also blocks creation', async () => {
    const ctx = setup();
    ctx.providerRows.find((p) => p.code === 'mock')!.active = false;
    await expect(create(ctx.payments, 'mock')).rejects.toMatchObject({
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
    expectNothingHappened(ctx);
  });

  it('10. a refusal leaves no payment row, no outbox event and no ledger entry at all', async () => {
    const ctx = setup();
    ctx.providerConfigs.length = 0;
    await expect(create(ctx.payments, 'mock')).rejects.toThrow();
    expect(ctx.paymentRows).toHaveLength(0);
    expect(ctx.outboxEvents).toHaveLength(0);
    expect(ctx.ledgerGroups).toHaveLength(0);
  });

  it("11. the stored method is the provider's own, never the one the client sent", async () => {
    const ctx = setup();
    const { payment } = await create(ctx.payments, 'cash', 'mobile_money'); // cash's method is cash_on_delivery
    expect(ctx.paymentRows.find((p) => p.id === payment.id)!.methodCode).toBe('cash_on_delivery');
  });
});
