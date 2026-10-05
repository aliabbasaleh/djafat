import { describe, expect, it } from 'vitest';
import type { Permission, Role } from '@djafat/types';
import {
  canCourierActOnDelivery,
  isStaffTierFor,
  resolveDeliveryAccess,
  resolveOrderAccess,
  type AccessActor,
} from './order-access';

function actor(
  userId: string,
  roles: readonly Role[],
  permissions: readonly Permission[] = [],
): AccessActor {
  return { userId, roles, permissions };
}

const CUSTOMER = 'customer-1';
const OTHER_CUSTOMER = 'customer-2';
const COURIER_ASSIGNED = 'courier-assigned';
const COURIER_OTHER = 'courier-other';
const STAFF_A = 'staff-a';

/**
 * BUG-10.1-AUTH — the centralized tenant rule, tested as pure logic so every
 * branch is provable without a DB. The service-level wiring that feeds these
 * facts is tested in `orders`/`deliveries`; the HTTP round trip is
 * Docker-gated (WRITTEN_NOT_EXECUTED).
 *
 * The invariant under test, stated once: knowing an identifier is never an
 * authorization. Every PASS below is justified by a RELATIONSHIP (ownership,
 * restaurant membership, current courier assignment) or by a staff-tier role
 * holding the matching permission — never by holding a permission alone.
 */
describe('resolveOrderAccess — orders (scenarios A-I)', () => {
  const orderFacts = {
    customerId: CUSTOMER,
    isMemberOfOrderRestaurant: false,
    assignedCourierUserId: COURIER_ASSIGNED,
  };

  it('A. the owning customer is allowed', () => {
    expect(resolveOrderAccess(actor(CUSTOMER, ['customer']), orderFacts, 'orders:read')).toBe(
      'customer',
    );
  });

  it('B. a different customer is DENIED', () => {
    expect(resolveOrderAccess(actor(OTHER_CUSTOMER, ['customer']), orderFacts, 'orders:read')).toBe(
      null,
    );
  });

  it('C. a member of THIS order’s restaurant is allowed', () => {
    const a = actor('staff-of-this-restaurant', ['restaurant_staff'], ['orders:read']);
    expect(
      resolveOrderAccess(a, { ...orderFacts, isMemberOfOrderRestaurant: true }, 'orders:read'),
    ).toBe('restaurant');
  });

  it('D/E/F. a restaurant actor who is NOT a member of this order’s restaurant is DENIED — even holding orders:read', () => {
    for (const roles of [['restaurant_owner'], ['restaurant_staff']] as const) {
      const a = actor('restaurant-elsewhere', roles, ['orders:read']);
      expect(
        resolveOrderAccess(a, { ...orderFacts, isMemberOfOrderRestaurant: false }, 'orders:read'),
      ).toBe(null);
    }
  });

  it('G. the courier CURRENTLY assigned to this order’s delivery is allowed', () => {
    const a = actor(COURIER_ASSIGNED, ['courier'], ['orders:read']);
    expect(resolveOrderAccess(a, orderFacts, 'orders:read')).toBe('courier');
  });

  it('H. a courier who is NOT assigned is DENIED — even holding orders:read', () => {
    const a = actor(COURIER_OTHER, ['courier'], ['orders:read']);
    expect(resolveOrderAccess(a, orderFacts, 'orders:read')).toBe(null);
  });

  it('H2. a courier is DENIED when no courier is assigned at all (null must never match)', () => {
    const a = actor(COURIER_OTHER, ['courier'], ['orders:read']);
    expect(
      resolveOrderAccess(a, { ...orderFacts, assignedCourierUserId: null }, 'orders:read'),
    ).toBe(null);
  });

  it.each(['admin', 'super_admin', 'support', 'finance'] as const)(
    'I. %s with orders:read keeps cross-tenant access (existing staff model preserved)',
    (role) => {
      const a = actor(STAFF_A, [role], ['orders:read']);
      expect(resolveOrderAccess(a, orderFacts, 'orders:read')).toBe('staff');
    },
  );

  it('S. the permission ALONE never authorizes — this is the exact bypass that existed', () => {
    // `orders:read` is held by restaurant/courier roles too; before the fix
    // `OwnershipGuard` returned true on the permission alone.
    const a = actor('unrelated-holder', ['restaurant_staff', 'courier'], ['orders:read']);
    expect(resolveOrderAccess(a, orderFacts, 'orders:read')).toBe(null);
  });

  it('S2. a staff-tier ROLE without the permission is DENIED — both halves are required', () => {
    const a = actor(STAFF_A, ['support'], []);
    expect(resolveOrderAccess(a, orderFacts, 'orders:read')).toBe(null);
  });
});

describe('resolveDeliveryAccess — deliveries (scenarios J, K, N, O)', () => {
  const deliveryFacts = {
    assignedCourierUserId: COURIER_ASSIGNED,
    customerId: CUSTOMER,
    isMemberOfOrderRestaurant: false,
  };

  it('J. the assigned courier is allowed', () => {
    const a = actor(COURIER_ASSIGNED, ['courier'], ['deliveries:read']);
    expect(resolveDeliveryAccess(a, deliveryFacts, 'deliveries:read')).toBe('courier');
  });

  it('K. a non-assigned courier is DENIED — even holding deliveries:read', () => {
    const a = actor(COURIER_OTHER, ['courier'], ['deliveries:read']);
    expect(resolveDeliveryAccess(a, deliveryFacts, 'deliveries:read')).toBe(null);
  });

  it('the owning customer of the order behind the delivery is allowed', () => {
    expect(
      resolveDeliveryAccess(actor(CUSTOMER, ['customer']), deliveryFacts, 'deliveries:read'),
    ).toBe('customer');
  });

  it('N. a restaurant actor is DENIED — no restaurant role holds deliveries:read, so membership alone never suffices', () => {
    const a = actor('restaurant-b', ['restaurant_owner'], []); // seed grants it no deliveries:read
    expect(
      resolveDeliveryAccess(
        a,
        { ...deliveryFacts, isMemberOfOrderRestaurant: true },
        'deliveries:read',
      ),
    ).toBe(null);
  });

  it.each(['admin', 'super_admin', 'support'] as const)(
    'O. %s with deliveries:read keeps access',
    (role) => {
      const a = actor(STAFF_A, [role], ['deliveries:read']);
      expect(resolveDeliveryAccess(a, deliveryFacts, 'deliveries:read')).toBe('staff');
    },
  );
});

describe('canCourierActOnDelivery — fail authority (scenarios L, M)', () => {
  it('L. the assigned courier may act', () => {
    expect(
      canCourierActOnDelivery(
        actor(COURIER_ASSIGNED, ['courier'], ['deliveries:write']),
        COURIER_ASSIGNED,
      ),
    ).toBe(true);
  });

  it('M. a non-assigned courier may NOT act — even holding deliveries:write', () => {
    expect(
      canCourierActOnDelivery(
        actor(COURIER_OTHER, ['courier'], ['deliveries:write']),
        COURIER_ASSIGNED,
      ),
    ).toBe(false);
  });

  it('an unassigned delivery grants nobody courier authority', () => {
    expect(
      canCourierActOnDelivery(actor(COURIER_OTHER, ['courier'], ['deliveries:write']), null),
    ).toBe(false);
  });
});

describe('isStaffTierFor — no new privilege, no widening (scenarios T, U)', () => {
  it.each(['customer', 'courier', 'restaurant_owner', 'restaurant_staff'] as const)(
    'T. %s is never staff-tier, whatever permission it holds',
    (role) => {
      expect(
        isStaffTierFor(actor('u', [role], ['orders:read', 'deliveries:write']), 'orders:read'),
      ).toBe(false);
    },
  );

  it('T2. staff-tier is role AND permission — neither half alone', () => {
    expect(isStaffTierFor(actor('u', ['support'], []), 'orders:read')).toBe(false);
    expect(isStaffTierFor(actor('u', ['customer'], ['orders:read']), 'orders:read')).toBe(false);
    expect(isStaffTierFor(actor('u', ['support'], ['orders:read']), 'orders:read')).toBe(true);
  });

  it('a multi-role actor is staff-tier if ANY role qualifies and the permission is held', () => {
    expect(
      isStaffTierFor(actor('u', ['customer', 'support'], ['orders:read']), 'orders:read'),
    ).toBe(true);
  });
});
