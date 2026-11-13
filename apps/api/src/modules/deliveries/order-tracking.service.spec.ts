import { describe, expect, it, vi } from 'vitest';
import type { OrderAmountPort } from '@djafat/types';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { CouriersService } from '../couriers/couriers.service';
import { OrderTrackingService } from './order-tracking.service';

// Live map for the customer (asked by the user: "a guy on a motorbike moving,
// like Deliveroo"). The courier's position is shown ONLY to the order's owner
// and ONLY while the courier is actually on this delivery.

function build(opts: {
  owner?: string;
  deliveryStatus?: string | null;
  courierId?: string | null;
}) {
  const orderAmount = {
    getOwnerUserId: vi.fn(async () => opts.owner ?? 'cust-1'),
    getDeliveryContext: vi.fn(async () => ({
      restaurantName: 'Chez Fatimé',
      pickup: { lat: 12.1348, lng: 15.0557 },
      dropoff: { lat: 12.12, lng: 15.04 },
      dropoffLabel: 'Domicile',
    })),
  } as unknown as OrderAmountPort;
  const prisma = {
    delivery: {
      findFirst: vi.fn(async () =>
        opts.deliveryStatus === null
          ? null
          : { status: opts.deliveryStatus ?? 'on_the_way', courierId: opts.courierId ?? 'cour-1' },
      ),
    },
  } as unknown as PrismaService;
  const couriers = {
    getPosition: vi.fn(async () => ({
      lat: 12.13,
      lng: 15.05,
      heading: 90,
      at: '2026-11-08T07:00:00.000Z',
    })),
  } as unknown as CouriersService;
  return { service: new OrderTrackingService(prisma, couriers, orderAmount), couriers };
}

describe('OrderTrackingService.getForCustomer', () => {
  it('owner, courier on the way: restaurant, home and the courier position', async () => {
    const { service } = build({});
    await expect(service.getForCustomer('cust-1', 'ord-1')).resolves.toEqual({
      restaurant: { name: 'Chez Fatimé', lat: 12.1348, lng: 15.0557 },
      dropoff: { label: 'Domicile', lat: 12.12, lng: 15.04 },
      courier: { lat: 12.13, lng: 15.05, heading: 90, at: '2026-11-08T07:00:00.000Z' },
      deliveryStatus: 'on_the_way',
    });
  });

  it('another customer gets 404, and no position is ever read', async () => {
    const { service, couriers } = build({ owner: 'cust-1' });
    await expect(service.getForCustomer('cust-2', 'ord-1')).rejects.toMatchObject({ status: 404 });
    expect(couriers.getPosition).not.toHaveBeenCalled();
  });

  it('before a courier is on it (searching) or after delivery: no courier position', async () => {
    for (const status of ['searching_courier', 'delivered', 'cancelled']) {
      const { service, couriers } = build({ deliveryStatus: status });
      const t = await service.getForCustomer('cust-1', 'ord-1');
      expect(t.courier, status).toBeNull();
      expect(couriers.getPosition).not.toHaveBeenCalled();
    }
    const none = build({ deliveryStatus: null });
    expect((await none.service.getForCustomer('cust-1', 'ord-1')).courier).toBeNull();
  });
});
