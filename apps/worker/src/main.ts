import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env, logger } from './logger';
import { pool } from './db';
import { makeOutboxRelayProcessor } from './processors/outbox-relay.processor';
import { makeOrderExpiryProcessor } from './processors/order-expiry.processor';
import {
  makeLedgerAssertProcessor,
  selfTestPureInvariant,
} from './processors/ledger-assert.processor';

async function bootstrap(): Promise<void> {
  selfTestPureInvariant(); // fails fast at boot if @djafat/core's invariant primitive is broken

  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const publisherConnection = new IORedis(env.REDIS_URL);
  const publish = (channel: string, message: string): Promise<number> =>
    publisherConnection.publish(channel, message);

  const workers: Worker[] = [
    new Worker('outbox-relay', makeOutboxRelayProcessor(publish), { connection }),
    new Worker('order-expiry', makeOrderExpiryProcessor(), { connection }),
    new Worker('ledger-assert', makeLedgerAssertProcessor(), { connection }),
  ];

  for (const w of workers) {
    w.on('failed', (job, err) =>
      logger.error({ queue: w.name, jobId: job?.id, err }, 'job failed'),
    );
    w.on('completed', (job) => logger.debug({ queue: w.name, jobId: job.id }, 'job completed'));
  }

  // Repeatable jobs — cadence lives here; TTLs/thresholds live in platform_settings.
  const outboxQueue = new Queue('outbox-relay', { connection });
  await outboxQueue.add('tick', {}, { repeat: { every: 2_000 }, removeOnComplete: 50 });

  const expiryQueue = new Queue('order-expiry', { connection });
  await expiryQueue.add('tick', {}, { repeat: { every: 30_000 }, removeOnComplete: 20 });

  const assertQueue = new Queue('ledger-assert', { connection });
  await assertQueue.add('tick', {}, { repeat: { every: 3_600_000 }, removeOnComplete: 10 });

  logger.info(
    { queues: ['outbox-relay', 'order-expiry', 'ledger-assert'] },
    'DJAFAT worker started',
  );

  const shutdown = async (): Promise<void> => {
    logger.info('worker shutting down');
    await Promise.allSettled([
      ...workers.map((w) => w.close()),
      outboxQueue.close(),
      expiryQueue.close(),
      assertQueue.close(),
    ]);
    await Promise.allSettled([connection.quit(), publisherConnection.quit(), pool.end()]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void bootstrap();
