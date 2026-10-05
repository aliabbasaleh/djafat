import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { AuthenticatedActor, Permission, Role } from '@djafat/types';
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
 * BUG-10.1-AUTH — `GET /orders/:id` tenant isolation at the SERVICE level:
 * proves `getOrderFor` gathers the right facts (membership asked about THIS
 * order's restaurant, courier assignment asked about THIS order) and refuses
 * everyone else. The decision table itself is proven in
 * `common/authz/order-access.spec.ts`; the HTTP round trip needs Docker and is
 * therefore WRITTEN_NOT_EXECUTED.
 */

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORDER_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = 'customer-owner';
const RESTAURANT_A = 'restaurant-a';
const COURIER_ASSIGNED = 'courier-assigned';

function orderRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: ORDER_ID,
    code: 'ORD-1',
    status: 'placed',
    currency: 'XAF',
    countryId: 'c1',
    cityId: 'city1',
    customerId: CUSTOMER,
    restaurantId: RESTAURANT_A,
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
    items: [],
    ...overrides,
  };
}

function build(opts: {
  members?: ReadonlySet<string>;
  assignedCourier?: string | null;
  row?: Record<string, unknown> | null;
}) {
  const row = opts.row === undefined ? orderRow() : opts.row;
  const findUnique = vi.fn().mockResolvedValue(row);
  const prisma = { order: { findUnique } } as unknown as PrismaService;

  const members = opts.members ?? new Set<string>();
  const isMemberOfRestaurant = vi.fn((userId: string, restaurantId: string) =>
    Promise.resolve(members.has(`${userId}:${restaurantId}`)),
  );
  const users = { isMemberOfRestaurant } as unknown as UsersService;

  const getAssignedCourierUserIdByOrder = vi.fn().mockResolvedValue(opts.assignedCourier ?? null);
  const moduleRef = {
    get: vi.fn(() => ({ getAssignedCourierUserIdByOrder })),
  } as unknown as ModuleRef;

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
    moduleRef,
  );
  return { orders, isMemberOfRestaurant, getAssignedCourierUserIdByOrder, moduleRef, findUnique };
}

function actor(
  userId: string,
  roles: readonly Role[],
  permissions: readonly Permission[] = [],
): AuthenticatedActor {
  return { userId, sessionId: 's1', roles, permissions, stepUpVerifiedAt: null };
}

describe('OrdersService.getOrderFor — tenant isolation (BUG-10.1-AUTH)', () => {
  it('A. the owning customer reads their own order', async () => {
    const { orders } = build({});
    await expect(
      orders.getOrderFor(actor(CUSTOMER, ['customer']), ORDER_ID),
    ).resolves.toMatchObject({ id: ORDER_ID });
  });

  it('B. a different customer gets 404, never 403 — "not yours" must be indistinguishable from "absent"', async () => {
    const { orders } = build({});
    await expect(
      orders.getOrderFor(actor('someone-else', ['customer']), ORDER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('C. a member of THIS order’s restaurant reads it, and membership is asked about the ORDER’s restaurant', async () => {
    const { orders, isMemberOfRestaurant } = build({
      members: new Set([`staff-a:${RESTAURANT_A}`]),
    });
    await expect(
      orders.getOrderFor(actor('staff-a', ['restaurant_staff'], ['orders:read']), ORDER_ID),
    ).resolves.toMatchObject({ id: ORDER_ID });
    expect(isMemberOfRestaurant).toHaveBeenCalledWith('staff-a', RESTAURANT_A);
  });

  it('D/E/F. a restaurant actor who is not a member of this order’s restaurant is refused, despite holding orders:read', async () => {
    const { orders } = build({ members: new Set([`staff-b:restaurant-b`]) });
    for (const role of ['restaurant_owner', 'restaurant_staff'] as const) {
      await expect(
        orders.getOrderFor(actor('staff-b', [role], ['orders:read']), ORDER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('G. the courier assigned to THIS order’s delivery reads it', async () => {
    const { orders, getAssignedCourierUserIdByOrder } = build({
      assignedCourier: COURIER_ASSIGNED,
    });
    await expect(
      orders.getOrderFor(actor(COURIER_ASSIGNED, ['courier'], ['orders:read']), ORDER_ID),
    ).resolves.toMatchObject({ id: ORDER_ID });
    expect(getAssignedCourierUserIdByOrder).toHaveBeenCalledWith(ORDER_ID);
  });

  it('H. a courier assigned to a DIFFERENT delivery is refused', async () => {
    const { orders } = build({ assignedCourier: COURIER_ASSIGNED });
    await expect(
      orders.getOrderFor(actor('courier-other', ['courier'], ['orders:read']), ORDER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('H2. a courier is refused when the order has no delivery assigned yet', async () => {
    const { orders } = build({ assignedCourier: null });
    await expect(
      orders.getOrderFor(actor('courier-any', ['courier'], ['orders:read']), ORDER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each(['admin', 'super_admin', 'support', 'finance'] as const)(
    'I. %s with orders:read keeps access, with no membership or courier lookup at all',
    async (role) => {
      const { orders, isMemberOfRestaurant, getAssignedCourierUserIdByOrder } = build({});
      await expect(
        orders.getOrderFor(actor('staff', [role], ['orders:read']), ORDER_ID),
      ).resolves.toMatchObject({ id: ORDER_ID });
      expect(isMemberOfRestaurant).not.toHaveBeenCalled();
      expect(getAssignedCourierUserIdByOrder).not.toHaveBeenCalled();
    },
  );

  it('R. an unknown id is refused identically — the UUID carries no authority', async () => {
    const { orders } = build({ row: null });
    await expect(
      orders.getOrderFor(actor(CUSTOMER, ['customer']), OTHER_ORDER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('S. holding orders:read while being unrelated grants nothing — the exact bypass that existed', async () => {
    const { orders } = build({ assignedCourier: COURIER_ASSIGNED });
    const unrelated = actor('unrelated', ['restaurant_staff', 'courier'], ['orders:read']);
    await expect(orders.getOrderFor(unrelated, ORDER_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the delivery port is never resolved for a non-courier actor — no needless cross-module call', async () => {
    const { orders, moduleRef } = build({ members: new Set() });
    await expect(
      orders.getOrderFor(actor('nobody', ['customer']), ORDER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(moduleRef.get).not.toHaveBeenCalled();
  });
});
