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
  'delivery.assigned',
  'delivery.picked_up',
  'delivery.delivered',
  'delivery.failed',
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
