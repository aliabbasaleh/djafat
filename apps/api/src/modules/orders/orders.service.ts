import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import type {
  DomainEventType,
  Money,
  MoneyJson,
  OrderAccrualBreakdown,
  OrderAmountPort,
  OrderDeliveryContext,
  OrderPaymentContext,
  Role,
} from '@djafat/types';
import { addMoney, assertOrderTransition, money } from '@djafat/core';
import { CatalogService } from '../catalog/catalog.service';
import { PricingService } from '../pricing/pricing.service';
import { PlatformService } from '../platform/platform.service';
import { CartsService } from '../carts/carts.service';
import { AddressesService, type AddressDto } from '../addresses/addresses.service';
import { UsersService } from '../users/users.service';
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

/**
 * The shape `order.create`'s `dropoff*` columns are frozen from — common to
 * both checkout paths (Bloc 8, docs/29 §checkout): a client-selected address
 * (`AddressesService.requireOwned`, mapped to this shape) and the legacy
 * default-address lookup (`loadDefaultDropoff`, raw SQL, unchanged since
 * Bloc 6) both resolve to exactly this before `doCreateOrder` snapshots it.
 */
interface DropoffSnapshot {
  id: string;
  label: string | null;
  city: string | null;
  quartier: string | null;
  street: string | null;
  landmark: string | null;
  instructions: string | null;
  recipient_phone: string | null;
  geocode_status: string;
  lat: number | null;
  lng: number | null;
}

/** Maps a customer's selected `AddressDto` (camelCase, city joined by name) onto the `DropoffSnapshot` shape. */
function toDropoffSnapshot(address: AddressDto): DropoffSnapshot {
  return {
    id: address.id,
    label: address.label,
    city: address.cityName,
    quartier: address.quartier,
    street: address.street,
    landmark: address.landmark,
    instructions: address.instructions,
    recipient_phone: address.recipientPhone,
    geocode_status: address.geocodeStatus,
    lat: address.lat,
    lng: address.lng,
  };
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
    private readonly addresses: AddressesService,
    private readonly users: UsersService,
    private readonly outbox: OutboxService,
    private readonly idempotency: IdempotencyService,
    private readonly events: EventEmitter2,
  ) {}

  // ── creation (docs/22 §9 — always FROM the caller's cart) ────────────────

  async createOrder(
    customerId: string,
    idempotencyKey: string,
    addressId?: string,
  ): Promise<{ status: 'created' | 'replayed'; order: OrderDto }> {
    // Scoped per-customer (not a bare 'orders' scope): an idempotency key is
    // client-generated, so namespacing by actor is what actually prevents
    // one customer's key from ever colliding with another's (docs/19 §2).
    // The payload fingerprint is the customer id itself, with `addressId`
    // folded in (Bloc 8, docs/29 §checkout): a replay must produce the SAME
    // order it did the first time, so a key reused with a different address
    // selection is a fingerprint mismatch, not a silent re-resolution.
    const run = await this.idempotency.run(
      `orders:${customerId}`,
      idempotencyKey,
      { customerId, addressId: addressId ?? null },
      () => this.doCreateOrder(customerId, idempotencyKey, addressId),
    );
    return { status: run.status, order: run.response };
  }

  private async doCreateOrder(
    customerId: string,
    idempotencyKey: string,
    addressId?: string,
  ): Promise<OrderDto> {
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

      // Dropoff snapshot (Bloc 6, docs/25 §8; Bloc 8, docs/29 §checkout) —
      // frozen NOW, at order creation, never re-read live later (a
      // subsequent address-book edit must not alter this order). No courier
      // is resolved here — the Bloc 0.5 hack that used to do that is gone
      // (docs/25 §2): a courier is only known once `deliveries` dispatches
      // one, well after payment.
      //
      // When the client selects an address, it is resolved here through
      // `AddressesService.requireOwned`, given THIS SAME `tx` — the ownership
      // check and the snapshot below commit as one atomic unit, so a
      // concurrent delete/edit of that address can never land half-applied.
      // A foreign or unknown id is rejected (404) before any pricing or order
      // row is touched. With no selection, the pre-Bloc-8 default-address
      // behaviour is preserved untouched, byte-for-byte, for callers that
      // still omit it.
      const dropoff = addressId
        ? toDropoffSnapshot(await this.addresses.requireOwned(customerId, addressId, tx))
        : await this.loadDefaultDropoff(tx, customerId);

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
          status: 'awaiting_payment',
          currency: restaurant.currency,
          subtotalMinor: price.subtotal.minor,
          deliveryFeeMinor: price.deliveryFee.minor,
          commissionBpsSnapshot: price.commissionBps,
          commissionMinor: price.commission.minor,
          courierFeeMinor: price.courierFee.minor,
          totalMinor: total.minor,
          expiresAt,
          // Frozen at creation and never re-read from `addresses` afterwards
          // (docs/25 §B6.1-6). `dropoffAddressId` is a convenience pointer for
          // "re-order to the same address" only — migration 0025 makes it
          // ON DELETE SET NULL, so erasing the address book cannot rewrite or
          // block this order's history.
          dropoffAddressId: dropoff.id,
          dropoffLabel: dropoff.label,
          dropoffCity: dropoff.city,
          dropoffQuartier: dropoff.quartier,
          dropoffStreet: dropoff.street,
          dropoffLandmark: dropoff.landmark,
          dropoffInstructions: dropoff.instructions,
          dropoffRecipientPhone: dropoff.recipient_phone,
          dropoffGeocodeStatus: dropoff.geocode_status,
        },
      });
      // `dropoff_geom` is PostGIS — not writable through the Prisma client
      // (docs/17 D-02 convention). Only set when the source address actually
      // has coordinates (N'Djamena addressing is landmark-first — a manual
      // address legitimately has none yet, docs/09 B.1).
      if (dropoff.lat !== null && dropoff.lng !== null) {
        await tx.$executeRaw`
          UPDATE orders SET dropoff_geom = ST_SetSRID(ST_MakePoint(${dropoff.lng}, ${dropoff.lat}), 4326)::geography
          WHERE id = ${order.id}::uuid
        `;
      }

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

  /**
   * The pre-Bloc-8 behaviour (docs/25 §8), unchanged: when the client omits
   * `addressId`, fall back to the customer's default address. Kept as the
   * exact original raw query so every existing caller that never selects an
   * address keeps behaving byte-for-byte as before.
   */
  private async loadDefaultDropoff(
    tx: Prisma.TransactionClient,
    customerId: string,
  ): Promise<DropoffSnapshot> {
    const defaultAddress = await tx.$queryRaw<DropoffSnapshot[]>`
      SELECT a.id, a.quartier, a.street, a.landmark, a.instructions, a.recipient_phone,
             a.geocode_status, a.label, c.name AS city,
             ST_Y(a.geom::geometry) AS lat, ST_X(a.geom::geometry) AS lng
      FROM addresses a
      LEFT JOIN cities c ON c.id = a.city_id
      WHERE a.user_id = ${customerId}::uuid AND a.is_default = true
      LIMIT 1
    `;
    const dropoff = defaultAddress[0];
    if (!dropoff) {
      throw new ConflictException({
        code: 'VALIDATION_ERROR',
        message:
          'No default delivery address on file — add one before placing an order (docs/25 §6, §20).',
      });
    }
    return dropoff;
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
      subtotal: money(order.subtotalMinor, order.currency),
      commission: money(order.commissionMinor, order.currency),
      courierFee: money(order.courierFeeMinor, order.currency),
    };
  }

  /**
   * Everything `deliveries` needs to dispatch this order (docs/25 §6, §21) —
   * pickup coordinates come from the restaurant's own `geom` (never asked of
   * the customer), dropoff from THIS order's frozen snapshot (never the
   * customer's live, possibly-since-edited address book).
   */
  async getDeliveryContext(orderId: string): Promise<OrderDeliveryContext> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        code: string;
        restaurant_id: string;
        customer_id: string;
        currency: string;
        courier_fee_minor: bigint;
        pickup_lat: number | null;
        pickup_lng: number | null;
        dropoff_lat: number | null;
        dropoff_lng: number | null;
      }>
    >`
      SELECT o.id, o.code, o.restaurant_id, o.customer_id, o.currency, o.courier_fee_minor,
             ST_Y(r.geom::geometry) AS pickup_lat, ST_X(r.geom::geometry) AS pickup_lng,
             ST_Y(o.dropoff_geom::geometry) AS dropoff_lat, ST_X(o.dropoff_geom::geometry) AS dropoff_lng
      FROM orders o
      JOIN restaurants r ON r.id = o.restaurant_id
      WHERE o.id = ${orderId}::uuid
    `;
    const row = rows[0];
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Order ${orderId} not found.` });
    }

    // Prepaid orders always pass through `awaiting_payment` before `placed`
    // (only `payment.succeeded` lifts that gate — `markPlacedFromPayment`
    // above); cash orders go straight to `placed` at creation (docs/08 §8.4).
    // This history row is the one signal `orders` can answer without
    // reaching into `payments`' tables (DAG).
    const prepaidHistory = await this.prisma.orderStatusHistory.findFirst({
      where: { orderId, fromStatus: 'awaiting_payment' },
      select: { id: true },
    });

    return {
      orderId: row.id,
      orderCode: row.code,
      restaurantId: row.restaurant_id,
      customerId: row.customer_id,
      currency: row.currency,
      courierFee: money(row.courier_fee_minor, row.currency),
      courierFeeInPool: prepaidHistory !== null,
      pickup:
        row.pickup_lat !== null && row.pickup_lng !== null
          ? { lat: row.pickup_lat, lng: row.pickup_lng }
          : null,
      dropoff:
        row.dropoff_lat !== null && row.dropoff_lng !== null
          ? { lat: row.dropoff_lat, lng: row.dropoff_lng }
          : null,
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

  /**
   * Minimal operational listing for admin/support (Bloc 9, docs/30
   * §admin-api) — a summary row, never the full `OrderDto` with items
   * (that's `getOrder`, one at a time). Filterable by status/restaurant so
   * support can actually find what a ticket is about.
   */
  async listForAdmin(
    filters: { status?: OrderStatusString; restaurantId?: string },
    page: number,
    limit: number,
  ): Promise<{
    items: Array<{
      id: string;
      code: string;
      status: string;
      restaurantId: string;
      customerId: string;
      total: MoneyJson;
      createdAt: string;
    }>;
    page: number;
    limit: number;
    total: number;
  }> {
    const where = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.restaurantId ? { restaurantId: filters.restaurantId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      items: rows.map((o) => ({
        id: o.id,
        code: o.code,
        status: o.status,
        restaurantId: o.restaurantId,
        customerId: o.customerId,
        total: toMoneyJson(o.totalMinor, o.currency),
        createdAt: o.createdAt.toISOString(),
      })),
      page,
      limit,
      total,
    };
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

  // ── restaurant-side transitions (Bloc 9, docs/30 §order-authorization) ────
  //
  // Were an unauthenticated Bloc 0.5 stand-in until this bloc (docs/19 §10
  // dette D-10): `OrdersController` now requires `@RequireAuth` +
  // `@RequireRole('restaurant_owner','restaurant_staff')` before any of
  // these run, and `transitionOrder` itself re-verifies that the caller
  // actually belongs to THIS order's restaurant — never trusts the role
  // check alone, since a restaurant_staff member of restaurant A must never
  // confirm an order for restaurant B.

  async confirmOrder(id: string, actor: { userId: string; role: Role }): Promise<OrderDto> {
    await this.transitionOrder(id, 'confirmed', {
      actorRole: actor.role,
      actorUserId: actor.userId,
    });
    return this.getOrder(id);
  }

  /** `confirmed -> preparing -> ready` in one call (docs/18 §6). */
  async markReady(id: string, actor: { userId: string; role: Role }): Promise<OrderDto> {
    await this.transitionOrder(id, 'preparing', {
      actorRole: actor.role,
      actorUserId: actor.userId,
    });
    await this.transitionOrder(id, 'ready', { actorRole: actor.role, actorUserId: actor.userId });
    return this.getOrder(id);
  }

  /**
   * `placed -> rejected` — already fully defined in `@djafat/core`'s state
   * machine (`restaurant_reject`, same roles as `confirmOrder`) since before
   * this bloc; nothing stopped it from existing except the missing auth this
   * bloc closes, so there is no new business decision to make here.
   */
  async rejectOrder(
    id: string,
    actor: { userId: string; role: Role },
    reason?: string,
  ): Promise<OrderDto> {
    await this.transitionOrder(id, 'rejected', {
      actorRole: actor.role,
      actorUserId: actor.userId,
      ...(reason !== undefined ? { reason } : {}),
    });
    return this.getOrder(id);
  }

  // ── generic transition (single source of the state-machine logic) ────────

  /**
   * Validates via `@djafat/core` and applies the transition atomically. Never
   * called across the `payments`/`deliveries` DAG boundary directly — those
   * modules trigger it indirectly via events (`@OnEvent` handlers below).
   *
   * `actorUserId`, when given, is re-verified against the order's OWN
   * `restaurant_id` — read with the same row lock the transition itself
   * uses, so the membership check and the state change are one atomic unit
   * (no window where a staff change mid-flight could slip through). System-
   * triggered transitions (`opts.system`) never pass `actorUserId` and skip
   * this check entirely — there is no human actor to verify.
   */
  async transitionOrder(
    orderId: string,
    to: OrderStatusString,
    opts: { actorRole?: Role; actorUserId?: string; system?: boolean; reason?: string },
  ): Promise<void> {
    const restaurantId = await this.prisma.$transaction(async (tx) => {
      // `restaurant_id` is read with the lock rather than in a second query:
      // the realtime fan-out needs it to reach the restaurant's order board
      // (docs/27 §4), and it must describe the order as it was at THIS
      // transition, not as a later read might find it.
      const rows = await tx.$queryRaw<Array<{ status: OrderStatusString; restaurant_id: string }>>`
        SELECT status, restaurant_id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE
      `;
      if (!rows[0]) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: `Order ${orderId} not found.` });
      }
      const from = rows[0].status;
      const restaurantId = rows[0].restaurant_id;

      if (opts.actorUserId !== undefined) {
        const isMember = await this.users.isMemberOfRestaurant(opts.actorUserId, restaurantId);
        if (!isMember) {
          throw new ForbiddenException({
            code: 'FORBIDDEN',
            message: 'You do not belong to this order’s restaurant.',
          });
        }
      }

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
        payload: { orderId, status: to, restaurantId },
      });
      return restaurantId;
    });

    // Fast, same-process reaction — fired AFTER commit (docs/05 §5.4), by
    // the transition's own specific name (not just generic 'order.updated'
    // realtime forwarding below). Bloc 6: `deliveries` reacts to
    // `order.ready` to start dispatch — same mechanism `orders` itself
    // already uses to react to `payment.succeeded`/`delivery.*`.
    this.events.emit(this.eventNameFor(to), { orderId, status: to, restaurantId });
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

  /**
   * Reaction to `delivery.accepted` — a courier has actually COMMITTED, not
   * merely been offered the delivery (`delivery.assigned` fires earlier, at
   * offer time, and does not move the order — docs/25 §5). The one `system`
   * transition in the table.
   */
  @OnEvent('delivery.accepted')
  async onDeliveryAccepted(payload: { orderId: string; courierId: string }): Promise<void> {
    await this.transitionOrder(payload.orderId, 'courier_assigned', {
      system: true,
      reason: 'delivery.accepted',
    });
  }

  /** Reaction to `delivery.cancelled`/`delivery.failed` — the order follows the delivery to `cancelled` (docs/25 §29-30). */
  @OnEvent('delivery.cancelled')
  async onDeliveryCancelled(payload: { orderId: string }): Promise<void> {
    await this.transitionOrder(payload.orderId, 'cancelled', {
      system: true,
      reason: 'delivery.cancelled',
    }).catch((err: unknown) => {
      // Idempotent by design: the order may already be terminal via another
      // path (e.g. a customer-cancel that raced the delivery cancellation).
      this.logger.debug(`onDeliveryCancelled: order ${payload.orderId} no-op (${String(err)})`);
    });
  }

  @OnEvent('delivery.failed')
  async onDeliveryFailed(payload: { orderId: string }): Promise<void> {
    await this.transitionOrder(payload.orderId, 'cancelled', {
      system: true,
      reason: 'delivery.failed',
    }).catch((err: unknown) => {
      this.logger.debug(`onDeliveryFailed: order ${payload.orderId} no-op (${String(err)})`);
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
