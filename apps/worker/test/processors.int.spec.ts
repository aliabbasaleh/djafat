import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { orderExpiryProcessor } from '../src/processors/order-expiry.processor';
import { outboxRelayProcessor, type Publisher } from '../src/processors/outbox-relay.processor';
import { ledgerAssertProcessor } from '../src/processors/ledger-assert.processor';

/**
 * Exercises the REAL worker processors (no mocking of `pg`) against a real
 * Postgres instance with migrations applied and `pnpm db:seed` run (docs/18
 * §19–§20). Requires `pnpm infra:up` — see apps/api/test/README.md. Assumes
 * the Bloc 0.5 walking-skeleton fixtures exist (apps/api/prisma/seed.ts):
 * customer +23566000001, courier +23566000002, restaurant slug chez-fatime.
 */

interface Fixtures {
  countryId: string;
  cityId: string;
  customerId: string;
  restaurantId: string;
}

async function loadFixtures(): Promise<Fixtures> {
  const restaurant = await pool.query<{ id: string; country_id: string; city_id: string }>(
    `SELECT id, country_id, city_id FROM restaurants WHERE slug = 'chez-fatime'`,
  );
  const customer = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE phone = '+23566000001'`,
  );
  if (!restaurant.rows[0] || !customer.rows[0]) {
    throw new Error(
      'Bloc 0.5 seed fixtures not found — run `pnpm --filter @djafat/api run db:seed` before `test:int`.',
    );
  }
  return {
    countryId: restaurant.rows[0].country_id,
    cityId: restaurant.rows[0].city_id,
    customerId: customer.rows[0].id,
    restaurantId: restaurant.rows[0].id,
  };
}

async function insertOrder(
  fx: Fixtures,
  overrides: { status: string; expiresAt: Date | null },
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO orders (
       id, code, idempotency_key, country_id, city_id, customer_id, restaurant_id,
       status, currency, subtotal_minor, delivery_fee_minor, commission_minor,
       courier_fee_minor, total_minor, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'XAF', 4500, 1000, 900, 1000, 5500, $9)`,
    [
      id,
      `DJF-TEST-${id.slice(0, 8)}`,
      `test-idem-${id}`,
      fx.countryId,
      fx.cityId,
      fx.customerId,
      fx.restaurantId,
      overrides.status,
      overrides.expiresAt,
    ],
  );
  return id;
}

async function orderStatus(orderId: string): Promise<string> {
  const { rows } = await pool.query<{ status: string }>(`SELECT status FROM orders WHERE id = $1`, [
    orderId,
  ]);
  return rows[0]!.status;
}

let fx: Fixtures;

beforeAll(async () => {
  fx = await loadFixtures();
});

afterAll(async () => {
  await pool.end();
});

describe('orderExpiryProcessor (docs/18 §19)', () => {
  it('expires an awaiting_payment order past its TTL, and is idempotent on replay', async () => {
    const past = new Date(Date.now() - 60_000);
    const orderId = await insertOrder(fx, { status: 'awaiting_payment', expiresAt: past });

    const first = await orderExpiryProcessor();
    expect(first.expired).toBeGreaterThanOrEqual(1);
    expect(await orderStatus(orderId)).toBe('expired');

    const history = await pool.query(
      `SELECT from_status, to_status FROM order_status_history WHERE order_id = $1`,
      [orderId],
    );
    expect(history.rows).toEqual([{ from_status: 'awaiting_payment', to_status: 'expired' }]);

    const outboxRows = await pool.query(
      `SELECT event_type FROM outbox WHERE aggregate = 'order' AND aggregate_id = $1`,
      [orderId],
    );
    expect(outboxRows.rows).toEqual([{ event_type: 'order.expired' }]);

    // Idempotent replay: this order no longer matches `status = 'awaiting_payment'`,
    // so a second tick must not touch it again (no duplicate history/outbox rows).
    await orderExpiryProcessor();
    expect(await orderStatus(orderId)).toBe('expired');
    const historyAfterReplay = await pool.query(
      `SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1`,
      [orderId],
    );
    expect(historyAfterReplay.rows[0]!.n).toBe(1);
  });

  it('NEVER expires an order that already moved past awaiting_payment (race with payment success)', async () => {
    const past = new Date(Date.now() - 60_000);
    const orderId = await insertOrder(fx, { status: 'awaiting_payment', expiresAt: past });

    // Simulate `payments.markSucceeded` winning the race, atomically and
    // conditionally exactly like the real code does.
    await pool.query(
      `UPDATE orders SET status = 'placed' WHERE id = $1 AND status = 'awaiting_payment'`,
      [orderId],
    );
    expect(await orderStatus(orderId)).toBe('placed');

    await orderExpiryProcessor();
    // The bare conditional UPDATE inside orderExpiryProcessor matches zero rows
    // for this order (status is no longer 'awaiting_payment') — it must stay 'placed'.
    expect(await orderStatus(orderId)).toBe('placed');
  });
});

describe('outboxRelayProcessor (docs/18 §9)', () => {
  it('publishes a pending row and marks it published', async () => {
    const aggregateId = randomUUID();
    await pool.query(
      `INSERT INTO outbox (aggregate, aggregate_id, event_type, payload)
       VALUES ('order', $1, 'order.test_event', $2::jsonb)`,
      [aggregateId, JSON.stringify({ orderId: aggregateId })],
    );

    const published: Array<{ channel: string; message: string }> = [];
    const publish: Publisher = async (channel, message) => {
      published.push({ channel, message });
      return 1;
    };

    const result = await outboxRelayProcessor(publish);
    expect(result.published).toBeGreaterThanOrEqual(1);

    const match = published.find(
      (p) => (JSON.parse(p.message) as { aggregateId: string }).aggregateId === aggregateId,
    );
    expect(match).toBeDefined();
    expect(match!.channel).toBe('domain-events');

    const row = await pool.query(`SELECT status FROM outbox WHERE aggregate_id = $1`, [
      aggregateId,
    ]);
    expect(row.rows[0]!.status).toBe('published');
  });

  it('backs off (never DLQs on the first failure) when publish rejects', async () => {
    const aggregateId = randomUUID();
    await pool.query(
      `INSERT INTO outbox (aggregate, aggregate_id, event_type, payload)
       VALUES ('order', $1, 'order.test_event_fail', $2::jsonb)`,
      [aggregateId, JSON.stringify({})],
    );

    const failingPublish: Publisher = async () => {
      throw new Error('redis unreachable (test)');
    };
    await outboxRelayProcessor(failingPublish);

    const row = await pool.query<{ status: string; attempts: number; last_error: string }>(
      `SELECT status, attempts, last_error FROM outbox WHERE aggregate_id = $1`,
      [aggregateId],
    );
    expect(row.rows[0]!.status).toBe('pending'); // below MAX_ATTEMPTS, not DLQ'd yet
    expect(row.rows[0]!.attempts).toBe(1);
    expect(row.rows[0]!.last_error).toMatch(/redis unreachable/);
  });
});

describe('ledgerAssertProcessor (docs/08 §8.9, docs/18 §20)', () => {
  async function insertLedgerAccount(
    code: string,
    type: string,
    ownerType: string | null,
    ownerId: string | null,
  ) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO ledger_accounts (code, type, owner_type, owner_id, currency)
       VALUES ($1, $2, $3, $4, 'XAF') RETURNING id`,
      [code, type, ownerType, ownerId],
    );
    return rows[0]!.id;
  }

  it('reports zero findings for a balanced group with a matching wallet row', async () => {
    const restaurantId = randomUUID();
    const debitAccountId = await insertLedgerAccount('PSP_CLEARING', 'asset', 'psp', null);
    const creditAccountId = await insertLedgerAccount(
      `RESTAURANT_PAYABLE:${restaurantId}`.slice(0, 200),
      'liability',
      'restaurant',
      restaurantId,
    );
    const groupId = randomUUID();
    await pool.query(
      `INSERT INTO ledger_entry_groups (id, kind, idempotency_key, currency, created_by)
       VALUES ($1, 'order_accrual', $2, 'XAF', 'test')`,
      [groupId, `test:${groupId}`],
    );
    await pool.query(
      `INSERT INTO ledger_entries (entry_group, account_id, direction, amount_minor, currency)
       VALUES ($1, $2, 'debit', 1000, 'XAF'), ($1, $3, 'credit', 1000, 'XAF')`,
      [groupId, debitAccountId, creditAccountId],
    );
    // Matching wallet projection — what LedgerRepository.writeGroup would have done.
    await pool.query(
      `INSERT INTO wallet_balances (owner_type, owner_id, currency, pending_minor)
       VALUES ('restaurant', $1, 'XAF', 1000)`,
      [restaurantId],
    );

    const result = await ledgerAssertProcessor();
    expect(result.unbalancedGroups.find((g) => g.entryGroup === groupId)).toBeUndefined();
    expect(result.walletMismatches.find((m) => m.ownerId === restaurantId)).toBeUndefined();
  });

  it('DETECTS an unbalanced group written directly via SQL (bypassing the app-level invariant)', async () => {
    const debitAccountId = await insertLedgerAccount('PSP_CLEARING', 'asset', 'psp', null);
    const creditAccountId = await insertLedgerAccount('DJAFAT_REVENUE', 'revenue', 'djafat', null);
    const groupId = randomUUID();
    await pool.query(
      `INSERT INTO ledger_entry_groups (id, kind, idempotency_key, currency, created_by)
       VALUES ($1, 'adjustment', $2, 'XAF', 'test')`,
      [groupId, `test:${groupId}`],
    );
    // Deliberately unbalanced: debit 100, credit 90 — the DB has no CHECK for
    // this (it's an app-level invariant), which is exactly why this job exists.
    await pool.query(
      `INSERT INTO ledger_entries (entry_group, account_id, direction, amount_minor, currency)
       VALUES ($1, $2, 'debit', 100, 'XAF'), ($1, $3, 'credit', 90, 'XAF')`,
      [groupId, debitAccountId, creditAccountId],
    );

    const result = await ledgerAssertProcessor();
    const finding = result.unbalancedGroups.find((g) => g.entryGroup === groupId);
    expect(finding).toBeDefined();
    expect(finding).toMatchObject({ debit: '100', credit: '90' });
  });

  it('DETECTS a wallet_balances row that disagrees with its ledger entries', async () => {
    const courierId = randomUUID();
    const debitAccountId = await insertLedgerAccount('PSP_CLEARING', 'asset', 'psp', null);
    const creditAccountId = await insertLedgerAccount(
      `COURIER_PAYABLE:${courierId}`.slice(0, 200),
      'liability',
      'courier',
      courierId,
    );
    const groupId = randomUUID();
    await pool.query(
      `INSERT INTO ledger_entry_groups (id, kind, idempotency_key, currency, created_by)
       VALUES ($1, 'order_accrual', $2, 'XAF', 'test')`,
      [groupId, `test:${groupId}`],
    );
    await pool.query(
      `INSERT INTO ledger_entries (entry_group, account_id, direction, amount_minor, currency)
       VALUES ($1, $2, 'debit', 500, 'XAF'), ($1, $3, 'credit', 500, 'XAF')`,
      [groupId, debitAccountId, creditAccountId],
    );
    // Wallet row deliberately WRONG (should be 500, corrupted to 400).
    await pool.query(
      `INSERT INTO wallet_balances (owner_type, owner_id, currency, pending_minor)
       VALUES ('courier', $1, 'XAF', 400)`,
      [courierId],
    );

    const result = await ledgerAssertProcessor();
    const finding = result.walletMismatches.find((m) => m.ownerId === courierId);
    expect(finding).toBeDefined();
    expect(finding).toMatchObject({ bucket: 'pending', wallet: '400', ledger: '500' });
  });
});
