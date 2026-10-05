import { describe, expect, it } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedActor, Permission, Role } from '@djafat/types';
import {
  buildDeliveriesServices,
  makeDeliveriesRaceDb,
  seedAssignedOffer,
  CUSTOMER_ID,
  RESTAURANT_ID,
} from './deliveries-test-support';

/**
 * BUG-10.1-AUTH — `GET /deliveries/:id` and `POST /deliveries/:id/fail` tenant
 * isolation, exercised against the REAL `DeliveriesService` over the
 * concurrency harness (`makeDeliveriesRaceDb`), so the race scenarios are
 * genuine `Promise.all` races against row locks, not scripted sequences.
 *
 * Both routes previously used `@RequireOwnership(..., 'deliveries:read'|'deliveries:write')`,
 * and `OwnershipGuard` treats that override as a TOTAL bypass. `courier` holds
 * both permissions, so any courier could read — and FAIL — any other courier's
 * delivery. The HTTP round trip needs Docker: WRITTEN_NOT_EXECUTED.
 */

const COURIER_A = 'courier-A';
const COURIER_B = 'courier-B';

function actor(
  userId: string,
  roles: readonly Role[],
  permissions: readonly Permission[] = [],
): AuthenticatedActor {
  return { userId, sessionId: 's1', roles, permissions, stepUpVerifiedAt: null };
}

/**
 * NOTE the deliberate renaming: `makeDeliveriesRaceDb()` returns the `deliveries`
 * and `couriers` ROWS while `buildDeliveriesServices()` returns SERVICES of the
 * same names — spreading both into one object silently shadows the arrays with
 * the services.
 */
function harness() {
  const {
    db,
    deliveries: rows,
    offers,
    couriers: courierRows,
    ledgerGroups,
  } = makeDeliveriesRaceDb();
  const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);
  return { db, rows, offers, courierRows, ledgerGroups, service };
}

describe('DeliveriesService.getByIdFor — read isolation (J, K, N, O)', () => {
  it('J. the assigned courier reads their own delivery', async () => {
    const h = harness();
    const { delivery } = seedAssignedOffer(h.rows, h.offers, h.courierRows, COURIER_A, {
      status: 'on_the_way',
    });
    await expect(
      h.service.getByIdFor(actor(COURIER_A, ['courier'], ['deliveries:read']), delivery.id),
    ).resolves.toMatchObject({ id: delivery.id });
  });

  it('K. a NON-assigned courier is refused, despite holding deliveries:read', async () => {
    const h = harness();
    const { delivery } = seedAssignedOffer(h.rows, h.offers, h.courierRows, COURIER_A, {
      status: 'on_the_way',
    });
    await expect(
      h.service.getByIdFor(actor(COURIER_B, ['courier'], ['deliveries:read']), delivery.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the owning customer of the order behind the delivery may read it', async () => {
    const h = harness();
    const { delivery } = seedAssignedOffer(h.rows, h.offers, h.courierRows, COURIER_A, {
      status: 'on_the_way',
    });
    await expect(
      h.service.getByIdFor(actor(CUSTOMER_ID, ['customer']), delivery.id),
    ).resolves.toMatchObject({ id: delivery.id });
  });

  it('N. a restaurant actor is refused — no restaurant role holds deliveries:read, so membership alone never suffices', async () => {
    const h = harness();
    const { delivery } = seedAssignedOffer(h.rows, h.offers, h.courierRows, COURIER_A, {
      status: 'on_the_way',
    });
    // Even naming the right restaurant and holding menu/order permissions.
    const restaurantActor = actor(
      'owner-of-' + RESTAURANT_ID,
      ['restaurant_owner'],
      ['orders:read', 'menus:write'],
    );
    await expect(h.service.getByIdFor(restaurantActor, delivery.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each(['admin', 'super_admin', 'support'] as const)(
    'O. %s with deliveries:read keeps access',
    async (role) => {
      const h = harness();
      const { delivery } = seedAssignedOffer(h.rows, h.offers, h.courierRows, COURIER_A, {
        status: 'on_the_way',
      });
      await expect(
        h.service.getByIdFor(actor('staff', [role], ['deliveries:read']), delivery.id),
      ).resolves.toMatchObject({ id: delivery.id });
    },
  );

  it('R. an unknown delivery id is refused identically', async () => {
    const h = harness();
    await expect(
      h.service.getByIdFor(
        actor(COURIER_A, ['courier'], ['deliveries:read']),
        '33333333-3333-4333-8333-333333333333',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DeliveriesService.reportFailed — write isolation (L, M)', () => {
  it('L. the assigned courier may fail their own delivery', async () => {
    const h = harness();
    const { delivery } = seedAssignedOffer(h.rows, h.offers, h.courierRows, COURIER_A, {
      status: 'on_the_way',
    });
    await h.service.reportFailed(
      actor(COURIER_A, ['courier'], ['deliveries:write']),
      delivery.id,
      'customer unreachable',
      'k-ok',
    );
    expect(delivery.status).toBe('failed');
  });

  it('M. a NON-assigned courier may NOT fail it — 403, and the delivery is untouched', async () => {
    const h = harness();
    const { delivery } = seedAssignedOffer(h.rows, h.offers, h.courierRows, COURIER_A, {
      status: 'on_the_way',
    });
    await expect(
      h.service.reportFailed(
        actor(COURIER_B, ['courier'], ['deliveries:write']),
        delivery.id,
        'hijack attempt',
        'k-bad',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(delivery.status).toBe('on_the_way');
    expect(delivery.failedAt).toBeNull();
  });

  it('O2. staff-tier may force-fail regardless of assignment (existing admin authority preserved)', async () => {
    const h = harness();
    const { delivery } = seedAssignedOffer(h.rows, h.offers, h.courierRows, COURIER_A, {
      status: 'on_the_way',
    });
    await h.service.reportFailed(
      actor('admin-1', ['admin'], ['deliveries:write']),
      delivery.id,
      'ops force',
      'k-admin',
    );
    expect(delivery.status).toBe('failed');
  });

  it('R2. an unknown delivery id gives 404 to a courier, leaking nothing', async () => {
    const h = harness();
    await expect(
      h.service.reportFailed(
        actor(COURIER_B, ['courier'], ['deliveries:write']),
        '44444444-4444-4444-8444-444444444444',
        'nope',
        'k-404',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('reportFailed — concurrency (P, Q)', () => {
  it('P. a reassignment racing the fail cannot let a non-assigned courier through', async () => {
    const h = harness();
    const { delivery } = seedAssignedOffer(h.rows, h.offers, h.courierRows, COURIER_A, {
      status: 'on_the_way',
    });

    // B attempts to fail while the row is being reassigned to B underneath.
    // Whatever interleaving wins, B must never fail a delivery it was not
    // assigned to AT WRITE TIME — that is what the `courier_id` predicate in
    // the UPDATE guarantees, beyond the read-then-act check.
    const results = await Promise.allSettled([
      h.service.reportFailed(
        actor(COURIER_B, ['courier'], ['deliveries:write']),
        delivery.id,
        'racing',
        'k-race-1',
      ),
      Promise.resolve().then(() => {
        delivery.courierId = COURIER_B;
      }),
    ]);

    const failAttempt = results[0];
    if (failAttempt.status === 'fulfilled') {
      // Only acceptable if the reassignment genuinely landed first.
      expect(delivery.courierId).toBe(COURIER_B);
    } else {
      expect(delivery.status).toBe('on_the_way');
    }
  });

  it('P2. the ATOMIC layer alone stops a stale authorization — even if the explicit check is fooled, the UPDATE refuses', async () => {
    const h = harness();
    const { delivery } = seedAssignedOffer(h.rows, h.offers, h.courierRows, COURIER_A, {
      status: 'on_the_way',
    });

    // Simulate the exact race the explicit check cannot cover on its own:
    // the pre-check reads an assignment that is already stale (claims B) while
    // the row in the database still belongs to A. Only the `courier_id`
    // predicate inside the UPDATE can catch this — if it were absent, B would
    // successfully fail A's delivery here.
    const db = h.db as unknown as {
      delivery: { findUnique: (args: unknown) => Promise<unknown> };
    };
    const realFindUnique = db.delivery.findUnique.bind(db.delivery);
    let served = false;
    db.delivery.findUnique = async (args: unknown) => {
      if (!served) {
        served = true;
        return { courierId: COURIER_B }; // stale read: B looks assigned
      }
      return realFindUnique(args);
    };

    await expect(
      h.service.reportFailed(
        actor(COURIER_B, ['courier'], ['deliveries:write']),
        delivery.id,
        'stale-auth hijack',
        'k-stale',
      ),
    ).rejects.toThrow();

    // The decisive assertion: A's delivery survived untouched.
    expect(delivery.status).toBe('on_the_way');
    expect(delivery.failedAt).toBeNull();
    expect(delivery.failedReason).toBeNull();
    expect(delivery.courierId).toBe(COURIER_A);
  });

  it('Q. two couriers racing the same delivery — only the assigned one can win', async () => {
    const h = harness();
    const { delivery } = seedAssignedOffer(h.rows, h.offers, h.courierRows, COURIER_A, {
      status: 'on_the_way',
    });

    const results = await Promise.allSettled([
      h.service.reportFailed(
        actor(COURIER_A, ['courier'], ['deliveries:write']),
        delivery.id,
        'legit',
        'k-q-a',
      ),
      h.service.reportFailed(
        actor(COURIER_B, ['courier'], ['deliveries:write']),
        delivery.id,
        'hijack',
        'k-q-b',
      ),
    ]);

    expect(results[0].status).toBe('fulfilled'); // the assigned courier
    expect(results[1].status).toBe('rejected'); // the intruder
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(ForbiddenException);
    expect(delivery.failedReason).toBe('legit');
  });
});

/**
 * BUG-10.1.3 — `POST /deliveries/:id/cancel`. The route carried
 * `@RequireOwnership(..., 'deliveries:write')`, whose override skipped
 * ownership for every holder of that permission. A courier-ONLY actor was
 * still stopped downstream (`courier` appears on no `-> cancelled`
 * transition), which is exactly why this looked non-exploitable — and that
 * conclusion was wrong. `unionFromStatuses` UNIONS the from-statuses of ALL
 * the actor's roles, and `customer` is granted automatically to every account
 * at creation (`users.service.ts`), so every real courier holds
 * `courier + customer`. Through the customer branch the union came back
 * non-empty and the UPDATE filtered on id+status only.
 *
 * These tests therefore never assume a single role: the multi-role actor IS
 * the vulnerability.
 */
describe('DeliveriesService.cancel — tenant isolation, multi-role (BUG-10.1.3, A-O)', () => {
  const OTHER = 'someone-else';

  function cancellable() {
    const h = harness();
    // `courier_assigned` is cancellable by `customer` per the state machine,
    // so the state gate can never be what produces a DENY below — only the
    // tenant rule can.
    const { delivery } = seedAssignedOffer(h.rows, h.offers, h.courierRows, COURIER_A, {
      status: 'courier_assigned',
    });
    return { h, delivery };
  }

  it('A. the owning customer cancels their own delivery', async () => {
    const { h, delivery } = cancellable();
    const res = await h.service.cancel(
      actor(CUSTOMER_ID, ['customer']),
      delivery.id,
      'changed my mind',
      'k-A',
    );
    expect(res.delivery.status).toBe('cancelled');
  });

  it('B. a customer who does NOT own the order is refused (403)', async () => {
    const { h, delivery } = cancellable();
    await expect(
      h.service.cancel(actor(OTHER, ['customer']), delivery.id, 'not mine', 'k-B'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(delivery.status).toBe('courier_assigned');
  });

  it('C. a courier-only actor is refused — holding deliveries:write grants nothing', async () => {
    const { h, delivery } = cancellable();
    await expect(
      h.service.cancel(
        actor(COURIER_A, ['courier'], ['deliveries:write']),
        delivery.id,
        'hijack',
        'k-C',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(delivery.status).toBe('courier_assigned');
  });

  it('D. THE BUG: courier + customer on SOMEONE ELSE’S delivery is refused', async () => {
    const { h, delivery } = cancellable();
    await expect(
      h.service.cancel(
        actor(COURIER_A, ['courier', 'customer'], ['deliveries:write']),
        delivery.id,
        'hijack via role union',
        'k-D',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(delivery.status).toBe('courier_assigned');
    expect(delivery.cancelledBy).toBeNull();
  });

  it('E. courier + customer on their OWN delivery is allowed — the legitimate case still works', async () => {
    const { h, delivery } = cancellable();
    const res = await h.service.cancel(
      actor(CUSTOMER_ID, ['courier', 'customer'], ['deliveries:write']),
      delivery.id,
      'my own order',
      'k-E',
    );
    expect(res.delivery.status).toBe('cancelled');
  });

  it.each(['admin', 'super_admin'] as const)(
    'F/G. %s cancels without owning anything (staff authority preserved)',
    async (role) => {
      const { h, delivery } = cancellable();
      const res = await h.service.cancel(
        actor('staff-1', [role], ['deliveries:write']),
        delivery.id,
        'ops',
        `k-${role}`,
      );
      expect(res.delivery.status).toBe('cancelled');
    },
  );

  it.each([
    ['H. restaurant_owner', ['restaurant_owner'] as Role[], [] as Permission[]],
    ['I. restaurant_staff', ['restaurant_staff'] as Role[], [] as Permission[]],
    ['J. support', ['support'] as Role[], ['deliveries:read'] as Permission[]],
    ['K. finance', ['finance'] as Role[], [] as Permission[]],
  ])('%s is refused — no implicit cancel authority', async (_label, roles, permissions) => {
    const { h, delivery } = cancellable();
    await expect(
      h.service.cancel(actor(OTHER, roles, permissions), delivery.id, 'x', `k-${_label}`),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(delivery.status).toBe('courier_assigned');
  });

  it('O. a customer + restaurant_staff actor gains nothing from the union either', async () => {
    const { h, delivery } = cancellable();
    await expect(
      h.service.cancel(
        actor(OTHER, ['customer', 'restaurant_staff'], ['menus:write']),
        delivery.id,
        'union probe',
        'k-O',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('L. a non-cancellable state is still refused for the legitimate owner (409, state gate intact)', async () => {
    const h = harness();
    const { delivery } = seedAssignedOffer(h.rows, h.offers, h.courierRows, COURIER_A, {
      status: 'on_the_way', // customer may not cancel from here
    });
    await expect(
      h.service.cancel(actor(CUSTOMER_ID, ['customer']), delivery.id, 'too late', 'k-L'),
    ).rejects.toMatchObject({ response: { code: 'DELIVERY_INVALID_STATE' } });
    expect(delivery.status).toBe('on_the_way');
  });

  it('M. an unknown delivery UUID is refused', async () => {
    const h = harness();
    await expect(
      h.service.cancel(
        actor(CUSTOMER_ID, ['customer']),
        '55555555-5555-4555-8555-555555555555',
        'x',
        'k-M',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('N. a STALE authorization cannot cancel — the UPDATE is pinned to the authorized order', async () => {
    const { h, delivery } = cancellable();

    // The pre-check resolves ownership against order X (the actor owns it), but
    // by write time the delivery row points at a DIFFERENT order. Only the
    // `order_id = <authorized order>` predicate inside the UPDATE catches this;
    // without it, the stale authorization would carry the cancel through.
    const db = h.db as unknown as {
      delivery: { findUnique: (args: unknown) => Promise<unknown> };
    };
    const real = db.delivery.findUnique.bind(db.delivery);
    let served = false;
    db.delivery.findUnique = async (args: unknown) => {
      if (!served) {
        served = true;
        return { orderId: 'order-authorized-then-changed' };
      }
      return real(args);
    };

    await expect(
      h.service.cancel(actor(CUSTOMER_ID, ['customer']), delivery.id, 'stale', 'k-N'),
    ).rejects.toThrow();
    expect(delivery.status).toBe('courier_assigned');
    expect(delivery.cancelledAt).toBeNull();
  });
});
