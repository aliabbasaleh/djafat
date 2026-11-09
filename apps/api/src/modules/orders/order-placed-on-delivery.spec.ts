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

// FEAT-009 — docs/features/FEAT-009-mobile-money-transfer-matching (SPEC-009-01).

function build(prisma: Record<string, unknown>) {
  return new OrdersService(
    prisma as unknown as PrismaService,
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
}

function placementDb(affected: number) {
  // `UPDATE … RETURNING restaurant_id`: one row when the order was placed, none otherwise.
  const executeRaw = vi.fn().mockResolvedValue(affected === 1 ? [{ restaurant_id: 'r1' }] : []);
  const historyCreate = vi.fn().mockResolvedValue({});
  const outboxCreate = vi.fn().mockResolvedValue({});
  return {
    prisma: {
      $queryRaw: executeRaw,
      orderStatusHistory: { create: historyCreate },
      outbox: { create: outboxCreate },
    },
    executeRaw,
    historyCreate,
    outboxCreate,
  };
}

describe('SPEC-009-01 — orders react to a payment collected on delivery', () => {
  // SPEC-009-01-SC02
  it('SPEC-009-01-SC02 — awaiting_payment → placed once, with the on-delivery reason and order.placed; no-op otherwise', async () => {
    const ok = placementDb(1);
    await build(ok.prisma).markPlacedForDelivery({ orderId: 'o-1', paymentId: 'p-1' });
    const sql = (ok.executeRaw.mock.calls[0]?.[0] as TemplateStringsArray).join('?');
    expect(sql).toContain("status = 'placed'::order_status");
    expect(sql).toContain("status = 'awaiting_payment'::order_status");
    expect(ok.historyCreate).toHaveBeenCalledWith({
      data: {
        orderId: 'o-1',
        fromStatus: 'awaiting_payment',
        toStatus: 'placed',
        reason: 'payment.on_delivery:p-1',
      },
    });
    expect(ok.outboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: 'order.placed', aggregateId: 'o-1' }),
    });
    // the kitchen board is reached through `restaurant:orders:{restaurantId}`
    expect(ok.outboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ payload: { orderId: 'o-1', restaurantId: 'r1' } }),
    });

    const already = placementDb(0); // already placed, or expired first
    await build(already.prisma).markPlacedForDelivery({ orderId: 'o-1', paymentId: 'p-1' });
    expect(already.historyCreate).not.toHaveBeenCalled();
    expect(already.outboxCreate).not.toHaveBeenCalled();
  });

  // SPEC-009-01-SC03
  it('SPEC-009-01-SC03 — courierFeeInPool only for an order placed by a SUCCEEDED payment', async () => {
    const row = {
      id: 'o-1',
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
      restaurant_address: null,
      restaurant_phone: null,
      dropoff_label: null,
      dropoff_quartier: null,
      dropoff_street: null,
      dropoff_landmark: null,
      dropoff_recipient_phone: null,
    };
    // The fake answers like PostgreSQL would for the given filter: only a
    // `payment.succeeded:` history row counts as "prepaid".
    const history = (reason: string) =>
      vi.fn((args: { where: { reason?: { startsWith?: string } } }) => {
        const prefix = args.where.reason?.startsWith;
        return Promise.resolve(
          prefix === undefined || reason.startsWith(prefix) ? { id: 'h' } : null,
        );
      });

    const onDelivery = build({
      $queryRaw: vi.fn().mockResolvedValue([row]),
      orderStatusHistory: { findFirst: history('payment.on_delivery:p-1') },
      order: { count: vi.fn().mockResolvedValue(0) },
    });
    expect((await onDelivery.getDeliveryContext('o-1')).courierFeeInPool).toBe(false);

    const prepaid = build({
      $queryRaw: vi.fn().mockResolvedValue([row]),
      orderStatusHistory: { findFirst: history('payment.succeeded:p-2') },
      order: { count: vi.fn().mockResolvedValue(0) },
    });
    expect((await prepaid.getDeliveryContext('o-1')).courierFeeInPool).toBe(true);
  });
});
