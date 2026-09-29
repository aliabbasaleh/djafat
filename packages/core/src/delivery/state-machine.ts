import type { DeliveryStatus, Role } from '@djafat/types';
import { DELIVERY_TERMINAL_STATUSES } from '@djafat/types';
import { DeliveryTransitionError } from '../errors.js';

/**
 * Canonical delivery state machine (Bloc 6, docs/25 §3). Mirrors the shape of
 * `order/state-machine.ts` and `payment/state-machine.ts`. `deliveries.service.ts`
 * derives its guarded `WHERE status = ANY(...)` clauses FROM this module
 * (`fromStatusesFor`) rather than hand-duplicating the transition list — the
 * Bloc 5 QA pass found that a state machine nobody actually calls can silently
 * drift from the code that matters (docs/24 §17 D-16); this closes that gap.
 */
export interface DeliveryTransition {
  readonly from: DeliveryStatus;
  readonly to: DeliveryStatus;
  readonly trigger: string;
  readonly roles?: readonly Role[];
  readonly system?: boolean;
}

export const DELIVERY_TRANSITIONS: readonly DeliveryTransition[] = [
  { from: 'pending', to: 'searching_courier', trigger: 'dispatch_start', system: true },
  { from: 'searching_courier', to: 'courier_assigned', trigger: 'dispatch_assign', system: true },
  {
    from: 'courier_assigned',
    to: 'courier_accepted',
    trigger: 'courier_accept',
    roles: ['courier'],
  },
  // A reject/timeout sends it back to the pool for the next candidate.
  {
    from: 'courier_assigned',
    to: 'searching_courier',
    trigger: 'courier_reject',
    roles: ['courier'],
  },
  { from: 'courier_assigned', to: 'searching_courier', trigger: 'offer_expired', system: true },
  {
    from: 'courier_accepted',
    to: 'pickup_in_progress',
    trigger: 'courier_arrived_restaurant',
    roles: ['courier'],
  },
  { from: 'pickup_in_progress', to: 'picked_up', trigger: 'courier_pickup', roles: ['courier'] },
  { from: 'picked_up', to: 'on_the_way', trigger: 'courier_depart', roles: ['courier'] },
  { from: 'on_the_way', to: 'delivered', trigger: 'courier_deliver', roles: ['courier'] },

  // Cancellation — allowed from every active (non-terminal) state, but the
  // ledger/compensation consequence differs before vs. after pickup (docs/25
  // §11 — no automatic claw-back of a courier's already-reclassified fee).
  {
    from: 'pending',
    to: 'cancelled',
    trigger: 'customer_cancel',
    roles: ['customer', 'admin', 'super_admin'],
  },
  {
    from: 'searching_courier',
    to: 'cancelled',
    trigger: 'customer_cancel',
    roles: ['customer', 'admin', 'super_admin'],
  },
  {
    from: 'courier_assigned',
    to: 'cancelled',
    trigger: 'customer_cancel',
    roles: ['customer', 'admin', 'super_admin'],
  },
  {
    from: 'courier_accepted',
    to: 'cancelled',
    trigger: 'cancel',
    roles: ['customer', 'admin', 'super_admin'],
  },
  {
    from: 'pickup_in_progress',
    to: 'cancelled',
    trigger: 'admin_force_cancel',
    roles: ['admin', 'super_admin'],
  },
  {
    from: 'picked_up',
    to: 'cancelled',
    trigger: 'admin_force_cancel',
    roles: ['admin', 'super_admin'],
  },
  {
    from: 'on_the_way',
    to: 'cancelled',
    trigger: 'admin_force_cancel',
    roles: ['admin', 'super_admin'],
  },

  // Failed — a delivery genuinely attempted but not completable (docs/25 §14).
  {
    from: 'pickup_in_progress',
    to: 'failed',
    trigger: 'delivery_failed',
    roles: ['courier', 'admin', 'super_admin'],
  },
  {
    from: 'picked_up',
    to: 'failed',
    trigger: 'delivery_failed',
    roles: ['courier', 'admin', 'super_admin'],
  },
  {
    from: 'on_the_way',
    to: 'failed',
    trigger: 'delivery_failed',
    roles: ['courier', 'admin', 'super_admin'],
  },
];

export function isTerminalDeliveryStatus(status: DeliveryStatus): boolean {
  return DELIVERY_TERMINAL_STATUSES.includes(status);
}

/** All statuses reachable from `from` (ignoring actor role). */
export function nextDeliveryStatuses(from: DeliveryStatus): DeliveryStatus[] {
  return [...new Set(DELIVERY_TRANSITIONS.filter((t) => t.from === from).map((t) => t.to))];
}

/**
 * All statuses a conditional `WHERE status = ANY(...)` may transition FROM
 * to land on `to`, for a given actor context. Callers derive their SQL guard
 * from this instead of hand-listing statuses (see module doc comment).
 */
export function fromStatusesFor(
  to: DeliveryStatus,
  opts: CanTransitionDeliveryOptions,
): DeliveryStatus[] {
  return [
    ...new Set(
      DELIVERY_TRANSITIONS.filter((t) => {
        if (t.to !== to) return false;
        if (t.system) return opts.system === true;
        return (
          opts.actorRole !== undefined &&
          (t.roles === undefined || t.roles.includes(opts.actorRole))
        );
      }).map((t) => t.from),
    ),
  ];
}

export interface CanTransitionDeliveryOptions {
  readonly actorRole?: Role;
  /** Allow transitions marked `system: true` (dispatch job, offer-expiry job). */
  readonly system?: boolean;
}

export function canTransitionDelivery(
  from: DeliveryStatus,
  to: DeliveryStatus,
  opts: CanTransitionDeliveryOptions = {},
): boolean {
  if (isTerminalDeliveryStatus(from)) return false;
  if (from === to) return false;
  return DELIVERY_TRANSITIONS.some((t) => {
    if (t.from !== from || t.to !== to) return false;
    if (t.system) return opts.system === true;
    return (
      opts.actorRole !== undefined && (t.roles === undefined || t.roles.includes(opts.actorRole))
    );
  });
}

/** Throws `DeliveryTransitionError` if the transition is not allowed. */
export function assertDeliveryTransition(
  from: DeliveryStatus,
  to: DeliveryStatus,
  opts: CanTransitionDeliveryOptions = {},
): void {
  if (!canTransitionDelivery(from, to, opts)) {
    throw new DeliveryTransitionError(from, to);
  }
}
