import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { formatOrderMessage, type OfflineOrder } from '@djafat/core';
import { OfflineOrdersService } from './offline-orders.service';

// FEAT-017 — docs/features/FEAT-017-offline-ordering (SPEC-017-02).

const PRODUCT = '3f9a1c2e-0000-4000-8000-000000000001';
const OTHER = '7c2e4410-0000-4000-8000-000000000002';
const OPTION = 'b71d09aa-0000-4000-8000-000000000003';
const ADDRESS = 'a8f3c2d1-0000-4000-8000-000000000004';
const PHONE = '+23566000001';

const order = (over: Partial<OfflineOrder> = {}): OfflineOrder => ({
  restaurant: 'chez-fatime',
  items: [
    { product: '3f9a1c2e', quantity: 2, options: ['b71d09aa'] },
    { product: '7c2e4410', quantity: 1, options: [] },
  ],
  address: 'a8f3c2d1',
  payment: 'cash',
  key: 'k7q2m9x4ta',
  ...over,
});

function harness(
  opts: {
    user?: boolean;
    restaurant?: string | null;
    createStatus?: 'created' | 'replayed';
    orderStatus?: string;
    createOrderError?: Error;
    paymentError?: Error;
  } = {},
) {
  const users = {
    findByPhone: vi.fn(async () => (opts.user === false ? null : { id: 'cust-1' })),
  };
  const addresses = { list: vi.fn(async () => [{ id: ADDRESS }]) };
  const carts = { clearCart: vi.fn(async () => null), addItem: vi.fn(async () => ({})) };
  const catalog = {
    findRestaurantIdByRef: vi.fn(async () =>
      opts.restaurant === undefined ? 'resto-1' : opts.restaurant,
    ),
    getMenu: vi.fn(async () => [{ products: [{ id: PRODUCT }, { id: OTHER }] }]),
    getProductDetail: vi.fn(async () => ({ optionGroups: [{ options: [{ id: OPTION }] }] })),
  };
  const orders = {
    createOrder: vi.fn(async () => {
      if (opts.createOrderError) throw opts.createOrderError;
      return {
        status: opts.createStatus ?? 'created',
        order: { id: 'ord-1', code: 'DJF-7' },
      };
    }),
    getOrder: vi.fn(async () => ({
      id: 'ord-1',
      code: 'DJF-7',
      status: opts.orderStatus ?? 'awaiting_payment',
      total: { minor: '6500', currency: 'XAF' },
    })),
  };
  const payments = {
    listMethodsForOrder: vi.fn(async () => [
      {
        providerCode: 'airtel_money',
        methodCode: 'mobile_money',
        capabilities: { matchedByTransferReceipt: true },
      },
      {
        providerCode: 'cash',
        methodCode: 'cash_on_delivery',
        capabilities: { collectedOnDelivery: true },
      },
    ]),
    createPayment: vi.fn(async (input: { providerCode: string }) => {
      if (opts.paymentError) throw opts.paymentError;
      return {
        payment:
          input.providerCode === 'airtel_money'
            ? { action: { instructions: 'Envoyez 6 500 FCFA au +235 60 00 00 10' } }
            : {},
      };
    }),
  };
  const deliveries = { presetDeliveryCode: vi.fn(async () => '4821') };
  const audit = { log: vi.fn(async () => undefined) };
  const reply = { send: vi.fn(async () => true) };
  const service = new OfflineOrdersService(
    users as never,
    addresses as never,
    carts as never,
    catalog as never,
    orders as never,
    payments as never,
    deliveries as never,
    audit as never,
    reply as never,
  );
  const lastReply = () => (reply.send.mock.calls.at(-1) as unknown as [string, string])[1];
  return { service, carts, orders, payments, deliveries, audit, reply, lastReply };
}

describe('SPEC-017-02 — an order received by message', () => {
  it('SPEC-017-02-SC01 — placed like an app order, under the same key, and answered with number, total and courier code', async () => {
    const h = harness();
    const r = await h.service.handle(PHONE, formatOrderMessage(order()));
    expect(r.outcome).toBe('placed');
    expect(h.carts.addItem).toHaveBeenCalledWith('cust-1', {
      productId: PRODUCT,
      quantity: 2,
      selectedOptionIds: [OPTION],
      replaceCart: true,
    });
    expect(h.orders.createOrder).toHaveBeenCalledWith('cust-1', 'k7q2m9x4ta', ADDRESS);
    expect(h.payments.createPayment).toHaveBeenCalledWith(
      { orderId: 'ord-1', providerCode: 'cash', methodCode: 'cash_on_delivery' },
      'offline:k7q2m9x4ta',
    );
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ORDER_PLACED_BY_MESSAGE', entityId: 'ord-1' }),
    );
    expect(h.reply.send).toHaveBeenCalledWith(PHONE, expect.any(String));
    expect(h.lastReply()).toContain('DJF-7');
    expect(h.lastReply()).toContain('6 500 FCFA');
    expect(h.lastReply()).toContain('4821');
  });

  it('SPEC-017-02-SC02 — Airtel chosen: payment from the sender number, instructions in the reply', async () => {
    const h = harness();
    await h.service.handle(PHONE, formatOrderMessage(order({ payment: 'airtel' })));
    expect(h.payments.createPayment).toHaveBeenCalledWith(
      {
        orderId: 'ord-1',
        providerCode: 'airtel_money',
        methodCode: 'mobile_money',
        payerPhone: PHONE,
      },
      'offline:k7q2m9x4ta',
    );
    expect(h.lastReply()).toContain('Envoyez 6 500 FCFA');
  });

  it('SPEC-017-02-SC03 — the app got through as well: the same order, no second payment, no second audit', async () => {
    const h = harness({ createStatus: 'replayed', orderStatus: 'placed' });
    const r = await h.service.handle(PHONE, formatOrderMessage(order()));
    expect(r.outcome).toBe('placed');
    expect(h.payments.createPayment).not.toHaveBeenCalled();
    expect(h.audit.log).not.toHaveBeenCalled();
    expect(h.carts.clearCart).toHaveBeenCalledTimes(2); // the rebuilt cart is emptied again
    expect(h.lastReply()).toContain('DJF-7');
  });

  it('SPEC-017-02-SC04 — unknown number, damaged message, unknown restaurant, dish or address: nothing ordered, an explanation', async () => {
    const cases: Array<[ReturnType<typeof harness>, string, string]> = [
      [harness({ user: false }), formatOrderMessage(order()), 'unknown_customer'],
      [harness(), formatOrderMessage(order()).replace('x2', 'x9'), 'unreadable'],
      [harness({ restaurant: null }), formatOrderMessage(order()), 'unknown_restaurant'],
      [
        harness(),
        formatOrderMessage(order({ items: [{ product: 'ffffffff', quantity: 1, options: [] }] })),
        'unknown_item',
      ],
      [harness(), formatOrderMessage(order({ address: 'ffffffff' })), 'unknown_address'],
    ];
    for (const [h, text, outcome] of cases) {
      expect((await h.service.handle(PHONE, text)).outcome).toBe(outcome);
      expect(h.orders.createOrder).not.toHaveBeenCalled();
      expect(h.reply.send).toHaveBeenCalledTimes(1);
    }
  });

  it('SPEC-017-02-SC05 — refused by the order rules or above the cash limit: said in the reply', async () => {
    const closed = harness({
      createOrderError: new ConflictException({ code: 'RESTAURANT_CLOSED', message: 'closed' }),
    });
    expect((await closed.service.handle(PHONE, formatOrderMessage(order()))).outcome).toBe(
      'refused',
    );
    expect(closed.lastReply()).toContain('le restaurant est fermé');

    const capped = harness({
      paymentError: new ConflictException({ code: 'COD_LIMIT', message: 'cap' }),
    });
    expect((await capped.service.handle(PHONE, formatOrderMessage(order()))).outcome).toBe(
      'awaiting_payment',
    );
    expect(capped.lastReply()).toContain('Airtel Money');
  });
});
