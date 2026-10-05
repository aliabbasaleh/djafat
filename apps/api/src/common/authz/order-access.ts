import type { Permission } from '@djafat/types';
import { isStaffTierFor, type AccessActor } from './staff-tier';

export { isStaffTierFor, STAFF_TIER_ROLES, type AccessActor } from './staff-tier';

/**
 * The ONE tenant-isolation rule for an order and its delivery (BUG-10.1-AUTH).
 *
 * Lives in `common/` because both `orders` and `deliveries` must apply the
 * SAME rule and `common/` is the only place reachable from every module
 * (docs/05 §5.3). Deliberately DI-free and side-effect-free: each caller
 * gathers the facts with whatever it is allowed to reach (its own tables,
 * `UsersService`, or a DAG-safe port) and then asks this module for the
 * decision. That keeps one source of truth without creating a DI cycle —
 * `DeliveriesService` already injects `ORDER_AMOUNT_PORT` (bound to
 * `OrdersService`), so an injectable policy that in turn needed
 * `DELIVERY_TRACKING_PORT` would close a constructor loop.
 *
 * WHY this exists: `GET /orders/:id`, `GET /deliveries/:id` and
 * `POST /deliveries/:id/fail` all used `@RequireOwnership(..., overridePermission)`,
 * and `OwnershipGuard` treats that override as a TOTAL ownership bypass. The
 * overrides were `orders:read` / `deliveries:read` / `deliveries:write` —
 * permissions the seed also grants to `restaurant_owner`, `restaurant_staff`
 * and `courier`. Any of them could therefore reach any order/delivery whose
 * UUID they knew. Knowing an identifier is not an authorization.
 *
 * The rule mirrors what `realtime.gateway.ts::isAuthorizedForRoom` already
 * enforced correctly for socket rooms — this is the REST layer catching up,
 * not a new model.
 */

export type OrderAccessGrant = 'staff' | 'customer' | 'restaurant' | 'courier';

export interface OrderAccessFacts {
  /** The order's owning customer. */
  readonly customerId: string;
  /** Whether the actor holds a restaurant-scoped grant on THIS order's restaurant. */
  readonly isMemberOfOrderRestaurant: boolean;
  /** The courier CURRENTLY assigned to this order's delivery, if any. */
  readonly assignedCourierUserId: string | null;
}

/**
 * Why the actor may see this order, or `null` for deny. Returning the reason
 * rather than a boolean keeps the decision auditable and makes the tests
 * assert the PATH, not just the outcome — a test that passes for the wrong
 * reason is worse than no test.
 */
export function resolveOrderAccess(
  actor: AccessActor,
  facts: OrderAccessFacts,
  staffPermission: Permission,
): OrderAccessGrant | null {
  if (isStaffTierFor(actor, staffPermission)) return 'staff';
  if (facts.customerId === actor.userId) return 'customer';
  if (facts.isMemberOfOrderRestaurant) return 'restaurant';
  if (facts.assignedCourierUserId !== null && facts.assignedCourierUserId === actor.userId) {
    return 'courier';
  }
  return null;
}

export interface DeliveryAccessFacts {
  /** The courier CURRENTLY assigned to this delivery, if any. */
  readonly assignedCourierUserId: string | null;
  /** The owning customer of the order behind this delivery. */
  readonly customerId: string;
  /**
   * Whether the actor holds a restaurant-scoped grant on the restaurant of
   * the order behind this delivery. NOTE: a restaurant member still needs the
   * delivery permission below, which the seed grants to NO restaurant role
   * today — so this branch currently never fires. It is expressed anyway so
   * the rule is complete and so granting that permission later cannot
   * accidentally hand restaurants a cross-tenant view.
   */
  readonly isMemberOfOrderRestaurant: boolean;
}

export function resolveDeliveryAccess(
  actor: AccessActor,
  facts: DeliveryAccessFacts,
  staffPermission: Permission,
): OrderAccessGrant | null {
  if (facts.assignedCourierUserId !== null && facts.assignedCourierUserId === actor.userId) {
    return 'courier';
  }
  if (facts.customerId === actor.userId) return 'customer';
  if (isStaffTierFor(actor, staffPermission)) return 'staff';
  if (facts.isMemberOfOrderRestaurant && actor.permissions.includes(staffPermission)) {
    return 'restaurant';
  }
  return null;
}

/**
 * May this actor transition THIS delivery as a courier? A courier's authority
 * is strictly "I am the one currently assigned" — never "I hold
 * `deliveries:write`". Staff-tier keeps its existing, assignment-independent
 * authority (an admin force-failing a stuck delivery must stay possible).
 *
 * The caller MUST additionally scope the write itself by `courier_id` inside
 * the same transaction: this answer is read-then-act and a reassignment can
 * land in between (docs/25 §12 assigns under `FOR UPDATE`).
 */
export function canCourierActOnDelivery(
  actor: AccessActor,
  assignedCourierUserId: string | null,
): boolean {
  return assignedCourierUserId !== null && assignedCourierUserId === actor.userId;
}
