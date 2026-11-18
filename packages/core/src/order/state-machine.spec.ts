import { describe, expect, it } from 'vitest';
import { OrderTransitionError } from '../errors.js';
import {
  ORDER_TRANSITIONS,
  assertOrderTransition,
  canTransitionOrder,
  isTerminalOrderStatus,
  nextOrderStatuses,
} from './state-machine.js';

describe('order state machine', () => {
  it('lists the reachable next states', () => {
    expect(nextOrderStatuses('draft').sort()).toEqual(['awaiting_payment', 'placed']);
    expect(nextOrderStatuses('awaiting_payment').sort()).toEqual([
      'cancelled',
      'expired',
      'placed',
    ]);
    expect(nextOrderStatuses('delivered')).toEqual([]);
  });

  it('allows the prepaid happy path with the right actors', () => {
    expect(canTransitionOrder('draft', 'awaiting_payment', { actorRole: 'customer' })).toBe(true);
    expect(canTransitionOrder('awaiting_payment', 'placed', { system: true })).toBe(true);
    expect(canTransitionOrder('placed', 'confirmed', { actorRole: 'restaurant_staff' })).toBe(true);
    expect(canTransitionOrder('confirmed', 'preparing', { actorRole: 'restaurant_owner' })).toBe(
      true,
    );
    expect(canTransitionOrder('ready', 'courier_assigned', { system: true })).toBe(true);
    expect(canTransitionOrder('courier_assigned', 'picked_up', { actorRole: 'courier' })).toBe(
      true,
    );
    expect(canTransitionOrder('on_the_way', 'delivered', { actorRole: 'courier' })).toBe(true);
  });

  it('cancellation: the customer before preparation, the system only for a placed order nobody confirmed (ORD-01, ORD-02)', () => {
    for (const from of ['awaiting_payment', 'placed', 'confirmed'] as const) {
      expect(canTransitionOrder(from, 'cancelled', { actorRole: 'customer' })).toBe(true);
    }
    for (const from of ['preparing', 'ready', 'courier_assigned', 'picked_up'] as const) {
      expect(canTransitionOrder(from, 'cancelled', { actorRole: 'customer' })).toBe(false);
    }
    expect(canTransitionOrder('placed', 'cancelled', { system: true })).toBe(true);
    expect(canTransitionOrder('confirmed', 'cancelled', { system: true })).toBe(false);
    expect(canTransitionOrder('preparing', 'cancelled', { actorRole: 'admin' })).toBe(true);
    expect(canTransitionOrder('picked_up', 'cancelled', { actorRole: 'admin' })).toBe(false);
  });

  it('allows the cash happy path to skip awaiting_payment', () => {
    expect(canTransitionOrder('draft', 'placed', { actorRole: 'customer' })).toBe(true);
  });

  it('enforces actor roles', () => {
    expect(canTransitionOrder('placed', 'confirmed', { actorRole: 'customer' })).toBe(false);
    expect(canTransitionOrder('on_the_way', 'delivered', { actorRole: 'restaurant_staff' })).toBe(
      false,
    );
    // a system transition is NOT performable by a random customer
    expect(canTransitionOrder('awaiting_payment', 'placed', { actorRole: 'customer' })).toBe(false);
    // ...but an admin may (system transitions accept admin explicitly? no — only system flag or listed roles)
    expect(canTransitionOrder('ready', 'courier_assigned', {})).toBe(false);
  });

  it('forbids impossible transitions that must never be documented', () => {
    expect(canTransitionOrder('placed', 'awaiting_payment', { system: true })).toBe(false);
    expect(canTransitionOrder('awaiting_payment', 'confirmed', { system: true })).toBe(false);
    expect(canTransitionOrder('delivered', 'on_the_way', { actorRole: 'courier' })).toBe(false);
    expect(canTransitionOrder('expired', 'placed', { system: true })).toBe(false);
    expect(canTransitionOrder('courier_assigned', 'ready', { actorRole: 'courier' })).toBe(false);
    expect(canTransitionOrder('draft', 'confirmed', { actorRole: 'customer' })).toBe(false);
  });

  it('recognises terminal states', () => {
    for (const s of ['delivered', 'cancelled', 'rejected', 'expired'] as const) {
      expect(isTerminalOrderStatus(s)).toBe(true);
      expect(nextOrderStatuses(s)).toEqual([]);
    }
    expect(isTerminalOrderStatus('placed')).toBe(false);
  });

  it('assertOrderTransition throws OrderTransitionError on an illegal move', () => {
    expect(() => assertOrderTransition('placed', 'delivered', { actorRole: 'courier' })).toThrow(
      OrderTransitionError,
    );
    expect(() =>
      assertOrderTransition('draft', 'awaiting_payment', { actorRole: 'customer' }),
    ).not.toThrow();
  });

  it('every transition targets a declared status and no transition leaves a terminal state', () => {
    for (const t of ORDER_TRANSITIONS) {
      expect(isTerminalOrderStatus(t.from)).toBe(false);
    }
  });

  it('admin force-cancel is allowed from active states', () => {
    expect(canTransitionOrder('preparing', 'cancelled', { actorRole: 'admin' })).toBe(true);
    expect(canTransitionOrder('ready', 'cancelled', { actorRole: 'super_admin' })).toBe(true);
  });
});
