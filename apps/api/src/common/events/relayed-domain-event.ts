/**
 * The in-process event name a relayed domain event is re-emitted under, after
 * `DomainEventsConsumer` has read it off the durable Redis Stream (Bloc 7,
 * docs/27 §2).
 *
 * Lives in `common/events` rather than inside `modules/realtime` because it is
 * a CONTRACT between fan-out consumers, not realtime's private detail: both
 * `realtime` (broadcasts to rooms) and `notifications` (persists a row) listen
 * for it, and neither owns it. Putting it in the realtime module would make
 * `notifications -> realtime` a module dependency the DAG rightly forbids
 * (docs/15 AD-09, enforced by `eslint-plugin-boundaries`).
 *
 * The payload is always an `OutboxEnvelope`. Every listener must be idempotent:
 * delivery is at-least-once, and the envelope's `id` (the outbox row id) is the
 * deduplication key (docs/27 §5).
 */
export const RELAYED_DOMAIN_EVENT = 'domain-event.relayed';
