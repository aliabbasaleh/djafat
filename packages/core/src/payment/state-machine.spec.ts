import { describe, expect, it } from 'vitest';
import { PaymentTransitionError } from '../errors.js';
import {
  PAYMENT_TRANSITIONS,
  assertPaymentTransition,
  canTransitionPayment,
  isTerminalPaymentStatus,
  nextPaymentStatuses,
} from './state-machine.js';

describe('payment state machine (docs/08 §8.3)', () => {
  it('allows the synchronous/webhook happy path', () => {
    expect(canTransitionPayment('pending', 'succeeded', { system: true })).toBe(true);
    expect(canTransitionPayment('pending', 'failed', { system: true })).toBe(true);
    expect(canTransitionPayment('pending', 'authorized', { system: true })).toBe(true);
    expect(canTransitionPayment('authorized', 'succeeded', { system: true })).toBe(true);
  });

  it('allows needs_review only to be resolved by ops (admin/super_admin), never automatically', () => {
    expect(canTransitionPayment('needs_review', 'succeeded', { system: true })).toBe(false);
    expect(canTransitionPayment('needs_review', 'succeeded', { actorRole: 'admin' })).toBe(true);
    expect(canTransitionPayment('needs_review', 'failed', { actorRole: 'super_admin' })).toBe(true);
    expect(canTransitionPayment('needs_review', 'cancelled', { actorRole: 'customer' })).toBe(
      false,
    );
  });

  it('allows a customer or admin to cancel a pending/authorized payment', () => {
    expect(canTransitionPayment('pending', 'cancelled', { actorRole: 'customer' })).toBe(true);
    expect(canTransitionPayment('authorized', 'cancelled', { actorRole: 'admin' })).toBe(true);
    expect(canTransitionPayment('pending', 'cancelled', { actorRole: 'courier' })).toBe(false);
  });

  it('allows refunds only from succeeded/partially_refunded, by finance-tier roles', () => {
    expect(canTransitionPayment('succeeded', 'refunded', { actorRole: 'finance' })).toBe(true);
    expect(canTransitionPayment('succeeded', 'partially_refunded', { actorRole: 'admin' })).toBe(
      true,
    );
    expect(
      canTransitionPayment('partially_refunded', 'refunded', { actorRole: 'super_admin' }),
    ).toBe(true);
    expect(canTransitionPayment('pending', 'refunded', { actorRole: 'admin' })).toBe(false);
    expect(canTransitionPayment('succeeded', 'refunded', { actorRole: 'customer' })).toBe(false);
  });

  it('NEVER allows a transition out of a terminal status — the out-of-order-webhook guard', () => {
    for (const terminal of ['failed', 'cancelled', 'expired', 'refunded'] as const) {
      expect(isTerminalPaymentStatus(terminal)).toBe(true);
      expect(nextPaymentStatuses(terminal)).toEqual([]);
      // A late webhook claiming this now-terminal payment "succeeded" must never apply.
      expect(canTransitionPayment(terminal, 'succeeded', { system: true })).toBe(false);
      expect(canTransitionPayment(terminal, 'failed', { system: true })).toBe(false);
    }
  });

  it('rejects a same-state "transition" (not a real move)', () => {
    expect(canTransitionPayment('succeeded', 'succeeded', { system: true })).toBe(false);
  });

  it('forbids impossible jumps that must never be documented', () => {
    expect(canTransitionPayment('failed', 'pending', { system: true })).toBe(false);
    expect(canTransitionPayment('pending', 'partially_refunded', { actorRole: 'admin' })).toBe(
      false,
    );
    expect(canTransitionPayment('cancelled', 'succeeded', { system: true })).toBe(false);
  });

  it('assertPaymentTransition throws PaymentTransitionError on an illegal move', () => {
    expect(() => assertPaymentTransition('succeeded', 'pending', { system: true })).toThrow(
      PaymentTransitionError,
    );
    expect(() => assertPaymentTransition('pending', 'succeeded', { system: true })).not.toThrow();
  });

  it('every declared transition originates from a non-terminal status', () => {
    for (const t of PAYMENT_TRANSITIONS) {
      expect(isTerminalPaymentStatus(t.from)).toBe(false);
    }
  });
});
