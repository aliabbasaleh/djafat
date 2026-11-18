import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

/**
 * ORD-02. Same harness as `order-expiry.processor.spec.ts`: only the
 * transaction wrapper is faked, the REAL processor runs against an in-memory
 * table set that applies the SQL's conditions (status `placed`, `placed_at`
 * older than the timeout). The SQL itself is exercised against PostgreSQL by
 * the API integration test of the refund it triggers.
 */
vi.mock('../db', () => ({
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => fn(fakeClient),
}));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

interface OrderRow {
  id: string;
  restaurant_id: string;
  status: string;
  placed_at: Date | null;
}

let orders: OrderRow[] = [];
let history: unknown[][] = [];
let outbox: Array<{ aggregateId: string; eventType: string; payload: unknown }> = [];
let timeoutSetting: unknown = undefined;

const fakeClient = {
  query: vi.fn(async (text: string, params: unknown[] = []) => {
    if (text.includes('FROM platform_settings')) {
      return { rows: timeoutSetting === undefined ? [] : [{ value: timeoutSetting }] };
    }
    if (text.includes('UPDATE orders SET status')) {
      const [seconds] = params as [number];
      const cutoff = Date.now() - seconds * 1000;
      const matched = orders.filter(
        (o) => o.status === 'placed' && o.placed_at !== null && o.placed_at.getTime() <= cutoff,
      );
      for (const o of matched) o.status = 'cancelled';
      return { rows: matched.map((o) => ({ id: o.id, restaurant_id: o.restaurant_id })) };
    }
    if (text.includes('INSERT INTO order_status_history')) {
      history.push(params);
      return { rows: [] };
    }
    if (text.includes('INSERT INTO outbox')) {
      const [aggregateId, payloadJson] = params as [string, string];
      const eventType = text.includes("'order.cancelled'") ? 'order.cancelled' : 'unknown';
      outbox.push({ aggregateId, eventType, payload: JSON.parse(payloadJson) });
      return { rows: [] };
    }
    throw new Error(`Unhandled query in fake client: ${text}`);
  }),
};

function reset(setting?: unknown) {
  orders = [];
  history = [];
  outbox = [];
  timeoutSetting = setting;
  fakeClient.query.mockClear();
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

describe('orderConfirmationTimeoutProcessor (ORD-02)', () => {
  it('cancels a placed order older than the timeout, with its history row and order.cancelled event', async () => {
    reset(900);
    const { orderConfirmationTimeoutProcessor } = await import(
      './order-confirmation-timeout.processor'
    );
    const restaurantId = randomUUID();
    const late = {
      id: randomUUID(),
      restaurant_id: restaurantId,
      status: 'placed',
      placed_at: minutesAgo(16),
    };
    orders.push(late);

    const result = await orderConfirmationTimeoutProcessor();

    expect(result.cancelled).toBe(1);
    expect(late.status).toBe('cancelled');
    expect(history).toEqual([[late.id]]);
    expect(outbox).toEqual([
      {
        aggregateId: late.id,
        eventType: 'order.cancelled',
        payload: { orderId: late.id, status: 'cancelled', restaurantId },
      },
    ]);
  });

  it('leaves a placed order still inside the timeout, and orders past placed, alone', async () => {
    reset(900);
    const { orderConfirmationTimeoutProcessor } = await import(
      './order-confirmation-timeout.processor'
    );
    orders.push(
      {
        id: randomUUID(),
        restaurant_id: randomUUID(),
        status: 'placed',
        placed_at: minutesAgo(14),
      },
      {
        id: randomUUID(),
        restaurant_id: randomUUID(),
        status: 'confirmed',
        placed_at: minutesAgo(60),
      },
      {
        id: randomUUID(),
        restaurant_id: randomUUID(),
        status: 'awaiting_payment',
        placed_at: null,
      },
    );

    const result = await orderConfirmationTimeoutProcessor();

    expect(result.cancelled).toBe(0);
    expect(orders.map((o) => o.status)).toEqual(['placed', 'confirmed', 'awaiting_payment']);
    expect(outbox).toEqual([]);
  });

  it('reads the timeout from platform_settings, and falls back to 15 min when unset or invalid', async () => {
    const { orderConfirmationTimeoutProcessor } = await import(
      './order-confirmation-timeout.processor'
    );
    reset(300); // 5 min configured
    orders.push({
      id: randomUUID(),
      restaurant_id: randomUUID(),
      status: 'placed',
      placed_at: minutesAgo(6),
    });
    expect((await orderConfirmationTimeoutProcessor()).cancelled).toBe(1);

    for (const setting of [undefined, 'soon', -5]) {
      reset(setting);
      orders.push({
        id: randomUUID(),
        restaurant_id: randomUUID(),
        status: 'placed',
        placed_at: minutesAgo(6),
      });
      expect((await orderConfirmationTimeoutProcessor()).cancelled, String(setting)).toBe(0);
      orders[0]!.placed_at = minutesAgo(16);
      expect((await orderConfirmationTimeoutProcessor()).cancelled, String(setting)).toBe(1);
    }
  });
});
