import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PaymentProvider, ProviderCapabilities } from '@djafat/types';
import {
  sandboxOnlyCodes,
  seedPaymentProviderPlan,
  selectRegistrableProviders,
} from './payment-provider-selection';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { CashPaymentProvider } from './providers/cash/cash-payment.provider';
import { MockPaymentProvider } from './providers/mock/mock-payment.provider';
import {
  buildPaymentsService,
  makePaymentsRaceDb,
  ORDER_ID,
  type PaymentRow,
} from './payments-test-support';

// FEAT-002 — docs/features/FEAT-002-mock-provider-production-lock. Expected
// outcomes come from the specs (SPEC-002-01, SPEC-002-02), not from the code.

const allProviders = (): PaymentProvider[] => [
  new CashPaymentProvider(),
  new MockPaymentProvider(),
];
const productionRegistry = () =>
  new PaymentProviderRegistry(selectRegistrableProviders(allProviders(), { isProduction: true }));

/** A provider with an arbitrary code, to prove the decision is capability-driven. */
function fakeProvider(code: string, sandboxOnly: boolean | undefined): PaymentProvider {
  const base = new CashPaymentProvider();
  const capabilities: ProviderCapabilities = {
    ...base.getCapabilities(),
    ...(sandboxOnly === undefined ? {} : { sandboxOnly }),
  };
  return Object.assign(Object.create(base) as PaymentProvider, {
    code,
    getCapabilities: () => capabilities,
  });
}

describe('SPEC-002-01 — sandbox-only providers are not registered in production', () => {
  // SPEC-002-01-SC01
  it('SPEC-002-01-SC01 — the production registry has cash but not mock, and mock is PROVIDER_UNAVAILABLE', () => {
    const registry = productionRegistry();
    expect(registry.has('cash')).toBe(true);
    expect(registry.has('mock')).toBe(false);
    expect(() => registry.get('mock')).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
      }),
    );
    expect(registry.list().map((p) => p.code)).toEqual(['cash']);
  });

  // SPEC-002-01-SC02
  it('SPEC-002-01-SC02 — in production a mock payment is refused and nothing is written', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const { payments } = buildPaymentsService(db, ledgerGroups, productionRegistry());

    await expect(
      payments.createPayment(
        { orderId: ORDER_ID, providerCode: 'mock', methodCode: 'mobile_money' },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ response: { code: 'PROVIDER_UNAVAILABLE' } });
    expect(rows).toHaveLength(0);
  });

  // SPEC-002-01-SC03
  it('SPEC-002-01-SC03 — in production a correctly signed mock webhook is refused and the payment stays pending', async () => {
    const { db, payments: rows, ledgerGroups } = makePaymentsRaceDb();
    const pending: PaymentRow = {
      id: randomUUID(),
      orderId: ORDER_ID,
      providerCode: 'mock',
      methodCode: 'mobile_money',
      status: 'pending',
      amountMinor: 10_000n,
      currency: 'XAF',
      pspFeeMinor: 0n,
      providerRef: 'mock-ref-prod',
      idempotencyKey: 'create-key',
      attemptNo: 1,
      metadata: null,
    };
    rows.push(pending);
    const { payments } = buildPaymentsService(db, ledgerGroups, productionRegistry());

    const body = JSON.stringify({
      eventId: 'evt-prod',
      providerRef: 'mock-ref-prod',
      status: 'succeeded',
    });
    const req = {
      headers: { 'x-mock-signature': MockPaymentProvider.sign(body) },
      rawBody: Buffer.from(body),
    };

    await expect(payments.handleWebhook('mock', req)).rejects.toMatchObject({
      response: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(rows[0]?.status).toBe('pending');
  });

  // SPEC-002-01-SC05
  it('SPEC-002-01-SC05 — outside production (development, test) both cash and mock are registered', () => {
    for (const isProduction of [false]) {
      const registry = new PaymentProviderRegistry(
        selectRegistrableProviders(allProviders(), { isProduction }),
      );
      expect(registry.has('cash')).toBe(true);
      expect(registry.has('mock')).toBe(true);
    }
  });

  // SPEC-002-01-SC06
  it('SPEC-002-01-SC06 — the decision comes from the declared capability, whatever the provider code', () => {
    const selected = selectRegistrableProviders(
      [
        fakeProvider('any_sandbox_psp', true),
        fakeProvider('any_real_psp', false),
        fakeProvider('legacy_psp', undefined),
      ],
      { isProduction: true },
    );
    expect(selected.map((p) => p.code)).toEqual(['any_real_psp', 'legacy_psp']);
  });
});

describe('SPEC-002-02 — the seed does not activate sandbox providers in production', () => {
  // SPEC-002-02-SC01
  it('SPEC-002-02-SC01 — production plan: mock inactive without availability config, flag off; cash active', () => {
    const plan = seedPaymentProviderPlan({ isProduction: true, sandboxCodes: ['mock'] });
    expect(plan.isActive('mock')).toBe(false);
    expect(plan.isActive('cash')).toBe(true);
    expect(plan.availabilityCodes).toEqual(['cash']);
    expect(plan.mockPaymentFlagEnabled).toBe(false);
  });

  // SPEC-002-02-SC02
  it('SPEC-002-02-SC02 — non-production plan is unchanged: cash and mock active, flag on', () => {
    const plan = seedPaymentProviderPlan({ isProduction: false, sandboxCodes: ['mock'] });
    expect(plan.isActive('mock')).toBe(true);
    expect(plan.isActive('cash')).toBe(true);
    expect(plan.availabilityCodes).toEqual(['cash', 'mock']);
    expect(plan.mockPaymentFlagEnabled).toBe(true);
  });

  // SPEC-002-02-SC04
  it('SPEC-002-02-SC04 — re-seeding production disables the existing availability configs of sandbox providers only', () => {
    expect(
      seedPaymentProviderPlan({ isProduction: true, sandboxCodes: ['mock'] }).configsToDisable,
    ).toEqual(['mock']);
    expect(
      seedPaymentProviderPlan({ isProduction: false, sandboxCodes: ['mock'] }).configsToDisable,
    ).toEqual([]);
  });

  // SPEC-002-02-SC03
  it('SPEC-002-02-SC03 — the sandbox codes are read from the providers capabilities: exactly mock', () => {
    expect(sandboxOnlyCodes(allProviders())).toEqual(['mock']);
  });
});
