import { describe, expect, it, vi } from 'vitest';
import { buildPaymentsService, makePaymentsRaceDb, ORDER_ID } from './payments-test-support';

// Screens: the order page must offer the payment methods of the ORDER's city
// and restaurant, for its exact amount — the browser does not know the city.

describe('PaymentsService.listMethodsForOrder', () => {
  it("resolves the order's city, restaurant, amount and currency, then lists the available methods", async () => {
    const { db, ledgerGroups } = makePaymentsRaceDb();
    const { payments } = buildPaymentsService(db, ledgerGroups);
    const list = vi.spyOn(payments, 'listAvailablePaymentMethods').mockResolvedValue([
      {
        providerCode: 'cash',
        methodCode: 'cash_on_delivery',
        displayName: 'Espèces',
        capabilities: {},
      },
    ]);
    const methods = await payments.listMethodsForOrder(ORDER_ID);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        cityId: expect.any(String),
        restaurantId: expect.any(String),
        amountMinor: expect.any(BigInt),
        currency: 'XAF',
      }),
    );
    expect(methods.map((m) => m.providerCode)).toEqual(['cash']);
  });
});
