import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import type { OutboxEnvelope } from '@djafat/types';
import { DOMAIN_EVENT_STREAM, DOMAIN_EVENT_STREAM_MAXLEN } from '@djafat/types';
import { env, logger } from './logger';
import { pool } from './db';
import { makeOutboxRelayProcessor } from './processors/outbox-relay.processor';
import { makeOrderExpiryProcessor } from './processors/order-expiry.processor';
import { makeOrderConfirmationTimeoutProcessor } from './processors/order-confirmation-timeout.processor';
import { makeDispatchRetryProcessor } from './processors/dispatch.processor';
import {
  makeLedgerAssertProcessor,
  selfTestPureInvariant,
} from './processors/ledger-assert.processor';

async function bootstrap(): Promise<void> {
  selfTestPureInvariant(); // fails fast at boot if @djafat/core's invariant primitive is broken

  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const publisherConnection = new IORedis(env.REDIS_URL);

  /**
   * Appends a domain event to the durable Redis Stream every API instance's
   * realtime fan-out reads (docs/27 §2). `XADD` persists the entry, so an API
   * process that was down during a deploy reads what it missed when it returns
   * — which `PUBLISH` could not do.
   *
   * `MAXLEN ~` caps the stream approximately (cheaper than an exact trim, and
   * the bound only needs to be a bound): a long outage cannot grow Redis
   * without limit. Resolving with the entry id is what lets the relay mark the
   * outbox row published; a rejection leaves it for the next tick.
   */
  const publish = async (event: OutboxEnvelope): Promise<string> => {
    const id = await publisherConnection.xadd(
      DOMAIN_EVENT_STREAM,
      'MAXLEN',
      '~',
      String(DOMAIN_EVENT_STREAM_MAXLEN),
      '*',
      'event',
      JSON.stringify(event),
    );
    if (id === null) {
      throw new Error(`XADD to ${DOMAIN_EVENT_STREAM} returned no id for outbox row ${event.id}`);
    }
    return id;
  };

  const workers: Worker[] = [
    new Worker('outbox-relay', makeOutboxRelayProcessor(publish), { connection }),
    new Worker('order-expiry', makeOrderExpiryProcessor(), { connection }),
    new Worker('order-confirmation-timeout', makeOrderConfirmationTimeoutProcessor(), {
      connection,
    }),
    new Worker('ledger-assert', makeLedgerAssertProcessor(), { connection }),
    new Worker('dispatch-retry', makeDispatchRetryProcessor(), { connection }),
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

  // ORD-02: placed orders nobody confirmed within
  // platform_settings['order_confirmation_timeout_seconds'] are cancelled (and
  // refunded by the API, PAY-04). A 30 s tick against a 15 min default.
  const confirmationQueue = new Queue('order-confirmation-timeout', { connection });
  await confirmationQueue.add('tick', {}, { repeat: { every: 30_000 }, removeOnComplete: 20 });

  const assertQueue = new Queue('ledger-assert', { connection });
  await assertQueue.add('tick', {}, { repeat: { every: 3_600_000 }, removeOnComplete: 10 });

  // Offers expire on a 30s default (platform_settings['offer_timeout_seconds'])
  // — a 10s tick keeps expiry snappy without hammering the DB (docs/25 §15, §42).
  const dispatchQueue = new Queue('dispatch-retry', { connection });
  await dispatchQueue.add('tick', {}, { repeat: { every: 10_000 }, removeOnComplete: 50 });

  logger.info(
    {
      queues: [
        'outbox-relay',
        'order-expiry',
        'order-confirmation-timeout',
        'ledger-assert',
        'dispatch-retry',
      ],
    },
    'DJAFAT worker started',
  );

  const shutdown = async (): Promise<void> => {
    logger.info('worker shutting down');
    await Promise.allSettled([
      ...workers.map((w) => w.close()),
      outboxQueue.close(),
      expiryQueue.close(),
      assertQueue.close(),
      dispatchQueue.close(),
    ]);
    await Promise.allSettled([connection.quit(), publisherConnection.quit(), pool.end()]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void bootstrap();
