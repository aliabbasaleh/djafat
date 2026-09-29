import { randomBytes, createHash } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import type {
  DeliveryStatus,
  MoneyJson,
  OrderAmountPort,
  OrderDeliveryContext,
  Role,
} from '@djafat/types';
import { DeliveryTransitionError, assertDeliveryTransition, fromStatusesFor } from '@djafat/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { toMoneyJson } from '../../common/money/money.mapper';
import { ORDER_AMOUNT_PORT } from '../../common/ports/order-amount.port';
import { LedgerService } from '../ledger/ledger.service';
import { PlatformService } from '../platform/platform.service';
import { CouriersService } from '../couriers/couriers.service';
import { buildFundsAvailableEntries } from './release-entries';
import { buildCourierFeeReclassificationEntries } from './courier-fee-reclassification';

export interface DeliveryDto {
  id: string;
  orderId: string;
  courierId: string | null;
  status: DeliveryStatus;
  courierFee: MoneyJson;
  estimatedDistanceM: number | null;
  dispatchAttempts: number;
  assignedAt: string | null;
  acceptedAt: string | null;
  pickedUpAt: string | null;
  onTheWayAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  failedAt: string | null;
  failedReason: string | null;
}

export interface DeliveryOfferDto {
  id: string;
  deliveryId: string;
  status: string;
  offeredAt: string;
  expiresAt: string;
}

type DeliveryRow = {
  id: string;
  orderId: string;
  courierId: string | null;
  status: string;
  currency: string;
  courierFeeMinor: bigint;
  estimatedDistanceM: Prisma.Decimal | null;
  dispatchAttempts: number;
  assignedAt: Date | null;
  acceptedAt: Date | null;
  pickedUpAt: Date | null;
  onTheWayAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  cancelledReason: string | null;
  failedAt: Date | null;
  failedReason: string | null;
};

/**
 * Real dispatch core (Bloc 6, docs/25). Owns `Delivery`'s own lifecycle —
 * NEVER `Order`'s (docs/25 §5): every order-side consequence is emitted as
 * an event (`delivery.accepted`/`delivery.picked_up`/`delivery.delivered`/
 * `delivery.cancelled`/`delivery.failed`) that `orders` reacts to, exactly
 * the established DAG pattern (`orders` never imports `payments`/
 * `deliveries`, docs/15 AD-09). `deliveries` itself never writes
 * `ledger_*`/`wallet_*` directly — always via `LedgerService`.
 *
 * Lock ordering (docs/25 §12, §39): every transaction that touches both a
 * `deliveries` row and a `couriers` row locks the DELIVERY FIRST, then calls
 * `couriers.lockAndClaim`/`release` (which locks the courier row) SECOND —
 * never the reverse, anywhere in this file.
 */
@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly events: EventEmitter2,
    private readonly platform: PlatformService,
    private readonly couriers: CouriersService,
    @Inject(ORDER_AMOUNT_PORT) private readonly orderAmount: OrderAmountPort,
  ) {}

  // ── creation + dispatch trigger (docs/25 §11) ────────────────────────────

  /**
   * `orders` never calls into `deliveries` directly (DAG) — this reacts to
   * the order reaching `ready`, the dispatch trigger point (docs/25 §2, §21:
   * pickup = the restaurant's location, resolved via `OrderAmountPort`,
   * never asked of the client).
   */
  @OnEvent('order.ready')
  async onOrderReady(payload: { orderId: string }): Promise<void> {
    await this.createAndDispatch(payload.orderId);
  }

  /**
   * `POST /v1/deliveries` (docs/25 §45) — admin/ops manual trigger, same
   * logic the automatic `order.ready` reaction uses. Idempotent: a delivery
   * already `searching_courier` just gets another dispatch wave (useful
   * after an incident); one already assigned/beyond is left untouched.
   */
  async createAndDispatch(orderId: string): Promise<DeliveryDto> {
    const context = await this.orderAmount.getDeliveryContext(orderId);
    const delivery = await this.createIfMissing(context);
    if (delivery.status === 'pending') {
      await this.startSearching(delivery.id);
    } else if (delivery.status === 'searching_courier') {
      await this.runDispatchWave(delivery.id);
    }
    return this.getByIdOrThrow(delivery.id);
  }

  private async createIfMissing(
    context: OrderDeliveryContext,
  ): Promise<{ id: string; status: string }> {
    const existing = await this.prisma.delivery.findUnique({ where: { orderId: context.orderId } });
    if (existing) return { id: existing.id, status: existing.status };

    const created = await this.prisma.delivery.create({
      data: {
        orderId: context.orderId,
        status: 'pending',
        currency: context.currency,
        courierFeeMinor: context.courierFee.minor,
      },
    });
    if (context.pickup) {
      await this.prisma.$executeRaw`
        UPDATE deliveries SET pickup_geom = ST_SetSRID(ST_MakePoint(${context.pickup.lng}, ${context.pickup.lat}), 4326)::geography
        WHERE id = ${created.id}::uuid
      `;
    }
    if (context.dropoff) {
      await this.prisma.$executeRaw`
        UPDATE deliveries SET dropoff_geom = ST_SetSRID(ST_MakePoint(${context.dropoff.lng}, ${context.dropoff.lat}), 4326)::geography
        WHERE id = ${created.id}::uuid
      `;
    }
    if (context.pickup && context.dropoff) {
      const distance = await this.prisma.$queryRaw<Array<{ d: number }>>`
        SELECT ST_Distance(
          ST_SetSRID(ST_MakePoint(${context.pickup.lng}, ${context.pickup.lat}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${context.dropoff.lng}, ${context.dropoff.lat}), 4326)::geography
        ) AS d
      `;
      await this.prisma.delivery.update({
        where: { id: created.id },
        data: { estimatedDistanceM: distance[0]?.d ?? null },
      });
    }
    await this.prisma.outbox.create({
      data: {
        aggregate: 'delivery',
        aggregateId: created.id,
        eventType: 'delivery.created',
        payload: { deliveryId: created.id, orderId: context.orderId },
      },
    });
    this.logger.log(`delivery ${created.id} created for order ${context.orderId}`);
    return { id: created.id, status: created.status };
  }

  private async startSearching(deliveryId: string): Promise<void> {
    const updated = await this.prisma.delivery.updateMany({
      where: { id: deliveryId, status: 'pending' },
      data: { status: 'searching_courier', searchingSince: new Date() },
    });
    if (updated.count === 0) return; // already progressed — idempotent no-op
    await this.prisma.outbox.create({
      data: {
        aggregate: 'delivery',
        aggregateId: deliveryId,
        eventType: 'delivery.searching_courier',
        payload: { deliveryId },
      },
    });
    await this.runDispatchWave(deliveryId);
  }

  // ── dispatch wave (docs/25 §11, worker-retried — see dispatch.processor.ts) ──

  /**
   * One attempt: find the nearest eligible candidate NOT already offered
   * this delivery, claim them, and send an offer. Radius widens with
   * `dispatch_attempts` (docs/25 §10 — never a hardcoded 5000m). Safe to
   * call repeatedly (by the worker) — a no-op unless the delivery is still
   * `searching_courier`.
   */
  async runDispatchWave(deliveryId: string): Promise<void> {
    const initialRadius = await this.platform.getDispatchInitialRadiusMeters();
    const maxRadius = await this.platform.getDispatchMaxRadiusMeters();
    const step = await this.platform.getDispatchRadiusExpansionStepMeters();
    const maxWaves = await this.platform.getDispatchMaxWaves();
    const offerTimeoutSeconds = await this.platform.getOfferTimeoutSeconds();

    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery || delivery.status !== 'searching_courier') return;

    const rows = await this.prisma.$queryRaw<Array<{ lat: number | null; lng: number | null }>>`
      SELECT ST_Y(pickup_geom::geometry) AS lat, ST_X(pickup_geom::geometry) AS lng
      FROM deliveries WHERE id = ${deliveryId}::uuid
    `;
    const pickup = rows[0];
    if (!pickup || pickup.lat === null || pickup.lng === null) {
      // No pickup coordinates (manual/un-geocoded restaurant address) — dispatch
      // cannot compute distance-based candidates. Flagged for manual ops
      // handling rather than crashing (docs/25 §6, §11) — the delivery stays
      // `searching_courier`; documented as non-blocking debt (docs/25 §23).
      await this.prisma.outbox.create({
        data: {
          aggregate: 'delivery',
          aggregateId: deliveryId,
          eventType: 'delivery.searching_no_courier',
          payload: { deliveryId, reason: 'no_pickup_coordinates' },
        },
      });
      return;
    }

    const alreadyOffered = await this.prisma.deliveryOffer.findMany({
      where: { deliveryId },
      select: { courierId: true },
    });
    const excludeIds = alreadyOffered.map((o) => o.courierId);

    const radius = Math.min(initialRadius + delivery.dispatchAttempts * step, maxRadius);
    const candidates = await this.couriers.findEligibleCandidates(
      { lat: pickup.lat, lng: pickup.lng },
      radius,
      excludeIds,
    );

    if (candidates.length === 0) {
      const attempts = delivery.dispatchAttempts + 1;
      await this.prisma.delivery.update({
        where: { id: deliveryId },
        data: { dispatchAttempts: attempts, dispatchRadiusM: radius },
      });
      if (attempts >= maxWaves && radius >= maxRadius) {
        await this.prisma.outbox.create({
          data: {
            aggregate: 'delivery',
            aggregateId: deliveryId,
            eventType: 'delivery.searching_no_courier',
            payload: { deliveryId, attempts, radius },
          },
        });
      }
      return; // the worker retries later with a wider radius
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      // Lock the delivery FIRST (docs/25 §12, §39).
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM deliveries WHERE id = ${deliveryId}::uuid FOR UPDATE
      `;
      if (!locked[0] || locked[0].status !== 'searching_courier') return null;

      for (const candidate of candidates) {
        const claimed = await this.couriers.lockAndClaim(tx, candidate.courierId, deliveryId); // courier SECOND
        if (!claimed) continue;

        const expiresAt = new Date(Date.now() + offerTimeoutSeconds * 1000);
        const offer = await tx.deliveryOffer.create({
          data: { deliveryId, courierId: candidate.courierId, status: 'offered', expiresAt },
        });
        await tx.delivery.update({
          where: { id: deliveryId },
          data: {
            status: 'courier_assigned',
            courierId: candidate.courierId,
            assignedAt: new Date(),
            dispatchRadiusM: radius,
          },
        });
        await tx.outbox.create({
          data: {
            aggregate: 'delivery',
            aggregateId: deliveryId,
            eventType: 'delivery.assigned',
            payload: { deliveryId, courierId: candidate.courierId, offerId: offer.id },
          },
        });
        return { courierId: candidate.courierId, offerId: offer.id };
      }
      return null;
    });

    if (outcome) {
      this.events.emit('courier.offer.new', { deliveryId, ...outcome });
      this.logger.log(`delivery ${deliveryId} offered to courier ${outcome.courierId}`);
    }
  }

  // ── accept / reject (courier-facing, docs/25 §14-15) ─────────────────────
  // The API targets the DELIVERY, not a separate offer id (docs/25 §45) — the
  // "offer" is implicit: whichever `offered`, unexpired `delivery_offers` row
  // belongs to (deliveryId, courierId). At most one such row can ever be
  // `offered` at a time for a given delivery (the dispatch wave only ever
  // creates the next offer after the previous one leaves `offered`).

  private async findActiveOffer(deliveryId: string, courierId: string) {
    const offer = await this.prisma.deliveryOffer.findFirst({
      where: { deliveryId, courierId, status: 'offered' },
      orderBy: { offeredAt: 'desc' },
    });
    if (!offer) {
      // Never let a courier act on a delivery not currently offered to them
      // (docs/25 §14, §46 IDOR) — same 404 whether the delivery doesn't
      // exist, was never offered to them, or their offer already resolved.
      throw new NotFoundException({
        code: 'OFFER_NOT_FOUND',
        message: `No active offer for delivery ${deliveryId} addressed to this courier.`,
      });
    }
    return offer;
  }

  async acceptOffer(
    deliveryId: string,
    courierId: string,
    idempotencyKey: string,
  ): Promise<{ status: 'created' | 'replayed'; delivery: DeliveryDto }> {
    const run = await this.idempotency.run(
      'deliveries:accept',
      idempotencyKey,
      { deliveryId, courierId },
      () => this.doAcceptOffer(deliveryId, courierId),
    );
    return { status: run.status, delivery: run.response };
  }

  private async doAcceptOffer(deliveryId: string, courierId: string): Promise<DeliveryDto> {
    const offer = await this.findActiveOffer(deliveryId, courierId);
    const offerId = offer.id;

    const outcome = await this.prisma.$transaction(async (tx) => {
      // Delivery FIRST.
      const rows = await tx.$queryRaw<
        Array<{ status: string; courier_id: string | null; order_id: string }>
      >`
        SELECT status, courier_id, order_id FROM deliveries WHERE id = ${offer.deliveryId}::uuid FOR UPDATE
      `;
      const delivery = rows[0];
      if (!delivery) {
        throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found.' });
      }

      const freshOffer = await tx.deliveryOffer.findUnique({ where: { id: offerId } });
      if (
        !freshOffer ||
        freshOffer.status !== 'offered' ||
        freshOffer.expiresAt.getTime() <= Date.now()
      ) {
        throw new ConflictException({ code: 'OFFER_EXPIRED', message: 'This offer has expired.' });
      }
      // Ownership check FIRST: the common way to lose this race is a
      // DIFFERENT courier's offer for the SAME delivery having already won
      // (docs/25 §13) — that must read as "no longer yours", not an internal
      // state-machine rejection. Only once ownership is confirmed does the
      // state machine get asked whether the move itself is legal; either way
      // `DeliveryTransitionError` (a plain `Error`, not an HTTP exception) is
      // translated to a clean 409 rather than leaking as a raw 500 (docs/25
      // §47, §64) — reachable if this SAME courier's own accept is somehow
      // replayed post-commit under a different idempotency key.
      if (delivery.courier_id !== courierId) {
        throw new ConflictException({
          code: 'DELIVERY_ALREADY_ASSIGNED',
          message: 'This delivery is no longer offered to you.',
        });
      }
      try {
        assertDeliveryTransition(delivery.status as never, 'courier_accepted', {
          actorRole: 'courier',
        });
      } catch (err) {
        if (err instanceof DeliveryTransitionError) {
          throw new ConflictException({
            code: 'DELIVERY_INVALID_STATE',
            message: `Cannot accept from status ${delivery.status}.`,
          });
        }
        throw err;
      }

      // Courier row (SECOND) — re-verify not suspended in the meantime
      // (docs/25 §13, §64: a suspended courier must never be able to accept).
      const courierRows = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM couriers WHERE user_id = ${courierId}::uuid FOR UPDATE
      `;
      if (!courierRows[0] || courierRows[0].status !== 'busy') {
        throw new ConflictException({
          code: 'COURIER_NOT_ELIGIBLE',
          message: 'Courier is no longer eligible to accept this delivery.',
        });
      }

      await tx.deliveryOffer.update({
        where: { id: offerId },
        data: { status: 'accepted', respondedAt: new Date() },
      });
      await tx.delivery.update({
        where: { id: offer.deliveryId },
        data: { status: 'courier_accepted', acceptedAt: new Date() },
      });

      // Reclassify the pooled courier fee to this specific courier NOW
      // (docs/25 §12, §26) — only for a prepaid order (see doc comment on
      // `courierFeeInPool`); a cash order has nothing pooled yet.
      const context = await this.orderAmount.getDeliveryContext(delivery.order_id);
      if (context.courierFeeInPool) {
        await this.ledger.postEntryGroupTx(tx, {
          kind: 'adjustment',
          idempotencyKey: `courier-accrual:${offer.deliveryId}`,
          currency: context.currency,
          entries: buildCourierFeeReclassificationEntries(courierId, context.courierFee),
          refs: { orderId: delivery.order_id },
          createdBy: 'deliveries',
        });
      }

      await tx.outbox.create({
        data: {
          aggregate: 'delivery',
          aggregateId: offer.deliveryId,
          eventType: 'delivery.accepted',
          payload: { deliveryId: offer.deliveryId, orderId: delivery.order_id, courierId },
        },
      });

      return { deliveryId: offer.deliveryId, orderId: delivery.order_id };
    });

    // Fast, same-process reaction — fired AFTER commit: `orders` reacts to
    // move the order to `courier_assigned` (docs/25 §5).
    this.events.emit('delivery.accepted', { orderId: outcome.orderId, courierId });
    return this.getByIdOrThrow(outcome.deliveryId);
  }

  async rejectOffer(
    deliveryId: string,
    courierId: string,
    idempotencyKey: string,
  ): Promise<{ status: 'created' | 'replayed'; delivery: DeliveryDto }> {
    const run = await this.idempotency.run(
      'deliveries:reject',
      idempotencyKey,
      { deliveryId, courierId },
      () => this.doRejectOffer(deliveryId, courierId),
    );
    return { status: run.status, delivery: run.response };
  }

  private async doRejectOffer(inputDeliveryId: string, courierId: string): Promise<DeliveryDto> {
    const offer = await this.findActiveOffer(inputDeliveryId, courierId);
    const offerId = offer.id;

    const deliveryId = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ status: string; courier_id: string | null }>>`
        SELECT status, courier_id FROM deliveries WHERE id = ${offer.deliveryId}::uuid FOR UPDATE
      `;
      const delivery = rows[0];
      if (!delivery) return null;

      const freshOffer = await tx.deliveryOffer.findUnique({ where: { id: offerId } });
      if (!freshOffer || freshOffer.status !== 'offered') return offer.deliveryId; // already resolved — idempotent no-op

      await tx.deliveryOffer.update({
        where: { id: offerId },
        data: { status: 'rejected', respondedAt: new Date() },
      });
      if (delivery.courier_id === courierId && delivery.status === 'courier_assigned') {
        await this.couriers.release(tx, courierId); // courier SECOND
        await tx.delivery.update({
          where: { id: offer.deliveryId },
          data: { status: 'searching_courier', courierId: null },
        });
      }
      await tx.outbox.create({
        data: {
          aggregate: 'delivery',
          aggregateId: offer.deliveryId,
          eventType: 'delivery.rejected',
          payload: { deliveryId: offer.deliveryId, courierId },
        },
      });
      return offer.deliveryId;
    });

    if (!deliveryId) {
      throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found.' });
    }
    await this.runDispatchWave(deliveryId); // try the next candidate immediately
    return this.getByIdOrThrow(deliveryId);
  }

  // ── pickup / on the way (docs/25 §17) ─────────────────────────────────────

  async markPickedUp(
    deliveryId: string,
    courierId: string,
    idempotencyKey: string,
  ): Promise<{ status: 'created' | 'replayed'; delivery: DeliveryDto }> {
    const run = await this.idempotency.run(
      'deliveries:picked-up',
      idempotencyKey,
      { deliveryId, courierId },
      () => this.doMarkPickedUp(deliveryId, courierId),
    );
    return { status: run.status, delivery: run.response };
  }

  private async doMarkPickedUp(deliveryId: string, courierId: string): Promise<DeliveryDto> {
    const fromStatuses = fromStatusesFor('picked_up', { actorRole: 'courier' });
    // pickup_in_progress -> picked_up in one call (this bloc exposes no separate
    // "arrived at restaurant" endpoint — docs/25 §45's minimal route list).
    // Verifies ownership (courier_id match) atomically, not via a prior read.
    const affected = await this.prisma.$executeRaw`
      UPDATE deliveries SET status = 'picked_up'::text, picked_up_at = now()
      WHERE id = ${deliveryId}::uuid AND courier_id = ${courierId}::uuid
        AND status = ANY(${fromStatuses}::text[])
    `;
    if (affected === 0) {
      const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
      if (!delivery) {
        throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found.' });
      }
      if (delivery.courierId !== courierId) {
        throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found.' });
      }
      if (delivery.status === 'picked_up' || delivery.status === 'on_the_way') {
        return this.getByIdOrThrow(deliveryId); // idempotent replay
      }
      throw new ConflictException({
        code: 'DELIVERY_INVALID_STATE',
        message: `Cannot mark picked up from status ${delivery.status}.`,
      });
    }
    await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { status: 'on_the_way', onTheWayAt: new Date() },
    });
    const delivery = await this.getByIdOrThrow(deliveryId);
    await this.outbox.enqueue(this.prisma, {
      aggregate: 'delivery',
      aggregateId: deliveryId,
      eventType: 'delivery.picked_up',
      payload: { deliveryId, orderId: delivery.orderId },
    });
    this.events.emit('delivery.picked_up', { orderId: delivery.orderId });
    this.events.emit('delivery.on_the_way', { orderId: delivery.orderId });
    return delivery;
  }

  // ── delivered + proof (docs/25 §18-19, §25-27) ────────────────────────────

  /** Generates a 4-digit delivery code (docs/09 A.5) at pickup time; returns the RAW code once (never stored raw, never logged). */
  async issueDeliveryCode(deliveryId: string): Promise<string> {
    const code = (randomBytes(2).readUInt16BE(0) % 10000).toString().padStart(4, '0');
    const valueHash = this.hashProof(code);
    await this.prisma.deliveryProof.create({
      data: { deliveryId, type: 'delivery_code', valueHash, createdBy: 'system' },
    });
    return code;
  }

  private hashProof(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  async confirmDelivered(
    deliveryId: string,
    courierId: string,
    proofCode: string,
    idempotencyKey: string,
  ): Promise<{ status: 'created' | 'replayed'; delivery: DeliveryDto }> {
    const run = await this.idempotency.run(
      'deliveries:delivered',
      idempotencyKey,
      { deliveryId, courierId },
      () => this.doConfirmDelivered(deliveryId, courierId, proofCode),
    );
    return { status: run.status, delivery: run.response };
  }

  private async doConfirmDelivered(
    deliveryId: string,
    courierId: string,
    proofCode: string,
  ): Promise<DeliveryDto> {
    const proof = await this.prisma.deliveryProof.findFirst({
      where: { deliveryId, type: 'delivery_code' },
      orderBy: { createdAt: 'desc' },
    });
    if (!proof || proof.valueHash !== this.hashProof(proofCode)) {
      throw new ConflictException({
        code: 'INVALID_PROOF',
        message: 'Delivery code does not match.',
      });
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; order_id: string; currency: string; courier_id: string | null }>
      >`
        UPDATE deliveries SET status = 'delivered'::text, delivered_at = now()
        WHERE id = ${deliveryId}::uuid AND courier_id = ${courierId}::uuid AND status = 'on_the_way'::text
        RETURNING id, order_id, currency, courier_id
      `;
      if (!rows[0]) return null; // already delivered / not this courier's — idempotent no-op or clean 404 below
      const delivery = rows[0];

      const breakdown = await this.orderAmount.getAccrualBreakdown(delivery.order_id);
      const entries = buildFundsAvailableEntries({ courierId }, breakdown);
      await this.ledger.postEntryGroupTx(tx, {
        kind: 'funds_available',
        idempotencyKey: `delivery:${delivery.id}:funds_available`,
        currency: delivery.currency,
        entries,
        refs: { orderId: delivery.order_id },
        createdBy: 'deliveries',
      });

      await this.couriers.release(tx, courierId); // courier SECOND (delivery already updated above)

      await tx.outbox.create({
        data: {
          aggregate: 'delivery',
          aggregateId: delivery.id,
          eventType: 'delivery.delivered',
          payload: { deliveryId: delivery.id, orderId: delivery.order_id, courierId },
        },
      });
      return { deliveryId: delivery.id, orderId: delivery.order_id };
    });

    if (!outcome) {
      const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
      if (!delivery || delivery.courierId !== courierId) {
        throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found.' });
      }
      if (delivery.status === 'delivered') return this.getByIdOrThrow(deliveryId); // idempotent replay
      throw new ConflictException({
        code: 'DELIVERY_INVALID_STATE',
        message: `Cannot confirm delivery from status ${delivery.status}.`,
      });
    }

    // `orders` moves to `delivered`; `payments` completes a pending cash
    // payment now that the courier has collected it (docs/25 §28).
    this.events.emit('delivery.delivered', { orderId: outcome.orderId, courierId });
    this.logger.log(`delivery ${outcome.deliveryId} delivered by courier ${courierId}`);
    return this.getByIdOrThrow(outcome.deliveryId);
  }

  // ── cancellation / failure (docs/25 §29-30) ───────────────────────────────

  /** A real user often holds several roles at once — allowed if ANY of them permits the transition. */
  private unionFromStatuses(to: DeliveryStatus, actorRoles: readonly Role[]): DeliveryStatus[] {
    return [...new Set(actorRoles.flatMap((actorRole) => fromStatusesFor(to, { actorRole })))];
  }

  async cancel(
    deliveryId: string,
    actorRoles: readonly Role[],
    actorUserId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<{ status: 'created' | 'replayed'; delivery: DeliveryDto }> {
    const run = await this.idempotency.run(
      'deliveries:cancel',
      idempotencyKey,
      { deliveryId, actorRoles, reason },
      () => this.doCancel(deliveryId, actorRoles, actorUserId, reason),
    );
    return { status: run.status, delivery: run.response };
  }

  private async doCancel(
    deliveryId: string,
    actorRoles: readonly Role[],
    actorUserId: string,
    reason: string,
  ): Promise<DeliveryDto> {
    const fromStatuses = this.unionFromStatuses('cancelled', actorRoles);
    if (fromStatuses.length === 0) {
      throw new ConflictException({
        code: 'DELIVERY_INVALID_STATE',
        message: `Role(s) ${actorRoles.join(',')} cannot cancel a delivery.`,
      });
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ status: string; courier_id: string | null; order_id: string }>
      >`
        UPDATE deliveries SET status = 'cancelled'::text, cancelled_at = now(),
          cancelled_reason = ${reason}, cancelled_by = ${actorUserId}::uuid
        WHERE id = ${deliveryId}::uuid AND status = ANY(${fromStatuses}::text[])
        RETURNING status, courier_id, order_id
      `;
      if (!rows[0]) return null;
      const delivery = rows[0];
      if (delivery.courier_id) {
        await this.couriers.release(tx, delivery.courier_id); // courier SECOND
      }
      await tx.outbox.create({
        data: {
          aggregate: 'delivery',
          aggregateId: deliveryId,
          eventType: 'delivery.cancelled',
          payload: { deliveryId, orderId: delivery.order_id },
        },
      });
      return { orderId: delivery.order_id };
    });

    if (!outcome) {
      const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
      if (!delivery) {
        throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found.' });
      }
      if (delivery.status === 'cancelled') {
        throw new ConflictException({
          code: 'DELIVERY_ALREADY_CANCELLED',
          message: 'This delivery is already cancelled.',
        });
      }
      if (delivery.status === 'delivered') {
        throw new ConflictException({
          code: 'DELIVERY_ALREADY_DELIVERED',
          message: 'Cannot cancel a delivered delivery.',
        });
      }
      throw new ConflictException({
        code: 'DELIVERY_INVALID_STATE',
        message: `Cannot cancel from status ${delivery.status}.`,
      });
    }
    this.events.emit('delivery.cancelled', { orderId: outcome.orderId });
    return this.getByIdOrThrow(deliveryId);
  }

  async reportFailed(
    deliveryId: string,
    actorRoles: readonly Role[],
    actorUserId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<{ status: 'created' | 'replayed'; delivery: DeliveryDto }> {
    const run = await this.idempotency.run(
      'deliveries:failed',
      idempotencyKey,
      { deliveryId, actorRoles, reason },
      () => this.doReportFailed(deliveryId, actorRoles, actorUserId, reason),
    );
    return { status: run.status, delivery: run.response };
  }

  private async doReportFailed(
    deliveryId: string,
    actorRoles: readonly Role[],
    actorUserId: string,
    reason: string,
  ): Promise<DeliveryDto> {
    const fromStatuses = this.unionFromStatuses('failed', actorRoles);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ courier_id: string | null; order_id: string }>>`
        UPDATE deliveries SET status = 'failed'::text, failed_at = now(), failed_reason = ${reason}
        WHERE id = ${deliveryId}::uuid AND status = ANY(${fromStatuses}::text[])
        RETURNING courier_id, order_id
      `;
      if (!rows[0]) return null;
      if (rows[0].courier_id) await this.couriers.release(tx, rows[0].courier_id);
      await tx.outbox.create({
        data: {
          aggregate: 'delivery',
          aggregateId: deliveryId,
          eventType: 'delivery.failed',
          payload: { deliveryId, orderId: rows[0].order_id, reason, actorUserId },
        },
      });
      return { orderId: rows[0].order_id };
    });

    if (!outcome) {
      const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
      if (!delivery) {
        throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found.' });
      }
      throw new ConflictException({
        code: 'DELIVERY_INVALID_STATE',
        message: `Cannot report failed from status ${delivery.status}.`,
      });
    }
    this.events.emit('delivery.failed', { orderId: outcome.orderId });
    return this.getByIdOrThrow(deliveryId);
  }

  // ── reads / ownership (docs/19 §21, docs/25 §35) ──────────────────────────

  async getByIdOrThrow(id: string): Promise<DeliveryDto> {
    const d = await this.prisma.delivery.findUnique({ where: { id } });
    if (!d)
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: `Delivery ${id} not found.`,
      });
    return this.toDto(d);
  }

  async getByOrderIdOrThrow(orderId: string): Promise<DeliveryDto> {
    const d = await this.prisma.delivery.findUnique({ where: { orderId } });
    if (!d)
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: `No delivery for order ${orderId}.`,
      });
    return this.toDto(d);
  }

  /** For `@RequireOwnership` — the CUSTOMER who owns the order behind this delivery. */
  async getOwnerUserId(deliveryId: string): Promise<string> {
    const d = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { orderId: true },
    });
    if (!d)
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: `Delivery ${deliveryId} not found.`,
      });
    return this.orderAmount.getOwnerUserId(d.orderId);
  }

  /** For `@RequireOwnership` — the COURIER assigned to this delivery (pickup/deliver routes). */
  async getAssignedCourierUserId(deliveryId: string): Promise<string> {
    const d = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { courierId: true },
    });
    if (!d || !d.courierId) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_ASSIGNED',
        message: 'No courier assigned yet.',
      });
    }
    return d.courierId;
  }

  /** `DeliveryTrackingPort` (docs/25 §31, §33) — for `realtime`'s `order:{id}` room authorization. Never throws. */
  async getAssignedCourierUserIdByOrder(orderId: string): Promise<string | null> {
    const d = await this.prisma.delivery.findUnique({
      where: { orderId },
      select: { courierId: true },
    });
    return d?.courierId ?? null;
  }

  /** For `@RequireOwnership` on accept/reject — the courier the CURRENT active offer for this delivery was sent to. */
  async getActiveOfferCourierUserId(deliveryId: string): Promise<string> {
    const o = await this.prisma.deliveryOffer.findFirst({
      where: { deliveryId, status: 'offered' },
      orderBy: { offeredAt: 'desc' },
      select: { courierId: true },
    });
    if (!o) {
      throw new NotFoundException({
        code: 'OFFER_NOT_FOUND',
        message: `No active offer for delivery ${deliveryId}.`,
      });
    }
    return o.courierId;
  }

  async listOffersForCourier(courierId: string): Promise<DeliveryOfferDto[]> {
    const rows = await this.prisma.deliveryOffer.findMany({
      where: { courierId, status: 'offered' },
      orderBy: { offeredAt: 'desc' },
    });
    return rows.map((o) => ({
      id: o.id,
      deliveryId: o.deliveryId,
      status: o.status,
      offeredAt: o.offeredAt.toISOString(),
      expiresAt: o.expiresAt.toISOString(),
    }));
  }

  async listActiveForCourier(courierId: string): Promise<DeliveryDto[]> {
    const rows = await this.prisma.delivery.findMany({
      where: {
        courierId,
        status: {
          in: [
            'courier_assigned',
            'courier_accepted',
            'pickup_in_progress',
            'picked_up',
            'on_the_way',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((d) => this.toDto(d));
  }

  private toDto(d: DeliveryRow): DeliveryDto {
    return {
      id: d.id,
      orderId: d.orderId,
      courierId: d.courierId,
      status: d.status as DeliveryStatus,
      courierFee: toMoneyJson(d.courierFeeMinor, d.currency),
      estimatedDistanceM: d.estimatedDistanceM !== null ? Number(d.estimatedDistanceM) : null,
      dispatchAttempts: d.dispatchAttempts,
      assignedAt: d.assignedAt ? d.assignedAt.toISOString() : null,
      acceptedAt: d.acceptedAt ? d.acceptedAt.toISOString() : null,
      pickedUpAt: d.pickedUpAt ? d.pickedUpAt.toISOString() : null,
      onTheWayAt: d.onTheWayAt ? d.onTheWayAt.toISOString() : null,
      deliveredAt: d.deliveredAt ? d.deliveredAt.toISOString() : null,
      cancelledAt: d.cancelledAt ? d.cancelledAt.toISOString() : null,
      cancelledReason: d.cancelledReason,
      failedAt: d.failedAt ? d.failedAt.toISOString() : null,
      failedReason: d.failedReason,
    };
  }
}
