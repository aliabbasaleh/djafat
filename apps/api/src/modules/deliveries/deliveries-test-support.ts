import { randomUUID, createHash } from 'node:crypto';
import { vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  DeliveryStatus,
  OrderAccrualBreakdown,
  OrderAmountPort,
  OrderDeliveryContext,
} from '@djafat/types';
import { DELIVERY_COURIER_HOLDING_STATUSES } from '@djafat/types';
import { assertBalanced, haversineDistanceMeters, money } from '@djafat/core';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaIdempotencyStore } from '../../common/idempotency/prisma-idempotency.store';
import type { LedgerService } from '../ledger/ledger.service';
import type { PlatformService } from '../platform/platform.service';
import { CouriersService } from '../couriers/couriers.service';
import type { UsersService } from '../users/users.service';
import { DeliveriesService } from './deliveries.service';

export const ORDER_ID = 'order-1';
export const RESTAURANT_ID = 'restaurant-1';
export const CUSTOMER_ID = 'customer-1';
export const PICKUP = { lat: 12.1348, lng: 15.0557 };
export const DROPOFF = { lat: 12.14, lng: 15.06 };

export interface DeliveryRow {
  id: string;
  orderId: string;
  courierId: string | null;
  status: string;
  currency: string;
  courierFeeMinor: bigint;
  estimatedDistanceM: number | null;
  dispatchAttempts: number;
  dispatchRadiusM: number | null;
  searchingSince: Date | null;
  assignedAt: Date | null;
  acceptedAt: Date | null;
  pickedUpAt: Date | null;
  onTheWayAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  cancelledReason: string | null;
  cancelledBy: string | null;
  failedAt: Date | null;
  failedReason: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
}
export interface OfferRow {
  id: string;
  deliveryId: string;
  courierId: string;
  status: string;
  offeredAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
}
export interface ProofRow {
  id: string;
  deliveryId: string;
  type: string;
  valueHash: string;
  reference: string | null;
  createdAt: Date;
  createdBy: string;
  consumedAt: Date | null;
  expiresAt: Date | null;
  failedAttempts: number;
}
export interface CourierRow {
  userId: string;
  status: string;
  activeDeliveryId: string | null;
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: Date | null;
}
export interface LedgerGroupRow {
  kind: string;
  idempotencyKey: string;
  currency: string;
  entries: Array<{ accountRef: string; direction: 'debit' | 'credit'; amount: { minor: bigint } }>;
}

/**
 * Real-concurrency harness for `deliveries`/`couriers`, same discipline as
 * `payments-test-support.ts` (Bloc 5) and `orders-checkout-race.spec.ts`
 * (Bloc 4, docs/23 §1.1): raw `FOR UPDATE` patterns acquire a genuine
 * per-row async mutex (a promise-chain queue), so a truly concurrent
 * `Promise.all([...])` against the REAL `DeliveriesService`/`CouriersService`
 * classes proves the assignment race (docs/25 §12-13) is actually closed —
 * not merely that calls happened to run one after another.
 */
export function makeDeliveriesRaceDb() {
  const deliveries: DeliveryRow[] = [];
  const offers: OfferRow[] = [];
  const proofs: ProofRow[] = [];
  const couriers: CourierRow[] = [];
  const ledgerGroups: LedgerGroupRow[] = [];
  const outboxEvents: Array<{
    aggregate: string;
    aggregateId: string;
    eventType: string;
    payload: unknown;
  }> = [];
  const idempotencyKeys = new Map<
    string,
    { fingerprint: string; response: unknown; status: 'reserved' | 'completed' }
  >();

  function rawText(strings: TemplateStringsArray): string {
    return strings.join('?');
  }

  // ── per-row lock queues (simulate `SELECT ... FOR UPDATE`) ───────────────
  const deliveryLockTail = new Map<string, Promise<void>>();
  const courierLockTail = new Map<string, Promise<void>>();
  async function acquireLock(tail: Map<string, Promise<void>>, key: string): Promise<() => void> {
    const previous = tail.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    tail.set(
      key,
      previous.then(() => mine),
    );
    await previous;
    return release;
  }

  // ── migration 0024's partial unique indexes, enforced for real ───────────
  // Same discipline as `carts.service.spec.ts`'s `carts_one_open_per_user`
  // (Bloc 4): a synchronous check-then-write inside this single-threaded fake
  // is atomic exactly as a PostgreSQL unique index is atomic, so a genuine
  // `Promise.all([...])` race hits the constraint truthfully instead of only
  // via a scripted one-shot P2002.

  /** A real Prisma error instance, so `isUniqueViolation`'s `instanceof` behaves as it would in production. */
  function uniqueViolation(index: string): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError(
      `Unique constraint failed on the constraint: \`${index}\``,
      { code: 'P2002', clientVersion: '6.2.1' },
    );
  }

  /** `couriers_one_active_delivery_idx` — two couriers may never point at one delivery. */
  function assertNoOtherCourierHolds(deliveryId: string, courierId: string): void {
    if (couriers.some((c) => c.userId !== courierId && c.activeDeliveryId === deliveryId)) {
      throw uniqueViolation('couriers_one_active_delivery_idx');
    }
  }

  /** `deliveries_one_active_per_courier_idx` — one courier may never hold two active deliveries. */
  function assertCourierFreeForDelivery(deliveryId: string, courierId: string): void {
    if (
      deliveries.some(
        (d) =>
          d.id !== deliveryId &&
          d.courierId === courierId &&
          DELIVERY_COURIER_HOLDING_STATUSES.includes(d.status as DeliveryStatus),
      )
    ) {
      throw uniqueViolation('deliveries_one_active_per_courier_idx');
    }
  }

  /** `delivery_offers_one_offered_per_delivery_idx` — one live offer per delivery. */
  function assertNoLiveOffer(deliveryId: string): void {
    if (offers.some((o) => o.deliveryId === deliveryId && o.status === 'offered')) {
      throw uniqueViolation('delivery_offers_one_offered_per_delivery_idx');
    }
  }

  function findEligible(
    excludeIds: string[],
    radiusMeters: number,
    pickup: { lat: number; lng: number },
  ): Array<{ user_id: string }> {
    return couriers
      .filter(
        (c) =>
          c.status === 'online' &&
          c.activeDeliveryId === null &&
          c.lastLat !== null &&
          c.lastLng !== null &&
          c.lastLocationAt !== null &&
          Date.now() - c.lastLocationAt.getTime() < 120_000 &&
          !excludeIds.includes(c.userId) &&
          haversineDistanceMeters(pickup, { lat: c.lastLat, lng: c.lastLng }) <= radiusMeters,
      )
      .sort(
        (a, b) =>
          haversineDistanceMeters(pickup, { lat: a.lastLat!, lng: a.lastLng! }) -
          haversineDistanceMeters(pickup, { lat: b.lastLat!, lng: b.lastLng! }),
      )
      .map((c) => ({ user_id: c.userId }));
  }

  const topLevelQueryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    await Promise.resolve();
    const text = rawText(strings);
    if (text.includes('idempotency_keys') && text.includes('SELECT')) {
      const [scope, key] = values as [string, string];
      const row = idempotencyKeys.get(`${scope}::${key}`);
      return row
        ? [{ fingerprint: row.fingerprint, response: row.response, status: row.status }]
        : [];
    }
    if (text.includes('FROM couriers') && text.includes('ST_DWithin')) {
      // values = [lng, lat, staleSeconds, excluded[], lng, lat, radiusMeters]
      // (pickup coords appear twice — two ST_MakePoint calls in the real query).
      const lng = values[0] as number;
      const lat = values[1] as number;
      const excluded = values[3] as string[];
      const radiusMeters = values[6] as number;
      return findEligible(excluded, radiusMeters, { lat, lng });
    }
    if (text.includes('FROM deliveries') && text.includes('ST_Y')) {
      // `runDispatchWave`'s pickup-coordinates lookup.
      const [deliveryId] = values as [string];
      const row = deliveries.find((d) => d.id === deliveryId);
      return row ? [{ lat: row.pickupLat, lng: row.pickupLng }] : [];
    }
    if (text.includes('ST_Distance') && !text.includes('FROM couriers')) {
      // `createIfMissing`'s pickup<->dropoff estimated distance.
      const [pLng, pLat, dLng, dLat] = values as [number, number, number, number];
      return [{ d: haversineDistanceMeters({ lat: pLat, lng: pLng }, { lat: dLat, lng: dLng }) }];
    }
    throw new Error(`Unhandled top-level $queryRaw: ${text}`);
  });

  function makeClient(
    txQueryRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>,
  ) {
    return {
      delivery: {
        findUnique: vi.fn((args: { where: { id?: string; orderId?: string } }) => {
          const row = args.where.id
            ? deliveries.find((d) => d.id === args.where.id)
            : deliveries.find((d) => d.orderId === args.where.orderId);
          return Promise.resolve(row ?? null);
        }),
        findMany: vi.fn((args: { where: { courierId?: string; status?: { in: string[] } } }) =>
          Promise.resolve(
            deliveries.filter(
              (d) =>
                (!args.where.courierId || d.courierId === args.where.courierId) &&
                (!args.where.status || args.where.status.in.includes(d.status)),
            ),
          ),
        ),
        create: vi.fn((args: { data: Record<string, unknown> }) => {
          const row: DeliveryRow = {
            id: randomUUID(),
            courierId: null,
            dispatchAttempts: 0,
            dispatchRadiusM: null,
            searchingSince: null,
            assignedAt: null,
            acceptedAt: null,
            pickedUpAt: null,
            onTheWayAt: null,
            deliveredAt: null,
            cancelledAt: null,
            cancelledReason: null,
            cancelledBy: null,
            failedAt: null,
            failedReason: null,
            estimatedDistanceM: null,
            pickupLat: null,
            pickupLng: null,
            dropoffLat: null,
            dropoffLng: null,
            ...args.data,
          } as unknown as DeliveryRow;
          deliveries.push(row);
          return Promise.resolve(row);
        }),
        update: vi.fn((args: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = deliveries.find((d) => d.id === args.where.id)!;
          // `deliveries_one_active_per_courier_idx`: check the row AS IT WOULD
          // BE after the write, since a status change alone can bring an
          // already-attached courier into the index's WHERE clause.
          const nextCourierId = (args.data['courierId'] ?? row.courierId) as string | null;
          const nextStatus = (args.data['status'] ?? row.status) as string;
          if (
            nextCourierId !== null &&
            DELIVERY_COURIER_HOLDING_STATUSES.includes(nextStatus as DeliveryStatus)
          ) {
            assertCourierFreeForDelivery(row.id, nextCourierId);
          }
          Object.assign(row, args.data);
          return Promise.resolve(row);
        }),
        updateMany: vi.fn(
          (args: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
            const row = deliveries.find(
              (d) =>
                d.id === args.where.id && (!args.where.status || d.status === args.where.status),
            );
            if (!row) return Promise.resolve({ count: 0 });
            Object.assign(row, args.data);
            return Promise.resolve({ count: 1 });
          },
        ),
      },
      deliveryOffer: {
        create: vi.fn(
          (args: {
            data: { deliveryId: string; courierId: string; status: string; expiresAt: Date };
          }) => {
            if (args.data.status === 'offered') assertNoLiveOffer(args.data.deliveryId);
            const row: OfferRow = {
              id: randomUUID(),
              respondedAt: null,
              offeredAt: new Date(),
              ...args.data,
            };
            offers.push(row);
            return Promise.resolve(row);
          },
        ),
        findFirst: vi.fn(
          (args: {
            where: { deliveryId: string; courierId?: string; status: string };
            orderBy?: unknown;
          }) => {
            const matches = offers.filter(
              (o) =>
                o.deliveryId === args.where.deliveryId &&
                (!args.where.courierId || o.courierId === args.where.courierId) &&
                o.status === args.where.status,
            );
            matches.sort((a, b) => b.offeredAt.getTime() - a.offeredAt.getTime());
            return Promise.resolve(matches[0] ?? null);
          },
        ),
        findUnique: vi.fn((args: { where: { id: string } }) =>
          Promise.resolve(offers.find((o) => o.id === args.where.id) ?? null),
        ),
        findMany: vi.fn(
          (args: { where: { deliveryId?: string; courierId?: string; status?: string } }) =>
            Promise.resolve(
              offers.filter(
                (o) =>
                  (!args.where.deliveryId || o.deliveryId === args.where.deliveryId) &&
                  (!args.where.courierId || o.courierId === args.where.courierId) &&
                  (!args.where.status || o.status === args.where.status),
              ),
            ),
        ),
        update: vi.fn((args: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = offers.find((o) => o.id === args.where.id)!;
          Object.assign(row, args.data);
          return Promise.resolve(row);
        }),
      },
      deliveryProof: {
        create: vi.fn(
          (args: {
            data: {
              deliveryId: string;
              type: string;
              valueHash: string;
              createdBy: string;
              expiresAt?: Date;
            };
          }) => {
            const row: ProofRow = {
              id: randomUUID(),
              reference: null,
              createdAt: new Date(),
              consumedAt: null,
              expiresAt: null,
              failedAttempts: 0,
              ...args.data,
            };
            proofs.push(row);
            return Promise.resolve(row);
          },
        ),
        findFirst: vi.fn((args: { where: { deliveryId: string; type: string } }) => {
          const matches = proofs.filter(
            (p) => p.deliveryId === args.where.deliveryId && p.type === args.where.type,
          );
          matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return Promise.resolve(matches[0] ?? null);
        }),
        update: vi.fn(
          (args: {
            where: { id: string };
            data: { failedAttempts?: { increment: number }; consumedAt?: Date };
          }) => {
            const row = proofs.find((p) => p.id === args.where.id)!;
            if (args.data.failedAttempts) {
              row.failedAttempts += args.data.failedAttempts.increment;
            }
            if (args.data.consumedAt !== undefined) row.consumedAt = args.data.consumedAt;
            return Promise.resolve(row);
          },
        ),
        updateMany: vi.fn(
          (args: {
            where: { id: string; consumedAt: Date | null };
            data: { consumedAt: Date };
          }) => {
            const row = proofs.find(
              (p) => p.id === args.where.id && p.consumedAt === args.where.consumedAt,
            );
            if (!row) return Promise.resolve({ count: 0 });
            row.consumedAt = args.data.consumedAt;
            return Promise.resolve({ count: 1 });
          },
        ),
      },
      outbox: {
        create: vi.fn((args: { data: Record<string, unknown> }) => {
          outboxEvents.push(args.data as never);
          return Promise.resolve(undefined);
        }),
      },
      courier: {
        upsert: vi.fn(
          (args: { where: { userId: string }; create: { userId: string; status: string } }) => {
            let row = couriers.find((c) => c.userId === args.where.userId);
            if (!row) {
              row = {
                userId: args.create.userId,
                status: args.create.status,
                activeDeliveryId: null,
                lastLat: null,
                lastLng: null,
                lastLocationAt: null,
              };
              couriers.push(row);
            }
            return Promise.resolve(row);
          },
        ),
        findUnique: vi.fn((args: { where: { userId: string } }) =>
          Promise.resolve(couriers.find((c) => c.userId === args.where.userId) ?? null),
        ),
        findUniqueOrThrow: vi.fn((args: { where: { userId: string } }) => {
          const row = couriers.find((c) => c.userId === args.where.userId);
          if (!row) throw new Error(`courier ${args.where.userId} not found`);
          return Promise.resolve(row);
        }),
        update: vi.fn((args: { where: { userId: string }; data: Record<string, unknown> }) => {
          const row = couriers.find((c) => c.userId === args.where.userId)!;
          Object.assign(row, args.data);
          return Promise.resolve(row);
        }),
      },
      $queryRaw: txQueryRaw,
      // `couriers.lockAndClaim`/`release` call `tx.$executeRaw` (no RETURNING
      // clause) for the exact same UPDATE patterns `txQueryRaw` already
      // handles below — same function serves both roles inside a transaction.
      $executeRaw: txQueryRaw,
    };
  }

  const baseClient = makeClient(topLevelQueryRaw);

  const store = {
    ...baseClient,
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      await Promise.resolve();
      const text = rawText(strings);
      if (text.includes('INSERT INTO idempotency_keys')) {
        const [scope, key, fingerprint] = values as [string, string, string];
        const id = `${scope}::${key}`;
        if (idempotencyKeys.has(id)) return 0;
        idempotencyKeys.set(id, { fingerprint, response: null, status: 'reserved' });
        return 1;
      }
      if (text.includes('UPDATE idempotency_keys')) {
        const [response, scope, key] = values as [string, string, string];
        const row = idempotencyKeys.get(`${scope}::${key}`);
        if (row) {
          row.response = JSON.parse(response);
          row.status = 'completed';
        }
        return 1;
      }
      if (text.includes('DELETE FROM idempotency_keys')) {
        const [scope, key] = values as [string, string];
        const id = `${scope}::${key}`;
        if (idempotencyKeys.get(id)?.status === 'reserved') idempotencyKeys.delete(id);
        return 1;
      }
      if (text.includes('pickup_geom') && text.includes('ST_MakePoint')) {
        const [lng, lat, deliveryId] = values as [number, number, string];
        const row = deliveries.find((d) => d.id === deliveryId);
        if (row) {
          row.pickupLat = lat;
          row.pickupLng = lng;
        }
        return 1;
      }
      if (text.includes('dropoff_geom') && text.includes('ST_MakePoint')) {
        const [lng, lat, deliveryId] = values as [number, number, string];
        const row = deliveries.find((d) => d.id === deliveryId);
        if (row) {
          row.dropoffLat = lat;
          row.dropoffLng = lng;
        }
        return 1;
      }
      if (text.includes('UPDATE couriers SET') && text.includes('last_geom')) {
        const [lng, lat, , , , userId] = values as [
          number,
          number,
          unknown,
          unknown,
          unknown,
          string,
        ];
        const row = couriers.find((c) => c.userId === userId);
        if (row) {
          row.lastLat = lat;
          row.lastLng = lng;
          row.lastLocationAt = new Date();
        }
        return 1;
      }
      // `doMarkPickedUp`'s guarded UPDATE — top-level, not inside $transaction.
      if (text.includes('UPDATE deliveries SET status') && text.includes("'picked_up'")) {
        const [deliveryId, courierId, fromStatuses] = values as [string, string, string[]];
        const row = deliveries.find(
          (d) =>
            d.id === deliveryId && d.courierId === courierId && fromStatuses.includes(d.status),
        );
        if (!row) return 0;
        row.status = 'picked_up';
        row.pickedUpAt = new Date();
        return 1;
      }
      throw new Error(`Unhandled top-level $executeRaw: ${text}`);
    }),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const releases: Array<() => void> = [];
      const txQueryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = rawText(strings);

        if (text.includes('FROM deliveries') && text.includes('FOR UPDATE')) {
          const [deliveryId] = values as [string];
          const release = await acquireLock(deliveryLockTail, deliveryId);
          releases.push(release);
          const row = deliveries.find((d) => d.id === deliveryId);
          if (!row) return [];
          return [{ status: row.status, courier_id: row.courierId, order_id: row.orderId }];
        }
        if (text.includes('FROM couriers') && text.includes('FOR UPDATE')) {
          const [courierId] = values as [string];
          const release = await acquireLock(courierLockTail, courierId);
          releases.push(release);
          const row = couriers.find((c) => c.userId === courierId);
          if (!row) return [];
          return [{ status: row.status, active_delivery_id: row.activeDeliveryId }];
        }
        if (text.includes("SET status = 'busy'")) {
          const [deliveryId, courierId] = values as [string, string];
          const row = couriers.find((c) => c.userId === courierId);
          if (!row || row.status !== 'online' || row.activeDeliveryId !== null) return [];
          // `couriers_one_active_delivery_idx` (migration 0024) — enforced for
          // real, not scripted, so a genuine `Promise.all` race exercises the
          // constraint path exactly as PostgreSQL would.
          assertNoOtherCourierHolds(deliveryId, courierId);
          row.status = 'busy';
          row.activeDeliveryId = deliveryId;
          return [];
        }
        // `CouriersService.release` — since Bloc 6.1 a CASE expression, so it
        // never promotes a SUSPENDED courier to `online`, and it always clears
        // `active_delivery_id` (docs/25 §B6.1-1). Matched on the CASE text: the
        // pre-6.1 `SET status = 'online'` literal no longer appears.
        if (text.includes('active_delivery_id = NULL') && text.includes('CASE WHEN')) {
          const [courierId] = values as [string];
          const row = couriers.find((c) => c.userId === courierId);
          if (row) {
            if (row.status === 'busy') row.status = 'online';
            row.activeDeliveryId = null;
          }
          return [];
        }
        if (text.includes('UPDATE deliveries SET status') && text.includes("'delivered'")) {
          const [deliveryId, courierId] = values as [string, string];
          const row = deliveries.find(
            (d) => d.id === deliveryId && d.courierId === courierId && d.status === 'on_the_way',
          );
          if (!row) return [];
          row.status = 'delivered';
          row.deliveredAt = new Date();
          return [
            {
              id: row.id,
              order_id: row.orderId,
              currency: row.currency,
              courier_id: row.courierId,
            },
          ];
        }
        if (text.includes('UPDATE deliveries SET status') && text.includes("'cancelled'")) {
          // BUG-10.1.3 added `AND (:isStaff OR order_id = :authorizedOrderId)`.
          // Honoured here for the same reason as the `'failed'` branch: a fake
          // that ignores the tenant predicate would let the stale-authorization
          // test pass without the predicate actually existing.
          const [reason, actorUserId, deliveryId, fromStatuses, isStaff, authorizedOrderId] =
            values as [string, string, string, string[], boolean, string | null];
          // Emulate the SQL AS GIVEN: if the statement carries no tenant
          // predicate (fewer bound params), do not invent one — otherwise
          // removing the predicate in production would still look "blocked"
          // here and the stale-authorization test would guard nothing.
          const cancelScoped = isStaff !== undefined || authorizedOrderId !== undefined;
          const row = deliveries.find(
            (d) =>
              d.id === deliveryId &&
              fromStatuses.includes(d.status) &&
              (!cancelScoped || isStaff === true || d.orderId === authorizedOrderId),
          );
          if (!row) return [];
          row.status = 'cancelled';
          row.cancelledAt = new Date();
          row.cancelledReason = reason;
          row.cancelledBy = actorUserId;
          return [{ status: row.status, courier_id: row.courierId, order_id: row.orderId }];
        }
        if (text.includes('UPDATE deliveries SET status') && text.includes("'failed'")) {
          // BUG-10.1-AUTH added `AND (:isStaff OR courier_id = :actor)` to this
          // statement. Honouring it here is not optional politeness: without it
          // the fake silently ignores the tenant predicate and a test proving
          // "a stale authorization cannot fail someone else's delivery" would
          // pass for the wrong reason.
          const [reason, deliveryId, fromStatuses, isStaff, actorUserId] = values as [
            string,
            string,
            string[],
            boolean,
            string,
          ];
          // Same faithfulness rule as the `'cancelled'` branch above.
          const failScoped = isStaff !== undefined || actorUserId !== undefined;
          const row = deliveries.find(
            (d) =>
              d.id === deliveryId &&
              fromStatuses.includes(d.status) &&
              (!failScoped || isStaff === true || d.courierId === actorUserId),
          );
          if (!row) return [];
          row.status = 'failed';
          row.failedAt = new Date();
          row.failedReason = reason;
          return [{ courier_id: row.courierId, order_id: row.orderId }];
        }
        return [];
      });
      const txClient = makeClient(txQueryRaw);
      try {
        return await fn(txClient);
      } finally {
        for (const release of releases) release();
      }
    }),
  };

  return {
    db: store as unknown as PrismaService,
    deliveries,
    offers,
    proofs,
    couriers,
    ledgerGroups,
    outboxEvents,
    idempotencyKeys,
    findEligible,
  };
}

// ── shared seed helpers (Bloc 6.1) ─────────────────────────────────────────
// Lifted out of `deliveries-assignment-race.spec.ts` so every hardening suite
// seeds identical fixtures rather than each drifting its own copy.

export function seedSearchingDelivery(
  deliveries: DeliveryRow[],
  overrides: Partial<DeliveryRow> = {},
): DeliveryRow {
  const row: DeliveryRow = {
    id: randomUUID(),
    orderId: ORDER_ID,
    courierId: null,
    status: 'searching_courier',
    currency: 'XAF',
    courierFeeMinor: 1200n,
    estimatedDistanceM: null,
    dispatchAttempts: 0,
    dispatchRadiusM: null,
    searchingSince: new Date(),
    assignedAt: null,
    acceptedAt: null,
    pickedUpAt: null,
    onTheWayAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelledReason: null,
    cancelledBy: null,
    failedAt: null,
    failedReason: null,
    pickupLat: PICKUP.lat,
    pickupLng: PICKUP.lng,
    dropoffLat: null,
    dropoffLng: null,
    ...overrides,
  };
  deliveries.push(row);
  return row;
}

/** ~0.001 deg latitude ≈ 111 m — small deterministic offsets, all comfortably inside the 3 km default radius. */
export function seedOnlineCourier(
  couriers: CourierRow[],
  userId: string,
  offsetMeters = 100,
): CourierRow {
  const row: CourierRow = {
    userId,
    status: 'online',
    activeDeliveryId: null,
    lastLat: PICKUP.lat + offsetMeters / 111_000,
    lastLng: PICKUP.lng,
    lastLocationAt: new Date(),
  };
  couriers.push(row);
  return row;
}

export function seedAssignedOffer(
  deliveries: DeliveryRow[],
  offers: OfferRow[],
  couriers: CourierRow[],
  courierId: string,
  overrides: Partial<DeliveryRow> = {},
): { delivery: DeliveryRow; offer: OfferRow } {
  const delivery = seedSearchingDelivery(deliveries, {
    status: 'courier_assigned',
    courierId,
    assignedAt: new Date(),
    ...overrides,
  });
  seedOnlineCourier(couriers, courierId);
  const courierRow = couriers.find((c) => c.userId === courierId)!;
  courierRow.status = 'busy';
  courierRow.activeDeliveryId = delivery.id;
  const offer: OfferRow = {
    id: randomUUID(),
    deliveryId: delivery.id,
    courierId,
    status: 'offered',
    offeredAt: new Date(),
    expiresAt: new Date(Date.now() + 30_000),
    respondedAt: null,
  };
  offers.push(offer);
  return { delivery, offer };
}

/** A usable delivery code fixture: stores the hash of `code`, unexpired and unconsumed. */
export function seedDeliveryCode(
  proofs: ProofRow[],
  deliveryId: string,
  code: string,
  overrides: Partial<ProofRow> = {},
): ProofRow {
  const row: ProofRow = {
    id: randomUUID(),
    deliveryId,
    type: 'delivery_code',
    valueHash: createHash('sha256').update(code).digest('hex'),
    reference: null,
    createdAt: new Date(),
    createdBy: 'courier-A',
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    failedAttempts: 0,
    ...overrides,
  };
  proofs.push(row);
  return row;
}

export function fakeLedger(ledgerGroups: LedgerGroupRow[]): LedgerService {
  const posted = new Set<string>();
  return {
    postEntryGroupTx: vi.fn(
      async (
        _tx: unknown,
        input: {
          kind: string;
          idempotencyKey: string;
          currency: string;
          entries: LedgerGroupRow['entries'];
        },
      ) => {
        await Promise.resolve();
        assertBalanced(input.entries as never, input.currency);
        if (!posted.has(input.idempotencyKey)) {
          posted.add(input.idempotencyKey);
          ledgerGroups.push({
            kind: input.kind,
            idempotencyKey: input.idempotencyKey,
            currency: input.currency,
            entries: input.entries,
          });
        }
        return {
          id: randomUUID(),
          kind: input.kind,
          currency: input.currency,
          postedAt: new Date().toISOString(),
        };
      },
    ),
  } as unknown as LedgerService;
}

export interface PlatformOverrides {
  initialRadius?: number;
  maxRadius?: number;
  step?: number;
  maxWaves?: number;
  offerTimeoutSeconds?: number;
}

export function fakePlatform(overrides: PlatformOverrides = {}): PlatformService {
  return {
    getDispatchInitialRadiusMeters: vi.fn().mockResolvedValue(overrides.initialRadius ?? 3000),
    getDispatchMaxRadiusMeters: vi.fn().mockResolvedValue(overrides.maxRadius ?? 8000),
    getDispatchRadiusExpansionStepMeters: vi.fn().mockResolvedValue(overrides.step ?? 2000),
    getDispatchMaxWaves: vi.fn().mockResolvedValue(overrides.maxWaves ?? 3),
    getOfferTimeoutSeconds: vi.fn().mockResolvedValue(overrides.offerTimeoutSeconds ?? 30),
    getCourierLocationStaleSeconds: vi.fn().mockResolvedValue(120),
  } as unknown as PlatformService;
}

/**
 * `DeliveriesService` injects `UsersService` only to answer "is this actor a
 * member of the order's restaurant?" for the tenant-scoped delivery read
 * (BUG-10.1-AUTH). No existing delivery test exercises that branch, so the
 * default is "not a member" — the branch is covered explicitly in
 * `delivery-tenant-isolation.spec.ts`.
 */
export function fakeUsersService(members: ReadonlySet<string> = new Set()): UsersService {
  return {
    isMemberOfRestaurant: vi.fn((userId: string, restaurantId: string) =>
      Promise.resolve(members.has(`${userId}:${restaurantId}`)),
    ),
  } as unknown as UsersService;
}

export function fakeOrderAmountPort(courierFeeInPool = true): OrderAmountPort {
  const breakdown: OrderAccrualBreakdown = {
    restaurantId: RESTAURANT_ID,
    subtotal: money(8800n, 'XAF'),
    commission: money(2400n, 'XAF'),
    courierFee: money(1200n, 'XAF'),
  };
  const context: OrderDeliveryContext = {
    orderId: ORDER_ID,
    orderCode: 'DJ-0001',
    restaurantId: RESTAURANT_ID,
    customerId: CUSTOMER_ID,
    currency: 'XAF',
    courierFee: money(1200n, 'XAF'),
    courierFeeInPool,
    pickup: PICKUP,
    dropoff: DROPOFF,
  };
  return {
    getAuthoritativeAmount: vi.fn().mockResolvedValue(money(10000n, 'XAF')),
    getPaymentContext: vi.fn(),
    getAccrualBreakdown: vi.fn().mockResolvedValue(breakdown),
    getOwnerUserId: vi.fn().mockResolvedValue(CUSTOMER_ID),
    getDeliveryContext: vi.fn().mockResolvedValue(context),
  } as unknown as OrderAmountPort;
}

export interface EmittedEvent {
  readonly name: string;
  readonly payload: Record<string, unknown>;
}

export function buildDeliveriesServices(
  db: PrismaService,
  ledgerGroups: LedgerGroupRow[],
  opts: { courierFeeInPool?: boolean; platform?: PlatformOverrides } = {},
): { deliveries: DeliveriesService; couriers: CouriersService; emitted: EmittedEvent[] } {
  const platform = fakePlatform(opts.platform);
  const couriers = new CouriersService(db, platform);
  const idempotency = new IdempotencyService(new PrismaIdempotencyStore(db));
  // Captured rather than discarded: several hardening tests assert on what
  // leaves the service in-process — most importantly that the raw delivery
  // code travels on `delivery.code_issued` to the CUSTOMER and appears
  // nowhere else (docs/25 §B6.1-7).
  const emitted: EmittedEvent[] = [];
  const events = {
    emit: vi.fn((name: string, payload: Record<string, unknown>) => {
      emitted.push({ name, payload });
      return true;
    }),
    emitAsync: vi.fn(),
  } as unknown as EventEmitter2;
  const deliveries = new DeliveriesService(
    db,
    idempotency,
    fakeLedger(ledgerGroups),
    new OutboxService(db),
    events,
    platform,
    couriers,
    fakeUsersService(),
    fakeOrderAmountPort(opts.courierFeeInPool ?? true),
  );
  return { deliveries, couriers, emitted };
}
