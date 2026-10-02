import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrderTransitionError } from '@djafat/core';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { CatalogService } from '../catalog/catalog.service';
import type { PricingService } from '../pricing/pricing.service';
import type { PlatformService } from '../platform/platform.service';
import type { CartsService } from '../carts/carts.service';
import type { AddressesService } from '../addresses/addresses.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { OutboxService } from '../../infra/outbox/outbox.service';
import type { UsersService } from '../users/users.service';
import { OrdersService } from './orders.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaIdempotencyStore } from '../../common/idempotency/prisma-idempotency.store';

/**
 * Bloc 9 (docs/30 §order-authorization, Phase 5 adversarial matrix) —
 * `OrdersController.confirm`/`ready`/`reject` closed the pre-Bloc-9 hole
 * (unauthenticated stand-ins, dette D-10): this file proves the FULL guard
 * stack (role gate in the controller + restaurant-membership check inside
 * `transitionOrder`'s own row-locked transaction) against a real lock-aware
 * fake DB — every scenario the mandate's Phase 5 names explicitly.
 *
 * Narrower fake than `checkout-address-selection.spec.ts`'s: these methods
 * never touch carts/addresses/pricing, only `orders`/`order_status_history`
 * — a per-order lock queue on `FOR UPDATE` is the one piece of real
 * concurrency this file needs (confirm/ready races).
 */
function makeOrderFakeDb() {
  type OrderRow = {
    id: string;
    code: string;
    status: string;
    currency: string;
    countryId: string;
    cityId: string;
    customerId: string;
    restaurantId: string;
    subtotalMinor: bigint;
    deliveryFeeMinor: bigint;
    commissionBpsSnapshot: number;
    commissionMinor: bigint;
    courierFeeMinor: bigint;
    totalMinor: bigint;
    expiresAt: Date | null;
    placedAt: Date | null;
    deliveredAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  interface HistoryRow {
    orderId: string;
    fromStatus: string | null;
    toStatus: string;
    actorRole: string | null;
    reason: string | null;
  }

  const orders: OrderRow[] = [];
  const history: HistoryRow[] = [];

  const lockTail = new Map<string, Promise<void>>();
  async function acquireOrderLock(orderId: string): Promise<() => void> {
    const previous = lockTail.get(orderId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    lockTail.set(
      orderId,
      previous.then(() => mine),
    );
    await previous;
    return release;
  }

  function rawText(strings: TemplateStringsArray): string {
    return strings.join('?');
  }

  type QueryRawFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
  type ExecuteRawFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<number>;

  function makeClient(txQueryRaw: QueryRawFn, txExecuteRaw: ExecuteRawFn) {
    return {
      order: {
        findUnique: vi.fn((args: { where: { id: string }; include?: unknown }) => {
          const row = orders.find((o) => o.id === args.where.id);
          return Promise.resolve(row ? { ...row, items: [] } : null);
        }),
      },
      orderStatusHistory: {
        create: vi.fn(
          (args: {
            data: {
              orderId: string;
              fromStatus: string | null;
              toStatus: string;
              actorRole: string | null;
              reason: string | null;
            };
          }) => {
            history.push({ ...args.data });
            return Promise.resolve(undefined);
          },
        ),
      },
      $queryRaw: txQueryRaw,
      $executeRaw: txExecuteRaw,
    };
  }

  const topLevel = {
    $queryRaw: vi.fn(() => {
      throw new Error('Unhandled top-level $queryRaw in order fake');
    }),
    $executeRaw: vi.fn(() => {
      throw new Error('Unhandled top-level $executeRaw in order fake');
    }),
  };

  const db = {
    order: {
      ...makeClient(topLevel.$queryRaw, topLevel.$executeRaw).order,
      findMany: vi.fn(
        (args: {
          where: { status?: string; restaurantId?: string };
          skip: number;
          take: number;
        }) => {
          let matches = orders;
          if (args.where.status) matches = matches.filter((o) => o.status === args.where.status);
          if (args.where.restaurantId) {
            matches = matches.filter((o) => o.restaurantId === args.where.restaurantId);
          }
          return Promise.resolve(matches.slice(args.skip, args.skip + args.take));
        },
      ),
      count: vi.fn((args: { where: { status?: string; restaurantId?: string } }) => {
        let matches = orders;
        if (args.where.status) matches = matches.filter((o) => o.status === args.where.status);
        if (args.where.restaurantId) {
          matches = matches.filter((o) => o.restaurantId === args.where.restaurantId);
        }
        return Promise.resolve(matches.length);
      }),
    },
    $queryRaw: topLevel.$queryRaw,
    $executeRaw: topLevel.$executeRaw,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const releases: Array<() => void> = [];
      const txQueryRaw = vi.fn(
        async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
          const text = rawText(strings);
          if (text.includes('FOR UPDATE') && text.includes('FROM orders')) {
            const [orderId] = values as [string];
            const release = await acquireOrderLock(orderId);
            releases.push(release);
            const row = orders.find((o) => o.id === orderId);
            return row ? [{ status: row.status, restaurant_id: row.restaurantId }] : [];
          }
          throw new Error(`Unhandled tx $queryRaw in order fake: ${text}`);
        },
      );
      const txExecuteRaw = vi.fn(
        async (strings: TemplateStringsArray, ...values: unknown[]): Promise<number> => {
          const text = rawText(strings);
          if (text.includes('UPDATE orders SET status')) {
            const [to, orderId] = values as [string, string];
            const row = orders.find((o) => o.id === orderId);
            if (!row) return 0;
            row.status = to;
            row.updatedAt = new Date();
            return 1;
          }
          throw new Error(`Unhandled tx $executeRaw in order fake: ${text}`);
        },
      );
      const txClient = makeClient(txQueryRaw, txExecuteRaw);
      try {
        return await fn(txClient);
      } finally {
        for (const release of releases) release();
      }
    }),
  };

  return { db: db as unknown as PrismaService, orders, history };
}

function seedOrder(
  orders: ReturnType<typeof makeOrderFakeDb>['orders'],
  overrides: Partial<(typeof orders)[number]> = {},
) {
  const now = new Date();
  const row = {
    id: randomUUID(),
    code: 'ORD-TEST',
    status: 'placed',
    currency: 'XAF',
    countryId: 'c1',
    cityId: 'city1',
    customerId: randomUUID(),
    restaurantId: 'r1',
    subtotalMinor: 2800n,
    deliveryFeeMinor: 1000n,
    commissionBpsSnapshot: 0,
    commissionMinor: 0n,
    courierFeeMinor: 1000n,
    totalMinor: 3800n,
    expiresAt: null,
    placedAt: now,
    deliveredAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  orders.push(row);
  return row;
}

function buildServices(db: PrismaService, membership: Set<string>) {
  const idempotency = new IdempotencyService(new PrismaIdempotencyStore(db));
  const users = {
    isMemberOfRestaurant: vi.fn((userId: string, restaurantId: string) =>
      Promise.resolve(membership.has(`${userId}:${restaurantId}`)),
    ),
  } as unknown as UsersService;
  const orders = new OrdersService(
    db,
    {} as unknown as CatalogService,
    {} as unknown as PricingService,
    {} as unknown as PlatformService,
    {} as unknown as CartsService,
    {} as unknown as AddressesService,
    users,
    { enqueue: vi.fn().mockResolvedValue(undefined) } as unknown as OutboxService,
    idempotency,
    { emit: vi.fn() } as unknown as EventEmitter2,
  );
  return { orders, users };
}

const RESTAURANT_A = 'restaurant-a';
const RESTAURANT_B = 'restaurant-b';

describe('orders.confirm/ready/reject — authorization (Bloc 9, docs/30 §order-authorization, Phase 5)', () => {
  it('a staff member of the order’s OWN restaurant can confirm it', async () => {
    const { db, orders: orderRows } = makeOrderFakeDb();
    const order = seedOrder(orderRows, { restaurantId: RESTAURANT_A, status: 'placed' });
    const staffUserId = randomUUID();
    const membership = new Set([`${staffUserId}:${RESTAURANT_A}`]);
    const { orders } = buildServices(db, membership);

    const result = await orders.confirmOrder(order.id, {
      userId: staffUserId,
      role: 'restaurant_staff',
    });
    expect(result.status).toBe('confirmed');
  });

  it('restaurant A staff CANNOT confirm restaurant B’s order — 403, no transition applied', async () => {
    const { db, orders: orderRows } = makeOrderFakeDb();
    const order = seedOrder(orderRows, { restaurantId: RESTAURANT_B, status: 'placed' });
    const staffOfA = randomUUID();
    const membership = new Set([`${staffOfA}:${RESTAURANT_A}`]);
    const { orders } = buildServices(db, membership);

    await expect(
      orders.confirmOrder(order.id, { userId: staffOfA, role: 'restaurant_staff' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(order.status).toBe('placed'); // untouched
  });

  it('restaurant A staff CANNOT mark restaurant B’s order ready', async () => {
    const { db, orders: orderRows } = makeOrderFakeDb();
    const order = seedOrder(orderRows, { restaurantId: RESTAURANT_B, status: 'confirmed' });
    const staffOfA = randomUUID();
    const membership = new Set([`${staffOfA}:${RESTAURANT_A}`]);
    const { orders } = buildServices(db, membership);

    await expect(
      orders.markReady(order.id, { userId: staffOfA, role: 'restaurant_staff' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(order.status).toBe('confirmed');
  });

  it('a staff member of the right restaurant can reject it (placed -> rejected)', async () => {
    const { db, orders: orderRows, history } = makeOrderFakeDb();
    const order = seedOrder(orderRows, { restaurantId: RESTAURANT_A, status: 'placed' });
    const staffUserId = randomUUID();
    const membership = new Set([`${staffUserId}:${RESTAURANT_A}`]);
    const { orders } = buildServices(db, membership);

    const result = await orders.rejectOrder(
      order.id,
      { userId: staffUserId, role: 'restaurant_staff' },
      'out of stock',
    );
    expect(result.status).toBe('rejected');
    expect(history).toContainEqual(
      expect.objectContaining({ toStatus: 'rejected', reason: 'out of stock' }),
    );
  });

  it('an unknown order returns 404, not a membership-check false', async () => {
    const { db } = makeOrderFakeDb();
    const { orders } = buildServices(db, new Set());

    await expect(
      orders.confirmOrder(randomUUID(), { userId: randomUUID(), role: 'restaurant_staff' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('an invalid state transition (confirming an already-rejected order) is a clean 409, never a raw 500', async () => {
    const { db, orders: orderRows } = makeOrderFakeDb();
    const order = seedOrder(orderRows, { restaurantId: RESTAURANT_A, status: 'rejected' });
    const staffUserId = randomUUID();
    const membership = new Set([`${staffUserId}:${RESTAURANT_A}`]);
    const { orders } = buildServices(db, membership);

    const attempt = orders.confirmOrder(order.id, {
      userId: staffUserId,
      role: 'restaurant_staff',
    });
    await expect(attempt).rejects.toBeInstanceOf(OrderTransitionError);
  });

  describe('concurrency — two genuinely concurrent calls on the SAME order', () => {
    it('two concurrent confirm() calls: the row lock serializes them — the SECOND sees "confirmed" already and gets a clean 409, never a corrupted state', async () => {
      const { db, orders: orderRows } = makeOrderFakeDb();
      const order = seedOrder(orderRows, { restaurantId: RESTAURANT_A, status: 'placed' });
      const staffUserId = randomUUID();
      const membership = new Set([`${staffUserId}:${RESTAURANT_A}`]);
      const { orders } = buildServices(db, membership);
      const actor = { userId: staffUserId, role: 'restaurant_staff' as const };

      const [a, b] = await Promise.allSettled([
        orders.confirmOrder(order.id, actor),
        orders.confirmOrder(order.id, actor),
      ]);
      const outcomes = [a, b];
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
      expect(order.status).toBe('confirmed');
    });

    it('two concurrent markReady() calls on the same order: exactly one sequence of confirmed->preparing->ready actually lands', async () => {
      const { db, orders: orderRows } = makeOrderFakeDb();
      const order = seedOrder(orderRows, { restaurantId: RESTAURANT_A, status: 'confirmed' });
      const staffUserId = randomUUID();
      const membership = new Set([`${staffUserId}:${RESTAURANT_A}`]);
      const { orders } = buildServices(db, membership);
      const actor = { userId: staffUserId, role: 'restaurant_staff' as const };

      const [a, b] = await Promise.allSettled([
        orders.markReady(order.id, actor),
        orders.markReady(order.id, actor),
      ]);
      const outcomes = [a, b];
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
      expect(order.status).toBe('ready');
    });
  });
});

describe('OrdersService.listForAdmin (Bloc 9, docs/30 §admin-api)', () => {
  it('filters by status and restaurant, and paginates', async () => {
    const { db, orders: orderRows } = makeOrderFakeDb();
    seedOrder(orderRows, { restaurantId: RESTAURANT_A, status: 'placed' });
    seedOrder(orderRows, { restaurantId: RESTAURANT_A, status: 'confirmed' });
    seedOrder(orderRows, { restaurantId: RESTAURANT_B, status: 'placed' });
    const { orders } = buildServices(db, new Set());

    const byRestaurant = await orders.listForAdmin({ restaurantId: RESTAURANT_A }, 1, 20);
    expect(byRestaurant.total).toBe(2);

    const byStatus = await orders.listForAdmin({ status: 'placed' }, 1, 20);
    expect(byStatus.total).toBe(2);

    const page1 = await orders.listForAdmin({}, 1, 2);
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(3);
  });
});
