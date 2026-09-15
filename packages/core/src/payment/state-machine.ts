import type { PaymentStatus, Role } from '@djafat/types';
import { PaymentTransitionError } from '../errors.js';

/**
 * Canonical payment state machine (docs/08 §8.3). Mirrors the shape of
 * `order/state-machine.ts`. The one rule every caller (webhook handler,
 * `getStatus()` poller, cancel/refund endpoints) must respect: **no
 * transition ever leaves a terminal status** — a late/out-of-order webhook
 * arriving after the payment already resolved is a no-op, never a regression.
 */
export interface PaymentTransition {
  readonly from: PaymentStatus;
  readonly to: PaymentStatus;
  readonly trigger: string;
  readonly roles?: readonly Role[];
  readonly system?: boolean;
}

/** Terminal: nothing may transition OUT of these (docs/08 §8.3 "transitions monotones"). */
export const PAYMENT_TERMINAL_STATUSES: readonly PaymentStatus[] = [
  'failed',
  'cancelled',
  'expired',
  'refunded',
];

export const PAYMENT_TRANSITIONS: readonly PaymentTransition[] = [
  // Webhook / poll resolution from the initial state.
  { from: 'pending', to: 'authorized', trigger: 'provider_authorize', system: true },
  { from: 'pending', to: 'succeeded', trigger: 'provider_confirm', system: true },
  { from: 'pending', to: 'failed', trigger: 'provider_reject', system: true },
  { from: 'pending', to: 'expired', trigger: 'ttl_order_expiry_job', system: true },
  { from: 'pending', to: 'needs_review', trigger: 'amount_or_signature_mismatch', system: true },
  {
    from: 'pending',
    to: 'cancelled',
    trigger: 'cancel',
    roles: ['customer', 'admin', 'super_admin'],
  },
  // Optional authorize/capture leg — only used when `capabilities.capture`.
  { from: 'authorized', to: 'succeeded', trigger: 'capture', system: true },
  { from: 'authorized', to: 'failed', trigger: 'provider_reject', system: true },
  {
    from: 'authorized',
    to: 'cancelled',
    trigger: 'cancel',
    roles: ['customer', 'admin', 'super_admin'],
  },
  // NEEDS_REVIEW is always resolved manually by ops (docs/08 §8.3) — never auto.
  {
    from: 'needs_review',
    to: 'succeeded',
    trigger: 'ops_resolve',
    roles: ['admin', 'super_admin'],
  },
  { from: 'needs_review', to: 'failed', trigger: 'ops_resolve', roles: ['admin', 'super_admin'] },
  {
    from: 'needs_review',
    to: 'cancelled',
    trigger: 'ops_resolve',
    roles: ['admin', 'super_admin'],
  },
  // Refunds — only ever from a resolved success.
  {
    from: 'succeeded',
    to: 'refunded',
    trigger: 'refund_full',
    roles: ['admin', 'super_admin', 'finance'],
  },
  {
    from: 'succeeded',
    to: 'partially_refunded',
    trigger: 'refund_partial',
    roles: ['admin', 'super_admin', 'finance'],
  },
  {
    from: 'partially_refunded',
    to: 'refunded',
    trigger: 'refund_full',
    roles: ['admin', 'super_admin', 'finance'],
  },
];

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return PAYMENT_TERMINAL_STATUSES.includes(status);
}

/** All statuses reachable from `from` (ignoring actor role). */
export function nextPaymentStatuses(from: PaymentStatus): PaymentStatus[] {
  return [...new Set(PAYMENT_TRANSITIONS.filter((t) => t.from === from).map((t) => t.to))];
}

export interface CanTransitionPaymentOptions {
  readonly actorRole?: Role;
  /** Allow transitions marked `system: true` (webhook handler, poller, expiry job). */
  readonly system?: boolean;
}

export function canTransitionPayment(
  from: PaymentStatus,
  to: PaymentStatus,
  opts: CanTransitionPaymentOptions = {},
): boolean {
  if (isTerminalPaymentStatus(from)) return false;
  if (from === to) return false;
  return PAYMENT_TRANSITIONS.some((t) => {
    if (t.from !== from || t.to !== to) return false;
    if (t.system) return opts.system === true;
    return (
      opts.actorRole !== undefined && (t.roles === undefined || t.roles.includes(opts.actorRole))
    );
  });
}

/** Throws `PaymentTransitionError` if the transition is not allowed. */
export function assertPaymentTransition(
  from: PaymentStatus,
  to: PaymentStatus,
  opts: CanTransitionPaymentOptions = {},
): void {
  if (!canTransitionPayment(from, to, opts)) {
    throw new PaymentTransitionError(from, to);
  }
}
