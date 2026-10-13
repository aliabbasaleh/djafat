import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ModuleRef } from '@nestjs/core';
import { ConflictException, type HttpException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { CartsService } from '../carts/carts.service';
import type { CatalogService, CartProductRecord } from '../catalog/catalog.service';
import type { PricingService } from '../pricing/pricing.service';
import type { PlatformService } from '../platform/platform.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { OutboxService } from '../../infra/outbox/outbox.service';
import type { AddressesService } from '../addresses/addresses.service';
import type { UsersService } from '../users/users.service';
import { OrdersService } from './orders.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaIdempotencyStore } from '../../common/idempotency/prisma-idempotency.store';

/**
 * A REAL concurrency harness, not a sequential simulation: `$transaction`'s
 * `tx.$queryRaw` for `SELECT ... FOR UPDATE` on `carts` acquires a genuine
 * per-cart-id async mutex (queued waiters, released only when the outer
 * transaction's callback settles) — so two truly concurrent
 * `OrdersService.createOrder()` calls on the SAME cart actually serialize
 * through this lock exactly as they would against real PostgreSQL row
 * locking, rather than merely happening to run one-after-another because
 * nothing in a naive fake ever `await`s. `idempotency_keys` inserts are
 * simulated as a synchronous check-and-set (safe: no `await` between check
 * and write, matching Postgres's `INSERT ... ON CONFLICT DO NOTHING`
 * atomicity for a single row).
 */
function makeRaceDb() {
  interface CartRow {
    id: string;
    userId: string;
    restaurantId: string | null;
    currency: string | null;
    status: string;
  }
  interface ItemRow {
    id: string;
    cartId: string;
    productId: string;
    nameSnapshot: string;
    quantity: number;
    unitPriceMinor: bigint;
    currency: string;
  }
  interface OptionRow {
    id: string;
    cartItemId: string;
    optionGroupId: string;
    optionId: string;
    nameSnapshot: string;
    priceDeltaMinor: bigint;
    currency: string;
  }
  // Deliberately untyped beyond `id` — mirrors whatever fields the real
  // `doCreateOrder()` writes, plus the DB-defaulted columns it never sets.
  type OrderRow = { id: string } & Record<string, unknown>;
  interface IdemRow {
    fingerprint: string;
    response: unknown;
    status: 'reserved' | 'completed';
  }

  const carts: CartRow[] = [];
  const items: ItemRow[] = [];
  const options: OptionRow[] = [];
  const orders: OrderRow[] = [];
  const idempotencyKeys = new Map<string, IdemRow>();

  function withRelations(cart: CartRow) {
    return {
      ...cart,
      items: items
        .filter((i) => i.cartId === cart.id)
        .map((i) => ({ ...i, options: options.filter((o) => o.cartItemId === i.id) })),
    };
  }

  // ── per-cart-id lock queue (simulates `SELECT ... FOR UPDATE`) ───────────
  const lockTail = new Map<string, Promise<void>>();
  async function acquireCartLock(cartId: string): Promise<() => void> {
    const previous = lockTail.get(cartId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    lockTail.set(
      cartId,
      previous.then(() => mine),
    );
    await previous;
    return release;
  }

  function rawText(strings: TemplateStringsArray): string {
    return strings.join('?');
  }

  // Top-level (non-transactional) raw SQL — only `idempotency_keys` uses this.
  const topLevelExecuteRaw = vi.fn(
    async (strings: TemplateStringsArray, ...values: unknown[]): Promise<number> => {
      const text = rawText(strings);
      if (text.includes('INSERT INTO idempotency_keys')) {
        const [scope, key, fingerprint] = values as [string, string, string];
        const id = `${scope}::${key}`;
        if (idempotencyKeys.has(id)) return 0; // ON CONFLICT DO NOTHING
        idempotencyKeys.set(id, { fingerprint, response: null, status: 'reserved' });
        return 1;
      }
      if (text.includes('UPDATE idempotency_keys')) {
        const [response, scope, key] = values as [string, string, string];
        const row = idempotencyKeys.get(`${scope}::${key}`);
        if (row) {
          row.response = JSON.parse(response);
          row.status = 'completed';
        }
        return 1;
      }
      if (text.includes('DELETE FROM idempotency_keys')) {
        const [scope, key] = values as [string, string];
        const id = `${scope}::${key}`;
        if (idempotencyKeys.get(id)?.status === 'reserved') idempotencyKeys.delete(id);
        return 1;
      }
      throw new Error(`Unhandled $executeRaw in test fake: ${text}`);
    },
  );

  const topLevelQueryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = rawText(strings);
    if (text.includes('idempotency_keys')) {
      const [scope, key] = values as [string, string];
      const row = idempotencyKeys.get(`${scope}::${key}`);
      return row
        ? [{ fingerprint: row.fingerprint, response: row.response, status: row.status }]
        : [];
    }
    throw new Error(`Unhandled top-level $queryRaw in test fake: ${text}`);
  });

  type QueryRawFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

  function makeClient(txQueryRaw: QueryRawFn) {
    return {
      cart: {
        findFirst: vi.fn((args: { where: { userId: string; status: string } }) => {
          const found = carts.find(
            (c) => c.userId === args.where.userId && c.status === args.where.status,
          );
          return Promise.resolve(found ? withRelations(found) : null);
        }),
        create: vi.fn((args: { data: Omit<CartRow, 'id'> }) => {
          const row: CartRow = { id: randomUUID(), ...args.data };
          carts.push(row);
          return Promise.resolve(withRelations(row));
        }),
        update: vi.fn((args: { where: { id: string }; data: Partial<CartRow> }) => {
          const row = carts.find((c) => c.id === args.where.id)!;
          Object.assign(row, args.data);
          return Promise.resolve(withRelations(row));
        }),
        updateMany: vi.fn(
          (args: { where: { id: string; status?: string }; data: Partial<CartRow> }) => {
            const row = carts.find(
              (c) =>
                c.id === args.where.id &&
                (args.where.status ? c.status === args.where.status : true),
            );
            if (!row) return Promise.resolve({ count: 0 });
            Object.assign(row, args.data);
            return Promise.resolve({ count: 1 });
          },
        ),
      },
      cartItem: {
        create: vi.fn((args: { data: Omit<ItemRow, 'id'> }) => {
          const row: ItemRow = { id: randomUUID(), ...args.data };
          items.push(row);
          return Promise.resolve(row);
        }),
        update: vi.fn((args: { where: { id: string }; data: Partial<ItemRow> }) => {
          const row = items.find((i) => i.id === args.where.id)!;
          Object.assign(row, args.data);
          return Promise.resolve(row);
        }),
        delete: vi.fn((args: { where: { id: string } }) => {
          const idx = items.findIndex((i) => i.id === args.where.id);
          items.splice(idx, 1);
          return Promise.resolve(undefined);
        }),
        deleteMany: vi.fn((args: { where: { cartId: string } }) => {
          for (let i = items.length - 1; i >= 0; i--) {
            if (items[i]!.cartId === args.where.cartId) items.splice(i, 1);
          }
          return Promise.resolve({ count: 0 });
        }),
      },
      cartItemOption: {
        createMany: vi.fn((args: { data: Omit<OptionRow, 'id'>[] }) => {
          for (const d of args.data) options.push({ id: randomUUID(), ...d });
          return Promise.resolve({ count: args.data.length });
        }),
        deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
      },
      product: {
        findUnique: vi.fn(() => Promise.resolve({ restaurantId: RESTAURANT_ID })),
      },
      order: {
        create: vi.fn((args: { data: Record<string, unknown> }) => {
          const now = new Date();
          const row: OrderRow = {
            id: randomUUID(),
            placedAt: null,
            deliveredAt: null,
            createdAt: now,
            updatedAt: now,
            ...args.data,
          };
          orders.push(row);
          return Promise.resolve(row);
        }),
      },
      orderItem: {
        create: vi.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: randomUUID(), ...args.data }),
        ),
      },
      orderItemOption: {
        createMany: vi.fn(() => Promise.resolve({ count: 0 })),
      },
      orderStatusHistory: {
        create: vi.fn(() => Promise.resolve(undefined)),
      },
      outbox: {
        create: vi.fn(() => Promise.resolve(undefined)),
      },
      $queryRaw: txQueryRaw,
    };
  }

  const baseClient = makeClient(topLevelQueryRaw);

  const store = {
    ...baseClient,
    $executeRaw: topLevelExecuteRaw,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const releases: Array<() => void> = [];
      const txQueryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = rawText(strings);
        if (text.includes('FOR UPDATE') && text.includes('carts')) {
          const userId = values[0] as string;
          const openCart = carts.find((c) => c.userId === userId && c.status === 'open');
          if (!openCart) return [];
          const release = await acquireCartLock(openCart.id);
          releases.push(release);
          // Re-read AFTER acquiring the lock — the whole point of FOR UPDATE:
          // by the time we get it, another committed transaction may have
          // already converted this exact cart.
          const stillOpen = carts.find((c) => c.id === openCart.id && c.status === 'open');
          return stillOpen ? [{ id: stillOpen.id }] : [];
        }
        if (text.includes('FROM addresses')) {
          // A seeded default address with no coordinates — the dropoff
          // snapshot (Bloc 6, docs/25 §8) needs SOME row to exist, but these
          // race tests don't exercise geo, so lat/lng stay null (the
          // service correctly skips the geom UPDATE in that case).
          return [
            {
              id: 'addr-1',
              quartier: 'Quartier Test',
              street: null,
              landmark: null,
              instructions: null,
              recipient_phone: null,
              geocode_status: 'manual',
              lat: null,
              lng: null,
            },
          ];
        }
        // Anything else raw-queried inside a transaction in this codebase
        // doesn't need real data for these tests.
        return [];
      });
      const txClient = makeClient(txQueryRaw);
      try {
        return await fn(txClient);
      } finally {
        for (const release of releases) release();
      }
    }),
  };

  return {
    db: store as unknown as PrismaService,
    carts,
    items,
    orders,
    idempotencyKeys,
  };
}

const RESTAURANT_ID = 'r1';
const PRODUCT_ID = 'p1';

function burgerProduct(): CartProductRecord {
  return {
    id: PRODUCT_ID,
    restaurantId: RESTAURANT_ID,
    name: 'Burger',
    priceMinor: 2800n,
    currency: 'XAF',
    optionGroups: [],
  };
}

function catalogStub() {
  return {
    getActiveRestaurant: vi.fn().mockResolvedValue({
      id: RESTAURANT_ID,
      countryId: 'c1',
      cityId: 'city1',
      name: 'Chez Fatimé',
      currency: 'XAF',
    }),
    getCartEligibleProducts: vi.fn().mockResolvedValue([burgerProduct()]),
    // These tests are about the cart LOCK, not opening hours — keep the
    // restaurant open so the race is what is actually under test.
    getRestaurantAvailability: vi.fn().mockResolvedValue('OPEN'),
  } as unknown as CatalogService;
}

const pricingStub = () =>
  ({
    priceOrder: vi.fn().mockResolvedValue({
      subtotal: { minor: 2800n, currency: 'XAF' },
      deliveryFee: { minor: 1000n, currency: 'XAF' },
      commissionBps: 0,
      commission: { minor: 0n, currency: 'XAF' },
      courierFee: { minor: 1000n, currency: 'XAF' },
      total: { minor: 3800n, currency: 'XAF' },
    }),
  }) as unknown as PricingService;

const platformStub = () =>
  ({
    getCartMaxItemQuantity: vi.fn().mockResolvedValue(99),
    getUnpaidOrderTtlSeconds: vi.fn().mockResolvedValue(900),
  }) as unknown as PlatformService;

const outboxStub = () =>
  ({ enqueue: vi.fn().mockResolvedValue(undefined) }) as unknown as OutboxService;

// Bloc 8 (docs/29): none of these races ever select an `addressId` — every
// `createOrder()` call here omits it and falls through to the pre-existing
// default-address path, so `AddressesService` is never actually invoked.
// `requireOwned` still throws if that assumption ever breaks, rather than
// silently returning `undefined` into the dropoff snapshot.
const addressesStub = () =>
  ({
    requireOwned: vi.fn().mockRejectedValue(new Error('addressesStub: unexpectedly called')),
  }) as unknown as AddressesService;

// Bloc 9 (docs/30): none of these races ever call confirm/ready/reject —
// `isMemberOfRestaurant` is never invoked on this path.
const usersStub = () =>
  ({
    isMemberOfRestaurant: vi.fn().mockRejectedValue(new Error('usersStub: unexpectedly called')),
  }) as unknown as UsersService;

function buildServices(db: PrismaService) {
  const catalog = catalogStub();
  const pricing = pricingStub();
  const platform = platformStub();
  const carts = new CartsService(db, catalog, pricing, platform);
  const idempotency = new IdempotencyService(new PrismaIdempotencyStore(db));
  const orders = new OrdersService(
    db,
    catalog,
    pricing,
    platform,
    carts,
    addressesStub(),
    usersStub(),
    outboxStub(),
    idempotency,
    { emit: vi.fn() } as unknown as EventEmitter2,
    // `ModuleRef` — only used to lazily resolve `DELIVERY_TRACKING_PORT` for the
    // courier branch of `getOrderFor` (BUG-10.1-AUTH); never reached by these tests.
    { get: vi.fn() } as unknown as ModuleRef,
  );
  return { carts, orders };
}

describe('OrdersService.createOrder — REAL concurrency against a lock-aware fake DB (docs/22 §9)', () => {
  it('two concurrent createOrder() calls on the SAME cart with DIFFERENT idempotency keys produce exactly ONE order (the row lock, not idempotency, is what protects this)', async () => {
    const { db, orders: orderRows, carts: cartRows } = makeRaceDb();
    const { carts, orders } = buildServices(db);

    await carts.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: [] });

    const [a, b] = await Promise.allSettled([
      orders.createOrder('u1', 'key-A'),
      orders.createOrder('u1', 'key-B'),
    ]);

    const outcomes = [a, b];
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    // Exactly one of the two requests actually created an order; the other
    // must fail cleanly (CART_EMPTY — the cart it locked onto was already
    // converted) rather than ALSO succeeding.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejectionA = (rejected[0] as PromiseRejectedResult).reason as HttpException;
    expect(rejectionA).toBeInstanceOf(ConflictException);
    expect(rejectionA.getResponse()).toMatchObject({ code: 'CART_EMPTY' });

    // The DATABASE itself has exactly one order row — not just "one promise
    // resolved" (which could still coexist with two rows if the resolved
    // one raced ahead of a partially-written second).
    expect(orderRows).toHaveLength(1);

    // The cart converted exactly once, never left half-open/half-converted.
    const cart = cartRows.find((c) => c.userId === 'u1')!;
    expect(cart.status).toBe('converted');
  });

  it('two concurrent createOrder() calls with the SAME idempotency key: only one runs the handler, the other is rejected as in-progress (never a duplicate order, never a fabricated null reply)', async () => {
    const { db, orders: orderRows } = makeRaceDb();
    const { carts, orders } = buildServices(db);

    await carts.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: [] });

    const [a, b] = await Promise.allSettled([
      orders.createOrder('u1', 'same-key'),
      orders.createOrder('u1', 'same-key'),
    ]);

    const fulfilled = [a, b].filter((o) => o.status === 'fulfilled');
    const rejected = [a, b].filter((o) => o.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejectionB = (rejected[0] as PromiseRejectedResult).reason as HttpException;
    expect(rejectionB).toBeInstanceOf(ConflictException);
    expect(rejectionB.getResponse()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(orderRows).toHaveLength(1);
  });

  it('a client retry with the SAME key AFTER the original request already committed replays the SAME order (never a second one)', async () => {
    const { db, orders: orderRows } = makeRaceDb();
    const { carts, orders } = buildServices(db);

    await carts.addItem('u1', { productId: PRODUCT_ID, quantity: 1, selectedOptionIds: [] });

    const original = await orders.createOrder('u1', 'retry-key');
    expect(original.status).toBe('created');

    // Simulates the client never seeing the first response (e.g. a network
    // timeout) and retrying with the identical key once the server-side
    // work has fully committed.
    const retry = await orders.createOrder('u1', 'retry-key');

    expect(retry.status).toBe('replayed');
    expect(retry.order.id).toBe(original.order.id);
    expect(orderRows).toHaveLength(1);
  });
});
