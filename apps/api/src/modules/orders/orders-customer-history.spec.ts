import { describe, expect, it, vi } from 'vitest';
import type { ModuleRef } from '@nestjs/core';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { OrdersService } from './orders.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { OutboxService } from '../../infra/outbox/outbox.service';
import type { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { CatalogService } from '../catalog/catalog.service';
import type { PricingService } from '../pricing/pricing.service';
import type { PlatformService } from '../platform/platform.service';
import type { CartsService } from '../carts/carts.service';
import type { AddressesService } from '../addresses/addresses.service';
import type { UsersService } from '../users/users.service';

/**
 * The pilot's P0 n°2 (docs/36): there was NO way for a customer to list their
 * own orders — `GET /orders` is the kitchen board (restaurant-only) and
 * nothing else existed, so "historique" was unreachable on every frontend.
 *
 * Mirrors `orders-restaurant-board.spec.ts`'s build pattern. The facts under
 * test, in priority order (security → data → journey):
 *   1. the scope is `actor.userId` and nothing else;
 *   2. another customer's orders can never appear;
 *   3. status filter and pagination narrow WITHIN that scope, never out of it.
 */

interface OrderRow {
  id: string;
  code: string;
  status: string;
  currency: string;
  totalMinor: bigint;
  createdAt: Date;
  placedAt: Date | null;
  deliveredAt: Date | null;
  restaurantId: string;
  customerId: string;
  items: Array<{
    nameSnapshot: string;
    quantity: number;
    options: Array<{ nameSnapshot: string }>;
  }>;
}

const MINE = 'customer-mine';
const STRANGER = 'customer-stranger';

function row(overrides: Partial<OrderRow> = {}): OrderRow {
  const now = new Date();
  return {
    id: 'order-1',
    code: 'ORD-1',
    status: 'delivered',
    currency: 'XAF',
    totalMinor: 8000n,
    createdAt: now,
    placedAt: now,
    deliveredAt: now,
    restaurantId: 'restaurant-a',
    customerId: MINE,
    items: [{ nameSnapshot: 'Poulet braisé', quantity: 2, options: [{ nameSnapshot: 'Entier' }] }],
    ...overrides,
  };
}

function build(rows: OrderRow[]) {
  const matching = (where: { customerId: string; status?: string }): OrderRow[] => {
    let matches = rows.filter((r) => r.customerId === where.customerId);
    if (where.status !== undefined) matches = matches.filter((r) => r.status === where.status);
    return matches;
  };

  const findMany = vi.fn(
    (args: {
      where: { customerId: string; status?: string };
      skip: number;
      take: number;
      orderBy: { createdAt: 'asc' | 'desc' };
    }) => {
      const matches = [...matching(args.where)].sort((a, b) =>
        args.orderBy.createdAt === 'asc'
          ? a.createdAt.getTime() - b.createdAt.getTime()
          : b.createdAt.getTime() - a.createdAt.getTime(),
      );
      return Promise.resolve(matches.slice(args.skip, args.skip + args.take));
    },
  );
  const count = vi.fn((args: { where: { customerId: string; status?: string } }) =>
    Promise.resolve(matching(args.where).length),
  );
  const prisma = { order: { findMany, count } } as unknown as PrismaService;

  const orders = new OrdersService(
    prisma,
    {} as unknown as CatalogService,
    {} as unknown as PricingService,
    {} as unknown as PlatformService,
    {} as unknown as CartsService,
    {} as unknown as AddressesService,
    {} as unknown as UsersService,
    { enqueue: vi.fn() } as unknown as OutboxService,
    {} as unknown as IdempotencyService,
    { emit: vi.fn() } as unknown as EventEmitter2,
    {} as unknown as ModuleRef,
  );
  return { orders, findMany, count };
}

describe('OrdersService.listOrdersForCustomer — isolation (pilot P0 n°2, docs/36)', () => {
  it('scopes the query to the caller’s own userId, with no other filter able to widen it', async () => {
    const { orders, findMany } = build([row()]);
    await orders.listOrdersForCustomer(MINE, {}, 1, 20);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: MINE } }));
  });

  it('never returns another customer’s order, even when it is the only one in the table', async () => {
    const { orders } = build([row({ id: 'theirs', customerId: STRANGER })]);
    const page = await orders.listOrdersForCustomer(MINE, {}, 1, 20);
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('returns only the caller’s rows when the table holds both', async () => {
    const { orders } = build([
      row({ id: 'mine-1', customerId: MINE }),
      row({ id: 'theirs-1', customerId: STRANGER }),
      row({ id: 'mine-2', customerId: MINE }),
    ]);
    const page = await orders.listOrdersForCustomer(MINE, {}, 1, 20);
    expect(page.items.map((o) => o.id).sort()).toEqual(['mine-1', 'mine-2']);
    expect(page.total).toBe(2);
  });

  it('counts within the caller’s scope too — a total must not leak how busy the platform is', async () => {
    const { orders, count } = build([
      row({ id: 'mine-1', customerId: MINE }),
      row({ id: 'theirs-1', customerId: STRANGER }),
      row({ id: 'theirs-2', customerId: STRANGER }),
    ]);
    const page = await orders.listOrdersForCustomer(MINE, {}, 1, 20);
    expect(page.total).toBe(1);
    expect(count).toHaveBeenCalledWith({ where: { customerId: MINE } });
  });

  it('a status filter narrows WITHIN the caller’s scope, never across customers', async () => {
    const { orders } = build([
      row({ id: 'mine-delivered', customerId: MINE, status: 'delivered' }),
      row({ id: 'mine-placed', customerId: MINE, status: 'placed' }),
      row({ id: 'theirs-placed', customerId: STRANGER, status: 'placed' }),
    ]);
    const page = await orders.listOrdersForCustomer(MINE, { status: 'placed' }, 1, 20);
    expect(page.items.map((o) => o.id)).toEqual(['mine-placed']);
  });
});

describe('OrdersService.listOrdersForCustomer — shape and ordering', () => {
  it('returns newest first — a history, not a queue', async () => {
    const older = new Date(Date.now() - 60_000);
    const newer = new Date();
    const { orders } = build([
      row({ id: 'older', createdAt: older }),
      row({ id: 'newer', createdAt: newer }),
    ]);
    const page = await orders.listOrdersForCustomer(MINE, {}, 1, 20);
    expect(page.items.map((o) => o.id)).toEqual(['newer', 'older']);
  });

  it('paginates with the requested page/limit', async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ id: `o-${i}`, createdAt: new Date(Date.now() - i * 1_000) }),
    );
    const { orders } = build(rows);
    const page2 = await orders.listOrdersForCustomer(MINE, {}, 2, 2);
    expect(page2.items.map((o) => o.id)).toEqual(['o-2', 'o-3']);
    expect(page2.page).toBe(2);
    expect(page2.limit).toBe(2);
    expect(page2.total).toBe(5);
  });

  it('serialises money as MoneyJson and carries the fields a history screen needs', async () => {
    const { orders } = build([row()]);
    const [item] = (await orders.listOrdersForCustomer(MINE, {}, 1, 20)).items;
    expect(item!.total).toEqual({ minor: '8000', currency: 'XAF' });
    expect(item!.code).toBe('ORD-1');
    expect(item!.status).toBe('delivered');
    expect(item!.restaurantId).toBe('restaurant-a');
    expect(item!.items).toEqual([{ name: 'Poulet braisé', quantity: 2, options: ['Entier'] }]);
    expect(item!.deliveredAt).not.toBeNull();
  });
});
