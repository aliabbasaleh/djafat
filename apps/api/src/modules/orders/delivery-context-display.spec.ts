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
 * Bloc 11 — `getDeliveryContext`'s human-readable fields (docs/34
 * §offer-context): the courier app needs more than coordinates to show
 * "where to go" — restaurant name/address/phone, and the dropoff's
 * label/composed address/recipient phone. Added to the SAME port method
 * `deliveries` already consumed for dispatch (`OrderAmountPort`), not a new
 * one — see the port's own doc comment for why this must never become a
 * `deliveries`→`orders`/`catalog` table join.
 */

function build(row: Record<string, unknown> | null, hasPrepaidHistory: boolean) {
  const queryRaw = vi.fn().mockResolvedValue(row ? [row] : []);
  const findFirst = vi.fn().mockResolvedValue(hasPrepaidHistory ? { id: 'hist-1' } : null);
  const prisma = {
    $queryRaw: queryRaw,
    orderStatusHistory: { findFirst },
  } as unknown as PrismaService;

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
  return orders;
}

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    code: 'ORD-1',
    restaurant_id: 'r1',
    customer_id: 'c1',
    currency: 'XAF',
    courier_fee_minor: 1000n,
    pickup_lat: 12.1,
    pickup_lng: 15.0,
    dropoff_lat: 12.2,
    dropoff_lng: 15.1,
    restaurant_name: 'Chez Fatimé',
    restaurant_address: 'Avenue Charles de Gaulle',
    restaurant_phone: '+23566000001',
    dropoff_label: 'Maison',
    dropoff_quartier: 'Klemat',
    dropoff_street: 'Rue 123',
    dropoff_landmark: 'Près de la pharmacie',
    dropoff_recipient_phone: '+23566000002',
    ...overrides,
  };
}

describe('OrdersService.getDeliveryContext — human-readable fields (Bloc 11)', () => {
  it('surfaces restaurant name/address/phone and composes the dropoff address', async () => {
    const orders = build(baseRow(), false);
    const ctx = await orders.getDeliveryContext('order-1');
    expect(ctx.restaurantName).toBe('Chez Fatimé');
    expect(ctx.restaurantAddress).toBe('Avenue Charles de Gaulle');
    expect(ctx.restaurantPhone).toBe('+23566000001');
    expect(ctx.dropoffLabel).toBe('Maison');
    expect(ctx.dropoffAddress).toBe('Klemat, Rue 123, Près de la pharmacie');
    expect(ctx.dropoffPhone).toBe('+23566000002');
  });

  it('composes a partial address from whichever parts are present', async () => {
    const orders = build(
      baseRow({ dropoff_quartier: null, dropoff_street: 'Rue 123', dropoff_landmark: null }),
      false,
    );
    const ctx = await orders.getDeliveryContext('order-1');
    expect(ctx.dropoffAddress).toBe('Rue 123');
  });

  it('returns null, never an empty string, when every address part is absent', async () => {
    const orders = build(
      baseRow({ dropoff_quartier: null, dropoff_street: null, dropoff_landmark: null }),
      false,
    );
    const ctx = await orders.getDeliveryContext('order-1');
    expect(ctx.dropoffAddress).toBeNull();
  });

  it('a restaurant with no address_text/phone on file surfaces null, not a crash', async () => {
    const orders = build(baseRow({ restaurant_address: null, restaurant_phone: null }), false);
    const ctx = await orders.getDeliveryContext('order-1');
    expect(ctx.restaurantAddress).toBeNull();
    expect(ctx.restaurantPhone).toBeNull();
    expect(ctx.restaurantName).toBe('Chez Fatimé'); // name is NOT nullable — every restaurant has one
  });
});
