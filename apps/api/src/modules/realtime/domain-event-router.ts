import type { DomainEventAudience, DomainEventType, OutboxEnvelope } from '@djafat/types';

/**
 * One realtime emission: a room, the event name clients listen for, and the
 * (small) payload they receive.
 */
export interface RealtimeEmission {
  readonly room: string;
  readonly event: DomainEventType;
  readonly payload: RealtimeEventPayload;
}

/**
 * What a client actually receives. Deliberately narrow (docs/27 §11 — DJAFAT
 * targets low-bandwidth networks): enough to know something changed and what
 * to refetch, never the aggregate itself.
 *
 * `eventId` is the outbox row id, so a client that receives the same event
 * twice — which at-least-once delivery guarantees will happen — can discard
 * the repeat without asking the server.
 */
export interface RealtimeEventPayload {
  readonly eventId: string;
  readonly eventType: DomainEventType;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly orderId?: string;
  readonly deliveryId?: string;
  readonly status?: string;
}

/**
 * Which audiences an event type is allowed to reach. This table IS the
 * authorization model for broadcast, and it is deny-by-default: an event type
 * absent from it reaches nobody, however well-formed its payload.
 *
 * Read alongside `RealtimeGateway.isAuthorizedForRoom`, which decides who may
 * JOIN a room. The two are complementary and both are required: this table
 * stops an event being sent to the wrong KIND of room, and the join rule stops
 * the wrong PERSON being in a room.
 */
type Audience = 'order' | 'courier' | 'restaurantOrders' | 'adminOps';

const EVENT_AUDIENCES: Partial<Record<DomainEventType, readonly Audience[]>> = {
  // ── Order lifecycle ──────────────────────────────────────────────────────
  // The customer follows their own order; the restaurant needs the operational
  // half so its kitchen board moves without polling.
  'order.placed': ['order', 'restaurantOrders'],
  'order.awaiting_payment': ['order'],
  'order.confirmed': ['order', 'restaurantOrders'],
  'order.preparing': ['order', 'restaurantOrders'],
  'order.ready': ['order', 'restaurantOrders'],
  'order.courier_assigned': ['order', 'restaurantOrders'],
  'order.picked_up': ['order', 'restaurantOrders'],
  'order.on_the_way': ['order'],
  'order.delivered': ['order', 'restaurantOrders'],
  'order.cancelled': ['order', 'restaurantOrders'],
  'order.expired': ['order', 'restaurantOrders'],

  // ── Payment ──────────────────────────────────────────────────────────────
  // Scoped to the order room only. A payment is between the customer and
  // DJAFAT: the restaurant is told the order is confirmed, never how it was
  // paid for (docs/27 §5 — no financial detail beyond what the audience needs).
  'payment.created': ['order'],
  'payment.succeeded': ['order'],
  'payment.failed': ['order'],
  'payment.cancelled': ['order'],
  'payment.expired': ['order'],
  'payment.refunded': ['order'],
  // Ops-only: "needs review" is an internal signal, not a customer message.
  'payment.needs_review': ['adminOps'],

  // ── Delivery ─────────────────────────────────────────────────────────────
  'delivery.created': ['order'],
  'delivery.searching_courier': ['order'],
  // Nobody found after every wave — an operational problem, not a customer
  // notification. Telling the customer "no courier" before ops has had a
  // chance to act would be worse than silence.
  'delivery.searching_no_courier': ['adminOps'],
  'delivery.assigned': ['order', 'courier'],
  'delivery.accepted': ['order', 'courier'],
  // A rejection is the courier's own business and an ops signal. The customer
  // sees only that the search continues — which `delivery.searching_courier`
  // already says.
  'delivery.rejected': ['courier', 'adminOps'],
  'delivery.pickup_in_progress': ['order', 'courier'],
  'delivery.picked_up': ['order', 'courier', 'restaurantOrders'],
  'delivery.on_the_way': ['order', 'courier'],
  'delivery.delivered': ['order', 'courier', 'restaurantOrders'],
  'delivery.cancelled': ['order', 'courier', 'restaurantOrders'],
  'delivery.failed': ['order', 'courier', 'adminOps'],

  // ── Courier ──────────────────────────────────────────────────────────────
  'courier.status_changed': ['courier'],

  // ── Deliberately absent ──────────────────────────────────────────────────
  // `delivery.code_issued` — carries the raw delivery code. It is in-process
  //   only and must never reach a socket (docs/25 §B6.1-7).
  // `courier.location_updated` — customer-facing live map is deferred scope
  //   (docs/25 §23, §31); broadcasting a courier's position needs a throttle
  //   and an active-order lookup this bloc keeps out of the hot path.
  // `wallet.*`, `settlement.*` — no producer emits them yet. Adding routes for
  //   events nothing publishes would be inventing coverage (docs/27 §3).
};

/**
 * Events whose payload carries a courier id but which must NOT be sent to that
 * courier's own room, because the courier is the subject rather than the
 * audience. None today — kept as an explicit empty set so the distinction is
 * visible rather than accidental.
 */
const NEVER_TO_SUBJECT: readonly DomainEventType[] = [];

/**
 * Routes one outbox envelope to the rooms allowed to receive it.
 *
 * PURE — no Redis, no socket, no database. That is the point: the decision of
 * "who may see this" is the security-critical part of the fan-out, so it is
 * testable exhaustively without standing up any infrastructure.
 *
 * Returns an empty array for anything it cannot attribute confidently: an
 * unknown event type, or a known one whose payload lacks the id the audience
 * is keyed on. Silence is the safe failure mode for a broadcast.
 */
export function routeDomainEvent(envelope: OutboxEnvelope): RealtimeEmission[] {
  const audiences = EVENT_AUDIENCES[envelope.eventType];
  if (!audiences || audiences.length === 0) return [];

  const audience = (envelope.payload ?? {}) as DomainEventAudience;
  const payload: RealtimeEventPayload = {
    eventId: envelope.id,
    eventType: envelope.eventType,
    aggregateId: envelope.aggregateId,
    occurredAt: envelope.createdAt,
    ...(audience.orderId !== undefined ? { orderId: audience.orderId } : {}),
    ...(audience.deliveryId !== undefined ? { deliveryId: audience.deliveryId } : {}),
    ...(audience.status !== undefined ? { status: audience.status } : {}),
  };

  const emissions: RealtimeEmission[] = [];
  const push = (room: string): void => {
    emissions.push({ room, event: envelope.eventType, payload });
  };

  for (const target of audiences) {
    switch (target) {
      case 'order':
        // `order:{id}` is joinable by the owning customer, the assigned
        // courier, and staff — all authorized at join time by the gateway.
        if (audience.orderId) push(`order:${audience.orderId}`);
        break;

      case 'courier':
        if (audience.courierId && !NEVER_TO_SUBJECT.includes(envelope.eventType)) {
          push(`courier:${audience.courierId}`);
        }
        break;

      case 'restaurantOrders':
        if (audience.restaurantId) push(`restaurant:orders:${audience.restaurantId}`);
        break;

      case 'adminOps':
        push('admin:ops');
        break;
    }
  }

  return emissions;
}

/** Every event type this bloc actually broadcasts — used by the docs and the tests. */
export function broadcastableEventTypes(): DomainEventType[] {
  return Object.keys(EVENT_AUDIENCES) as DomainEventType[];
}

/** The audiences declared for one event type, or `[]` if it is not broadcast. */
export function audiencesFor(eventType: DomainEventType): readonly string[] {
  return EVENT_AUDIENCES[eventType] ?? [];
}
