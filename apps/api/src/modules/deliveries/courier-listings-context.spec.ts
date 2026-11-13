import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { OrderAmountPort, OrderDeliveryContext } from '@djafat/types';
import { DeliveriesService } from './deliveries.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { LedgerService } from '../ledger/ledger.service';
import type { OutboxService } from '../../infra/outbox/outbox.service';
import type { PlatformService } from '../platform/platform.service';
import type { CouriersService } from '../couriers/couriers.service';
import type { UsersService } from '../users/users.service';
import { fakeConfigService } from './deliveries-test-support';

/**
 * Bloc 11 — `listOffersForCourier`/`listActiveForCourier` now attach a
 * human-readable `context` (restaurant + dropoff) via `OrderAmountPort.
 * getDeliveryContext` — see `OrderDeliveryContext`'s doc comment for why this
 * is the ONLY sanctioned way `deliveries` learns anything about `orders`/
 * `restaurants`. Self-contained mocks (not the shared race-DB harness) —
 * this is a thin read path, not a transactional write.
 */

function fakeContext(orderId: string): OrderDeliveryContext {
  return {
    orderId,
    orderCode: `CODE-${orderId}`,
    restaurantId: 'r1',
    customerId: 'c1',
    currency: 'XAF',
    customerIsNew: false,
    courierFee: { minor: 1000n, currency: 'XAF' },
    courierFeeInPool: true,
    pickup: { lat: 12.1, lng: 15.0 },
    dropoff: { lat: 12.2, lng: 15.1 },
    restaurantName: `Restaurant for ${orderId}`,
    restaurantAddress: 'Avenue Test',
    restaurantPhone: '+23566000001',
    dropoffLabel: 'Maison',
    dropoffAddress: 'Quartier, Rue',
    dropoffPhone: '+23566000002',
  };
}

function build(opts: {
  offers?: Array<{
    id: string;
    deliveryId: string;
    status: string;
    offeredAt: Date;
    expiresAt: Date;
  }>;
  deliveryRows?: Array<{ id: string; orderId: string }>;
  activeDeliveries?: Array<Record<string, unknown>>;
}) {
  const findManyOffers = vi.fn().mockResolvedValue(opts.offers ?? []);
  const findManyDeliveriesByIds = vi
    .fn()
    .mockResolvedValue(opts.deliveryRows ?? []) as unknown as () => Promise<
    Array<{ id: string; orderId: string }>
  >;
  const findManyActive = vi
    .fn()
    .mockResolvedValue(opts.activeDeliveries ?? []) as unknown as () => Promise<
    Array<Record<string, unknown>>
  >;

  const prisma = {
    deliveryOffer: { findMany: findManyOffers },
    delivery: {
      findMany: vi.fn((args: { where: { id?: { in: string[] }; courierId?: string } }) =>
        args.where.id ? findManyDeliveriesByIds() : findManyActive(),
      ),
    },
  } as unknown as PrismaService;

  const getDeliveryContext = vi.fn((orderId: string) => Promise.resolve(fakeContext(orderId)));
  const orderAmount = { getDeliveryContext } as unknown as OrderAmountPort;

  const service = new DeliveriesService(
    prisma,
    {} as unknown as IdempotencyService,
    {} as unknown as LedgerService,
    {} as unknown as OutboxService,
    {} as unknown as EventEmitter2,
    {} as unknown as PlatformService,
    {} as unknown as CouriersService,
    {} as unknown as UsersService,
    orderAmount,
    fakeConfigService(),
  );
  return { service, getDeliveryContext, findManyOffers, findManyDeliveriesByIds };
}

describe('listOffersForCourier — context enrichment (Bloc 11, docs/34 §offer-context)', () => {
  it('attaches the delivery context, resolved via the order id (not a direct join)', async () => {
    const { service, getDeliveryContext } = build({
      offers: [
        {
          id: 'offer-1',
          deliveryId: 'delivery-1',
          status: 'offered',
          offeredAt: new Date('2024-01-01T10:00:00Z'),
          expiresAt: new Date('2024-01-01T10:01:00Z'),
        },
      ],
      deliveryRows: [{ id: 'delivery-1', orderId: 'order-1' }],
    });

    const result = await service.listOffersForCourier('courier-1');
    expect(result).toHaveLength(1);
    expect(result[0]!.context.restaurantName).toBe('Restaurant for order-1');
    expect(result[0]!.context.dropoffAddress).toBe('Quartier, Rue');
    expect(getDeliveryContext).toHaveBeenCalledWith('order-1');
  });

  it('returns an empty array without ever calling the port when there are no offers', async () => {
    const { service, getDeliveryContext } = build({ offers: [] });
    const result = await service.listOffersForCourier('courier-1');
    expect(result).toEqual([]);
    expect(getDeliveryContext).not.toHaveBeenCalled();
  });

  it('throws NotFound rather than silently dropping an offer whose delivery vanished', async () => {
    const { service } = build({
      offers: [
        {
          id: 'offer-1',
          deliveryId: 'delivery-missing',
          status: 'offered',
          offeredAt: new Date(),
          expiresAt: new Date(),
        },
      ],
      deliveryRows: [], // the delivery row was not found by the batch lookup
    });
    await expect(service.listOffersForCourier('courier-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('listActiveForCourier — context enrichment (Bloc 11, docs/34 §offer-context)', () => {
  it('attaches the delivery context to every active delivery row', async () => {
    const now = new Date();
    const { service, getDeliveryContext } = build({
      activeDeliveries: [
        {
          id: 'd1',
          orderId: 'order-9',
          courierId: 'courier-1',
          status: 'on_the_way',
          currency: 'XAF',
          courierFeeMinor: 1000n,
          estimatedDistanceM: null,
          dispatchAttempts: 1,
          assignedAt: now,
          acceptedAt: now,
          pickedUpAt: now,
          onTheWayAt: now,
          deliveredAt: null,
          cancelledAt: null,
          cancelledReason: null,
          failedAt: null,
          failedReason: null,
        },
      ],
    });

    const result = await service.listActiveForCourier('courier-1');
    expect(result).toHaveLength(1);
    expect(result[0]!.context!.restaurantName).toBe('Restaurant for order-9');
    expect(getDeliveryContext).toHaveBeenCalledWith('order-9');
  });

  it('an empty active list resolves to an empty array', async () => {
    const { service } = build({ activeDeliveries: [] });
    await expect(service.listActiveForCourier('courier-1')).resolves.toEqual([]);
  });
});

describe('the embedded context is JSON-serialisable (pilot fix, docs/36)', () => {
  // The pilot's crash: `GET /couriers/me/offers` and `/couriers/me/deliveries`
  // embedded the port's raw `OrderDeliveryContext`, whose `courierFee.minor`
  // is a bigint. Fastify's serialiser throws "Do not know how to serialize a
  // BigInt" — a 500 on the two endpoints the courier app calls on every
  // screen, and the whole courier journey was blocked by it.
  const hasBigInt = (value: unknown): boolean => {
    if (typeof value === 'bigint') return true;
    if (Array.isArray(value)) return value.some(hasBigInt);
    if (value && typeof value === 'object') return Object.values(value).some(hasBigInt);
    return false;
  };

  it('an offer survives JSON.stringify — no bigint anywhere in the payload', async () => {
    const { service } = build({
      offers: [
        {
          id: 'offer-1',
          deliveryId: 'delivery-1',
          status: 'offered',
          offeredAt: new Date('2024-01-01T10:00:00Z'),
          expiresAt: new Date('2024-01-01T10:01:00Z'),
        },
      ],
      deliveryRows: [{ id: 'delivery-1', orderId: 'order-1' }],
    });

    const [offer] = await service.listOffersForCourier('courier-1');

    expect(hasBigInt(offer)).toBe(false);
    expect(() => JSON.stringify(offer)).not.toThrow();
    // Money crosses the wire as the platform's MoneyJson, minor as a string.
    expect(offer!.context.courierFee).toEqual({ minor: '1000', currency: 'XAF' });
  });

  it('an active delivery survives JSON.stringify too', async () => {
    const now = new Date();
    const { service } = build({
      activeDeliveries: [
        {
          id: 'd1',
          orderId: 'order-9',
          courierId: 'courier-1',
          status: 'on_the_way',
          currency: 'XAF',
          courierFeeMinor: 1000n,
          estimatedDistanceM: null,
          dispatchAttempts: 1,
          assignedAt: now,
          acceptedAt: now,
          pickedUpAt: now,
          onTheWayAt: now,
          deliveredAt: null,
          cancelledAt: null,
          cancelledReason: null,
          failedAt: null,
          failedReason: null,
        },
      ],
    });

    const [delivery] = await service.listActiveForCourier('courier-1');

    expect(hasBigInt(delivery)).toBe(false);
    expect(() => JSON.stringify(delivery)).not.toThrow();
    expect(delivery!.context!.courierFee).toEqual({ minor: '1000', currency: 'XAF' });
    expect(delivery!.courierFee).toEqual({ minor: '1000', currency: 'XAF' });
  });
});
