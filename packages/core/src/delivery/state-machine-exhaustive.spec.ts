import { describe, expect, it } from 'vitest';
import type { DeliveryStatus, Role } from '@djafat/types';
import { DELIVERY_STATUSES, DELIVERY_TERMINAL_STATUSES } from '@djafat/types';
import { DeliveryTransitionError } from '../errors.js';
import {
  DELIVERY_TRANSITIONS,
  assertDeliveryTransition,
  canTransitionDelivery,
  fromStatusesFor,
  isTerminalDeliveryStatus,
  nextDeliveryStatuses,
} from './state-machine.js';

/**
 * Bloc 6.1 §5 — every valid AND invalid transition, exhaustively.
 *
 * `state-machine.spec.ts` (Bloc 6) tested the behaviour of each function on
 * chosen examples. This file instead walks the ENTIRE 10x10 matrix of
 * (from, to) pairs and asserts each cell agrees with the declared transition
 * table, for every actor context. An edge added to the table without being
 * thought through shows up here as a changed cell, not as silence.
 */

const ALL_ROLES: readonly Role[] = [
  'customer',
  'courier',
  'restaurant_owner',
  'restaurant_staff',
  'admin',
  'super_admin',
];

/** Every way a caller can ask the machine a question. */
const CONTEXTS: ReadonlyArray<{ label: string; opts: { actorRole?: Role; system?: boolean } }> = [
  { label: 'system', opts: { system: true } },
  ...ALL_ROLES.map((actorRole) => ({ label: `role:${actorRole}`, opts: { actorRole } })),
  { label: 'no context', opts: {} },
];

/** The table's own answer, computed without going through the machine's code. */
function tableAllows(
  from: DeliveryStatus,
  to: DeliveryStatus,
  opts: { actorRole?: Role; system?: boolean },
): boolean {
  if (DELIVERY_TERMINAL_STATUSES.includes(from)) return false;
  if (from === to) return false;
  return DELIVERY_TRANSITIONS.some((t) => {
    if (t.from !== from || t.to !== to) return false;
    if (t.system === true) return opts.system === true;
    if (opts.actorRole === undefined) return false;
    return t.roles === undefined || t.roles.includes(opts.actorRole);
  });
}

describe('the full transition matrix (mandate §5)', () => {
  it('covers every one of the 100 (from, to) pairs in every actor context', () => {
    let checked = 0;
    for (const from of DELIVERY_STATUSES) {
      for (const to of DELIVERY_STATUSES) {
        for (const { label, opts } of CONTEXTS) {
          const expected = tableAllows(from, to, opts);
          expect(canTransitionDelivery(from, to, opts), `${from} -> ${to} as ${label}`).toBe(
            expected,
          );
          checked += 1;
        }
      }
    }
    expect(checked).toBe(DELIVERY_STATUSES.length * DELIVERY_STATUSES.length * CONTEXTS.length);
  });

  it('a terminal status is a dead end for everyone, including the system', () => {
    for (const from of DELIVERY_TERMINAL_STATUSES) {
      expect(isTerminalDeliveryStatus(from)).toBe(true);
      expect(nextDeliveryStatuses(from)).toEqual([]);
      for (const to of DELIVERY_STATUSES) {
        for (const { label, opts } of CONTEXTS) {
          expect(canTransitionDelivery(from, to, opts), `${from} -> ${to} as ${label}`).toBe(false);
        }
      }
    }
  });

  it('a status can never transition to itself, however it is asked', () => {
    for (const status of DELIVERY_STATUSES) {
      for (const { label, opts } of CONTEXTS) {
        expect(canTransitionDelivery(status, status, opts), `${status} self as ${label}`).toBe(
          false,
        );
      }
    }
  });

  it('every declared transition is actually reachable by the actor it names', () => {
    // Guards against a transition declared with a role list nobody holds, or a
    // `system` flag that makes it unreachable by its own declared roles.
    for (const t of DELIVERY_TRANSITIONS) {
      const opts = t.system === true ? { system: true } : { actorRole: (t.roles ?? ALL_ROLES)[0]! };
      expect(canTransitionDelivery(t.from, t.to, opts), `${t.from} -> ${t.to} (${t.trigger})`).toBe(
        true,
      );
    }
  });

  it('no declared transition starts from a terminal status', () => {
    const offenders = DELIVERY_TRANSITIONS.filter((t) =>
      DELIVERY_TERMINAL_STATUSES.includes(t.from),
    );
    expect(offenders).toEqual([]);
  });
});

describe('the specific illegal moves the mandate names (mandate §5)', () => {
  // Each of these must be refused for EVERY actor, including admins and the
  // system — none of them is "allowed with enough privilege".
  const ILLEGAL: ReadonlyArray<[DeliveryStatus, DeliveryStatus]> = [
    ['pending', 'delivered'],
    ['pending', 'picked_up'],
    ['delivered', 'on_the_way'],
    ['cancelled', 'courier_assigned'],
    ['failed', 'delivered'],
  ];

  for (const [from, to] of ILLEGAL) {
    it(`refuses ${from} -> ${to} for every actor`, () => {
      for (const { label, opts } of CONTEXTS) {
        expect(canTransitionDelivery(from, to, opts), `as ${label}`).toBe(false);
        expect(() => assertDeliveryTransition(from, to, opts)).toThrow(DeliveryTransitionError);
      }
    });
  }

  it('the refusal carries both statuses, so the caller can build a precise message', () => {
    try {
      assertDeliveryTransition('delivered', 'on_the_way', { actorRole: 'courier' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DeliveryTransitionError);
      expect((err as Error).message).toContain('delivered');
      expect((err as Error).message).toContain('on_the_way');
    }
  });

  it('a skipped step is refused even when both ends are individually legal', () => {
    // `courier_accepted` and `on_the_way` are both real states, and both are
    // reachable — but not from one another directly. The API collapses the
    // intermediate hops explicitly (see `doMarkPickedUp`); the machine itself
    // never blesses the shortcut.
    expect(canTransitionDelivery('courier_accepted', 'on_the_way', { actorRole: 'courier' })).toBe(
      false,
    );
    expect(canTransitionDelivery('courier_assigned', 'picked_up', { actorRole: 'courier' })).toBe(
      false,
    );
    expect(canTransitionDelivery('searching_courier', 'delivered', { system: true })).toBe(false);
  });
});

describe('role separation (mandate §5, §7)', () => {
  it('only a courier may drive the physical hops', () => {
    const courierOnly: ReadonlyArray<[DeliveryStatus, DeliveryStatus]> = [
      ['courier_assigned', 'courier_accepted'],
      ['courier_accepted', 'pickup_in_progress'],
      ['pickup_in_progress', 'picked_up'],
      ['picked_up', 'on_the_way'],
      ['on_the_way', 'delivered'],
    ];
    for (const [from, to] of courierOnly) {
      expect(canTransitionDelivery(from, to, { actorRole: 'courier' })).toBe(true);
      for (const role of ALL_ROLES.filter((r) => r !== 'courier')) {
        expect(canTransitionDelivery(from, to, { actorRole: role }), `${role} on ${from}`).toBe(
          false,
        );
      }
      // Not even the background jobs may fake a physical event.
      expect(canTransitionDelivery(from, to, { system: true })).toBe(false);
    }
  });

  it('a customer may cancel only before the courier has committed', () => {
    expect(canTransitionDelivery('pending', 'cancelled', { actorRole: 'customer' })).toBe(true);
    expect(canTransitionDelivery('searching_courier', 'cancelled', { actorRole: 'customer' })).toBe(
      true,
    );
    expect(canTransitionDelivery('courier_assigned', 'cancelled', { actorRole: 'customer' })).toBe(
      true,
    );
    expect(canTransitionDelivery('courier_accepted', 'cancelled', { actorRole: 'customer' })).toBe(
      true,
    );
    // Once the courier is at or past the restaurant, only an admin may force it.
    for (const from of ['pickup_in_progress', 'picked_up', 'on_the_way'] as DeliveryStatus[]) {
      expect(canTransitionDelivery(from, 'cancelled', { actorRole: 'customer' }), from).toBe(false);
      expect(canTransitionDelivery(from, 'cancelled', { actorRole: 'admin' }), from).toBe(true);
    }
  });

  it('a delivery can only FAIL once it has actually been attempted', () => {
    for (const from of ['pending', 'searching_courier', 'courier_assigned'] as DeliveryStatus[]) {
      for (const { label, opts } of CONTEXTS) {
        expect(canTransitionDelivery(from, 'failed', opts), `${from} as ${label}`).toBe(false);
      }
    }
    for (const from of ['pickup_in_progress', 'picked_up', 'on_the_way'] as DeliveryStatus[]) {
      expect(canTransitionDelivery(from, 'failed', { actorRole: 'courier' }), from).toBe(true);
    }
  });

  it('a restaurant never drives the delivery lifecycle at all', () => {
    for (const role of ['restaurant_owner', 'restaurant_staff'] as Role[]) {
      for (const from of DELIVERY_STATUSES) {
        for (const to of DELIVERY_STATUSES) {
          expect(
            canTransitionDelivery(from, to, { actorRole: role }),
            `${role} ${from}->${to}`,
          ).toBe(false);
        }
      }
    }
  });
});

describe('fromStatusesFor is a faithful inverse of the matrix (mandate §5)', () => {
  // This is the function `deliveries.service.ts` derives its SQL `WHERE status
  // = ANY(...)` guards from. If it ever disagrees with `canTransitionDelivery`,
  // the database guard and the in-memory check diverge — which is precisely how
  // the Bloc 6 pickup bug went unnoticed.
  it('returns exactly the statuses the matrix says can reach the target', () => {
    for (const to of DELIVERY_STATUSES) {
      for (const { label, opts } of CONTEXTS) {
        const derived = fromStatusesFor(to, opts).sort();
        const expected = DELIVERY_STATUSES.filter((from) => tableAllows(from, to, opts)).sort();
        expect(derived, `-> ${to} as ${label}`).toEqual(expected);
      }
    }
  });

  it('never returns a terminal status as a legal origin', () => {
    for (const to of DELIVERY_STATUSES) {
      for (const { opts } of CONTEXTS) {
        for (const from of fromStatusesFor(to, opts)) {
          expect(DELIVERY_TERMINAL_STATUSES.includes(from)).toBe(false);
        }
      }
    }
  });

  it('returns an empty set for a role with no authority, so the SQL guard matches nothing', () => {
    // `status = ANY('{}')` matches no row — the service then answers a clean
    // business error rather than performing an unauthorised write.
    expect(fromStatusesFor('delivered', { actorRole: 'restaurant_owner' })).toEqual([]);
    expect(fromStatusesFor('picked_up', { actorRole: 'customer' })).toEqual([]);
    expect(fromStatusesFor('failed', { actorRole: 'customer' })).toEqual([]);
  });

  it('the two-hop pickup collapse the API performs is grounded in real edges', () => {
    // `doMarkPickedUp` unions these two sets to accept a courier at either
    // point. Both must be non-empty, or the endpoint is unreachable — the
    // Bloc 6 bug in one assertion.
    const viaArrival = fromStatusesFor('pickup_in_progress', { actorRole: 'courier' });
    const direct = fromStatusesFor('picked_up', { actorRole: 'courier' });

    expect(viaArrival).toEqual(['courier_accepted']);
    expect(direct).toEqual(['pickup_in_progress']);
    expect([...new Set([...viaArrival, ...direct])]).toEqual([
      'courier_accepted',
      'pickup_in_progress',
    ]);
  });
});
