import { describe, expect, it } from 'vitest';
import { DeliveryTransitionError } from '../errors.js';
import {
  DELIVERY_TRANSITIONS,
  assertDeliveryTransition,
  canTransitionDelivery,
  fromStatusesFor,
  isTerminalDeliveryStatus,
  nextDeliveryStatuses,
} from './state-machine.js';

describe('delivery state machine (docs/25 §3)', () => {
  it('allows the dispatch happy path', () => {
    expect(canTransitionDelivery('pending', 'searching_courier', { system: true })).toBe(true);
    expect(canTransitionDelivery('searching_courier', 'courier_assigned', { system: true })).toBe(
      true,
    );
    expect(
      canTransitionDelivery('courier_assigned', 'courier_accepted', { actorRole: 'courier' }),
    ).toBe(true);
    expect(
      canTransitionDelivery('courier_accepted', 'pickup_in_progress', { actorRole: 'courier' }),
    ).toBe(true);
    expect(canTransitionDelivery('pickup_in_progress', 'picked_up', { actorRole: 'courier' })).toBe(
      true,
    );
    expect(canTransitionDelivery('picked_up', 'on_the_way', { actorRole: 'courier' })).toBe(true);
    expect(canTransitionDelivery('on_the_way', 'delivered', { actorRole: 'courier' })).toBe(true);
  });

  it('a rejected offer or an expired offer both send the delivery back to searching_courier', () => {
    expect(
      canTransitionDelivery('courier_assigned', 'searching_courier', { actorRole: 'courier' }),
    ).toBe(true);
    expect(canTransitionDelivery('courier_assigned', 'searching_courier', { system: true })).toBe(
      true,
    );
  });

  it('never lets a random role reject/accept an offer not addressed to them at the type level (ownership is enforced by the service, not here)', () => {
    expect(
      canTransitionDelivery('courier_assigned', 'courier_accepted', { actorRole: 'customer' }),
    ).toBe(false);
    expect(
      canTransitionDelivery('courier_assigned', 'courier_accepted', { actorRole: 'admin' }),
    ).toBe(false);
  });

  it('customer/admin can cancel before pickup; only admin can force-cancel once picked up', () => {
    expect(canTransitionDelivery('pending', 'cancelled', { actorRole: 'customer' })).toBe(true);
    expect(canTransitionDelivery('searching_courier', 'cancelled', { actorRole: 'customer' })).toBe(
      true,
    );
    expect(canTransitionDelivery('courier_accepted', 'cancelled', { actorRole: 'customer' })).toBe(
      true,
    );
    expect(canTransitionDelivery('picked_up', 'cancelled', { actorRole: 'customer' })).toBe(false);
    expect(canTransitionDelivery('picked_up', 'cancelled', { actorRole: 'admin' })).toBe(true);
    expect(canTransitionDelivery('on_the_way', 'cancelled', { actorRole: 'courier' })).toBe(false);
  });

  it('DELIVERED forbids cancellation — the exact rule the mandate calls out explicitly', () => {
    expect(canTransitionDelivery('delivered', 'cancelled', { actorRole: 'admin' })).toBe(false);
    expect(canTransitionDelivery('delivered', 'cancelled', { system: true })).toBe(false);
  });

  it('failed is reachable only once a courier is actually engaged (post pickup_in_progress)', () => {
    expect(canTransitionDelivery('pickup_in_progress', 'failed', { actorRole: 'courier' })).toBe(
      true,
    );
    expect(canTransitionDelivery('picked_up', 'failed', { actorRole: 'courier' })).toBe(true);
    expect(canTransitionDelivery('on_the_way', 'failed', { actorRole: 'admin' })).toBe(true);
    expect(canTransitionDelivery('pending', 'failed', { actorRole: 'courier' })).toBe(false);
    expect(canTransitionDelivery('searching_courier', 'failed', { actorRole: 'courier' })).toBe(
      false,
    );
  });

  it('NEVER allows a transition out of a terminal status', () => {
    for (const terminal of ['delivered', 'cancelled', 'failed'] as const) {
      expect(isTerminalDeliveryStatus(terminal)).toBe(true);
      expect(nextDeliveryStatuses(terminal)).toEqual([]);
      expect(canTransitionDelivery(terminal, 'on_the_way', { system: true })).toBe(false);
      expect(canTransitionDelivery(terminal, 'delivered', { actorRole: 'courier' })).toBe(false);
    }
  });

  it('rejects a same-state "transition"', () => {
    expect(canTransitionDelivery('on_the_way', 'on_the_way', { actorRole: 'courier' })).toBe(false);
  });

  it('forbids impossible jumps', () => {
    expect(canTransitionDelivery('pending', 'delivered', { system: true })).toBe(false);
    expect(canTransitionDelivery('searching_courier', 'picked_up', { actorRole: 'courier' })).toBe(
      false,
    );
    expect(canTransitionDelivery('cancelled', 'searching_courier', { system: true })).toBe(false);
  });

  it('assertDeliveryTransition throws DeliveryTransitionError on an illegal move', () => {
    expect(() => assertDeliveryTransition('delivered', 'cancelled', { system: true })).toThrow(
      DeliveryTransitionError,
    );
    expect(() =>
      assertDeliveryTransition('pending', 'searching_courier', { system: true }),
    ).not.toThrow();
  });

  it('every declared transition originates from a non-terminal status', () => {
    for (const t of DELIVERY_TRANSITIONS) {
      expect(isTerminalDeliveryStatus(t.from)).toBe(false);
    }
  });

  describe('fromStatusesFor — the derivation the service layer relies on for its SQL guard', () => {
    it('accepting an offer: only courier_assigned is a valid origin, for a courier actor', () => {
      expect(fromStatusesFor('courier_accepted', { actorRole: 'courier' })).toEqual([
        'courier_assigned',
      ]);
      expect(fromStatusesFor('courier_accepted', { actorRole: 'customer' })).toEqual([]);
    });

    it('dispatch assignment (system) can only originate from searching_courier', () => {
      expect(fromStatusesFor('courier_assigned', { system: true })).toEqual(['searching_courier']);
      expect(fromStatusesFor('courier_assigned', { actorRole: 'courier' })).toEqual([]);
    });

    it('system-driven arrivals at searching_courier: the initial dispatch_start (from pending) plus a rejected/expired offer (from courier_assigned)', () => {
      const origins = fromStatusesFor('searching_courier', { system: true });
      expect(origins).toContain('pending');
      expect(origins).toContain('courier_assigned');
      expect(origins).toHaveLength(2);
    });

    it('cancellation by a customer can originate from any of the pre-pickup states', () => {
      const origins = fromStatusesFor('cancelled', { actorRole: 'customer' });
      expect(origins).toContain('pending');
      expect(origins).toContain('searching_courier');
      expect(origins).toContain('courier_assigned');
      expect(origins).toContain('courier_accepted');
      expect(origins).not.toContain('picked_up');
      expect(origins).not.toContain('on_the_way');
    });
  });
});
