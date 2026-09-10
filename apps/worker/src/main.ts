import { Queue, QueueEvents, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env, logger } from './logger';
import { outboxRelayProcessor } from './processors/outbox-relay.processor';
import { orderExpiryProcessor } from './processors/order-expiry.processor';
import { ledgerAssertProcessor } from './processors/ledger-assert.processor';

const QUEUE_NAMES = ['outbox-relay', 'order-expiry', 'ledger-assert'] as const;

async function bootstrap(): Promise<void> {
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

  const workers: Worker[] = [
    new Worker('outbox-relay', outboxRelayProcessor, { connection }),
    new Worker('order-expiry', orderExpiryProcessor, { connection }),
    new Worker('ledger-assert', ledgerAssertProcessor, { connection }),
  ];

  for (const w of workers) {
    w.on('failed', (job, err) =>
      logger.error({ queue: w.name, jobId: job?.id, err }, 'job failed'),
    );
    w.on('completed', (job) => logger.debug({ queue: w.name, jobId: job.id }, 'job completed'));
  }

  // Repeatable jobs — the cadence lives here; the DB `platform_settings` will
  // tune TTLs, this only drives the tick.
  const outboxQueue = new Queue('outbox-relay', { connection });
  await outboxQueue.add('tick', {}, { repeat: { every: 2_000 }, removeOnComplete: 50 });

  const expiryQueue = new Queue('order-expiry', { connection });
  await expiryQueue.add('tick', {}, { repeat: { every: 30_000 }, removeOnComplete: 20 });

  const assertQueue = new Queue('ledger-assert', { connection });
  await assertQueue.add('tick', {}, { repeat: { every: 3_600_000 }, removeOnComplete: 10 });

  const events = QUEUE_NAMES.map((n) => new QueueEvents(n, { connection }));

  logger.info({ queues: QUEUE_NAMES }, 'DJAFAT worker started');

  const shutdown = async (): Promise<void> => {
    logger.info('worker shutting down');
    await Promise.allSettled([
      ...workers.map((w) => w.close()),
      ...events.map((e) => e.close()),
      outboxQueue.close(),
      expiryQueue.close(),
      assertQueue.close(),
    ]);
    await connection.quit();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void bootstrap();
