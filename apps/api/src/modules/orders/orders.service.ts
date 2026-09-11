import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type {
  DomainEventType,
  Money,
  MoneyJson,
  OrderAccrualBreakdown,
  OrderAmountPort,
  OrderPaymentContext,
  Role,
} from '@djafat/types';
import { addMoney, assertOrderTransition, money, sumMoney } from '@djafat/core';
import { CatalogService } from '../catalog/catalog.service';
import { PricingService } from '../pricing/pricing.service';
import { PlatformService } from '../platform/platform.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { toMoneyJson } from '../../common/money/money.mapper';
import { generateOrderCode } from './order-code';
import type { CreateOrderInput } from './dto/create-order.schema';

export type OrderStatusString =
  | 'draft'
  | 'awaiting_payment'
  | 'placed'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'courier_assigned'
  | 'picked_up'
  | 'on_the_way'
  | 'delivered'
  | 'cancelled'
  | 'rejected'
  | 'expired';

export interface OrderItemDto {
  productId: string | null;
  name: string;
  unitPrice: MoneyJson;
  quantity: number;
  lineTotal: MoneyJson;
}

export interface OrderDto {
  id: string;
  code: string;
  status: OrderStatusString;
  currency: string;
  countryId: string;
  cityId: string;
  customerId: string;
  restaurantId: string;
  courierId: string | null;
  subtotal: MoneyJson;
  deliveryFee: MoneyJson;
  commissionBps: number;
  commission: MoneyJson;
  courierFee: MoneyJson;
  total: MoneyJson;
  expiresAt: string | null;
  placedAt: string | null;
  deliveredAt: string | null;
  items: OrderItemDto[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Order lifecycle for the Bloc 0.5 walking skeleton, driving the REAL
 * canonical state machine (`@djafat/core`, 58 tests) end-to-end rather than a
 * simplified shortcut set — see docs/18 §3.
 *
 * `orders` NEVER imports `payments` or `deliveries` (DAG — docs/15 AD-09): it
 * reacts to their events by name (`@OnEvent`) and only ever touches its own
 * tables. See docs/18 §5 for the full event map.
 */
@Injectable()
export class OrdersService implements OrderAmountPort {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly pricing: PricingService,
    private readonly platform: PlatformService,
    private readonly outbox: OutboxService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ── creation ────────────────────────────────────────────────────────────

  async createOrder(
    input: CreateOrderInput,
    idempotencyKey: string,
  ): Promise<{ status: 'created' | 'replayed'; order: OrderDto }> {
    const run = await this.idempotency.run('orders', idempotencyKey, input, () =>
      this.doCreateOrder(input, idempotencyKey),
    );
    return { status: run.status, order: run.response };
  }

  private async doCreateOrder(input: CreateOrderInput, idempotencyKey: string): Promise<OrderDto> {
    const restaurant = await this.catalog.getActiveRestaurant(input.restaurantId);
    const products = await this.catalog.getAvailableProducts(
      restaurant.id,
      input.items.map((i) => i.productId),
    );
    const byId = new Map(products.map((p) => [p.id, p]));

    const lines = input.items.map((i) => {
      const product = byId.get(i.productId);
      if (!product) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: `Product ${i.productId} is not available at restaurant ${restaurant.id}.`,
        });
      }
      const unitPrice = money(product.priceMinor, product.currency);
      const lineTotal = money(product.priceMinor * BigInt(i.quantity), product.currency);
      return { product, quantity: i.quantity, unitPrice, lineTotal };
    });

    const subtotal = sumMoney(
      lines.map((l) => l.lineTotal),
      restaurant.currency,
    );

    // Bloc 0.5 simplification: single seeded test courier, resolved now so the
    // courier leg of `order_accrual` can post at payment.succeeded exactly like
    // the validated reference model (docs/08 §8.9, docs/18 §4). Real dispatch
    // is Bloc 6.
    const courier = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT u.id FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      WHERE ur.role = 'courier' AND u.deleted_at IS NULL
      ORDER BY u.created_at ASC LIMIT 1
    `;
    const courierId = courier[0]?.id ?? null;
    if (!courierId) {
      this.logger.warn('No seeded courier user found — order will have no courier_id.');
    }

    const price = await this.pricing.priceOrder({
      restaurantId: restaurant.id,
      countryId: restaurant.countryId,
      cityId: restaurant.cityId,
      subtotal,
    });
    const total = addMoney(price.subtotal, price.deliveryFee);

    const ttlSeconds = await this.platform.getUnpaidOrderTtlSeconds();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const code = generateOrderCode();

    const created = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          code,
          idempotencyKey,
          countryId: restaurant.countryId,
          cityId: restaurant.cityId,
          customerId: input.customerId,
          restaurantId: restaurant.id,
          courierId,
          status: 'awaiting_payment',
          currency: restaurant.currency,
          subtotalMinor: price.subtotal.minor,
          deliveryFeeMinor: price.deliveryFee.minor,
          commissionBpsSnapshot: price.commissionBps,
          commissionMinor: price.commission.minor,
          courierFeeMinor: price.courierFee.minor,
          totalMinor: total.minor,
          expiresAt,
        },
      });

      await tx.orderItem.createMany({
        data: lines.map((l) => ({
          orderId: order.id,
          productId: l.product.id,
          nameSnapshot: l.product.name,
          unitPriceMinor: l.unitPrice.minor,
          quantity: l.quantity,
          lineTotalMinor: l.lineTotal.minor,
          currency: l.lineTotal.currency,
        })),
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: null,
          toStatus: 'awaiting_payment',
          reason: 'order_created',
        },
      });

      await this.outbox.enqueue(tx, {
        aggregate: 'order',
        aggregateId: order.id,
        eventType: 'order.awaiting_payment',
        payload: { orderId: order.id, code: order.code },
      });

      return order;
    });

    return this.toDto(created, lines);
  }

  // ── OrderAmountPort (consumed by `payments` — docs/15 AD-09) ─────────────

  /** The frozen, server-authoritative total. `payments` never sees a client-supplied amount. */
  async getAuthoritativeAmount(orderId: string): Promise<Money> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { totalMinor: true, currency: true },
    });
    if (!order) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Order ${orderId} not found.` });
    }
    return money(order.totalMinor, order.currency);
  }

  async getPaymentContext(orderId: string): Promise<OrderPaymentContext> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        code: true,
        countryId: true,
        cityId: true,
        restaurantId: true,
        currency: true,
        status: true,
      },
    });
    if (!order) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Order ${orderId} not found.` });
    }
    if (order.status !== 'awaiting_payment') {
      throw new ConflictException({
        code: 'ORDER_INVALID_TRANSITION',
        message: `Order ${orderId} is not awaiting payment (status=${order.status}).`,
      });
    }
    return {
      orderId,
      orderCode: order.code,
      countryId: order.countryId,
      cityId: order.cityId,
      restaurantId: order.restaurantId,
      currency: order.currency,
    };
  }

  async getAccrualBreakdown(orderId: string): Promise<OrderAccrualBreakdown> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        restaurantId: true,
        courierId: true,
        subtotalMinor: true,
        commissionMinor: true,
        courierFeeMinor: true,
        currency: true,
      },
    });
    if (!order) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Order ${orderId} not found.` });
    }
    return {
      restaurantId: order.restaurantId,
      courierId: order.courierId,
      subtotal: money(order.subtotalMinor, order.currency),
      commission: money(order.commissionMinor, order.currency),
      courierFee: money(order.courierFeeMinor, order.currency),
    };
  }

  // ── reads ───────────────────────────────────────────────────────────────

  async getOrder(id: string): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order)
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Order ${id} not found.` });
    return this.toDto(
      order,
      order.items.map((it) => ({
        product: { id: it.productId ?? '', name: it.nameSnapshot },
        quantity: it.quantity,
        unitPrice: money(it.unitPriceMinor, it.currency),
        lineTotal: money(it.lineTotalMinor, it.currency),
      })),
    );
  }

  // ── restaurant-side transitions (Bloc 0.5: no auth yet — see docs/18 §3) ──

  async confirmOrder(id: string): Promise<OrderDto> {
    await this.transitionOrder(id, 'confirmed', { actorRole: 'restaurant_staff' });
    return this.getOrder(id);
  }

  /** `confirmed -> preparing -> ready` in one call (docs/18 §6). */
  async markReady(id: string): Promise<OrderDto> {
    await this.transitionOrder(id, 'preparing', { actorRole: 'restaurant_staff' });
    await this.transitionOrder(id, 'ready', { actorRole: 'restaurant_staff' });
    return this.getOrder(id);
  }

  // ── generic transition (single source of the state-machine logic) ────────

  /**
   * Validates via `@djafat/core` and applies the transition atomically. Never
   * called across the `payments`/`deliveries` DAG boundary directly — those
   * modules trigger it indirectly via events (`@OnEvent` handlers below).
   */
  async transitionOrder(
    orderId: string,
    to: OrderStatusString,
    opts: { actorRole?: Role; system?: boolean; reason?: string },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ status: OrderStatusString }>>`
        SELECT status FROM orders WHERE id = ${orderId}::uuid FOR UPDATE
      `;
      if (!rows[0]) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: `Order ${orderId} not found.` });
      }
      const from = rows[0].status;
      assertOrderTransition(from, to, opts); // throws OrderTransitionError -> 409

      await tx.$executeRaw`UPDATE orders SET status = ${to}::order_status WHERE id = ${orderId}::uuid`;
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: from,
          toStatus: to,
          actorRole: opts.actorRole ?? (opts.system ? 'system' : null),
          reason: opts.reason ?? null,
        },
      });
      await this.outbox.enqueue(tx, {
        aggregate: 'order',
        aggregateId: orderId,
        eventType: this.eventNameFor(to),
        payload: { orderId, status: to },
      });
    });
  }

  /**
   * Idempotent, race-safe reaction to `payment.succeeded` (docs/18 §5, §19).
   * A bare conditional UPDATE is atomic per-row in PostgreSQL: whichever of
   * this handler or the `order-expiry` job commits first wins; the other is a
   * harmless no-op. No explicit row lock needed.
   */
  @OnEvent('payment.succeeded')
  async markPlacedFromPayment(payload: { orderId: string; paymentId: string }): Promise<void> {
    const affected = await this.prisma.$executeRaw`
      UPDATE orders SET status = 'placed'::order_status, placed_at = now()
      WHERE id = ${payload.orderId}::uuid AND status = 'awaiting_payment'::order_status
    `;
    if (affected === 0) {
      this.logger.debug(
        `markPlacedFromPayment: order ${payload.orderId} already left awaiting_payment (idempotent no-op)`,
      );
      return;
    }
    await this.prisma.orderStatusHistory.create({
      data: {
        orderId: payload.orderId,
        fromStatus: 'awaiting_payment',
        toStatus: 'placed',
        reason: `payment.succeeded:${payload.paymentId}`,
      },
    });
    await this.prisma.outbox.create({
      data: {
        aggregate: 'order',
        aggregateId: payload.orderId,
        eventType: 'order.placed',
        payload: { orderId: payload.orderId },
      },
    });
    this.logger.log(`order ${payload.orderId} placed (payment ${payload.paymentId} succeeded)`);
  }

  /** Reaction to `delivery.assigned` — the one `system` transition in the table. */
  @OnEvent('delivery.assigned')
  async onDeliveryAssigned(payload: { orderId: string; courierId: string }): Promise<void> {
    await this.transitionOrder(payload.orderId, 'courier_assigned', {
      system: true,
      reason: 'delivery.assigned',
    });
  }

  /** Reaction to `delivery.picked_up` — `courier_assigned -> picked_up -> on_the_way`. */
  @OnEvent('delivery.picked_up')
  async onDeliveryPickedUp(payload: { orderId: string }): Promise<void> {
    await this.transitionOrder(payload.orderId, 'picked_up', {
      actorRole: 'courier',
      reason: 'delivery.picked_up',
    });
    await this.transitionOrder(payload.orderId, 'on_the_way', {
      actorRole: 'courier',
      reason: 'delivery.picked_up',
    });
  }

  /** Reaction to `delivery.delivered` — the terminal transition. */
  @OnEvent('delivery.delivered')
  async onDeliveryDelivered(payload: { orderId: string }): Promise<void> {
    await this.transitionOrder(payload.orderId, 'delivered', {
      actorRole: 'courier',
      reason: 'delivery.delivered',
    });
    await this.prisma.order.update({
      where: { id: payload.orderId },
      data: { deliveredAt: new Date() },
    });
  }

  /** Maps an order status to its outbox `DomainEventType` (exhaustive — no fallback needed). */
  private eventNameFor(status: OrderStatusString): DomainEventType {
    const map: Record<OrderStatusString, DomainEventType> = {
      draft: 'order.awaiting_payment',
      awaiting_payment: 'order.awaiting_payment',
      placed: 'order.placed',
      confirmed: 'order.confirmed',
      preparing: 'order.preparing',
      ready: 'order.ready',
      courier_assigned: 'order.courier_assigned',
      picked_up: 'order.picked_up',
      on_the_way: 'order.on_the_way',
      delivered: 'order.delivered',
      cancelled: 'order.cancelled',
      rejected: 'order.cancelled',
      expired: 'order.expired',
    };
    return map[status];
  }

  private toDto(
    order: {
      id: string;
      code: string;
      status: string;
      currency: string;
      countryId: string;
      cityId: string;
      customerId: string;
      restaurantId: string;
      courierId: string | null;
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
    },
    lines: Array<{
      product: { id: string; name: string };
      quantity: number;
      unitPrice: { minor: bigint; currency: string };
      lineTotal: { minor: bigint; currency: string };
    }>,
  ): OrderDto {
    return {
      id: order.id,
      code: order.code,
      status: order.status as OrderStatusString,
      currency: order.currency,
      countryId: order.countryId,
      cityId: order.cityId,
      customerId: order.customerId,
      restaurantId: order.restaurantId,
      courierId: order.courierId,
      subtotal: toMoneyJson(order.subtotalMinor, order.currency),
      deliveryFee: toMoneyJson(order.deliveryFeeMinor, order.currency),
      commissionBps: order.commissionBpsSnapshot,
      commission: toMoneyJson(order.commissionMinor, order.currency),
      courierFee: toMoneyJson(order.courierFeeMinor, order.currency),
      total: toMoneyJson(order.totalMinor, order.currency),
      expiresAt: order.expiresAt ? order.expiresAt.toISOString() : null,
      placedAt: order.placedAt ? order.placedAt.toISOString() : null,
      deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
      items: lines.map((l) => ({
        productId: l.product.id || null,
        name: l.product.name,
        unitPrice: toMoneyJson(l.unitPrice.minor, l.unitPrice.currency),
        quantity: l.quantity,
        lineTotal: toMoneyJson(l.lineTotal.minor, l.lineTotal.currency),
      })),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }
}
