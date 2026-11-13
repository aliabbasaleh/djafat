import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { money } from '@djafat/core';
import { CodTrustService } from './cod-trust.service';
import { buildPaymentsService, makePaymentsRaceDb, ORDER_ID } from './payments-test-support';

// FEAT-015 — docs/features/FEAT-015-cod-trust-score (SPEC-015-02).

const DAY = new Date('2026-11-09T10:00:00Z'); // 11:00 in N'Djamena

function trust(
  facts: Partial<{ deliveredOrders: number; noShows: number; accountAgeDays: number }>,
) {
  const orders = {
    getOwnerUserId: vi.fn(async () => 'cust-1'),
    getCustomerTrustSignals: vi.fn(async () => ({
      phoneVerified: true,
      deliveredOrders: 0,
      noShows: 0,
      cancelAfterDispatch: 0,
      accountAgeDays: 0,
      ...facts,
    })),
  };
  const platform = {
    getCodCapsMinor: vi.fn(async () => ({ T1: 10_000n, T2: 25_000n, T3: 60_000n })),
  };
  return new CodTrustService(orders as never, platform as never);
}

describe('SPEC-015-02 — cash on delivery only within the customer’s trust', () => {
  it('SPEC-015-02-SC01 — a new customer may pay up to 10 000 in cash, not more', async () => {
    const t = trust({});
    expect(await t.decide(ORDER_ID, money(10_000n, 'XAF'), DAY)).toMatchObject({
      allowed: true,
      tier: 'T1',
    });
    expect(await t.decide(ORDER_ID, money(10_001n, 'XAF'), DAY)).toMatchObject({
      allowed: false,
      cap: 10_000n,
    });
  });

  it('SPEC-015-02-SC02 — a customer absent twice at the door may not pay in cash at all', async () => {
    const t = trust({ deliveredOrders: 8, accountAgeDays: 60, noShows: 2 });
    expect(await t.decide(ORDER_ID, money(1_000n, 'XAF'), DAY)).toMatchObject({
      allowed: false,
      tier: 'T0',
      cap: 0n,
    });
  });

  it('SPEC-015-02-SC03 — over the cap: the cash payment is refused (409 COD_LIMIT) and pay-on-delivery is hidden', async () => {
    const { db, ledgerGroups } = makePaymentsRaceDb(); // the order totals 10 000 XAF
    const cod = trust({ noShows: 2 });
    const { payments, events } = buildPaymentsService(db, ledgerGroups, undefined, cod);
    await expect(
      payments.createPayment(
        { orderId: ORDER_ID, providerCode: 'cash', methodCode: 'cash_on_delivery' },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409, response: { code: 'COD_LIMIT' } });
    expect(events.emit).not.toHaveBeenCalledWith('payment.on_delivery', expect.anything());

    vi.spyOn(payments, 'listAvailablePaymentMethods').mockResolvedValue([
      {
        providerCode: 'cash',
        methodCode: 'cash_on_delivery',
        displayName: 'Espèces',
        capabilities: { collectedOnDelivery: true },
      },
      {
        providerCode: 'airtel_money',
        methodCode: 'mobile_money',
        displayName: 'Airtel Money',
        capabilities: { matchedByTransferReceipt: true },
      },
    ]);
    expect((await payments.listMethodsForOrder(ORDER_ID)).map((m) => m.providerCode)).toEqual([
      'airtel_money',
    ]);
  });

  it('SPEC-015-02-SC04 — a trusted customer pays in cash as before; prepaid is never limited', async () => {
    const { db, ledgerGroups } = makePaymentsRaceDb();
    const cod = trust({ deliveredOrders: 5, accountAgeDays: 30 }); // T2, cap 25 000
    const { payments, events } = buildPaymentsService(db, ledgerGroups, undefined, cod);
    const r = await payments.createPayment(
      { orderId: ORDER_ID, providerCode: 'cash', methodCode: 'cash_on_delivery' },
      randomUUID(),
    );
    expect(r.payment.status).toBe('pending');
    expect(events.emit).toHaveBeenCalledWith('payment.on_delivery', expect.anything());

    const other = makePaymentsRaceDb();
    const blocked = buildPaymentsService(
      other.db,
      other.ledgerGroups,
      undefined,
      trust({ noShows: 2 }),
    );
    await expect(
      blocked.payments.createPayment(
        {
          orderId: ORDER_ID,
          providerCode: 'mock',
          methodCode: 'mobile_money',
          metadata: { mockOutcome: 'pending_then_succeed' },
        },
        randomUUID(),
      ),
    ).resolves.toMatchObject({ status: 'created' });
  });
});
