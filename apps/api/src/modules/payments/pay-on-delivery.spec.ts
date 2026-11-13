import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildPaymentsService, makePaymentsRaceDb, ORDER_ID } from './payments-test-support';

// FEAT-009 — docs/features/FEAT-009-mobile-money-transfer-matching (SPEC-009-01).

describe('SPEC-009-01 — an order paid on delivery goes to the restaurant', () => {
  // SPEC-009-01-SC01
  it('SPEC-009-01-SC01 — a cash payment stays pending and emits payment.on_delivery; a prepaid (mock) one does not', async () => {
    const { db, ledgerGroups } = makePaymentsRaceDb();
    const { payments, events } = buildPaymentsService(db, ledgerGroups);

    const cash = await payments.createPayment(
      { orderId: ORDER_ID, providerCode: 'cash', methodCode: 'cash_on_delivery' },
      randomUUID(),
    );
    expect(cash.payment.status).toBe('pending');
    expect(events.emit).toHaveBeenCalledWith('payment.on_delivery', {
      orderId: ORDER_ID,
      paymentId: cash.payment.id,
    });

    const other = makePaymentsRaceDb();
    const prepaid = buildPaymentsService(other.db, other.ledgerGroups);
    await prepaid.payments.createPayment(
      {
        orderId: ORDER_ID,
        providerCode: 'mock',
        methodCode: 'mobile_money',
        metadata: { mockOutcome: 'pending_then_succeed' },
      },
      randomUUID(),
    );
    expect(prepaid.events.emit).not.toHaveBeenCalledWith('payment.on_delivery', expect.anything());
  });
});
