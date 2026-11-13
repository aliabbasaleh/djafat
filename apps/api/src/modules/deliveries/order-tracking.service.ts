import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { OrderAmountPort } from '@djafat/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ORDER_AMOUNT_PORT } from '../../common/ports/order-amount.port';
import { CouriersService } from '../couriers/couriers.service';

/** Delivery statuses during which the courier is actually on THIS order. */
const COURIER_VISIBLE = new Set([
  'courier_assigned',
  'courier_accepted',
  'pickup_in_progress',
  'picked_up',
  'on_the_way',
]);

export interface OrderTrackingDto {
  readonly restaurant: { name: string; lat: number; lng: number } | null;
  readonly dropoff: { label: string | null; lat: number; lng: number } | null;
  readonly courier: { lat: number; lng: number; heading: number | null; at: string | null } | null;
  readonly deliveryStatus: string | null;
}

/**
 * Live map of an order for its customer: the restaurant, the delivery address
 * and — only while a courier is on this delivery — the courier's last known
 * position. Owner only (same 404 as an unknown order for anyone else).
 * The position is polled by the page; a pushed realtime stream can replace
 * the polling later without changing this contract.
 */
@Injectable()
export class OrderTrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly couriers: CouriersService,
    @Inject(ORDER_AMOUNT_PORT) private readonly orderAmount: OrderAmountPort,
  ) {}

  async getForCustomer(actorUserId: string, orderId: string): Promise<OrderTrackingDto> {
    const owner = await this.orderAmount.getOwnerUserId(orderId);
    if (owner !== actorUserId) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Order ${orderId} not found.` });
    }
    const context = await this.orderAmount.getDeliveryContext(orderId);
    const delivery = await this.prisma.delivery.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      select: { status: true, courierId: true },
    });
    const courier =
      delivery?.courierId && COURIER_VISIBLE.has(delivery.status)
        ? await this.couriers.getPosition(delivery.courierId)
        : null;
    return {
      restaurant: context.pickup
        ? { name: context.restaurantName ?? '', lat: context.pickup.lat, lng: context.pickup.lng }
        : null,
      dropoff: context.dropoff
        ? {
            label: context.dropoffLabel ?? null,
            lat: context.dropoff.lat,
            lng: context.dropoff.lng,
          }
        : null,
      courier,
      deliveryStatus: delivery?.status ?? null,
    };
  }
}
