import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import {
  buildDeliveriesServices,
  makeDeliveriesRaceDb,
  seedDeliveryCode,
  ORDER_ID,
  PICKUP,
  type DeliveryRow,
} from './deliveries-test-support';

function seedDelivery(
  deliveries: DeliveryRow[],
  overrides: Partial<DeliveryRow> = {},
): DeliveryRow {
  const row: DeliveryRow = {
    id: randomUUID(),
    orderId: ORDER_ID,
    courierId: null,
    status: 'pending',
    currency: 'XAF',
    courierFeeMinor: 1200n,
    estimatedDistanceM: null,
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
    pickupLat: PICKUP.lat,
    pickupLng: PICKUP.lng,
    dropoffLat: null,
    dropoffLng: null,
    ...overrides,
  };
  deliveries.push(row);
  return row;
}

describe('DeliveriesService.createAndDispatch (docs/25 §2, §11)', () => {
  it('creates a delivery from the order context — pickup/dropoff/courierFee come from OrderAmountPort, never the client', async () => {
    const { db, ledgerGroups, deliveries } = makeDeliveriesRaceDb();
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const dto = await service.createAndDispatch(ORDER_ID);

    expect(dto.orderId).toBe(ORDER_ID);
    expect(dto.courierFee.minor).toBe('1200');
    expect(deliveries).toHaveLength(1);
  });

  it('is idempotent: calling it again for the same order never creates a second delivery', async () => {
    const { db, ledgerGroups, deliveries } = makeDeliveriesRaceDb();
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.createAndDispatch(ORDER_ID);
    await service.createAndDispatch(ORDER_ID);

    expect(deliveries).toHaveLength(1);
  });

  it('with no eligible courier anywhere, the delivery stays searching_courier — never silently lost (docs/25 §11)', async () => {
    const { db, ledgerGroups, deliveries } = makeDeliveriesRaceDb();
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups); // no couriers seeded

    const dto = await service.createAndDispatch(ORDER_ID);

    expect(dto.status).toBe('searching_courier');
    expect(dto.courierId).toBeNull();
    expect(deliveries[0]!.dispatchAttempts).toBeGreaterThan(0); // recorded an attempt, not a no-op
  });
});

describe('DeliveriesService — ownership resolvers (docs/19 §21, docs/25 §35, §46 IDOR)', () => {
  it('getOwnerUserId resolves via the order, never a delivery-local field', async () => {
    const { db, ledgerGroups, deliveries } = makeDeliveriesRaceDb();
    const delivery = seedDelivery(deliveries);
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await expect(service.getOwnerUserId(delivery.id)).resolves.toBe('customer-1');
  });

  it('getOwnerUserId throws NotFound for an unknown delivery id — never a sentinel', async () => {
    const { db, ledgerGroups } = makeDeliveriesRaceDb();
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await expect(service.getOwnerUserId('does-not-exist')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('getAssignedCourierUserId throws DELIVERY_NOT_ASSIGNED before any courier is assigned (never returns null as if it were an id)', async () => {
    const { db, ledgerGroups, deliveries } = makeDeliveriesRaceDb();
    const delivery = seedDelivery(deliveries, { status: 'searching_courier' });
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await expect(service.getAssignedCourierUserId(delivery.id)).rejects.toMatchObject({
      response: { code: 'DELIVERY_NOT_ASSIGNED' },
    });
  });

  it('getAssignedCourierUserIdByOrder (realtime room auth) never throws — returns null instead', async () => {
    const { db, ledgerGroups } = makeDeliveriesRaceDb();
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await expect(service.getAssignedCourierUserIdByOrder('unknown-order')).resolves.toBeNull();
  });
});

describe('DeliveriesService.cancel — state-machine guarded (docs/25 §29)', () => {
  it('customer can cancel while still searching for a courier', async () => {
    const { db, ledgerGroups, deliveries } = makeDeliveriesRaceDb();
    const delivery = seedDelivery(deliveries, { status: 'searching_courier' });
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const result = await service.cancel(
      { userId: 'customer-1', roles: ['customer'], permissions: [] },
      delivery.id,
      'changed my mind',
      'key-1',
    );
    expect(result.delivery.status).toBe('cancelled');
  });

  it('customer can NOT cancel once picked_up (docs/25 §29 — must be explicitly admin-handled)', async () => {
    const { db, ledgerGroups, deliveries } = makeDeliveriesRaceDb();
    const delivery = seedDelivery(deliveries, { status: 'picked_up', courierId: 'courier-1' });
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await expect(
      service.cancel(
        { userId: 'customer-1', roles: ['customer'], permissions: [] },
        delivery.id,
        'too late',
        'key-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'DELIVERY_INVALID_STATE' } });
  });

  it('admin CAN force-cancel a picked_up delivery', async () => {
    const { db, ledgerGroups, deliveries, couriers } = makeDeliveriesRaceDb();
    const delivery = seedDelivery(deliveries, { status: 'picked_up', courierId: 'courier-1' });
    couriers.push({
      userId: 'courier-1',
      status: 'busy',
      activeDeliveryId: delivery.id,
      lastLat: null,
      lastLng: null,
      lastLocationAt: null,
    });
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const result = await service.cancel(
      { userId: 'admin-1', roles: ['admin'], permissions: ['deliveries:write'] },
      delivery.id,
      'operational incident',
      'key-1',
    );
    expect(result.delivery.status).toBe('cancelled');
    expect(couriers[0]!.status).toBe('online'); // released, never left dangling busy
  });

  it('NEVER allows cancelling an already-delivered delivery, with a clean error not a raw 500', async () => {
    const { db, ledgerGroups, deliveries } = makeDeliveriesRaceDb();
    const delivery = seedDelivery(deliveries, { status: 'delivered' });
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await expect(
      service.cancel(
        { userId: 'admin-1', roles: ['admin', 'super_admin'], permissions: ['deliveries:write'] },
        delivery.id,
        'x',
        'key-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'DELIVERY_ALREADY_DELIVERED' } });
  });

  it('a re-cancel replays the SAME idempotent result rather than re-running the transition', async () => {
    const { db, ledgerGroups, deliveries } = makeDeliveriesRaceDb();
    const delivery = seedDelivery(deliveries, { status: 'searching_courier' });
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const first = await service.cancel(
      { userId: 'customer-1', roles: ['customer'], permissions: [] },
      delivery.id,
      'reason',
      'same-key',
    );
    const second = await service.cancel(
      { userId: 'customer-1', roles: ['customer'], permissions: [] },
      delivery.id,
      'reason',
      'same-key',
    );
    expect(first.status).toBe('created');
    expect(second.status).toBe('replayed');
    expect(second.delivery.status).toBe('cancelled');
  });

  /**
   * BUG-10.1.3 changed the expected code here from 409 DELIVERY_INVALID_STATE
   * to 403 FORBIDDEN, and that is a STRICTLY STRONGER rejection, not a weakened
   * protection: a `restaurant_staff` who does not own the order is now refused
   * on tenant grounds BEFORE the state machine is consulted at all, instead of
   * being told "wrong state" about someone else's delivery. The 409 path for an
   * actor who IS authorized but whose role cannot cancel from the current state
   * stays covered by "customer can NOT cancel once picked_up" above.
   */
  it('a non-owner role is refused on tenant grounds (403) before the state machine is reached', async () => {
    const { db, ledgerGroups, deliveries } = makeDeliveriesRaceDb();
    const delivery = seedDelivery(deliveries, { status: 'searching_courier' });
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await expect(
      service.cancel(
        { userId: 'staff-1', roles: ['restaurant_staff'], permissions: [] },
        delivery.id,
        'x',
        'key-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
  });
});

describe('DeliveriesService.confirmDelivered — proof of delivery (docs/25 §18-19)', () => {
  it('rejects a wrong delivery code cleanly (INVALID_PROOF), never leaking whether it was close', async () => {
    const { db, ledgerGroups, deliveries, proofs } = makeDeliveriesRaceDb();
    const delivery = seedDelivery(deliveries, { status: 'on_the_way', courierId: 'courier-1' });
    seedDeliveryCode(proofs, delivery.id, '1234');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await expect(
      service.confirmDelivered(delivery.id, 'courier-1', '9999', 'key-1'),
    ).rejects.toMatchObject({ response: { code: 'INVALID_PROOF' } });
  });

  it('a courier who is not the assigned one can never confirm delivery, even with the right code', async () => {
    const { db, ledgerGroups, deliveries, proofs } = makeDeliveriesRaceDb();
    const delivery = seedDelivery(deliveries, { status: 'on_the_way', courierId: 'courier-1' });
    seedDeliveryCode(proofs, delivery.id, '4242');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await expect(
      service.confirmDelivered(delivery.id, 'courier-STRANGER', '4242', 'key-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DeliveriesService.issueDeliveryCode (docs/09 A.5)', () => {
  it('generates a 4-digit code and stores only its hash, never the raw code', async () => {
    const { db, ledgerGroups, proofs } = makeDeliveriesRaceDb();
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const code = await service.issueDeliveryCode('delivery-1', 'courier-1');
    expect(code).toMatch(/^\d{4}$/);
    expect(proofs).toHaveLength(1);
    expect(proofs[0]!.valueHash).not.toBe(code); // never the raw value at rest
  });

  // `created_by` is `uuid NOT NULL REFERENCES users(id)`. Bloc 6 wrote the
  // literal string 'system' into it, which a real PostgreSQL rejects outright
  // (`invalid input syntax for type uuid`) — a raw 500 on the delivery path
  // that no fake-DB test could ever surface (docs/25 §B6.1-7).
  it('attributes the proof to a real actor, never a non-uuid placeholder', async () => {
    const { db, ledgerGroups, proofs } = makeDeliveriesRaceDb();
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.issueDeliveryCode('delivery-1', 'courier-1');
    expect(proofs[0]!.createdBy).toBe('courier-1');
    expect(proofs[0]!.createdBy).not.toBe('system');
  });

  it('stamps an expiry so a code cannot stay valid forever', async () => {
    const { db, ledgerGroups, proofs } = makeDeliveriesRaceDb();
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.issueDeliveryCode('delivery-1', 'courier-1');
    expect(proofs[0]!.expiresAt).toBeInstanceOf(Date);
    expect(proofs[0]!.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});
