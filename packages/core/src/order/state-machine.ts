import type { OrderStatus, Role } from '@djafat/types';
import { ORDER_TERMINAL_STATUSES } from '@djafat/types';
import { OrderTransitionError } from '../errors.js';

/**
 * Canonical order state machine (docs/06 §6.6 comment block).
 *
 * `trigger` documents WHO/WHAT causes the transition. `roles` (when set)
 * restricts which actor role may perform it via the API; `system` transitions
 * are performed by jobs / event handlers, not a user.
 */
export interface OrderTransition {
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  readonly trigger: string;
  readonly roles?: readonly Role[];
  readonly system?: boolean;
}

export const ORDER_TRANSITIONS: readonly OrderTransition[] = [
  { from: 'draft', to: 'placed', trigger: 'create_order_cod', roles: ['customer'] },
  { from: 'draft', to: 'awaiting_payment', trigger: 'create_order_prepaid', roles: ['customer'] },
  { from: 'awaiting_payment', to: 'placed', trigger: 'payment.succeeded', system: true },
  { from: 'awaiting_payment', to: 'expired', trigger: 'ttl_order_expiry_job', system: true },
  {
    from: 'awaiting_payment',
    to: 'cancelled',
    trigger: 'customer_cancel',
    roles: ['customer', 'admin', 'super_admin'],
  },
  {
    from: 'placed',
    to: 'confirmed',
    trigger: 'restaurant_accept',
    roles: ['restaurant_owner', 'restaurant_staff'],
  },
  {
    from: 'placed',
    to: 'rejected',
    trigger: 'restaurant_reject',
    roles: ['restaurant_owner', 'restaurant_staff'],
  },
  {
    from: 'placed',
    to: 'cancelled',
    trigger: 'cancel_before_preparing',
    roles: ['customer', 'admin', 'super_admin'],
  },
  {
    from: 'confirmed',
    to: 'cancelled',
    trigger: 'cancel_before_preparing',
    roles: ['customer', 'admin', 'super_admin'],
  },
  {
    from: 'confirmed',
    to: 'preparing',
    trigger: 'restaurant_start',
    roles: ['restaurant_owner', 'restaurant_staff'],
  },
  {
    from: 'preparing',
    to: 'ready',
    trigger: 'restaurant_ready',
    roles: ['restaurant_owner', 'restaurant_staff'],
  },
  { from: 'ready', to: 'courier_assigned', trigger: 'dispatch_assign', system: true },
  { from: 'courier_assigned', to: 'picked_up', trigger: 'courier_pickup', roles: ['courier'] },
  { from: 'picked_up', to: 'on_the_way', trigger: 'courier_depart', roles: ['courier'] },
  { from: 'on_the_way', to: 'delivered', trigger: 'courier_deliver', roles: ['courier'] },
  // Exceptional admin override from any active state.
  {
    from: 'placed',
    to: 'cancelled',
    trigger: 'admin_force_cancel',
    roles: ['admin', 'super_admin'],
  },
  {
    from: 'confirmed',
    to: 'cancelled',
    trigger: 'admin_force_cancel',
    roles: ['admin', 'super_admin'],
  },
  {
    from: 'preparing',
    to: 'cancelled',
    trigger: 'admin_force_cancel',
    roles: ['admin', 'super_admin'],
  },
  {
    from: 'ready',
    to: 'cancelled',
    trigger: 'admin_force_cancel',
    roles: ['admin', 'super_admin'],
  },
  {
    from: 'courier_assigned',
    to: 'cancelled',
    trigger: 'admin_force_cancel',
    roles: ['admin', 'super_admin'],
  },
  // Bloc 6: the order follows a cancelled/failed delivery to `cancelled`
  // (docs/25 §29-30) — `deliveries` never transitions `orders` directly
  // (DAG), it emits `delivery.cancelled`/`delivery.failed`, which `orders`
  // reacts to via these two system-flagged transitions. Only from `ready`/
  // `courier_assigned` (before pickup) — once picked up, a failed delivery
  // has no defined order-side reaction yet (documented debt, docs/25 §23).
  { from: 'ready', to: 'cancelled', trigger: 'delivery_cancelled_or_failed', system: true },
  {
    from: 'courier_assigned',
    to: 'cancelled',
    trigger: 'delivery_cancelled_or_failed',
    system: true,
  },
];

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return ORDER_TERMINAL_STATUSES.includes(status);
}

/** All statuses reachable from `from` (ignoring actor role). */
export function nextOrderStatuses(from: OrderStatus): OrderStatus[] {
  return [...new Set(ORDER_TRANSITIONS.filter((t) => t.from === from).map((t) => t.to))];
}

export interface CanTransitionOptions {
  readonly actorRole?: Role;
  /** Allow transitions marked `system: true` (jobs / event handlers). */
  readonly system?: boolean;
}

export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus,
  opts: CanTransitionOptions = {},
): boolean {
  if (isTerminalOrderStatus(from)) return false;
  return ORDER_TRANSITIONS.some((t) => {
    if (t.from !== from || t.to !== to) return false;
    // `system` transitions (jobs / event handlers) are performed only with the
    // explicit `system` flag — never on behalf of a random user role.
    if (t.system) return opts.system === true;
    return (
      opts.actorRole !== undefined && (t.roles === undefined || t.roles.includes(opts.actorRole))
    );
  });
}

/** Throws `OrderTransitionError` if the transition is not allowed. */
export function assertOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
  opts: CanTransitionOptions = {},
): void {
  if (!canTransitionOrder(from, to, opts)) {
    throw new OrderTransitionError(from, to);
  }
}
