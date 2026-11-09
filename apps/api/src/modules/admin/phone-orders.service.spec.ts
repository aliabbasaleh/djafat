import { describe, expect, it, vi } from 'vitest';
import { PhoneOrdersService } from './phone-orders.service';
import type { PhoneOrderBody } from './dto/phone-order.schema';

const PRODUCT = '11111111-1111-1111-1111-111111111111';
const OPERATOR = { userId: 'op-1', role: 'support' };

const body = (over: Partial<PhoneOrderBody> = {}): PhoneOrderBody => ({
  customerPhone: '+23566123456',
  customerName: 'Achta Mahamat',
  items: [{ productId: PRODUCT, quantity: 2 }],
  address: { quartier: 'Moursal', landmark: 'Derrière la mosquée' },
  ...over,
});

function harness(opts: {
  isNew?: boolean;
  fullName?: string | null;
  addresses?: Array<Record<string, unknown>>;
  methods?: Array<{ providerCode: string; methodCode: string; capabilities: unknown }>;
  orderStatus?: string;
  transfer?: 'paid' | 'pending' | 'amount_mismatch';
}) {
  const users = {
    findOrCreateByPhone: vi.fn(async () => ({ userId: 'cust-1', isNew: opts.isNew ?? true })),
    getByIdOrThrow: vi.fn(async () => ({ fullName: opts.fullName ?? null })),
    updateFullName: vi.fn(async () => ({})),
  };
  const addresses = {
    list: vi.fn(async () => opts.addresses ?? []),
    create: vi.fn(async () => ({ id: 'addr-new' })),
  };
  const carts = { clearCart: vi.fn(async () => null), addItem: vi.fn(async () => ({})) };
  const orders = {
    createOrder: vi.fn(async () => ({
      status: 'created' as const,
      order: { id: 'ord-1', code: 'DJF-1', status: 'awaiting_payment' },
    })),
    getOrder: vi.fn(async () => ({
      id: 'ord-1',
      code: 'DJF-1',
      status: opts.orderStatus ?? 'awaiting_payment',
    })),
  };
  const payments = {
    listMethodsForOrder: vi.fn(
      async () =>
        opts.methods ?? [
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
        ],
    ),
    createPayment: vi.fn(async (input: { providerCode: string }) => ({
      status: 'created',
      payment:
        input.providerCode === 'airtel_money'
          ? { action: { type: 'none', instructions: 'Envoyez 6 500 FCFA au +235 60 00 00 10' } }
          : {},
    })),
  };
  const audit = { log: vi.fn(async () => undefined) };
  const idempotency = {
    run: vi.fn(async (_s: string, _k: string, _p: unknown, handler: () => Promise<unknown>) => ({
      status: 'created',
      response: await handler(),
    })),
  };
  const receipts = {
    claimForOrder: vi.fn(async () => ({ paymentId: 'pay-1', outcome: opts.transfer ?? 'paid' })),
  };
  const deliveries = { presetDeliveryCode: vi.fn(async () => '4821') };
  const service = new PhoneOrdersService(
    users as never,
    addresses as never,
    carts as never,
    orders as never,
    payments as never,
    audit as never,
    idempotency as never,
    receipts as never,
    deliveries as never,
  );
  return {
    service,
    users,
    addresses,
    carts,
    orders,
    payments,
    audit,
    idempotency,
    receipts,
    deliveries,
  };
}

describe('FEAT-011 / SPEC-011-01 — order taken on the phone by an operator', () => {
  it('SPEC-011-01-SC01 — new caller: account, address, cart, order and pay-on-delivery payment, audited', async () => {
    const h = harness({});
    const r = await h.service.place(body(), OPERATOR, 'key-1');

    expect(h.users.findOrCreateByPhone).toHaveBeenCalledWith('+23566123456', null);
    expect(h.users.updateFullName).toHaveBeenCalledWith('cust-1', 'Achta Mahamat');
    expect(h.addresses.create).toHaveBeenCalledWith(
      'cust-1',
      expect.objectContaining({ quartier: 'Moursal', landmark: 'Derrière la mosquée' }),
    );
    expect(h.carts.clearCart).toHaveBeenCalledWith('cust-1');
    expect(h.carts.addItem).toHaveBeenCalledWith('cust-1', {
      productId: PRODUCT,
      quantity: 2,
      selectedOptionIds: [],
      replaceCart: true,
    });
    expect(h.orders.createOrder).toHaveBeenCalledWith('cust-1', 'phone:key-1', 'addr-new');
    // chosen by capability (collectedOnDelivery), never by provider name
    expect(h.payments.createPayment).toHaveBeenCalledWith(
      { orderId: 'ord-1', providerCode: 'cash', methodCode: 'cash_on_delivery' },
      'phone:key-1',
    );
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'op-1',
        action: 'ORDER_PLACED_BY_PHONE',
        entityType: 'order',
        entityId: 'ord-1',
      }),
    );
    expect(r).toMatchObject({ status: 'created', customer: { id: 'cust-1', isNew: true } });
    expect(h.idempotency.run).toHaveBeenCalledWith(
      'phone-orders:op-1',
      'key-1',
      expect.anything(),
      expect.any(Function),
    );
  });

  it('SPEC-011-01-SC02 — a known customer keeps their name, and the same address is reused, not duplicated', async () => {
    const h = harness({
      isNew: false,
      fullName: 'Achta M.',
      addresses: [
        {
          id: 'addr-known',
          quartier: 'moursal ',
          landmark: 'Derrière la mosquée',
          street: null,
          lat: null,
          lng: null,
        },
      ],
    });
    await h.service.place(body(), OPERATOR, 'key-2');
    expect(h.users.updateFullName).not.toHaveBeenCalled();
    expect(h.addresses.create).not.toHaveBeenCalled();
    expect(h.orders.createOrder).toHaveBeenCalledWith('cust-1', 'phone:key-2', 'addr-known');
  });

  it('SPEC-011-01-SC03 — refused when no pay-on-delivery method is enabled for the order', async () => {
    const h = harness({
      methods: [{ providerCode: 'airtel_money', methodCode: 'mobile_money', capabilities: {} }],
    });
    await expect(h.service.place(body(), OPERATOR, 'key-3')).rejects.toMatchObject({
      status: 409,
      response: { code: 'PAYMENT_METHOD_UNAVAILABLE' },
    });
    expect(h.payments.createPayment).not.toHaveBeenCalled();
  });

  it('SPEC-011-01-SC04 — an order already placed (retry after a partial failure) gets no second payment', async () => {
    const h = harness({ orderStatus: 'placed' });
    await h.service.place(body(), OPERATOR, 'key-4');
    expect(h.payments.listMethodsForOrder).not.toHaveBeenCalled();
    expect(h.payments.createPayment).not.toHaveBeenCalled();
  });

  it("SPEC-012-01-SC01 — Airtel during the call: wallet payment from the caller's phone, instructions, code to give the courier", async () => {
    const h = harness({});
    const r = await h.service.place(
      body({ payment: { method: 'wallet', providerCode: 'airtel_money' } }),
      OPERATOR,
      'key-5',
    );
    expect(h.payments.createPayment).toHaveBeenCalledWith(
      {
        orderId: 'ord-1',
        providerCode: 'airtel_money',
        methodCode: 'mobile_money',
        payerPhone: '+23566123456',
      },
      'phone:key-5',
    );
    expect(r.payment).toEqual({
      method: 'wallet',
      instructions: 'Envoyez 6 500 FCFA au +235 60 00 00 10',
    });
    expect(h.receipts.claimForOrder).not.toHaveBeenCalled(); // no number given yet
    expect(r.deliveryCode).toBe('4821');
    expect(h.deliveries.presetDeliveryCode).toHaveBeenCalledWith('ord-1', 'op-1');
  });

  it('SPEC-012-01-SC02 — the caller already paid: the transaction number is checked at once', async () => {
    const h = harness({});
    const r = await h.service.place(
      body({
        payment: { method: 'wallet', providerCode: 'airtel_money', transactionRef: 'CI1.A' },
      }),
      OPERATOR,
      'key-6',
    );
    expect(h.receipts.claimForOrder).toHaveBeenCalledWith('ord-1', 'CI1.A');
    expect(r.transfer).toBe('paid');
  });

  it('SPEC-012-01-SC03 — wallet not enabled: refused, no payment', async () => {
    const h = harness({
      methods: [
        {
          providerCode: 'cash',
          methodCode: 'cash_on_delivery',
          capabilities: { collectedOnDelivery: true },
        },
      ],
    });
    await expect(
      h.service.place(
        body({ payment: { method: 'wallet', providerCode: 'airtel_money' } }),
        OPERATOR,
        'key-7',
      ),
    ).rejects.toMatchObject({ status: 409, response: { code: 'PAYMENT_METHOD_UNAVAILABLE' } });
    expect(h.payments.createPayment).not.toHaveBeenCalled();
  });

  it('SPEC-012-01-SC04 — paid after the call: the operator confirms the number later', async () => {
    const h = harness({ transfer: 'pending' });
    const r = await h.service.confirmTransfer('ord-1', 'CI2.B');
    expect(h.receipts.claimForOrder).toHaveBeenCalledWith('ord-1', 'CI2.B');
    expect(r.transfer).toBe('pending');
  });
});
