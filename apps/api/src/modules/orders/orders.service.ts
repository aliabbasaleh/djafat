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
import { addMoney, assertOrderTransition, money } from '@djafat/core';
import { CatalogService } from '../catalog/catalog.service';
import { PricingService } from '../pricing/pricing.service';
import { PlatformService } from '../platform/platform.service';
import { CartsService } from '../carts/carts.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { toMoneyJson } from '../../common/money/money.mapper';
import { generateOrderCode } from './order-code';

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

export interface OrderItemOptionDto {
  optionId: string | null;
  name: string;
  priceDelta: MoneyJson;
}

export interface OrderItemDto {
  productId: string | null;
  name: string;
  unitPrice: MoneyJson;
  quantity: number;
  lineTotal: MoneyJson;
  options: OrderItemOptionDto[];
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
    private readonly carts: CartsService,
    private readonly outbox: OutboxService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ── creation (docs/22 §9 — always FROM the caller's cart) ────────────────

  async createOrder(
    customerId: string,
    idempotencyKey: string,
  ): Promise<{ status: 'created' | 'replayed'; order: OrderDto }> {
    // Scoped per-customer (not a bare 'orders' scope): an idempotency key is
    // client-generated, so namespacing by actor is what actually prevents
    // one customer's key from ever colliding with another's (docs/19 §2).
    // The payload fingerprint is the customer id itself (there is no
    // client-supplied body any more — docs/22 §9): replaying the same key
    // for the same customer always replays the same order.
    const run = await this.idempotency.run(
      `orders:${customerId}`,
      idempotencyKey,
      { customerId },
      () => this.doCreateOrder(customerId, idempotencyKey),
    );
    return { status: run.status, order: run.response };
  }

  private async doCreateOrder(customerId: string, idempotencyKey: string): Promise<OrderDto> {
    const { order: created, lines } = await this.prisma.$transaction(async (tx) => {
      // Row-locks the caller's open cart for the rest of this transaction
      // (docs/22 §9). Without this, two concurrent POST /orders calls using
      // two DIFFERENT idempotency keys (e.g. a double-click, or a client
      // retry before the first response lands) could both read the same
      // open cart, both pass validation, and both create a full order
      // before either commits — idempotency alone only protects against
      // *replaying the same key*, not this race. The lock forces the second
      // call to wait for the first to commit (converting the cart), then
      // re-read it as no-longer-open and fail with CART_EMPTY, exactly like
      // a genuinely empty cart.
      const validated = await this.carts.loadAndValidateCartForCheckout(customerId, tx);
      const restaurant = await this.catalog.getActiveRestaurant(validated.restaurantId);

      // Bloc 0.5 simplification: single seeded test courier, resolved now so the
      // courier leg of `order_accrual` can post at payment.succeeded exactly like
      // the validated reference model (docs/08 §8.9, docs/18 §4). Real dispatch
      // is Bloc 6.
      const courier = await tx.$queryRaw<Array<{ id: string }>>`
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
        subtotal: validated.subtotal,
      });
      const total = addMoney(price.subtotal, price.deliveryFee);

      const ttlSeconds = await this.platform.getUnpaidOrderTtlSeconds();
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      const code = generateOrderCode();

      const order = await tx.order.create({
        data: {
          code,
          idempotencyKey,
          countryId: restaurant.countryId,
          cityId: restaurant.cityId,
          customerId,
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

      // One `create` per line (not `createMany`): each line's generated id
      // is needed to attach its `OrderItemOption` snapshot rows — a cart
      // has a handful of lines, never hundreds, so this is not the N+1
      // pattern the catalog module had to avoid at list-scale (docs/20 §39).
      for (const line of validated.lines) {
        const orderItem = await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: line.productId,
            nameSnapshot: line.name,
            unitPriceMinor: line.unitPrice.minor,
            quantity: line.quantity,
            lineTotalMinor: line.lineTotal.minor,
            currency: line.lineTotal.currency,
          },
        });
        if (line.options.length > 0) {
          await tx.orderItemOption.createMany({
            data: line.options.map((o) => ({
              orderItemId: orderItem.id,
              optionId: o.optionId,
              nameSnapshot: o.name,
              priceDeltaMinor: o.priceDelta.minor,
              currency: o.priceDelta.currency,
            })),
          });
        }
      }

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

      // The cart that funded this order is now spent — a new `addItem` call
      // starts a fresh one (docs/22 §3, the `carts_one_open_per_user`
      // partial unique index allows it once this row leaves `status='open'`).
      await this.carts.markConverted(tx, validated.cartId);

      return { order, lines: validated.lines };
    });

    const itemDtos: OrderItemDto[] = lines.map((l) => ({
      productId: l.productId,
      name: l.name,
      unitPrice: toMoneyJson(l.unitPrice.minor, l.unitPrice.currency),
      quantity: l.quantity,
      lineTotal: toMoneyJson(l.lineTotal.minor, l.lineTotal.currency),
      options: l.options.map((o) => ({
        optionId: o.optionId,
        name: o.name,
        priceDelta: toMoneyJson(o.priceDelta.minor, o.priceDelta.currency),
      })),
    }));
    return this.toDto(created, itemDtos);
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

  /** For `@RequireOwnership(...)` (docs/19 §21) — throws NotFound itself, never returns a sentinel. */
  async getOwnerUserId(orderId: string): Promise<string> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { customerId: true },
    });
    if (!order)
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Order ${orderId} not found.` });
    return order.customerId;
  }

  async getOrder(id: string): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: { include: { options: true } } },
    });
    if (!order)
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Order ${id} not found.` });
    const itemDtos: OrderItemDto[] = order.items.map((it) => ({
      productId: it.productId,
      name: it.nameSnapshot,
      unitPrice: toMoneyJson(it.unitPriceMinor, it.currency),
      quantity: it.quantity,
      lineTotal: toMoneyJson(it.lineTotalMinor, it.currency),
      options: it.options.map((o) => ({
        optionId: o.optionId,
        name: o.nameSnapshot,
        priceDelta: toMoneyJson(o.priceDeltaMinor, o.currency),
      })),
    }));
    return this.toDto(order, itemDtos);
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
    items: OrderItemDto[],
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
      items,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }
}
