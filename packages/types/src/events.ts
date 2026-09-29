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

export interface OutboxEnvelope<T = unknown> {
  readonly id: string;
  readonly aggregate: string;
  readonly aggregateId: string;
  readonly eventType: DomainEventType;
  readonly payload: T;
  readonly createdAt: string;
}
