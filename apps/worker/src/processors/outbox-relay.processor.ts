import type { Job } from 'bullmq';
import { logger } from '../logger';

/**
 * Skeleton (Bloc 0). Bloc 0.5 fills this in:
 *   - `SELECT ... FROM outbox WHERE status='pending' AND next_attempt_at <= now()
 *      FOR UPDATE SKIP LOCKED`
 *   - publish to Redis pub/sub + per-consumer BullMQ queues
 *   - on success: status='published', processed_at=now()
 *   - on failure: attempts++, exponential next_attempt_at, status='failed' + DLQ
 *     once attempts exceed the threshold.
 * Idempotent: re-processing a published row is a no-op.
 */
export function outboxRelayProcessor(job: Job): Promise<{ published: number }> {
  logger.debug({ jobId: job.id }, 'outbox-relay tick (skeleton)');
  return Promise.resolve({ published: 0 });
}
