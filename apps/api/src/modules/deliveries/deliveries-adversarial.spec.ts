import { describe, expect, it } from 'vitest';
import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import {
  buildDeliveriesServices,
  makeDeliveriesRaceDb,
  seedAssignedOffer,
  seedDeliveryCode,
  seedOnlineCourier,
  seedSearchingDelivery,
} from './deliveries-test-support';

/**
 * Bloc 6.1 §7, §8, §10 — the adversarial pass.
 *
 * One rule governs this whole file: **no predictable business condition may
 * ever surface as a raw 500.** Every expectation below therefore asserts a
 * specific HTTP-shaped exception (404 / 409 / 429), never merely "it threw".
 * A `TypeError`, a `DeliveryTransitionError`, or a raw Prisma error reaching
 * the caller is a failure here even though the operation was correctly refused
 * — that distinction is exactly what caught the Bloc 6 accept-race bug.
 */

/** Every exception the API is allowed to answer a hostile or racing caller with. */
function expectCleanBusinessError(err: unknown): void {
  expect(
    err instanceof NotFoundException ||
      err instanceof ConflictException ||
      err instanceof HttpException,
    `expected a clean business error, got: ${String(err)}`,
  ).toBe(true);
  // An HttpException carries a real status; an internal error would not.
  const status = (err as HttpException).getStatus();
  expect(status, 'never a 5xx').toBeLessThan(500);
}

describe('IDOR — only the assigned courier may act on a delivery (mandate §7)', () => {
  it('a stranger cannot accept an offer addressed to someone else', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    seedOnlineCourier(couriers, 'courier-STRANGER', 300);
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.acceptOffer(delivery.id, 'courier-STRANGER', 'k1').then(
      () => expect.unreachable('a stranger must never accept'),
      (err: unknown) => expectCleanBusinessError(err),
    );

    expect(delivery.status).toBe('courier_assigned'); // untouched
    expect(delivery.courierId).toBe('courier-A');
    expect(ledgerGroups).toHaveLength(0); // no money moved
  });

  it('a stranger cannot mark a delivery picked up', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A', {
      status: 'courier_accepted',
    });
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.markPickedUp(delivery.id, 'courier-STRANGER', 'k1').then(
      () => expect.unreachable('a stranger must never pick up'),
      (err: unknown) => {
        expectCleanBusinessError(err);
        expect(err).toBeInstanceOf(NotFoundException); // never reveals the delivery exists
      },
    );

    expect(delivery.status).toBe('courier_accepted');
  });

  it('a stranger cannot confirm delivery even holding the correct code', async () => {
    const { db, deliveries, offers, couriers, proofs, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A', {
      status: 'on_the_way',
    });
    seedDeliveryCode(proofs, delivery.id, '1234');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.confirmDelivered(delivery.id, 'courier-STRANGER', '1234', 'k1').then(
      () => expect.unreachable('a stranger must never confirm'),
      (err: unknown) => {
        expectCleanBusinessError(err);
        expect(err).toBeInstanceOf(NotFoundException);
      },
    );

    expect(delivery.status).toBe('on_the_way');
    expect(ledgerGroups).toHaveLength(0);
  });

  // The ordering bug this pass found: proof verification used to run BEFORE the
  // ownership check, so a stranger's guesses landed on the real courier's
  // attempt counter and could lock them out of their own delivery.
  it('a stranger’s wrong guesses never burn the assigned courier’s attempt budget', async () => {
    const { db, deliveries, offers, couriers, proofs, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A', {
      status: 'on_the_way',
    });
    const proof = seedDeliveryCode(proofs, delivery.id, '1234');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    for (let i = 0; i < 20; i += 1) {
      await service
        .confirmDelivered(delivery.id, 'courier-STRANGER', '0000', `k${i}`)
        .catch((err: unknown) => expectCleanBusinessError(err));
    }
    expect(proof.failedAttempts).toBe(0); // the real courier is untouched

    // And the assigned courier can still complete normally.
    const result = await service.confirmDelivered(delivery.id, 'courier-A', '1234', 'k-real');
    expect(result.delivery.status).toBe('delivered');
  });

  it('a stranger cannot cancel or fail someone else’s delivery through the courier route', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A', {
      status: 'on_the_way',
    });
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    // A courier role with no authority over THIS delivery: the state machine
    // grants `courier` the failed transition, but the route-level ownership
    // resolver is what binds it to the assigned courier.
    await expect(service.getAssignedCourierUserId(delivery.id)).resolves.toBe('courier-A');
    await expect(service.getAssignedCourierUserId(delivery.id)).not.resolves.toBe(
      'courier-STRANGER',
    );
  });

  it('a delivery with no courier yet exposes no courier identity', async () => {
    const { db, deliveries, ledgerGroups } = makeDeliveriesRaceDb();
    const delivery = seedSearchingDelivery(deliveries);
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.getAssignedCourierUserId(delivery.id).then(
      () => expect.unreachable('no courier is assigned'),
      (err: unknown) => {
        expectCleanBusinessError(err);
        expect(err).toBeInstanceOf(NotFoundException);
      },
    );
  });
});

describe('the delivery code is a real one-time secret (mandate §7)', () => {
  it('is never returned to the courier, and travels only to the customer', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A', {
      status: 'courier_accepted',
    });
    const { deliveries: service, emitted } = buildDeliveriesServices(db, ledgerGroups);

    const result = await service.markPickedUp(delivery.id, 'courier-A', 'k1');

    const issued = emitted.find((e) => e.name === 'delivery.code_issued');
    expect(issued).toBeDefined();
    const code = issued!.payload['code'] as string;
    expect(code).toMatch(/^\d{4}$/);
    expect(issued!.payload['customerId']).toBe('customer-1'); // addressed to the customer

    // The courier's own response carries the code in no field, at any depth.
    // Checked value by value rather than by scanning the serialised string:
    // the DTO legitimately contains other four-digit numbers (the 1200 XAF
    // fee, the year inside a timestamp), so a substring scan would be noise.
    const values: string[] = [];
    (function walk(node: unknown): void {
      if (node === null || node === undefined) return;
      if (typeof node === 'object') {
        for (const v of Object.values(node)) walk(v);
        return;
      }
      values.push(String(node));
    })(result);

    expect(values).not.toContain(code);
  });

  it('is stored hashed — the raw value never sits at rest', async () => {
    const { db, deliveries, offers, couriers, proofs, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A', {
      status: 'courier_accepted',
    });
    const { deliveries: service, emitted } = buildDeliveriesServices(db, ledgerGroups);

    await service.markPickedUp(delivery.id, 'courier-A', 'k1');
    const code = emitted.find((e) => e.name === 'delivery.code_issued')!.payload['code'] as string;

    expect(proofs).toHaveLength(1);
    expect(proofs[0]!.valueHash).not.toBe(code);
    expect(proofs[0]!.valueHash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    expect(proofs[0]!.valueHash).not.toContain(code);
  });

  it('cannot be replayed on a second delivery once consumed', async () => {
    const { db, deliveries, offers, couriers, proofs, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A', {
      status: 'on_the_way',
    });
    const proof = seedDeliveryCode(proofs, delivery.id, '1234');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.confirmDelivered(delivery.id, 'courier-A', '1234', 'k1');
    expect(proof.consumedAt).not.toBeNull();

    // Reset the delivery as an attacker would wish they could, and re-present
    // the same code: the proof itself refuses.
    delivery.status = 'on_the_way';
    await service.confirmDelivered(delivery.id, 'courier-A', '1234', 'k2').then(
      () => expect.unreachable('a consumed code must not work again'),
      (err: unknown) => {
        expectCleanBusinessError(err);
        expect((err as ConflictException).getResponse()).toMatchObject({ code: 'INVALID_PROOF' });
      },
    );
  });

  it('expires', async () => {
    const { db, deliveries, offers, couriers, proofs, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A', {
      status: 'on_the_way',
    });
    seedDeliveryCode(proofs, delivery.id, '1234', { expiresAt: new Date(Date.now() - 1000) });
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.confirmDelivered(delivery.id, 'courier-A', '1234', 'k1').then(
      () => expect.unreachable('an expired code must not work'),
      (err: unknown) => expectCleanBusinessError(err),
    );
    expect(delivery.status).toBe('on_the_way');
  });

  it('stops a brute-force run well before 10 000 guesses, with a 429', async () => {
    const { db, deliveries, offers, couriers, proofs, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A', {
      status: 'on_the_way',
    });
    seedDeliveryCode(proofs, delivery.id, '1234');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      await service
        .confirmDelivered(delivery.id, 'courier-A', '0000', `k${i}`)
        .catch((err: HttpException) => statuses.push(err.getStatus()));
    }

    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.every((s) => s < 500)).toBe(true);

    // Once locked out, even the CORRECT code is refused — the lockout is real,
    // not merely advisory.
    await service.confirmDelivered(delivery.id, 'courier-A', '1234', 'k-correct').then(
      () => expect.unreachable('rate limit must hold'),
      (err: HttpException) => expect(err.getStatus()).toBe(429),
    );
    expect(delivery.status).toBe('on_the_way');
  });

  it('a delivery with no code issued yet answers a business error, not a crash', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A', {
      status: 'on_the_way',
    });
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.confirmDelivered(delivery.id, 'courier-A', '1234', 'k1').then(
      () => expect.unreachable('no proof exists'),
      (err: unknown) => expectCleanBusinessError(err),
    );
  });
});

describe('offers: expiry and concurrent acceptance (mandate §8)', () => {
  it('an offer accepted before expiry succeeds', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery, offer } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const result = await service.acceptOffer(delivery.id, 'courier-A', 'k1');

    expect(result.delivery.status).toBe('courier_accepted');
    expect(offer.status).toBe('accepted');
    expect(offer.respondedAt).not.toBeNull();
  });

  it('an offer accepted AFTER expiry is refused with OFFER_EXPIRED', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery, offer } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    offer.expiresAt = new Date(Date.now() - 1000);
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.acceptOffer(delivery.id, 'courier-A', 'k1').then(
      () => expect.unreachable('an expired offer must not be acceptable'),
      (err: unknown) => {
        expectCleanBusinessError(err);
        expect((err as ConflictException).getResponse()).toMatchObject({ code: 'OFFER_EXPIRED' });
      },
    );

    expect(delivery.status).toBe('courier_assigned');
    expect(ledgerGroups).toHaveLength(0); // no reclassification on an expired offer
  });

  it('an already-resolved offer cannot be accepted a second time', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery, offer } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.rejectOffer(delivery.id, 'courier-A', 'k-reject');
    expect(offer.status).toBe('rejected');

    await service.acceptOffer(delivery.id, 'courier-A', 'k-accept').then(
      () => expect.unreachable('a rejected offer must not be acceptable'),
      (err: unknown) => expectCleanBusinessError(err),
    );
  });

  it('two couriers accepting simultaneously: one wins, the other gets a clean 409', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    // A second courier who also holds an `offered` row for this delivery —
    // the state migration 0024's partial index now forbids, reproduced here as
    // the pre-6.1 data a running system could already contain.
    seedOnlineCourier(couriers, 'courier-B', 200);
    offers.push({
      id: 'offer-b',
      deliveryId: delivery.id,
      courierId: 'courier-B',
      status: 'offered',
      offeredAt: new Date(),
      expiresAt: new Date(Date.now() + 30_000),
      respondedAt: null,
    });
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const [a, b] = await Promise.allSettled([
      service.acceptOffer(delivery.id, 'courier-A', 'k-a'),
      service.acceptOffer(delivery.id, 'courier-B', 'k-b'),
    ]);

    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expectCleanBusinessError((rejected[0] as PromiseRejectedResult).reason);

    expect(delivery.status).toBe('courier_accepted');
    // Exactly one reclassification: the pool is drained once, not twice.
    expect(
      ledgerGroups.filter((g) => g.idempotencyKey.startsWith('courier-accrual:')),
    ).toHaveLength(1);
  });

  it('a courier suspended between offer and acceptance can no longer accept', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    couriers.find((c) => c.userId === 'courier-A')!.status = 'suspended';
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.acceptOffer(delivery.id, 'courier-A', 'k1').then(
      () => expect.unreachable('a suspended courier must not accept'),
      (err: unknown) => {
        expectCleanBusinessError(err);
        expect((err as ConflictException).getResponse()).toMatchObject({
          code: 'COURIER_NOT_ELIGIBLE',
        });
      },
    );
    expect(ledgerGroups).toHaveLength(0);
  });
});

describe('concurrent state transitions (mandate §5, §10)', () => {
  it('accept and cancel fired together leave exactly one outcome', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const results = await Promise.allSettled([
      service.acceptOffer(delivery.id, 'courier-A', 'k-accept'),
      service.cancel(delivery.id, ['admin'], 'admin-1', 'ops', 'k-cancel'),
    ]);

    for (const r of results) {
      if (r.status === 'rejected') expectCleanBusinessError(r.reason);
    }
    // Whichever won, the delivery holds ONE status and the courier is consistent.
    expect(['courier_accepted', 'cancelled']).toContain(delivery.status);
    const courier = couriers.find((c) => c.userId === 'courier-A')!;
    if (delivery.status === 'cancelled') {
      expect(courier.activeDeliveryId).toBeNull();
    } else {
      expect(courier.activeDeliveryId).toBe(delivery.id);
    }
  });

  it('two simultaneous cancellations cancel once and refuse once, cleanly', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const results = await Promise.allSettled([
      service.cancel(delivery.id, ['admin'], 'admin-1', 'a', 'k-1'),
      service.cancel(delivery.id, ['admin'], 'admin-2', 'b', 'k-2'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expectCleanBusinessError(rejected.reason);
    expect(delivery.status).toBe('cancelled');
  });

  it('cancel and fail fired together never leave a delivery in both terminal states', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A', {
      status: 'on_the_way',
    });
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const results = await Promise.allSettled([
      service.cancel(delivery.id, ['admin'], 'admin-1', 'ops', 'k-c'),
      service.reportFailed(delivery.id, ['courier'], 'courier-A', 'unreachable', 'k-f'),
    ]);

    for (const r of results) {
      if (r.status === 'rejected') expectCleanBusinessError(r.reason);
    }
    expect(['cancelled', 'failed']).toContain(delivery.status);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('a transition on a non-existent delivery is a clean 404, never a crash', async () => {
    const { db, ledgerGroups } = makeDeliveriesRaceDb();
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    for (const call of [
      () => service.markPickedUp('00000000-0000-0000-0000-000000000000', 'courier-A', 'k1'),
      () => service.cancel('00000000-0000-0000-0000-000000000000', ['admin'], 'a', 'r', 'k2'),
      () => service.acceptOffer('00000000-0000-0000-0000-000000000000', 'courier-A', 'k3'),
    ]) {
      await call().then(
        () => expect.unreachable('a missing delivery must not succeed'),
        (err: unknown) => expectCleanBusinessError(err),
      );
    }
  });

  it('an illegal transition from a terminal state is refused with a business error', async () => {
    const { db, deliveries, offers, couriers, proofs, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A', {
      status: 'delivered',
      deliveredAt: new Date(),
    });
    seedDeliveryCode(proofs, delivery.id, '1234');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    // `delivered` is terminal: a pickup is nonsense, a cancellation is refused.
    await service.markPickedUp(delivery.id, 'courier-A', 'k1').then(
      () => expect.unreachable('cannot pick up a delivered delivery'),
      (err: unknown) => expectCleanBusinessError(err),
    );
    await service.cancel(delivery.id, ['admin'], 'admin-1', 'ops', 'k2').then(
      () => expect.unreachable('cannot cancel a delivered delivery'),
      (err: unknown) => {
        expectCleanBusinessError(err);
        expect((err as ConflictException).getResponse()).toMatchObject({
          code: 'DELIVERY_ALREADY_DELIVERED',
        });
      },
    );
    expect(delivery.status).toBe('delivered');
  });
});
