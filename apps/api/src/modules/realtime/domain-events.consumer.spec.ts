import { describe, expect, it, vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { OutboxEnvelope } from '@djafat/types';
import type { AppConfigService } from '../../common/config/config.service';
import { DomainEventsConsumer, RELAYED_DOMAIN_EVENT } from './domain-events.consumer';

/**
 * Bloc 7 §20 — the transport's delivery guarantees.
 *
 * The blocking read loop needs a real Redis; everything that DECIDES anything
 * lives in `handleEntry`, which is driven directly here. What matters is not
 * that Redis was called but **whether an entry is acknowledged**: an ack is the
 * consumer promising the event was handled, and a wrong ack is a lost event
 * nothing can recover.
 */

interface FakeRedis {
  xack: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

function makeConsumer(opts: { onEvent?: (e: OutboxEnvelope) => Promise<void> | void } = {}): {
  consumer: DomainEventsConsumer;
  redis: FakeRedis;
  received: OutboxEnvelope[];
} {
  // `lazyConnect` means constructing the real client opens no socket, so the
  // constructor runs untouched and only the client is swapped.
  const config = { get: () => 'redis://localhost:6379' } as unknown as AppConfigService;
  const events = new EventEmitter2();
  const received: OutboxEnvelope[] = [];

  // `emitAsync` awaits whatever a listener returns — which is exactly the
  // property under test, so this listener genuinely returns a promise. The cast
  // is only to satisfy EventEmitter2's loosely-typed `on(...values: any[]) =>
  // void` signature, which cannot express "may return a promise the emitter
  // will await".
  const listener = (envelope: OutboxEnvelope): Promise<void> | void => {
    received.push(envelope);
    return opts.onEvent?.(envelope);
  };
  events.on(RELAYED_DOMAIN_EVENT, listener as (...args: unknown[]) => void);

  const consumer = new DomainEventsConsumer(config, events);
  const redis: FakeRedis = { xack: vi.fn().mockResolvedValue(1), disconnect: vi.fn() };
  (consumer as unknown as { redis: FakeRedis }).redis = redis;

  return { consumer, redis, received };
}

function entry(envelope: Partial<OutboxEnvelope> = {}): string[] {
  return [
    'event',
    JSON.stringify({
      id: 'outbox-1',
      aggregate: 'order',
      aggregateId: 'order-1',
      eventType: 'order.ready',
      payload: { orderId: 'order-1', status: 'ready' },
      createdAt: '2026-09-30T12:00:00.000Z',
      ...envelope,
    }),
  ];
}

describe('a handled entry is acknowledged (Bloc 7 §20)', () => {
  it('hands the envelope to the fan-out, then acks', async () => {
    const { consumer, redis, received } = makeConsumer();

    await consumer.handleEntry('1700000000000-0', entry());

    expect(received).toHaveLength(1);
    expect(received[0]!.eventType).toBe('order.ready');
    expect(received[0]!.id).toBe('outbox-1');
    expect(redis.xack).toHaveBeenCalledTimes(1);
    expect(redis.xack).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      '1700000000000-0',
    );
  });

  it('preserves the business commit time rather than the relay time', async () => {
    const { consumer, received } = makeConsumer();
    await consumer.handleEntry('1-0', entry({ createdAt: '2026-01-01T00:00:00.000Z' }));
    expect(received[0]!.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('a failing handler leaves the entry pending (Bloc 7 §5, §20)', () => {
  // This is the whole reason the ack is explicit and awaited. If the consumer
  // acked first and handled after, a notification write that threw would be
  // gone: no retry, no trace, no way to know.
  it('does NOT ack when a handler throws', async () => {
    const { consumer, redis } = makeConsumer({
      onEvent: () => {
        throw new Error('notification store unreachable');
      },
    });

    await consumer.handleEntry('1-0', entry());

    expect(redis.xack).not.toHaveBeenCalled();
  });

  it('does NOT ack when a handler rejects asynchronously', async () => {
    const { consumer, redis } = makeConsumer({
      onEvent: async () => {
        await Promise.resolve();
        throw new Error('deadlock detected');
      },
    });

    await consumer.handleEntry('1-0', entry());

    expect(redis.xack).not.toHaveBeenCalled();
  });

  it('a failure does not stop the consumer — it returns and the loop continues', async () => {
    const { consumer } = makeConsumer({
      onEvent: () => {
        throw new Error('boom');
      },
    });
    // No rejection propagates: an entry that fails must not kill the reader.
    await expect(consumer.handleEntry('1-0', entry())).resolves.toBeUndefined();
  });

  it('a later success acks normally after an earlier failure', async () => {
    let shouldFail = true;
    const { consumer, redis } = makeConsumer({
      onEvent: () => {
        if (shouldFail) throw new Error('transient');
      },
    });

    await consumer.handleEntry('1-0', entry());
    expect(redis.xack).not.toHaveBeenCalled();

    shouldFail = false;
    await consumer.handleEntry('1-0', entry()); // redelivered by XAUTOCLAIM
    expect(redis.xack).toHaveBeenCalledTimes(1);
  });
});

describe('a poison entry is dropped rather than retried forever (Bloc 7 §20)', () => {
  // An entry that can never be parsed will fail every redelivery. Leaving it
  // pending would grow the group's pending list without bound and hold up
  // `XAUTOCLAIM` sweeps behind it. Acking is the only terminating choice — so
  // it is acked loudly, never silently.
  it('acks an entry whose JSON is malformed', async () => {
    const { consumer, redis, received } = makeConsumer();
    await consumer.handleEntry('1-0', ['event', '{not json']);
    expect(received).toHaveLength(0);
    expect(redis.xack).toHaveBeenCalledTimes(1);
  });

  it('acks an entry with no `event` field at all', async () => {
    const { consumer, redis, received } = makeConsumer();
    await consumer.handleEntry('1-0', ['something-else', 'value']);
    expect(received).toHaveLength(0);
    expect(redis.xack).toHaveBeenCalledTimes(1);
  });

  it('acks an entry whose `event` key has no value', async () => {
    const { consumer, redis } = makeConsumer();
    await consumer.handleEntry('1-0', ['event']);
    expect(redis.xack).toHaveBeenCalledTimes(1);
  });

  it('acks an envelope missing the fields the fan-out needs', async () => {
    const { consumer, redis, received } = makeConsumer();
    // No id and no eventType: nothing downstream could route or dedupe it.
    await consumer.handleEntry('1-0', ['event', JSON.stringify({ payload: {} })]);
    expect(received).toHaveLength(0);
    expect(redis.xack).toHaveBeenCalledTimes(1);
  });

  it('a valid envelope with an empty payload is still delivered, not dropped', async () => {
    // Malformed is not the same as uninteresting. `settlement.reconciled` has no
    // order id; the router decides it reaches nobody — that is the router's job,
    // not the consumer's.
    const { consumer, redis, received } = makeConsumer();
    await consumer.handleEntry('1-0', entry({ payload: {} }));
    expect(received).toHaveLength(1);
    expect(redis.xack).toHaveBeenCalledTimes(1);
  });
});

describe('at-least-once delivery is safe to repeat (Bloc 7 §5)', () => {
  it('a redelivered entry is handled again with the same event id', async () => {
    const { consumer, received } = makeConsumer();

    await consumer.handleEntry('1-0', entry());
    await consumer.handleEntry('1-0', entry()); // same entry, redelivered

    expect(received).toHaveLength(2);
    // Identical event id is what lets every downstream consumer dedupe — the
    // consumer deliberately does NOT try to suppress the repeat itself, because
    // an in-memory seen-set would be wrong across a restart.
    expect(received[0]!.id).toBe(received[1]!.id);
    expect(received[0]).toEqual(received[1]);
  });

  it('two different entries carrying the same outbox row are both delivered', async () => {
    // Possible if the relay retried after a partial failure. Downstream dedupe
    // on `id` handles it; the consumer must not silently swallow one.
    const { consumer, received } = makeConsumer();
    await consumer.handleEntry('1-0', entry());
    await consumer.handleEntry('2-0', entry());
    expect(received).toHaveLength(2);
    expect(received.map((e) => e.id)).toEqual(['outbox-1', 'outbox-1']);
  });
});

describe('shutdown does not lose work (Bloc 7 §20)', () => {
  it('stops cleanly when it was never started', async () => {
    const { consumer } = makeConsumer();
    // `onModuleInit` may have failed (Redis down at boot, which is non-fatal).
    // Destroying an unstarted consumer must not throw.
    await expect(consumer.onModuleDestroy()).resolves.toBeUndefined();
  });
});
