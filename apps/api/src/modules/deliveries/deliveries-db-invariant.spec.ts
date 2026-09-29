import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import type { DeliveryStatus } from '@djafat/types';
import { DELIVERY_COURIER_HOLDING_STATUSES, DELIVERY_STATUSES } from '@djafat/types';
import {
  buildDeliveriesServices,
  makeDeliveriesRaceDb,
  seedAssignedOffer,
  seedDeliveryCode,
  seedOnlineCourier,
  seedSearchingDelivery,
} from './deliveries-test-support';

/**
 * Bloc 6.1 §1 — "one courier = at most one ACTIVE delivery", enforced by the
 * DATABASE and not only by the service layer (docs/25 §B6.1-1).
 *
 * Migration 0023 asserted this invariant could not be expressed as a constraint
 * because "'active' spans several `deliveries.status` values". A PARTIAL unique
 * index expresses exactly that, and migration 0024 adds it. These tests pin
 * down the definition of "active", prove the SQL and the TypeScript constant
 * can never drift apart, and prove a genuinely concurrent double assignment
 * ends with one winner and one CLEAN business error — never a raw 500.
 */

const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../../prisma/migrations/0024_delivery_invariants/migration.sql'),
  'utf8',
);

describe('the "active delivery" definition (docs/25 §B6.1-1)', () => {
  it('is exactly: a courier is attached AND the delivery is not terminal', () => {
    // Derived independently of the constant, from first principles: every
    // status that is neither pre-assignment nor terminal.
    const preAssignment = ['pending', 'searching_courier'];
    const terminal = ['delivered', 'cancelled', 'failed'];
    const derived = DELIVERY_STATUSES.filter(
      (s) => !preAssignment.includes(s) && !terminal.includes(s),
    );

    expect([...DELIVERY_COURIER_HOLDING_STATUSES].sort()).toEqual([...derived].sort());
  });

  // The migration is hand-written SQL: it MUST repeat the status list as
  // literals. This is the test that makes that duplication safe — add a status
  // to the machine without touching migration 0024 and this fails loudly
  // rather than silently leaving a hole in the constraint.
  it('the partial unique index enumerates exactly the same statuses as the TypeScript constant', () => {
    const indexClause =
      /deliveries_one_active_per_courier_idx[\s\S]*?status IN \(([\s\S]*?)\)/.exec(MIGRATION_SQL);
    expect(indexClause).not.toBeNull();

    const sqlStatuses = [...indexClause![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(sqlStatuses.sort()).toEqual([...DELIVERY_COURIER_HOLDING_STATUSES].sort());
  });

  it('the index is partial on courier_id IS NOT NULL — an unassigned delivery never occupies a slot', () => {
    expect(MIGRATION_SQL).toMatch(
      /deliveries_one_active_per_courier_idx[\s\S]*?WHERE courier_id IS NOT NULL/,
    );
  });

  it('declares the two mirror invariants as well (courier back-pointer, live offer)', () => {
    expect(MIGRATION_SQL).toContain('couriers_one_active_delivery_idx');
    expect(MIGRATION_SQL).toContain('delivery_offers_one_offered_per_delivery_idx');
    expect(MIGRATION_SQL).toMatch(/CREATE UNIQUE INDEX[\s\S]*?WHERE status = 'offered'/);
  });

  it('is additive: it creates and alters, it never drops a table or a column', () => {
    expect(MIGRATION_SQL).not.toMatch(/DROP\s+TABLE/i);
    expect(MIGRATION_SQL).not.toMatch(/DROP\s+COLUMN/i);
  });
});

describe('DB invariant under REAL concurrency (docs/25 §B6.1-1, mandate §1)', () => {
  // The mandate's exact scenario: delivery A and delivery B both try to take
  // courier X at the same instant. One must win; the other must fail as a
  // BUSINESS outcome. Run through the real services against the lock-aware
  // fake DB, whose `couriers`/`deliveries` writes enforce migration 0024's
  // partial unique indexes for real (see `deliveries-test-support.ts`).
  it('A->X and B->X fired simultaneously: exactly one delivery ends up holding courier X', async () => {
    const { db, deliveries, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const deliveryA = seedSearchingDelivery(deliveries);
    const deliveryB = seedSearchingDelivery(deliveries);
    seedOnlineCourier(couriers, 'courier-X', 50); // the ONLY candidate
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const results = await Promise.allSettled([
      service.runDispatchWave(deliveryA.id),
      service.runDispatchWave(deliveryB.id),
    ]);

    // Neither call may blow up: losing a dispatch race is "no courier found
    // this wave", which the worker retries — never a 500 (mandate §10).
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const holding = deliveries.filter(
      (d) =>
        d.courierId === 'courier-X' &&
        DELIVERY_COURIER_HOLDING_STATUSES.includes(d.status as DeliveryStatus),
    );
    expect(holding).toHaveLength(1);

    // The courier's own back-pointer agrees with the delivery side.
    const courierX = couriers.find((c) => c.userId === 'courier-X')!;
    expect(courierX.status).toBe('busy');
    expect(courierX.activeDeliveryId).toBe(holding[0]!.id);

    // The loser is untouched and still dispatchable on a later wave.
    const loser = deliveries.find((d) => d.id !== holding[0]!.id)!;
    expect(loser.courierId).toBeNull();
    expect(loser.status).toBe('searching_courier');
  });

  it('the loser never receives a raw 500 — the database rejection is translated', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery: busyDelivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-X');
    // A second delivery whose only candidate is the already-busy courier.
    const second = seedSearchingDelivery(deliveries);

    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);
    await expect(service.runDispatchWave(second.id)).resolves.toBeUndefined();

    // Nothing moved: the courier stays on their first delivery.
    expect(second.courierId).toBeNull();
    expect(couriers.find((c) => c.userId === 'courier-X')!.activeDeliveryId).toBe(busyDelivery.id);
  });

  it('a courier released by a completed delivery becomes assignable again', async () => {
    const { db, deliveries, offers, couriers, proofs, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery: first } = seedAssignedOffer(deliveries, offers, couriers, 'courier-X', {
      status: 'on_the_way',
    });
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);
    seedDeliveryCode(proofs, first.id, '1234');

    await service.confirmDelivered(first.id, 'courier-X', '1234', 'k1');
    expect(first.status).toBe('delivered');

    // `delivered` is terminal, so it leaves the index's WHERE clause and the
    // courier is free — the whole point of defining "active" by status.
    const second = seedSearchingDelivery(deliveries);
    await service.runDispatchWave(second.id);

    expect(second.courierId).toBe('courier-X');
    expect(second.status).toBe('courier_assigned');
  });

  it('a suspended courier holding a delivery is never silently freed by the constraint', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-X');
    const courier = couriers.find((c) => c.userId === 'courier-X')!;
    courier.status = 'suspended'; // admin acts mid-delivery

    const { deliveries: service, couriers: courierService } = buildDeliveriesServices(
      db,
      ledgerGroups,
    );

    // Cancelling the delivery releases the back-pointer but must NOT promote a
    // suspended courier to `online` (the worker had exactly that bug).
    await service.cancel(delivery.id, ['admin'], 'admin-1', 'ops', 'k-cancel');
    expect(courier.status).toBe('suspended');
    expect(courier.activeDeliveryId).toBeNull();

    // And reinstating them must actually make them dispatchable again.
    await courierService.reinstate('courier-X');
    expect(courier.status).toBe('offline');
    expect(courier.activeDeliveryId).toBeNull();
  });

  it('a delivery already cancelled answers a clean business error, never a 500', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-X');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.cancel(delivery.id, ['admin'], 'admin-1', 'ops', 'k1');
    await expect(
      service.cancel(delivery.id, ['admin'], 'admin-1', 'ops', 'k2'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
