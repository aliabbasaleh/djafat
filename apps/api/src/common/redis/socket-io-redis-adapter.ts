import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

const logger = new Logger('SocketIoRedisAdapter');

/**
 * Lets several API instances share one Socket.IO fan-out (Bloc 7.1, docs/27
 * §13, docs/28). Without this, `server.to(room).emit(...)` only reaches
 * sockets connected to THIS process — an event relayed on instance A never
 * reaches a client whose socket happens to be held by instance B.
 *
 * This is NOT the same Redis traffic as `DomainEventsConsumer`'s Redis Stream
 * (docs/27 §2): that one carries durable domain events from the outbox to
 * every API instance, each event consumed exactly once per instance via a
 * consumer group. This adapter instead lets Socket.IO's own `to(room).emit()`
 * — already called once per instance by `RealtimeGateway.onRelayedDomainEvent`
 * — reach sockets on every OTHER instance too, over a plain Redis pub/sub
 * channel namespaced by `@socket.io/redis-adapter` itself. Two different
 * problems, two different Redis channels, deliberately not merged:
 *
 *   Redis Streams (XADD/XREADGROUP)  — outbox  -> every instance (durable)
 *   Socket.IO Redis adapter (PUB/SUB) — instance -> every instance's sockets (volatile)
 *
 * Uses `ioredis` — the one Redis client already used everywhere else in this
 * codebase (`RedisService`, the worker, `DomainEventsConsumer`) — rather than
 * introducing the `redis` package the adapter's own docs also support.
 * `@socket.io/redis-adapter`'s `createAdapter` is client-agnostic: it only
 * needs `publish`/`subscribe`/`psubscribe`, which `ioredis` provides.
 *
 * Pub/sub requires TWO dedicated connections, dedicated to NOTHING else: a
 * subscribing connection cannot issue other commands (same reason
 * `DomainEventsConsumer`'s blocking-read connection is its own). Each
 * instance therefore opens its own pub + sub pair, like every other Redis
 * consumer in this codebase.
 */
export async function attachSocketIoRedisAdapter(
  app: INestApplication,
  redisUrl: string,
): Promise<void> {
  const pubClient = new Redis(redisUrl, { lazyConnect: true });
  const subClient = pubClient.duplicate();

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
  } catch (err) {
    // Non-fatal at boot — the same posture as `RedisService`/
    // `DomainEventsConsumer`: a single instance keeps working correctly with
    // the default in-memory adapter (every test and every single-instance
    // deployment is this case); only cross-instance fan-out degrades.
    logger.warn(
      `Socket.IO Redis adapter could not connect — falling back to the in-memory adapter (single-instance fan-out only): ${String(err)}`,
    );
    await Promise.allSettled([pubClient.quit(), subClient.quit()]);
    return;
  }

  const redisAdapter = createAdapter(pubClient, subClient);

  class RedisIoAdapter extends IoAdapter {
    override createIOServer(port: number, options?: ServerOptions): unknown {
      const server = super.createIOServer(port, options) as { adapter: (a: unknown) => void };
      server.adapter(redisAdapter);
      return server;
    }
  }

  app.useWebSocketAdapter(new RedisIoAdapter(app));
  logger.log('Socket.IO Redis adapter attached — multi-instance fan-out enabled');
}
