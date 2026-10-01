/**
 * Domain event names. Payloads are intentionally minimal — consumers refetch
 * from the authoritative store if they need more. Events are relayed via the
 * transactional outbox, never emitted ad hoc. See docs/05 §5.4.
 */
export const DOMAIN_EVENTS = [
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
  'payment.created',
  'payment.succeeded',
  'payment.failed',
  'payment.cancelled',
  'payment.expired',
  'payment.needs_review',
  'payment.refunded',
  'delivery.created',
  'delivery.searching_courier',
  'delivery.searching_no_courier',
  'delivery.assigned',
  'delivery.accepted',
  'delivery.rejected',
  'delivery.pickup_in_progress',
  'delivery.picked_up',
  /**
   * In-process ONLY (never an outbox row): carries the raw delivery code to
   * `notifications` for delivery to the CUSTOMER. The raw code must never be
   * persisted, logged, or returned to the courier — docs/25 §B6.1-7.
   */
  'delivery.code_issued',
  'delivery.on_the_way',
  'delivery.delivered',
  'delivery.cancelled',
  'delivery.failed',
  'courier.location_updated',
  'courier.status_changed',
  'wallet.credited',
  'wallet.debited',
  'settlement.reconciled',
  'settlement.discrepancy',
] as const;
export type DomainEventType = (typeof DOMAIN_EVENTS)[number];

/**
 * Redis Stream carrying published outbox rows from the worker to every API
 * instance's realtime fan-out (Bloc 7, docs/27 §2).
 *
 * A STREAM, not pub/sub. Pub/sub is fire-and-forget: `PUBLISH` to a channel
 * nobody is listening on returns 0 and the message is gone, so a relay that
 * marks the outbox row `published` right after has silently lost the event.
 * A stream entry persists until acknowledged, so a gateway that was down comes
 * back and reads what it missed.
 */
export const DOMAIN_EVENT_STREAM = 'djafat:domain-events';

/**
 * One consumer group shared by every API instance, each joining under its own
 * consumer name. The group gives at-least-once delivery with explicit `XACK`,
 * and `XAUTOCLAIM` lets a surviving instance pick up entries a crashed one had
 * read but never acknowledged.
 */
export const DOMAIN_EVENT_GROUP = 'realtime-fanout';

/** Bounds the stream so a long gateway outage cannot grow Redis without limit. */
export const DOMAIN_EVENT_STREAM_MAXLEN = 100_000;

/**
 * What travels from the worker to the gateways. Deliberately small (docs/27
 * §11): an id, what happened, and to which aggregate. A consumer that needs
 * more refetches it from PostgreSQL, which is the only source of truth.
 *
 * `id` is the OUTBOX row id, reused rather than a new event id — it is already
 * unique, already durable, and already the thing the relay retries on. It is
 * what makes duplicate detection possible downstream.
 */
export interface OutboxEnvelope<T = unknown> {
  readonly id: string;
  readonly aggregate: string;
  readonly aggregateId: string;
  readonly eventType: DomainEventType;
  readonly payload: T;
  /** When the business transaction committed — not when it was relayed. */
  readonly createdAt: string;
}

/**
 * The payload fields the realtime router reads to decide WHO may see an event.
 * Every field is optional: the router routes on what is actually present and
 * emits nothing for an event it cannot attribute (docs/27 §4 — default deny).
 */
export interface DomainEventAudience {
  readonly orderId?: string;
  readonly courierId?: string;
  readonly restaurantId?: string;
  readonly deliveryId?: string;
  readonly paymentId?: string;
  readonly status?: string;
}
