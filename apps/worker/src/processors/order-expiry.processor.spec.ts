import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

/**
 * `withTransaction` normally opens a real Postgres connection (`../db`) — not
 * available here (Docker unavailable, same constraint noted throughout
 * docs/23/docs/24). This fakes ONLY the transaction wrapper, running the
 * REAL `orderExpiryProcessor` SQL text against a small in-memory table set so
 * the fix (docs/08 §8.4 step 7 — expiry must also close out the order's
 * still-pending payment) is proven by an executable test, not just read.
 */
vi.mock('../db', () => ({
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => fn(fakeClient),
}));
// `../logger` transitively loads `@djafat/config`'s env validation at import
// time (DATABASE_URL/REDIS_URL/...) — irrelevant to this pure-logic test.
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

interface OrderRow {
  id: string;
  status: string;
  expires_at: Date | null;
}
interface PaymentRow {
  id: string;
  order_id: string;
  status: string;
}
interface OutboxRow {
  aggregate: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
}

let orders: OrderRow[] = [];
let payments: PaymentRow[] = [];
let outbox: OutboxRow[] = [];

const fakeClient = {
  query: vi.fn(async (text: string, params: unknown[] = []) => {
    if (text.includes('UPDATE orders SET status')) {
      const now = new Date();
      const matched = orders.filter(
        (o) => o.status === 'awaiting_payment' && o.expires_at !== null && o.expires_at <= now,
      );
      for (const o of matched) o.status = 'expired';
      return { rows: matched.map((o) => ({ id: o.id })) };
    }
    if (text.includes('INSERT INTO order_status_history')) {
      return { rows: [] };
    }
    if (text.includes('INSERT INTO outbox')) {
      const [aggregateId, payloadJson] = params as [string, string];
      const aggregate = text.includes("'payment'") ? 'payment' : 'order';
      const eventType = text.includes('payment.expired') ? 'payment.expired' : 'order.expired';
      outbox.push({ aggregate, aggregateId, eventType, payload: JSON.parse(payloadJson) } as never);
      return { rows: [] };
    }
    if (text.includes('UPDATE payments SET status')) {
      const [orderId] = params as [string];
      const matched = payments.filter(
        (p) => p.order_id === orderId && ['pending', 'authorized'].includes(p.status),
      );
      for (const p of matched) p.status = 'expired';
      return { rows: matched.map((p) => ({ id: p.id })) };
    }
    throw new Error(`Unhandled query in fake client: ${text}`);
  }),
};

function resetTables() {
  orders = [];
  payments = [];
  outbox = [];
  fakeClient.query.mockClear();
}

describe('orderExpiryProcessor — also expires the order’s payment (docs/08 §8.4 step 7)', () => {
  it('flips a still-pending payment to expired and enqueues payment.expired, alongside order.expired', async () => {
    resetTables();
    const { orderExpiryProcessor } = await import('./order-expiry.processor');

    const orderId = randomUUID();
    const paymentId = randomUUID();
    orders.push({
      id: orderId,
      status: 'awaiting_payment',
      expires_at: new Date(Date.now() - 1000),
    });
    payments.push({ id: paymentId, order_id: orderId, status: 'pending' });

    const result = await orderExpiryProcessor();

    expect(result.expired).toBe(1);
    expect(orders[0]!.status).toBe('expired');
    expect(payments[0]!.status).toBe('expired'); // the fix: was left dangling 'pending' before
    expect(outbox).toContainEqual(
      expect.objectContaining({ aggregate: 'payment', eventType: 'payment.expired' }),
    );
  });

  it('never touches a payment that already resolved (succeeded/failed) before the order expired', async () => {
    resetTables();
    const { orderExpiryProcessor } = await import('./order-expiry.processor');

    const orderId = randomUUID();
    const paymentId = randomUUID();
    orders.push({
      id: orderId,
      status: 'awaiting_payment',
      expires_at: new Date(Date.now() - 1000),
    });
    payments.push({ id: paymentId, order_id: orderId, status: 'failed' });

    await orderExpiryProcessor();

    expect(payments[0]!.status).toBe('failed'); // untouched, not regressed to 'expired'
    expect(outbox.some((e) => e.aggregate === 'payment')).toBe(false);
  });

  it('an order not past its TTL is untouched, and so is its payment', async () => {
    resetTables();
    const { orderExpiryProcessor } = await import('./order-expiry.processor');

    const orderId = randomUUID();
    const paymentId = randomUUID();
    orders.push({
      id: orderId,
      status: 'awaiting_payment',
      expires_at: new Date(Date.now() + 60_000),
    });
    payments.push({ id: paymentId, order_id: orderId, status: 'pending' });

    const result = await orderExpiryProcessor();

    expect(result.expired).toBe(0);
    expect(orders[0]!.status).toBe('awaiting_payment');
    expect(payments[0]!.status).toBe('pending');
  });
});
