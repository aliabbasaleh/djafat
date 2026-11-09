import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
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
import { AppConfigService } from '../../common/config/config.service';
import { decryptAtRest, encryptAtRest } from '../../common/crypto/at-rest';
import { toMoneyJson } from '../../common/money/money.mapper';
import { ORDER_AMOUNT_PORT } from '../../common/ports/order-amount.port';
import {
  canCourierActOnDelivery,
  isStaffTierFor,
  resolveDeliveryAccess,
  type AccessActor,
  type OrderAccessGrant,
} from '../../common/authz/order-access';
import { LedgerService } from '../ledger/ledger.service';
import { PlatformService } from '../platform/platform.service';
import { CouriersService } from '../couriers/couriers.service';
import { UsersService } from '../users/users.service';
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
  /**
   * Human-readable "where to go" (Bloc 11, docs/34 §offer-context) — only
   * populated by the courier-facing listings below (`listOffersForCourier`/
   * `listActiveForCourier`); every other caller of `toDto` leaves it
   * `undefined` rather than pay for a port call nobody reads the result of.
   */
  context?: JsonSafeDeliveryContext;
}

/**
 * `OrderDeliveryContext.courierFee` is a raw `Money` (bigint `.minor`) —
 * correct for the internal ledger math every other caller of
 * `getDeliveryContext` does with it, but Fastify's JSON serializer throws
 * ("Do not know how to serialize a BigInt") the moment one reaches an HTTP
 * response unconverted. The courier-facing listings below are the only
 * callers that put `context` on the wire, so the fix belongs here, not on
 * the port's own type.
 */
type JsonSafeDeliveryContext = Omit<OrderDeliveryContext, 'courierFee'> & { courierFee: MoneyJson };

function toJsonSafeContext(context: OrderDeliveryContext): JsonSafeDeliveryContext {
  return {
    ...context,
    courierFee: toMoneyJson(context.courierFee.minor, context.courierFee.currency),
  };
}

/**
 * A concurrent writer lost to one of migration 0024's partial unique indexes
 * (`deliveries_one_active_per_courier_idx`,
 * `couriers_one_active_delivery_idx`,
 * `delivery_offers_one_offered_per_delivery_idx`). Prisma surfaces every
 * PostgreSQL 23505 as P2002 — a predictable business condition here, never an
 * internal error (docs/25 §B6.1-1, §B6.1-10).
 */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * A delivery code is only useful between leaving the restaurant and handing the
 * order over — a couple of hours is generous for N'Djamena. Past that it must
 * be re-issued by ops rather than stay valid forever (docs/25 §B6.1-7).
 */
const DELIVERY_CODE_TTL_MS = 4 * 60 * 60 * 1000;
/** 4 digits = 10 000 possibilities; five misses ends the guessing game. */
const MAX_PROOF_ATTEMPTS = 5;

export interface DeliveryOfferDto {
  id: string;
  deliveryId: string;
  status: string;
  offeredAt: string;
  expiresAt: string;
  context: JsonSafeDeliveryContext;
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
    private readonly users: UsersService,
    @Inject(ORDER_AMOUNT_PORT) private readonly orderAmount: OrderAmountPort,
    private readonly config: AppConfigService,
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

    // Who is NOT a candidate for this wave:
    //   - a live `offered` row — they are deciding right now;
    //   - `rejected` — they said no, never re-ask for this delivery;
    //   - `expired` within the last offer window — a timeout is not a
    //     refusal, so they become eligible again, but only after one
    //     cooldown, so a courier who ignored an offer is not re-pinged
    //     immediately while someone else could take it.
    // Excluding EVERY courier ever offered (what this did before the pilot,
    // docs/36) shrank the pool to zero as retries accumulated and
    // permanently stalled dispatch once every courier had timed out once —
    // with a single online courier, after the very first offer.
    // Mirrored 1:1 in `apps/worker`'s `dispatch.processor.ts`.
    const cooldownSince = new Date(Date.now() - offerTimeoutSeconds * 1_000);
    const allOffers = await this.prisma.deliveryOffer.findMany({
      where: { deliveryId },
      select: { courierId: true, status: true, respondedAt: true },
    });
    const excludeIds = allOffers
      .filter(
        (o) =>
          o.status === 'offered' ||
          o.status === 'rejected' ||
          (o.status === 'expired' &&
            o.respondedAt !== null &&
            o.respondedAt.getTime() > cooldownSince.getTime()),
      )
      .map((o) => o.courierId);

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

    const outcome = await this.runAssignmentTransaction(
      deliveryId,
      candidates,
      radius,
      offerTimeoutSeconds,
    );

    if (outcome) {
      this.events.emit('courier.offer.new', { deliveryId, ...outcome });
      this.logger.log(`delivery ${deliveryId} offered to courier ${outcome.courierId}`);
    }
  }

  /**
   * The assignment transaction proper. Split out of `runDispatchWave` so the
   * unique-violation translation below has one obvious home.
   *
   * Since Bloc 6.1 the database itself enforces "one courier = at most one
   * active delivery" and "at most one offered offer per delivery" (migration
   * 0024's partial unique indexes). The transactional locking above still wins
   * every race it sees — but a second writer this process does not share locks
   * with (the worker's dispatch job, an ops SQL fix) can now be rejected by the
   * index instead. Losing that way is a normal business outcome — "somebody
   * else got this courier" — so it resolves to "no offer made this wave" and
   * the worker retries, never a raw 500 (mandate §1, §10).
   */
  private async runAssignmentTransaction(
    deliveryId: string,
    candidates: readonly { courierId: string }[],
    radius: number,
    offerTimeoutSeconds: number,
  ): Promise<{ courierId: string; offerId: string } | null> {
    try {
      return await this.assignInTransaction(deliveryId, candidates, radius, offerTimeoutSeconds);
    } catch (err) {
      if (isUniqueViolation(err)) {
        this.logger.warn(
          `delivery ${deliveryId}: assignment lost to a concurrent writer (DB invariant held)`,
        );
        return null;
      }
      throw err;
    }
  }

  private async assignInTransaction(
    deliveryId: string,
    candidates: readonly { courierId: string }[],
    radius: number,
    offerTimeoutSeconds: number,
  ): Promise<{ courierId: string; offerId: string } | null> {
    return this.prisma.$transaction(async (tx) => {
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
    // `POST /deliveries/:id/pickup` collapses TWO machine hops into one call,
    // because this bloc exposes no separate "arrived at restaurant" endpoint
    // (docs/25 §45's minimal route list): `courier_accepted ->
    // pickup_in_progress -> picked_up`. Bloc 6.1 fixed a real break here
    // (docs/25 §B6.1-5): only the second hop's `from` set was used, so the
    // guard was `status = 'pickup_in_progress'` — a status NOTHING in the
    // codebase ever assigned. Every pickup therefore failed with
    // DELIVERY_INVALID_STATE and the lifecycle was dead after acceptance.
    // Both hops are still DERIVED from the machine, never hand-listed.
    const fromStatuses = [
      ...new Set([
        ...fromStatusesFor('pickup_in_progress', { actorRole: 'courier' }),
        ...fromStatusesFor('picked_up', { actorRole: 'courier' }),
      ]),
    ];
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

    // Issue the customer's delivery code NOW (docs/25 §B6.1-7). Bloc 6 defined
    // `issueDeliveryCode` but never called it from ANY production path, so no
    // `delivery_proofs` row ever existed and `confirmDelivered` could only ever
    // answer INVALID_PROOF — the lifecycle could not be completed at all.
    // Pickup is the right moment: the code only has to exist between leaving
    // the restaurant and handing the order over.
    const rawCode = await this.issueDeliveryCode(deliveryId, courierId);
    // The code goes to the CUSTOMER and never to the courier — a courier who
    // knew it could self-confirm a delivery they never made. So it travels on
    // an in-process event only (consumed by `notifications`), never in this
    // method's return value, never in the outbox payload (which is persisted),
    // and never in a log line.
    this.events.emit('delivery.code_issued', {
      orderId: delivery.orderId,
      customerId: (await this.orderAmount.getDeliveryContext(delivery.orderId)).customerId,
      code: rawCode,
    });

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

  /**
   * Generates a 4-digit delivery code (docs/09 A.5) at pickup time; returns the
   * RAW code once (never stored raw, never logged, never returned to the
   * courier). Stored hashed with an expiry, and single-use via `consumedAt`.
   *
   * `createdBy` takes the real actor's uuid: the column is
   * `uuid NOT NULL REFERENCES users(id)` and Bloc 6 wrote the literal string
   * `'system'` into it — a guaranteed `invalid input syntax for type uuid`
   * (raw 500) against a real PostgreSQL (docs/25 §B6.1-7).
   */
  async issueDeliveryCode(deliveryId: string, issuedByUserId: string): Promise<string> {
    // FEAT-012: an order taken on the phone already has its code — the operator
    // gave it to the customer during the call (no app to read it from).
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { orderId: true },
    });
    const preset = delivery
      ? await this.prisma.deliveryCodePreset.findUnique({ where: { orderId: delivery.orderId } })
      : null;
    const code = preset
      ? decryptAtRest(preset.reference, this.deliveryCodeKey(), 'DELIVERY_CODE_ENCRYPTION_KEY')
      : (randomBytes(2).readUInt16BE(0) % 10000).toString().padStart(4, '0');
    const valueHash = this.hashProof(code);
    await this.prisma.deliveryProof.create({
      data: {
        deliveryId,
        type: 'delivery_code',
        valueHash,
        createdBy: issuedByUserId,
        expiresAt: new Date(Date.now() + DELIVERY_CODE_TTL_MS),
        // Encrypted (AES-256-GCM), never plaintext: `value_hash` stays the ONE
        // verification truth, this is only so the owning CUSTOMER can read
        // their own code back (`getDeliveryCodeFor`). The pilot found that
        // without it the code reached nobody — it was emitted on an
        // in-process event with zero listeners, so a real customer could
        // never learn the code a real courier has to ask them for, and the
        // delivery lifecycle could not be completed at all (docs/36).
        reference: encryptAtRest(code, this.deliveryCodeKey(), 'DELIVERY_CODE_ENCRYPTION_KEY'),
      },
    });
    return code;
  }

  /**
   * FEAT-012 — choose the delivery code of an order taken on the phone, now,
   * so the operator can give it to the customer during the call. Idempotent:
   * the same order always gets the same code back. Used at pickup by
   * `issueDeliveryCode`; verification is unchanged (hash, single use, TTL).
   * Only the operator flow calls this — never a courier-facing route.
   */
  async presetDeliveryCode(orderId: string, operatorUserId: string): Promise<string> {
    const existing = await this.prisma.deliveryCodePreset.findUnique({ where: { orderId } });
    if (existing) {
      return decryptAtRest(
        existing.reference,
        this.deliveryCodeKey(),
        'DELIVERY_CODE_ENCRYPTION_KEY',
      );
    }
    const code = (randomBytes(2).readUInt16BE(0) % 10000).toString().padStart(4, '0');
    try {
      await this.prisma.deliveryCodePreset.create({
        data: {
          orderId,
          valueHash: this.hashProof(code),
          reference: encryptAtRest(code, this.deliveryCodeKey(), 'DELIVERY_CODE_ENCRYPTION_KEY'),
          createdBy: operatorUserId,
        },
      });
      return code;
    } catch (err) {
      // a concurrent call for the same order won the insert: answer its code
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.presetDeliveryCode(orderId, operatorUserId);
      }
      throw err;
    }
  }

  private deliveryCodeKey(): string {
    return this.config.get('DELIVERY_CODE_ENCRYPTION_KEY');
  }

  /**
   * The owning CUSTOMER reads their own live delivery code (pilot fix,
   * docs/36). Deliberately NOT available to:
   *   - the assigned courier — one who knew the code could self-confirm a
   *     delivery they never made, which is the entire point of the code;
   *   - the restaurant;
   *   - staff-tier — no ops flow asks for it today, and a compromised
   *     support account that could read codes is a fraud path that costs
   *     nothing to keep closed (least privilege; revisit only with a real
   *     requirement).
   * Every refusal is the SAME 404 as an absent delivery — never distinguish
   * "not yours" from "does not exist" (BUG-10.1.x discipline).
   */
  async getDeliveryCodeFor(
    actor: AccessActor,
    deliveryId: string,
  ): Promise<{ code: string; expiresAt: string }> {
    const notFound = new NotFoundException({
      code: 'DELIVERY_NOT_FOUND',
      message: `Delivery ${deliveryId} not found.`,
    });

    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) throw notFound;

    const context = await this.orderAmount.getDeliveryContext(delivery.orderId);
    if (context.customerId !== actor.userId) throw notFound;

    const proof = await this.prisma.deliveryProof.findFirst({
      where: { deliveryId, type: 'delivery_code' },
      orderBy: { createdAt: 'desc' },
    });
    // No code yet (the courier has not picked up), already consumed, or past
    // its TTL — all "there is nothing for you to show", same 404.
    if (!proof || proof.consumedAt !== null) throw notFound;
    if (proof.expiresAt && proof.expiresAt.getTime() <= Date.now()) throw notFound;
    if (!proof.reference) {
      // Issued before this column was written (or by a path that skipped it):
      // the raw code is unrecoverable by design, so say so honestly instead
      // of inventing one — ops re-issues via a fresh pickup/`/code` cycle.
      throw new ConflictException({
        code: 'VALIDATION_ERROR',
        message: 'This delivery code predates code retrieval and must be re-issued.',
      });
    }

    return {
      code: decryptAtRest(proof.reference, this.deliveryCodeKey(), 'DELIVERY_CODE_ENCRYPTION_KEY'),
      expiresAt: (proof.expiresAt ?? new Date(Date.now() + DELIVERY_CODE_TTL_MS)).toISOString(),
    };
  }

  private hashProof(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  /**
   * Constant-time comparison (docs/19 discipline): a plain `===` on the hex
   * digest leaks position-of-first-difference through timing. Both operands are
   * fixed-length SHA-256 hex, so the length guard never short-circuits in
   * practice — it only satisfies `timingSafeEqual`'s precondition.
   */
  private proofMatches(storedHash: string, candidate: string): boolean {
    const a = Buffer.from(storedHash, 'utf8');
    const b = Buffer.from(this.hashProof(candidate), 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
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
    // ── 1. Authorization and replay, BEFORE touching the proof ──────────────
    // Bloc 6 verified the code first, which had two consequences (docs/25
    // §B6.1-7): a courier this delivery was never assigned to could probe codes
    // on it and — once Bloc 6.1 added the attempt counter — burn a stranger's
    // rate limit, locking the real courier out of their own delivery; and an
    // idempotent replay of a completed delivery raced the single-use guard,
    // answering 200 or 409 depending on timing. Resolving identity and
    // completion first makes both deterministic.
    const current = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!current || current.courierId !== courierId) {
      // Same 404 either way — never reveal that the delivery exists to a
      // courier it does not belong to (docs/25 §46 IDOR).
      throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found.' });
    }
    if (current.status === 'delivered') {
      return this.toDto(current); // idempotent replay — never re-presents the code
    }

    // ── 2. Proof verification, deliberately strict ──────────────────────────
    // A 4-digit code is only 10 000 possibilities — without a cap, the assigned
    // courier could simply enumerate it. Bloc 6 had none of the four guards.
    const proof = await this.prisma.deliveryProof.findFirst({
      where: { deliveryId, type: 'delivery_code' },
      orderBy: { createdAt: 'desc' },
    });
    if (!proof) {
      throw new ConflictException({
        code: 'INVALID_PROOF',
        message: 'No delivery code has been issued for this delivery yet.',
      });
    }
    if (proof.failedAttempts >= MAX_PROOF_ATTEMPTS) {
      throw new HttpException(
        {
          code: 'PROOF_RATE_LIMITED',
          message: 'Too many incorrect delivery codes. Contact support to complete this delivery.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // Truthiness, not `!== null`: a `Date` is always truthy, and this also
    // treats a legacy row whose column predates migration 0024 as un-consumed
    // rather than mistaking `undefined` for "already used".
    if (proof.consumedAt) {
      // Someone consumed it between the read above and here. If that someone
      // is this same courier's own confirmation of this same delivery — two
      // requests in flight at once under distinct idempotency keys — then this
      // is a replay, not a reuse: the `delivered` check above read the row
      // before the winner committed. Re-read rather than answer on stale
      // state, so the outcome never depends on which call read the proof
      // first (docs/25 §B6.1-10).
      const fresh = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
      if (fresh && fresh.courierId === courierId && fresh.status === 'delivered') {
        return this.toDto(fresh);
      }
      throw new ConflictException({
        code: 'INVALID_PROOF',
        message: 'This delivery code has already been used.',
      });
    }
    if (proof.expiresAt && proof.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException({
        code: 'INVALID_PROOF',
        message: 'This delivery code has expired.',
      });
    }
    if (!this.proofMatches(proof.valueHash, proofCode)) {
      // Count the miss BEFORE answering, so a caller that hangs up early still
      // burns the attempt. Never logs or echoes the submitted code.
      await this.prisma.deliveryProof.update({
        where: { id: proof.id },
        data: { failedAttempts: { increment: 1 } },
      });
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

      // Single use (docs/25 §B6.1-7): burn the code in the SAME transaction
      // that marks the delivery delivered, so a replay can never re-present it.
      // Guarded on `consumed_at IS NULL` so two concurrent confirmations cannot
      // both consume it — the delivery-row guard above already serialises them,
      // this is the belt to that braces.
      await tx.deliveryProof.updateMany({
        where: { id: proof.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });

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
    actor: AccessActor,
    deliveryId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<{ status: 'created' | 'replayed'; delivery: DeliveryDto }> {
    const run = await this.idempotency.run(
      'deliveries:cancel',
      idempotencyKey,
      { deliveryId, actorRoles: actor.roles, reason },
      () => this.doCancel(actor, deliveryId, reason),
    );
    return { status: run.status, delivery: run.response };
  }

  /**
   * Tenant-scoped cancellation (BUG-10.1.3). This route used
   * `@RequireOwnership(..., getOwnerUserId, 'deliveries:write')`, and the
   * override bypassed ownership for every holder of `deliveries:write` —
   * `courier` included. A courier-only actor was still stopped downstream
   * because the state machine lists `courier` on NO `-> cancelled` transition,
   * which is why this looked non-exploitable. It was not: `unionFromStatuses`
   * UNIONS the from-statuses of ALL the actor's roles, and every real courier
   * also holds `customer` (granted automatically at account creation,
   * `users.service.ts`). For a `courier + customer` actor the union therefore
   * came back non-empty via the customer branch, and the UPDATE filtered on
   * id+status only — so they could cancel a STRANGER's delivery.
   *
   * The authority is now explicit and resolved here: staff-tier with
   * `deliveries:write`, or the customer who actually owns the order behind this
   * delivery. The state machine still decides WHICH statuses each role may
   * cancel from.
   *
   * Two layers, exactly like `reportFailed`: the explicit decision below gives
   * a clear 403, and the UPDATE additionally pins the write to the ORDER the
   * authorization was granted against (`order_id = <authorized order>`). The
   * explicit check is read-then-act; binding the write to that same order makes
   * the authorization and the transition one consistent unit, so a stale or
   * re-pointed row cannot be cancelled on the strength of an authorization that
   * no longer describes it.
   */
  private async doCancel(
    actor: AccessActor,
    deliveryId: string,
    reason: string,
  ): Promise<DeliveryDto> {
    const isStaff = isStaffTierFor(actor, 'deliveries:write');
    let authorizedOrderId: string | null = null;

    if (!isStaff) {
      // Throws NotFound itself if the delivery (or its order) is unknown.
      const { orderId, ownerUserId } = await this.resolveCancelOwnership(deliveryId);
      if (ownerUserId !== actor.userId) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Only the customer who owns this order may cancel its delivery.',
        });
      }
      authorizedOrderId = orderId;
    }

    const fromStatuses = this.unionFromStatuses('cancelled', actor.roles);
    if (fromStatuses.length === 0) {
      throw new ConflictException({
        code: 'DELIVERY_INVALID_STATE',
        message: `Role(s) ${actor.roles.join(',')} cannot cancel a delivery.`,
      });
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ status: string; courier_id: string | null; order_id: string }>
      >`
        UPDATE deliveries SET status = 'cancelled'::text, cancelled_at = now(),
          cancelled_reason = ${reason}, cancelled_by = ${actor.userId}::uuid
        WHERE id = ${deliveryId}::uuid AND status = ANY(${fromStatuses}::text[])
          AND (${isStaff}::boolean OR order_id = ${authorizedOrderId}::uuid)
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
    actor: AccessActor,
    deliveryId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<{ status: 'created' | 'replayed'; delivery: DeliveryDto }> {
    const run = await this.idempotency.run(
      'deliveries:failed',
      idempotencyKey,
      { deliveryId, actorRoles: actor.roles, reason },
      () => this.doReportFailed(actor, deliveryId, reason),
    );
    return { status: run.status, delivery: run.response };
  }

  /**
   * Tenant-scoped failure report (BUG-10.1-AUTH). Was
   * `@RequireOwnership(..., getAssignedCourierUserId, 'deliveries:write')`:
   * the override bypassed the assigned-courier resolver entirely for every
   * holder of `deliveries:write`, which the seed grants to `courier` — and the
   * state machine DOES allow `courier` on `pickup_in_progress|picked_up|
   * on_the_way -> failed`, while this UPDATE filtered on id+status only. Any
   * courier could therefore fail any other courier's in-flight delivery.
   *
   * Two layers, deliberately: an EXPLICIT service-level decision (so a
   * non-assigned courier gets a clear 403 instead of a silent no-op), AND the
   * `courier_id` predicate inside the UPDATE itself — the explicit check is
   * read-then-act, and assignment can change under it (docs/25 §12 assigns
   * under `FOR UPDATE`). Only the atomic predicate makes the decision and the
   * transition consistent.
   */
  private async doReportFailed(
    actor: AccessActor,
    deliveryId: string,
    reason: string,
  ): Promise<DeliveryDto> {
    const actorRoles = actor.roles;
    const isStaff = isStaffTierFor(actor, 'deliveries:write');

    if (!isStaff) {
      const assigned = await this.prisma.delivery.findUnique({
        where: { id: deliveryId },
        select: { courierId: true },
      });
      if (!assigned) {
        throw new NotFoundException({
          code: 'DELIVERY_NOT_FOUND',
          message: `Delivery ${deliveryId} not found.`,
        });
      }
      if (!canCourierActOnDelivery(actor, assigned.courierId)) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Only the courier currently assigned to this delivery may report it failed.',
        });
      }
    }

    const fromStatuses = this.unionFromStatuses('failed', actorRoles);
    const outcome = await this.prisma.$transaction(async (tx) => {
      // Staff-tier may act regardless of assignment (force-failing a stuck
      // delivery); a courier is pinned to the row they are assigned to AT
      // WRITE TIME, so a reassignment racing the check above cannot slip in.
      // Both predicates are PLAIN bound parameters on purpose: interpolating a
      // `Prisma.sql` fragment into a tagged `$queryRaw` template is not a
      // supported composition and would be bound as a value instead of spliced
      // as SQL.
      const rows = await tx.$queryRaw<Array<{ courier_id: string | null; order_id: string }>>`
        UPDATE deliveries SET status = 'failed'::text, failed_at = now(), failed_reason = ${reason}
        WHERE id = ${deliveryId}::uuid AND status = ANY(${fromStatuses}::text[])
          AND (${isStaff}::boolean OR courier_id = ${actor.userId}::uuid)
        RETURNING courier_id, order_id
      `;
      if (!rows[0]) return null;
      if (rows[0].courier_id) await this.couriers.release(tx, rows[0].courier_id);
      await tx.outbox.create({
        data: {
          aggregate: 'delivery',
          aggregateId: deliveryId,
          eventType: 'delivery.failed',
          payload: { deliveryId, orderId: rows[0].order_id, reason, actorUserId: actor.userId },
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

  /**
   * Tenant-scoped read (BUG-10.1-AUTH, `common/authz/order-access.ts`).
   * Replaces `@RequireOwnership(..., 'deliveries:read')`, whose override was a
   * TOTAL ownership bypass for every holder of `deliveries:read` — a
   * permission the seed grants to `courier`, so any courier could read any
   * other courier's delivery (fee, status timeline, order linkage) from its
   * UUID alone.
   *
   * The order's customer/restaurant come from `OrderAmountPort` (already
   * injected) — `deliveries` never reads the `orders` table itself (docs/25 §6).
   */
  async getByIdFor(actor: AccessActor, id: string): Promise<DeliveryDto> {
    const d = await this.prisma.delivery.findUnique({ where: { id } });
    if (!d) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: `Delivery ${id} not found.`,
      });
    }

    // Cheapest branch first, and expressed as its own predicate rather than
    // calling the full rule with placeholder facts — a fake `customerId` would
    // be one typo away from matching a real actor.
    let grant: OrderAccessGrant | null = canCourierActOnDelivery(actor, d.courierId)
      ? 'courier'
      : null;

    if (!grant) {
      const context = await this.orderAmount.getDeliveryContext(d.orderId);
      const isMember =
        actor.permissions.includes('deliveries:read') &&
        (await this.users.isMemberOfRestaurant(actor.userId, context.restaurantId));
      grant = resolveDeliveryAccess(
        actor,
        {
          assignedCourierUserId: d.courierId,
          customerId: context.customerId,
          isMemberOfOrderRestaurant: isMember,
        },
        'deliveries:read',
      );
    }

    // Same 404 as an unknown id — never distinguish "not yours" from "absent".
    if (!grant) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: `Delivery ${id} not found.`,
      });
    }
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

  /**
   * The CUSTOMER who owns the order behind this delivery. No longer wired to a
   * guard (BUG-10.1.3 moved that decision into `cancel`), but kept as the
   * module's public answer to "whose order is this delivery for?" — it has its
   * own contract tests, and `doCancel` reads the same fact through
   * `resolveCancelOwnership`.
   */
  async getOwnerUserId(deliveryId: string): Promise<string> {
    const { ownerUserId } = await this.resolveCancelOwnership(deliveryId);
    return ownerUserId;
  }

  /**
   * Resolves BOTH facts in one read (BUG-10.1.3): who owns the order, and WHICH
   * order it is. `doCancel` needs the order id too, to pin its UPDATE to the
   * same row the authorization was granted against.
   */
  private async resolveCancelOwnership(
    deliveryId: string,
  ): Promise<{ orderId: string; ownerUserId: string }> {
    const d = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { orderId: true },
    });
    if (!d)
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: `Delivery ${deliveryId} not found.`,
      });
    return { orderId: d.orderId, ownerUserId: await this.orderAmount.getOwnerUserId(d.orderId) };
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

  /**
   * A courier realistically holds at most one open offer at a time (`delivery_
   * offers_one_offered_per_delivery_idx` is per-delivery, but dispatch only
   * ever offers one active delivery to one courier at once in practice) — the
   * per-offer `getDeliveryContext` call below is never a real N+1 at scale,
   * same reasoning as every other per-row port call in this file (e.g.
   * `getByIdFor`).
   */
  async listOffersForCourier(courierId: string): Promise<DeliveryOfferDto[]> {
    const rows = await this.prisma.deliveryOffer.findMany({
      where: { courierId, status: 'offered' },
      orderBy: { offeredAt: 'desc' },
    });
    if (rows.length === 0) return [];

    // `DeliveryOffer` has no Prisma relation to `Delivery` (a plain FK
    // column, never modelled as one) — one extra query resolves the
    // `orderId`s `getDeliveryContext` needs, never a per-offer N+1 on top of
    // the per-offer context call already below.
    const deliveries = await this.prisma.delivery.findMany({
      where: { id: { in: rows.map((o) => o.deliveryId) } },
      select: { id: true, orderId: true },
    });
    const orderIdByDeliveryId = new Map(deliveries.map((d) => [d.id, d.orderId]));

    return Promise.all(
      rows.map(async (o) => {
        const orderId = orderIdByDeliveryId.get(o.deliveryId);
        if (!orderId) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: `Delivery ${o.deliveryId} not found for offer ${o.id}.`,
          });
        }
        return {
          id: o.id,
          deliveryId: o.deliveryId,
          status: o.status,
          offeredAt: o.offeredAt.toISOString(),
          expiresAt: o.expiresAt.toISOString(),
          context: toJsonSafeContext(await this.orderAmount.getDeliveryContext(orderId)),
        };
      }),
    );
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
    return Promise.all(
      rows.map(async (d) => ({
        ...this.toDto(d),
        context: toJsonSafeContext(await this.orderAmount.getDeliveryContext(d.orderId)),
      })),
    );
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
