import type { Permission, Role } from '@djafat/types';

/**
 * "Does this actor legitimately see across tenants?" — the one answer shared by
 * `OwnershipGuard` and every service-level tenant rule.
 *
 * Extracted from `order-access.ts` (pre-Bloc-10 hardening) because the notion
 * is not order-specific: `OwnershipGuard` guards payments, deliveries and
 * orders alike, and importing an `order-access` symbol there would have been a
 * lie about what the rule is.
 */

/**
 * Roles whose job spans tenants. Deliberately a CLOSED list of four, not
 * "anyone holding the permission": every tenant-isolation bug in the
 * BUG-10.1.x family came from treating a permission as proof of staff status,
 * when the seed grants several of those permissions (`orders:read`,
 * `deliveries:read`, `deliveries:write`) to `restaurant_owner`,
 * `restaurant_staff` and `courier` too.
 */
export const STAFF_TIER_ROLES: readonly Role[] = ['admin', 'super_admin', 'support', 'finance'];

export interface AccessActor {
  readonly userId: string;
  readonly roles: readonly Role[];
  readonly permissions: readonly Permission[];
}

/**
 * Staff-tier AND holding the relevant permission. Both halves are required and
 * neither is sufficient: the role says "this actor's job spans tenants", the
 * permission says "for this kind of resource".
 *
 * This is strictly NARROWER than the old "holds the permission" test — it can
 * only ever refuse an actor the old rule would have allowed, never the
 * reverse. That is what makes it safe to apply uniformly: it cannot widen
 * anyone's access, and it does not touch RBAC (no permission is added, removed
 * or re-assigned).
 */
export function isStaffTierFor(actor: AccessActor, permission: Permission): boolean {
  return (
    actor.roles.some((role) => STAFF_TIER_ROLES.includes(role)) &&
    actor.permissions.includes(permission)
  );
}
