import { describe, expect, it } from 'vitest';
import type { DomainEventType, OutboxEnvelope } from '@djafat/types';
import { DOMAIN_EVENTS } from '@djafat/types';
import {
  audiencesFor,
  broadcastableEventTypes,
  routeDomainEvent,
  type RealtimeEmission,
} from './domain-event-router';

/**
 * Bloc 7 §13-§14 — who may see which event.
 *
 * This is the security-critical half of the fan-out: the gateway decides who
 * may JOIN a room, this table decides which rooms an event is allowed to reach.
 * Both are required, and this one is pure, so it is tested exhaustively rather
 * than by sampling.
 */

const ORDER_ID = 'order-1';
const RESTAURANT_ID = 'restaurant-1';
const COURIER_ID = 'courier-1';
const DELIVERY_ID = 'delivery-1';

function envelope(
  eventType: DomainEventType,
  payload: Record<string, unknown> = {},
): OutboxEnvelope {
  return {
    id: 'outbox-row-1',
    aggregate: eventType.split('.')[0]!,
    aggregateId: (payload['orderId'] as string) ?? ORDER_ID,
    eventType,
    payload,
    createdAt: '2026-09-30T12:00:00.000Z',
  };
}

function rooms(emissions: RealtimeEmission[]): string[] {
  return emissions.map((e) => e.room).sort();
}

describe('the customer follows their own order (Bloc 7 §14)', () => {
  // The bug this bloc exists to fix: Bloc 6's gateway listened for
  // `order.updated`, which no producer ever emitted. `orders` emits ten
  // specific names instead, so the customer's order room received payment
  // events and not one single order status change.
  const ORDER_EVENTS: DomainEventType[] = [
    'order.placed',
    'order.awaiting_payment',
    'order.confirmed',
    'order.preparing',
    'order.ready',
    'order.courier_assigned',
    'order.picked_up',
    'order.on_the_way',
    'order.delivered',
    'order.cancelled',
    'order.expired',
  ];

  for (const eventType of ORDER_EVENTS) {
    it(`${eventType} reaches order:{id}`, () => {
      const emissions = routeDomainEvent(envelope(eventType, { orderId: ORDER_ID }));
      expect(rooms(emissions)).toContain(`order:${ORDER_ID}`);
    });
  }

  it('every status the order state machine can reach is broadcast — no silent gap', () => {
    // Derived from the event catalogue rather than hand-listed, so adding an
    // order event without routing it fails here.
    const declared = DOMAIN_EVENTS.filter((e) => e.startsWith('order.'));
    for (const eventType of declared) {
      const emissions = routeDomainEvent(envelope(eventType, { orderId: ORDER_ID }));
      expect(emissions.length, `${eventType} is declared but reaches nobody`).toBeGreaterThan(0);
    }
  });

  it('carries the status so a client can render without a refetch round-trip', () => {
    const [emission] = routeDomainEvent(
      envelope('order.preparing', { orderId: ORDER_ID, status: 'preparing' }),
    );
    expect(emission!.payload.status).toBe('preparing');
    expect(emission!.payload.orderId).toBe(ORDER_ID);
  });

  it('carries the outbox row id, so a duplicate delivery is discardable client-side', () => {
    const [emission] = routeDomainEvent(envelope('order.ready', { orderId: ORDER_ID }));
    expect(emission!.payload.eventId).toBe('outbox-row-1');
    expect(emission!.payload.occurredAt).toBe('2026-09-30T12:00:00.000Z');
  });
});

describe('payments stay between the customer and DJAFAT (Bloc 7 §14, §19)', () => {
  for (const eventType of [
    'payment.created',
    'payment.succeeded',
    'payment.failed',
    'payment.cancelled',
    'payment.expired',
    'payment.refunded',
  ] as DomainEventType[]) {
    it(`${eventType} reaches the order room and nowhere else`, () => {
      const emissions = routeDomainEvent(
        envelope(eventType, { orderId: ORDER_ID, paymentId: 'pay-1', restaurantId: RESTAURANT_ID }),
      );
      expect(rooms(emissions)).toEqual([`order:${ORDER_ID}`]);
    });

    it(`${eventType} never leaks a payment id to the wire`, () => {
      const [emission] = routeDomainEvent(
        envelope(eventType, { orderId: ORDER_ID, paymentId: 'pay-SECRET' }),
      );
      expect(JSON.stringify(emission!.payload)).not.toContain('pay-SECRET');
    });
  }

  it('the restaurant is never told how an order was paid for', () => {
    // It legitimately learns the order is confirmed; the payment itself is not
    // its business. Asserted even though `restaurantId` is present in the
    // payload — presence must not be enough.
    const emissions = routeDomainEvent(
      envelope('payment.succeeded', { orderId: ORDER_ID, restaurantId: RESTAURANT_ID }),
    );
    expect(rooms(emissions)).not.toContain(`restaurant:orders:${RESTAURANT_ID}`);
  });

  it('needs_review is an ops signal, never a customer message', () => {
    const emissions = routeDomainEvent(
      envelope('payment.needs_review', { orderId: ORDER_ID, paymentId: 'pay-1' }),
    );
    expect(rooms(emissions)).toEqual(['admin:ops']);
  });
});

describe('deliveries reach the customer and the assigned courier (Bloc 7 §14)', () => {
  it('an assignment reaches both the order room and that courier', () => {
    const emissions = routeDomainEvent(
      envelope('delivery.assigned', {
        orderId: ORDER_ID,
        courierId: COURIER_ID,
        deliveryId: DELIVERY_ID,
      }),
    );
    expect(rooms(emissions)).toEqual([`courier:${COURIER_ID}`, `order:${ORDER_ID}`]);
  });

  it('a rejection is the courier’s business and an ops signal — not the customer’s', () => {
    const emissions = routeDomainEvent(
      envelope('delivery.rejected', { orderId: ORDER_ID, courierId: COURIER_ID }),
    );
    expect(rooms(emissions)).toEqual(['admin:ops', `courier:${COURIER_ID}`]);
    expect(rooms(emissions)).not.toContain(`order:${ORDER_ID}`);
  });

  it('“no courier found” goes to ops, never to the waiting customer', () => {
    const emissions = routeDomainEvent(
      envelope('delivery.searching_no_courier', {
        deliveryId: DELIVERY_ID,
        orderId: ORDER_ID,
        attempts: 3,
      }),
    );
    expect(rooms(emissions)).toEqual(['admin:ops']);
  });

  it('pickup and completion also reach the restaurant', () => {
    for (const eventType of ['delivery.picked_up', 'delivery.delivered'] as DomainEventType[]) {
      const emissions = routeDomainEvent(
        envelope(eventType, {
          orderId: ORDER_ID,
          courierId: COURIER_ID,
          restaurantId: RESTAURANT_ID,
        }),
      );
      expect(rooms(emissions), eventType).toContain(`restaurant:orders:${RESTAURANT_ID}`);
    }
  });
});

describe('secrets and private data never enter the fan-out (Bloc 7 §19)', () => {
  it('the raw delivery code is not broadcastable at all', () => {
    // `delivery.code_issued` carries the customer's proof code in memory only.
    // A route for it would put a delivery secret on a socket.
    const emissions = routeDomainEvent(
      envelope('delivery.code_issued', { orderId: ORDER_ID, code: '4242' }),
    );
    expect(emissions).toEqual([]);
    expect(audiencesFor('delivery.code_issued')).toEqual([]);
  });

  it('a courier’s position is not broadcastable in this bloc', () => {
    const emissions = routeDomainEvent(
      envelope('courier.location_updated', { courierId: COURIER_ID, lat: 12.1, lng: 15.05 }),
    );
    expect(emissions).toEqual([]);
  });

  it('no emitted payload ever carries a field the router was not asked to expose', () => {
    // Routes are built from a fixed projection, so extra payload keys — a code,
    // coordinates, an amount — cannot ride along by accident.
    const emissions = routeDomainEvent(
      envelope('order.delivered', {
        orderId: ORDER_ID,
        status: 'delivered',
        courierId: COURIER_ID,
        restaurantId: RESTAURANT_ID,
        customerPhone: '+235 66 00 00 00',
        totalMinor: '10000',
        code: '4242',
      }),
    );

    const allowed = new Set([
      'eventId',
      'eventType',
      'aggregateId',
      'occurredAt',
      'orderId',
      'deliveryId',
      'status',
    ]);
    for (const emission of emissions) {
      for (const key of Object.keys(emission.payload)) {
        expect(allowed.has(key), `payload leaked "${key}"`).toBe(true);
      }
      const serialized = JSON.stringify(emission.payload);
      expect(serialized).not.toContain('+235');
      expect(serialized).not.toContain('10000');
      expect(serialized).not.toContain('4242');
    }
  });
});

describe('the router is deny-by-default (Bloc 7 §8, §19)', () => {
  it('an event type with no declared audience reaches nobody', () => {
    for (const eventType of ['wallet.credited', 'settlement.reconciled'] as DomainEventType[]) {
      expect(routeDomainEvent(envelope(eventType, { orderId: ORDER_ID })), eventType).toEqual([]);
    }
  });

  it('an unknown event type reaches nobody rather than throwing', () => {
    const rogue = envelope('order.placed').eventType;
    const forged = { ...envelope(rogue), eventType: 'order.hacked' as DomainEventType };
    expect(routeDomainEvent(forged)).toEqual([]);
  });

  it('a known event with no attributable id reaches nobody', () => {
    // Without an orderId there is no room to send it to, and guessing would
    // mean broadcasting. An empty result is the safe answer.
    expect(routeDomainEvent(envelope('order.preparing', {}))).toEqual([]);
    expect(routeDomainEvent(envelope('delivery.assigned', {}))).toEqual([]);
  });

  it('a missing courier id suppresses only the courier room, not the order room', () => {
    const emissions = routeDomainEvent(envelope('delivery.accepted', { orderId: ORDER_ID }));
    expect(rooms(emissions)).toEqual([`order:${ORDER_ID}`]);
  });

  it('a null or absent payload does not crash the fan-out', () => {
    const bare = { ...envelope('order.ready'), payload: null };
    expect(() => routeDomainEvent(bare)).not.toThrow();
    expect(routeDomainEvent(bare)).toEqual([]);
  });

  it('every routed event type is a declared domain event', () => {
    // Guards against the Bloc 6 failure mode in the opposite direction: a
    // gateway listening for a name the catalogue does not contain.
    for (const eventType of broadcastableEventTypes()) {
      expect(DOMAIN_EVENTS, `${eventType} is routed but not declared`).toContain(eventType);
    }
  });

  it('a routed event never targets a room pattern the gateway cannot authorize', () => {
    // The gateway authorizes `order:`, `courier:`, `customer:`,
    // `restaurant:orders:` and `admin:ops`. Emitting into anything else would
    // be a room nobody can legitimately be in.
    const authorizable = /^(order:|courier:|customer:|restaurant:orders:|admin:ops$)/;
    for (const eventType of broadcastableEventTypes()) {
      const emissions = routeDomainEvent(
        envelope(eventType, {
          orderId: ORDER_ID,
          courierId: COURIER_ID,
          restaurantId: RESTAURANT_ID,
          deliveryId: DELIVERY_ID,
        }),
      );
      for (const emission of emissions) {
        expect(emission.room, `${eventType} -> ${emission.room}`).toMatch(authorizable);
      }
    }
  });
});

describe('routing is deterministic and side-effect free (Bloc 7 §5)', () => {
  it('the same envelope always produces the same emissions', () => {
    const env = envelope('delivery.delivered', {
      orderId: ORDER_ID,
      courierId: COURIER_ID,
      restaurantId: RESTAURANT_ID,
    });
    expect(routeDomainEvent(env)).toEqual(routeDomainEvent(env));
  });

  it('routing does not mutate the envelope it was given', () => {
    const payload = { orderId: ORDER_ID, status: 'ready' };
    const env = envelope('order.ready', payload);
    routeDomainEvent(env);
    expect(payload).toEqual({ orderId: ORDER_ID, status: 'ready' });
  });

  it('a redelivered event routes identically — idempotent by construction', () => {
    // At-least-once delivery means the consumer WILL see repeats. Routing them
    // again must be harmless: same rooms, same payload, same event id, so the
    // client can deduplicate on `eventId`.
    const env = envelope('order.delivered', { orderId: ORDER_ID, status: 'delivered' });
    const first = routeDomainEvent(env);
    const second = routeDomainEvent(env);
    expect(second).toEqual(first);
    expect(second[0]!.payload.eventId).toBe(first[0]!.payload.eventId);
  });
});
