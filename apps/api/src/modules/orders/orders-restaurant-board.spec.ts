import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
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
 * Bloc 10 — `GET /orders` (the kitchen's order board):
 * `OrdersService.listOrdersForRestaurant`.
 *
 * Mirrors `order-tenant-isolation.spec.ts`'s build pattern. The one new fact
 * under test: restaurant identity is resolved EXCLUSIVELY from
 * `UsersService.getRestaurantScope(actorUserId)` — there is no
 * `restaurantId` parameter a caller could forge, unlike `listForAdmin`.
 */

interface OrderRow {
  id: string;
  code: string;
  status: string;
  currency: string;
  totalMinor: bigint;
  createdAt: Date;
  placedAt: Date | null;
  restaurantId: string;
  items: Array<{
    nameSnapshot: string;
    quantity: number;
    options: Array<{ nameSnapshot: string }>;
  }>;
}

function row(overrides: Partial<OrderRow> = {}): OrderRow {
  const now = new Date();
  return {
    id: 'order-1',
    code: 'ORD-1',
    status: 'placed',
    currency: 'XAF',
    totalMinor: 3800n,
    createdAt: now,
    placedAt: now,
    restaurantId: 'restaurant-a',
    items: [{ nameSnapshot: 'Burger', quantity: 2, options: [{ nameSnapshot: 'No onions' }] }],
    ...overrides,
  };
}

function build(opts: { scope?: string | null; rows?: OrderRow[] }) {
  const rows = opts.rows ?? [row()];
  const findMany = vi.fn(
    (args: {
      where: { restaurantId: string; status?: string | { in: readonly string[] } };
      skip: number;
      take: number;
      orderBy: { createdAt: 'asc' | 'desc' };
    }) => {
      let matches = rows.filter((r) => r.restaurantId === args.where.restaurantId);
      const status = args.where.status;
      if (status !== undefined) {
        matches =
          typeof status === 'string'
            ? matches.filter((r) => r.status === status)
            : matches.filter((r) => status.in.includes(r.status));
      }
      matches = [...matches].sort((a, b) =>
        args.orderBy.createdAt === 'asc'
          ? a.createdAt.getTime() - b.createdAt.getTime()
          : b.createdAt.getTime() - a.createdAt.getTime(),
      );
      return Promise.resolve(matches.slice(args.skip, args.skip + args.take));
    },
  );
  const count = vi.fn(
    (args: { where: { restaurantId: string; status?: string | { in: readonly string[] } } }) => {
      let matches = rows.filter((r) => r.restaurantId === args.where.restaurantId);
      const status = args.where.status;
      if (status !== undefined) {
        matches =
          typeof status === 'string'
            ? matches.filter((r) => r.status === status)
            : matches.filter((r) => status.in.includes(r.status));
      }
      return Promise.resolve(matches.length);
    },
  );
  const prisma = { order: { findMany, count } } as unknown as PrismaService;

  const getRestaurantScope = vi
    .fn()
    .mockResolvedValue(opts.scope === undefined ? null : opts.scope);
  const users = { getRestaurantScope } as unknown as UsersService;

  const orders = new OrdersService(
    prisma,
    {} as unknown as CatalogService,
    {} as unknown as PricingService,
    {} as unknown as PlatformService,
    {} as unknown as CartsService,
    {} as unknown as AddressesService,
    users,
    { enqueue: vi.fn() } as unknown as OutboxService,
    {} as unknown as IdempotencyService,
    { emit: vi.fn() } as unknown as EventEmitter2,
    {} as unknown as ModuleRef,
  );
  return { orders, getRestaurantScope, findMany, count };
}

describe('OrdersService.listOrdersForRestaurant (Bloc 10, docs/33 §order-board)', () => {
  it('resolves the restaurant from the caller’s OWN scope — never a client-supplied id', async () => {
    const { orders, getRestaurantScope, findMany } = build({ scope: 'restaurant-a' });
    await orders.listOrdersForRestaurant('owner-1', {}, 1, 50);
    expect(getRestaurantScope).toHaveBeenCalledWith('owner-1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ restaurantId: 'restaurant-a' }) }),
    );
  });

  it('an actor with no restaurant scope is refused — not silently given an empty board', async () => {
    const { orders } = build({ scope: null });
    await expect(orders.listOrdersForRestaurant('nobody', {}, 1, 50)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('with no status filter: returns only the ACTIVE board statuses, oldest first (FIFO)', async () => {
    const rows = [
      row({ id: 'o-draft', status: 'draft', createdAt: new Date('2024-01-01T10:00:00Z') }),
      row({ id: 'o-placed-older', status: 'placed', createdAt: new Date('2024-01-01T09:00:00Z') }),
      row({ id: 'o-ready', status: 'ready', createdAt: new Date('2024-01-01T11:00:00Z') }),
      row({ id: 'o-delivered', status: 'delivered', createdAt: new Date('2024-01-01T12:00:00Z') }),
      row({ id: 'o-cancelled', status: 'cancelled', createdAt: new Date('2024-01-01T13:00:00Z') }),
    ];
    const { orders } = build({ scope: 'restaurant-a', rows });
    const result = await orders.listOrdersForRestaurant('owner-1', {}, 1, 50);
    expect(result.items.map((i) => i.id)).toEqual(['o-placed-older', 'o-ready']);
  });

  it('a different restaurant’s orders never leak onto the board', async () => {
    const rows = [
      row({ id: 'mine', restaurantId: 'restaurant-a' }),
      row({ id: 'theirs', restaurantId: 'restaurant-b' }),
    ];
    const { orders } = build({ scope: 'restaurant-a', rows });
    const result = await orders.listOrdersForRestaurant('owner-1', {}, 1, 50);
    expect(result.items.map((i) => i.id)).toEqual(['mine']);
  });

  it('with an explicit status filter: history mode — that one status, newest first', async () => {
    const rows = [
      row({ id: 'o-1', status: 'delivered', createdAt: new Date('2024-01-01T09:00:00Z') }),
      row({ id: 'o-2', status: 'delivered', createdAt: new Date('2024-01-02T09:00:00Z') }),
      row({ id: 'o-3', status: 'ready', createdAt: new Date('2024-01-03T09:00:00Z') }),
    ];
    const { orders } = build({ scope: 'restaurant-a', rows });
    const result = await orders.listOrdersForRestaurant('owner-1', { status: 'delivered' }, 1, 50);
    expect(result.items.map((i) => i.id)).toEqual(['o-2', 'o-1']);
  });

  it('paginates (skip/take derived from page/limit) and reports the true total', async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ id: `o-${i}`, status: 'placed', createdAt: new Date(2024, 0, i + 1) }),
    );
    const { orders } = build({ scope: 'restaurant-a', rows });
    const result = await orders.listOrdersForRestaurant('owner-1', {}, 2, 2);
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.page).toBe(2);
  });

  it('maps item lines (name/quantity/option names) for the kitchen to read without a second call', async () => {
    const { orders } = build({ scope: 'restaurant-a' });
    const result = await orders.listOrdersForRestaurant('owner-1', {}, 1, 50);
    expect(result.items[0]!.items).toEqual([
      { name: 'Burger', quantity: 2, options: ['No onions'] },
    ]);
  });
});
