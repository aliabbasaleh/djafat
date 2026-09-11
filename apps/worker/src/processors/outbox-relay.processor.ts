import type { Job } from 'bullmq';
import type { PoolClient } from 'pg';
import { logger } from '../logger';
import { withTransaction } from '../db';

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 10;
export const DOMAIN_EVENTS_CHANNEL = 'domain-events';

interface OutboxRow {
  id: string;
  aggregate: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
}

export type Publisher = (channel: string, message: string) => Promise<number>;

/**
 * Publishes durable outbox rows to Redis pub/sub (`domain-events`), with
 * retry/backoff/DLQ (docs/05 §5.5, docs/18 §9). `FOR UPDATE SKIP LOCKED`
 * makes this safe to run with several worker instances concurrently: each
 * claims a disjoint batch. `publish` is injected so this stays unit-testable
 * without a real Redis connection.
 */
export async function outboxRelayProcessor(
  publish: Publisher,
): Promise<{ published: number; failed: number }> {
  let published = 0;
  let failed = 0;

  await withTransaction(async (client: PoolClient) => {
    const { rows } = await client.query<OutboxRow>(
      `SELECT id, aggregate, aggregate_id, event_type, payload, attempts
       FROM outbox
       WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()
       ORDER BY created_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE],
    );

    for (const row of rows) {
      try {
        await publish(
          DOMAIN_EVENTS_CHANNEL,
          JSON.stringify({
            id: row.id,
            aggregate: row.aggregate,
            aggregateId: row.aggregate_id,
            eventType: row.event_type,
            payload: row.payload,
          }),
        );
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
export function makeOutboxRelayProcessor(publish: Publisher) {
  return async (job: Job): Promise<{ published: number; failed: number }> => {
    const result = await outboxRelayProcessor(publish);
    if (result.published > 0 || result.failed > 0) {
      logger.debug({ jobId: job.id, ...result }, 'outbox-relay tick');
    }
    return result;
  };
}
