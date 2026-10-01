import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type {
  DomainEventAudience,
  DomainEventType,
  OrderAmountPort,
  OutboxEnvelope,
} from '@djafat/types';
import { ORDER_AMOUNT_PORT } from '../../common/ports/order-amount.port';
import { RELAYED_DOMAIN_EVENT } from '../../common/events/relayed-domain-event';
import { NotificationsService } from './notifications.service';

/**
 * Turns a curated subset of domain events into persisted, cross-device
 * notifications (Bloc 7, docs/27 §13, §15).
 *
 * Deliberately NOT every event the realtime fan-out broadcasts: realtime
 * already tells a connected client everything, live, while they are looking
 * at the order. A persisted notification earns its place only for what a user
 * would want to know about EVEN IF THEY WERE NOT WATCHING — six events, not
 * fifty (mandate §3's "ne pas créer 50 événements inutiles" applies here too).
 *
 * Explicitly excluded, with reasoning:
 *   - `order.ready` / `order.courier_assigned` — operationally interesting,
 *     but the order room already shows them live; a push on every hop would
 *     be noisier than useful for a short delivery window.
 *   - `delivery.assigned` (the courier's offer) — already delivered as a
 *     time-critical in-process ping (`courier.offer.new`) with a 30s TTL; a
 *     persisted row for something that may already have expired by the time
 *     it is read would mislead more than help.
 *   - Any restaurant- or admin-facing event — this table has one recipient
 *     column, `user_id`; broadcasting to a restaurant's whole staff or to ops
 *     is a different shape of problem this bloc does not build (docs/27 §15:
 *     "proportionné au MVP").
 *
 * Listens on the SAME `RELAYED_DOMAIN_EVENT` the realtime gateway does, on the
 * SAME at-least-once, ack-after-handling contract (docs/27 §5): if
 * `notifyUser` throws, the stream entry is not acknowledged and is retried —
 * exactly the guarantee this listener needs, since `notifyUser` is itself
 * idempotent on `dedupKey`.
 */
@Injectable()
export class DomainEventNotificationsListener {
  private readonly logger = new Logger(DomainEventNotificationsListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    @Inject(ORDER_AMOUNT_PORT) private readonly orderAmount: OrderAmountPort,
  ) {}

  @OnEvent(RELAYED_DOMAIN_EVENT)
  async onRelayedDomainEvent(envelope: OutboxEnvelope): Promise<void> {
    const rule = NOTIFIED_EVENTS[envelope.eventType];
    if (!rule) return; // not a notifiable event — most events are not, by design

    const audience = (envelope.payload ?? {}) as DomainEventAudience;
    const userId = await this.resolveRecipient(rule.recipient, audience);
    if (!userId) {
      // No attributable recipient (e.g. a legacy row with no orderId) — the
      // same "silence is the safe failure mode" rule the realtime router
      // follows (docs/27 §4). Never guess.
      this.logger.warn(`${envelope.eventType}: no resolvable recipient for notification, skipped`);
      return;
    }

    await this.notifications.notifyUser({
      userId,
      type: envelope.eventType,
      titleKey: rule.titleKey,
      bodyKey: rule.bodyKey,
      data: audience.orderId ? { orderId: audience.orderId } : {},
      referenceAggregate: envelope.aggregate,
      referenceId: envelope.aggregateId,
      dedupKey: envelope.id,
    });
  }

  private async resolveRecipient(
    recipient: 'orderOwner',
    audience: DomainEventAudience,
  ): Promise<string | null> {
    if (recipient === 'orderOwner') {
      if (!audience.orderId) return null;
      try {
        return await this.orderAmount.getOwnerUserId(audience.orderId);
      } catch {
        return null; // order not found — nothing to notify, never throw
      }
    }
    return null;
  }
}

interface NotificationRule {
  readonly recipient: 'orderOwner';
  readonly titleKey: string;
  readonly bodyKey: string;
}

const NOTIFIED_EVENTS: Partial<Record<DomainEventType, NotificationRule>> = {
  'order.confirmed': {
    recipient: 'orderOwner',
    titleKey: 'notifications.order.confirmed.title',
    bodyKey: 'notifications.order.confirmed.body',
  },
  'order.delivered': {
    recipient: 'orderOwner',
    titleKey: 'notifications.order.delivered.title',
    bodyKey: 'notifications.order.delivered.body',
  },
  'order.cancelled': {
    recipient: 'orderOwner',
    titleKey: 'notifications.order.cancelled.title',
    bodyKey: 'notifications.order.cancelled.body',
  },
  'order.expired': {
    recipient: 'orderOwner',
    titleKey: 'notifications.order.expired.title',
    bodyKey: 'notifications.order.expired.body',
  },
  'payment.failed': {
    recipient: 'orderOwner',
    titleKey: 'notifications.payment.failed.title',
    bodyKey: 'notifications.payment.failed.body',
  },
  'payment.refunded': {
    recipient: 'orderOwner',
    titleKey: 'notifications.payment.refunded.title',
    bodyKey: 'notifications.payment.refunded.body',
  },
};

/** Every event type this listener persists a notification for — used by docs and tests. */
export function notifiableEventTypes(): DomainEventType[] {
  return Object.keys(NOTIFIED_EVENTS) as DomainEventType[];
}
