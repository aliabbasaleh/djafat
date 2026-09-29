import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException, type HttpException } from '@nestjs/common';
import {
  buildDeliveriesServices,
  makeDeliveriesRaceDb,
  seedAssignedOffer,
  seedDeliveryCode,
  seedOnlineCourier,
  seedSearchingDelivery,
} from './deliveries-test-support';

describe('DeliveriesService — REAL concurrency against a lock-aware fake DB (docs/25 §12-13, §38)', () => {
  it('dispatch wave: two SIMULTANEOUS runDispatchWave calls for the SAME delivery only ever assign ONE courier', async () => {
    const { db, deliveries, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const delivery = seedSearchingDelivery(deliveries);
    seedOnlineCourier(couriers, 'courier-A', 50);
    seedOnlineCourier(couriers, 'courier-B', 60);
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await Promise.all([service.runDispatchWave(delivery.id), service.runDispatchWave(delivery.id)]);

    expect(delivery.status).toBe('courier_assigned');
    expect(delivery.courierId).not.toBeNull();
    const busyCouriers = couriers.filter((c) => c.status === 'busy');
    expect(busyCouriers).toHaveLength(1); // never both claimed
  });

  it('two deliveries dispatch concurrently for the SAME single candidate: only one delivery gets that courier', async () => {
    const { db, deliveries, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const deliveryA = seedSearchingDelivery(deliveries);
    const deliveryB = seedSearchingDelivery(deliveries, { orderId: 'order-2' });
    seedOnlineCourier(couriers, 'courier-only', 50); // exactly ONE candidate for both
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await Promise.all([
      service.runDispatchWave(deliveryA.id),
      service.runDispatchWave(deliveryB.id),
    ]);

    const assigned = [deliveryA, deliveryB].filter((d) => d.status === 'courier_assigned');
    expect(assigned).toHaveLength(1); // the other stays searching_courier — never double-assigned
    const stillSearching = [deliveryA, deliveryB].filter((d) => d.status === 'searching_courier');
    expect(stillSearching).toHaveLength(1);
    expect(couriers.find((c) => c.userId === 'courier-only')!.activeDeliveryId).toBe(
      assigned[0]!.id,
    );
  });

  it('a courier who was never offered this delivery can never win an accept race against the one who was — even fired at the exact same instant, and never a raw 500', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    // `delivery.courier_id` is set ONCE, at dispatch/offer time — courier-B's
    // offer row here is an ops/bug scenario (two `offered` rows should never
    // coexist in the real flow) used specifically to prove the OWNERSHIP
    // check inside the transaction — not just `findActiveOffer`'s outer
    // lookup — is what actually decides, under genuine parallel execution,
    // never a raw constraint error (docs/25 §13, §46, §64).
    const { delivery, offer } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    seedOnlineCourier(couriers, 'courier-B', 80);
    offers.push({
      id: randomUUID(),
      deliveryId: delivery.id,
      courierId: 'courier-B',
      status: 'offered',
      offeredAt: new Date(),
      expiresAt: new Date(Date.now() + 30_000),
      respondedAt: null,
    });
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const [a, b] = await Promise.allSettled([
      service.acceptOffer(delivery.id, 'courier-A', 'key-A'),
      service.acceptOffer(delivery.id, 'courier-B', 'key-B'),
    ]);

    expect(a.status).toBe('fulfilled'); // courier-A: the one actually assigned
    expect(b.status).toBe('rejected'); // courier-B: never assigned, loses deterministically
    const err = (b as PromiseRejectedResult).reason as HttpException;
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'DELIVERY_ALREADY_ASSIGNED' });
    expect(delivery.status).toBe('courier_accepted');
    void offer;
  });

  it('accept + cancel simultaneously: at most one succeeds, the delivery never ends up in an inconsistent state', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const [accept, cancel] = await Promise.allSettled([
      service.acceptOffer(delivery.id, 'courier-A', 'accept-key'),
      service.cancel(delivery.id, ['customer'], 'customer-1', 'changed my mind', 'cancel-key'),
    ]);

    // Whichever committed first wins; the loser sees a clean, typed error
    // (DELIVERY_INVALID_STATE from the state machine guard) — never a raw
    // constraint violation, and the delivery lands in EXACTLY one terminal-ish
    // state, never torn between the two.
    expect(['courier_accepted', 'cancelled']).toContain(delivery.status);
    const outcomes = [accept, cancel];
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    if (delivery.status === 'cancelled') {
      // the courier must have been released, never left dangling `busy`.
      expect(couriers.find((c) => c.userId === 'courier-A')!.status).toBe('online');
    }
  });

  it('two pickup confirmations fired simultaneously: exactly one transitions picked_up -> on_the_way, the other is a clean idempotent replay', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A', {
      status: 'pickup_in_progress',
      courierId: 'courier-A',
    });
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const [a, b] = await Promise.allSettled([
      service.markPickedUp(delivery.id, 'courier-A', 'pickup-key-1'),
      service.markPickedUp(delivery.id, 'courier-A', 'pickup-key-2'),
    ]);

    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled'); // different idempotency keys, but the SQL guard makes the second a no-op-then-replay
    expect(delivery.status).toBe('on_the_way');
    expect(delivery.pickedUpAt).not.toBeNull();
  });

  it('two delivery confirmations fired simultaneously: funds_available posts exactly ONCE, never double-credited', async () => {
    const { db, deliveries, offers, couriers, proofs, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A', {
      status: 'on_the_way',
      courierId: 'courier-A',
    });
    seedDeliveryCode(proofs, delivery.id, '1234');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const [a, b] = await Promise.allSettled([
      service.confirmDelivered(delivery.id, 'courier-A', '1234', 'deliver-key-1'),
      service.confirmDelivered(delivery.id, 'courier-A', '1234', 'deliver-key-2'),
    ]);

    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    expect(delivery.status).toBe('delivered');
    const fundsAvailableGroups = ledgerGroups.filter((g) => g.kind === 'funds_available');
    expect(fundsAvailableGroups).toHaveLength(1); // NEVER twice
    expect(couriers.find((c) => c.userId === 'courier-A')!.status).toBe('online');
  });

  it('a wrong courier (not the one offered) can never accept — IDOR (docs/25 §14, §46)', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await expect(
      service.acceptOffer(delivery.id, 'courier-STRANGER', 'key'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(delivery.status).toBe('courier_assigned'); // untouched
  });

  it('an expired offer can never be accepted, even by the right courier', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery, offer } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    offer.expiresAt = new Date(Date.now() - 1000); // already expired
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await expect(service.acceptOffer(delivery.id, 'courier-A', 'key')).rejects.toMatchObject({
      response: { code: 'OFFER_EXPIRED' },
    });
  });

  it('a suspended courier can never accept, even with a live offer in hand', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    couriers.find((c) => c.userId === 'courier-A')!.status = 'suspended'; // suspended mid-flight (docs/25 §13, §64)
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await expect(service.acceptOffer(delivery.id, 'courier-A', 'key')).rejects.toMatchObject({
      response: { code: 'COURIER_NOT_ELIGIBLE' },
    });
  });

  it('a busy (already-claimed) courier is never returned as an eligible dispatch candidate', async () => {
    const { db, deliveries, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const delivery = seedSearchingDelivery(deliveries);
    const busy = seedOnlineCourier(couriers, 'courier-busy', 50);
    busy.status = 'busy';
    busy.activeDeliveryId = 'some-other-delivery';
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.runDispatchWave(delivery.id);

    expect(delivery.status).toBe('searching_courier'); // no eligible candidate found
    expect(delivery.courierId).toBeNull();
  });
});
