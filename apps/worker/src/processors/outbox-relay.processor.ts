import type { Job } from 'bullmq';
import type { PoolClient } from 'pg';
import type { OutboxEnvelope } from '@djafat/types';
import { logger } from '../logger';
import { withTransaction } from '../db';

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 10;

interface OutboxRow {
  id: string;
  aggregate: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
  created_at: Date;
}

/**
 * Appends one envelope to the durable transport and returns the transport's own
 * entry id. Injected rather than imported so this stays unit-testable without a
 * Redis connection — and so the transport can be swapped without touching the
 * retry/DLQ logic below.
 *
 * MUST reject if the append did not durably land. The whole correctness of this
 * relay rests on that: a row is marked `published` only once this resolves.
 */
export type EventPublisher = (event: OutboxEnvelope) => Promise<string>;

/**
 * Relays durable outbox rows onto the domain-event transport, with
 * retry/backoff/DLQ (docs/05 §5.5, docs/18 §9, docs/27 §2). `FOR UPDATE SKIP
 * LOCKED` makes this safe to run with several worker instances concurrently:
 * each claims a disjoint batch.
 *
 * ── Why this no longer publishes to Redis pub/sub (Bloc 7) ────────────────
 * It used to call `PUBLISH domain-events <json>` and then mark the row
 * `published`. `PUBLISH` returns the number of subscribers and delivers to
 * nobody else: with the gateway down — a deploy, a restart, a crash — the
 * event was dropped on the floor and the outbox row was marked as successfully
 * published. The durable chain the architecture promises (docs/27 §1) ended in
 * a black hole, and nothing in the system could tell.
 *
 * A Redis Stream entry persists until a consumer group acknowledges it, so a
 * gateway that was down reads what it missed when it returns. The row is marked
 * `published` only after the append resolves with an entry id.
 *
 * Honest limit, documented rather than glossed: Redis durability is weaker than
 * PostgreSQL's. If Redis itself loses data, realtime events are lost. That is
 * acceptable ONLY because realtime is a diffusion mechanism and never the
 * source of truth — every client refetches over REST on reconnect (docs/27
 * §18). Losing an event degrades the experience; it never corrupts state.
 */
export async function outboxRelayProcessor(
  publish: EventPublisher,
): Promise<{ published: number; failed: number }> {
  let published = 0;
  let failed = 0;

  await withTransaction(async (client: PoolClient) => {
    const { rows } = await client.query<OutboxRow>(
      `SELECT id, aggregate, aggregate_id, event_type, payload, attempts, created_at
       FROM outbox
       WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()
       ORDER BY created_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE],
    );

    for (const row of rows) {
      try {
        await publish({
          id: row.id,
          aggregate: row.aggregate,
          aggregateId: row.aggregate_id,
          eventType: row.event_type as OutboxEnvelope['eventType'],
          payload: row.payload,
          // The business transaction's commit time, not the relay's — a
          // consumer ordering events must not see retry delays as reordering.
          createdAt: row.created_at.toISOString(),
        });
        await client.query(
          `UPDATE outbox SET status = 'published', processed_at = now() WHERE id = $1`,
          [row.id],
        );
        published++;
      } catch (err) {
        const attempts = row.attempts + 1;
        const backoffSeconds = Math.min(2 ** attempts, 300); // exponential, capped at 5 min
        const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
        await client.query(
          `UPDATE outbox
           SET attempts = $2, last_error = $3, status = $4,
               next_attempt_at = now() + ($5 || ' seconds')::interval
           WHERE id = $1`,
          [row.id, attempts, (err as Error).message, status, backoffSeconds],
        );
        failed++;
        if (attempts >= MAX_ATTEMPTS) {
          logger.error(
            { outboxId: row.id, attempts, err },
            'outbox row moved to DLQ (max attempts exceeded)',
          );
        }
      }
    }
  });

  return { published, failed };
}

/** BullMQ processor factory — binds the injected publisher, logs the tick. */
export function makeOutboxRelayProcessor(publish: EventPublisher) {
  return async (job: Job): Promise<{ published: number; failed: number }> => {
    const result = await outboxRelayProcessor(publish);
    if (result.published > 0 || result.failed > 0) {
      logger.debug({ jobId: job.id, ...result }, 'outbox-relay tick');
    }
    return result;
  };
}
