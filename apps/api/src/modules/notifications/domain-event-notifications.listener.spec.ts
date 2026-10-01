import { describe, expect, it, vi } from 'vitest';
import type { DomainEventType, OrderAmountPort, OutboxEnvelope } from '@djafat/types';
import { DOMAIN_EVENTS } from '@djafat/types';
import {
  DomainEventNotificationsListener,
  notifiableEventTypes,
} from './domain-event-notifications.listener';
import type { NotificationsService, NotifyUserInput } from './notifications.service';

/**
 * Bloc 7 §13, §20 — which events become a persisted notification, and for whom.
 *
 * The recipient is resolved from the ORDER, never from the event payload: the
 * outbox payload carries `orderId` and `restaurantId` but no customer id, so a
 * listener that trusted the payload would have no recipient at all. This is
 * where "the event is small, refetch what you need" (docs/27 §11) is paid for.
 */

const ORDER_ID = '22222222-2222-2222-2222-222222222222';
const OWNER = 'customer-owner';

function makeListener(opts: { owner?: string | null } = {}) {
  const calls: NotifyUserInput[] = [];
  const notifications = {
    notifyUser: vi.fn(async (input: NotifyUserInput) => {
      await Promise.resolve();
      calls.push(input);
      return { created: true, id: 'notification-1' };
    }),
  } as unknown as NotificationsService;

  const orderAmount = {
    getOwnerUserId: vi.fn(async (orderId: string) => {
      await Promise.resolve();
      if (opts.owner === null) throw new Error('order not found');
      if (orderId !== ORDER_ID) throw new Error('order not found');
      return opts.owner ?? OWNER;
    }),
  } as unknown as OrderAmountPort;

  return { listener: new DomainEventNotificationsListener(notifications, orderAmount), calls };
}

function envelope(
  eventType: DomainEventType,
  payload: Record<string, unknown> = { orderId: ORDER_ID },
): OutboxEnvelope {
  return {
    id: 'outbox-row-42',
    aggregate: eventType.split('.')[0]!,
    aggregateId: ORDER_ID,
    eventType,
    payload,
    createdAt: '2026-09-30T12:00:00.000Z',
  };
}

describe('the notified events are a deliberate, small set (Bloc 7 §13)', () => {
  it('notifies on the six outcomes a customer cares about when not watching', async () => {
    for (const eventType of notifiableEventTypes()) {
      const { listener, calls } = makeListener();
      await listener.onRelayedDomainEvent(envelope(eventType));
      expect(calls, `${eventType} should notify`).toHaveLength(1);
      expect(calls[0]!.userId).toBe(OWNER);
    }
  });

  it('is exactly the documented set — no accidental additions', async () => {
    expect(notifiableEventTypes().sort()).toEqual(
      [
        'order.cancelled',
        'order.confirmed',
        'order.delivered',
        'order.expired',
        'payment.failed',
        'payment.refunded',
      ].sort(),
    );
  });

  it('every notified event type is a declared domain event', () => {
    for (const eventType of notifiableEventTypes()) {
      expect(DOMAIN_EVENTS, `${eventType} is notified but not declared`).toContain(eventType);
    }
  });

  it('stays silent on the granular hops the live order room already shows', async () => {
    // A push per lifecycle hop would be noise on a 20-minute delivery. These
    // are broadcast in realtime and deliberately NOT persisted as notifications.
    for (const eventType of [
      'order.placed',
      'order.preparing',
      'order.ready',
      'order.courier_assigned',
      'order.picked_up',
      'order.on_the_way',
      'payment.created',
      'payment.succeeded',
      'delivery.assigned',
      'delivery.accepted',
      'delivery.picked_up',
      'delivery.delivered',
    ] as DomainEventType[]) {
      const { listener, calls } = makeListener();
      await listener.onRelayedDomainEvent(envelope(eventType));
      expect(calls, `${eventType} must not notify`).toHaveLength(0);
    }
  });

  it('never notifies on an event carrying a secret', async () => {
    const { listener, calls } = makeListener();
    await listener.onRelayedDomainEvent(
      envelope('delivery.code_issued', { orderId: ORDER_ID, code: '4242' }),
    );
    expect(calls).toHaveLength(0);
  });
});

describe('the recipient and the payload (Bloc 7 §11, §15)', () => {
  it('resolves the order owner as the recipient', async () => {
    const { listener, calls } = makeListener({ owner: 'customer-xyz' });
    await listener.onRelayedDomainEvent(envelope('order.delivered'));
    expect(calls[0]!.userId).toBe('customer-xyz');
  });

  it('uses the outbox row id as the dedup key', async () => {
    // This is what makes the at-least-once transport produce one notification.
    const { listener, calls } = makeListener();
    await listener.onRelayedDomainEvent(envelope('order.delivered'));
    expect(calls[0]!.dedupKey).toBe('outbox-row-42');
  });

  it('carries i18n keys and only the order id as data', async () => {
    const { listener, calls } = makeListener();
    await listener.onRelayedDomainEvent(
      envelope('order.cancelled', {
        orderId: ORDER_ID,
        restaurantId: 'restaurant-1',
        status: 'cancelled',
        customerPhone: '+235 66 00 00 00',
      }),
    );

    const call = calls[0]!;
    expect(call.titleKey).toBe('notifications.order.cancelled.title');
    expect(call.bodyKey).toBe('notifications.order.cancelled.body');
    expect(call.data).toEqual({ orderId: ORDER_ID });
    // Nothing private rides along from the payload.
    expect(JSON.stringify(call.data)).not.toContain('+235');
    expect(JSON.stringify(call.data)).not.toContain('restaurant-1');
  });

  it('records what the notification is about, for a deep link', async () => {
    const { listener, calls } = makeListener();
    await listener.onRelayedDomainEvent(envelope('order.delivered'));
    expect(calls[0]!.referenceAggregate).toBe('order');
    expect(calls[0]!.referenceId).toBe(ORDER_ID);
  });
});

describe('an unattributable event is skipped, never guessed (Bloc 7 §4, §19)', () => {
  it('skips a notifiable event with no order id', async () => {
    const { listener, calls } = makeListener();
    await listener.onRelayedDomainEvent(envelope('order.delivered', {}));
    expect(calls).toHaveLength(0);
  });

  it('skips when the order cannot be resolved, without throwing', async () => {
    // Throwing here would leave the stream entry unacked and retried forever
    // over an order that no longer exists.
    const { listener, calls } = makeListener({ owner: null });
    await expect(
      listener.onRelayedDomainEvent(envelope('order.delivered')),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('a null payload does not crash the listener', async () => {
    const { listener, calls } = makeListener();
    const bare = { ...envelope('order.delivered'), payload: null };
    await expect(listener.onRelayedDomainEvent(bare)).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe('redelivery is handled by the service, not suppressed here (Bloc 7 §5)', () => {
  it('the same envelope twice calls notifyUser twice with the same dedup key', async () => {
    // The listener deliberately does NOT keep an in-memory seen-set, which
    // would be wrong across a restart. Idempotence lives in the unique
    // constraint on (user_id, dedup_key).
    const { listener, calls } = makeListener();
    const env = envelope('order.delivered');
    await listener.onRelayedDomainEvent(env);
    await listener.onRelayedDomainEvent(env);

    expect(calls).toHaveLength(2);
    expect(calls[0]!.dedupKey).toBe(calls[1]!.dedupKey);
    expect(calls[0]!.userId).toBe(calls[1]!.userId);
  });
});
