import 'reflect-metadata';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { AppConfigService } from '../src/common/config/config.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { RedisService } from '../src/common/redis/redis.service';
import { attachSocketIoRedisAdapter } from '../src/common/redis/socket-io-redis-adapter';
import { mockOtpKey } from '../src/modules/auth/providers/mock-otp-delivery.provider';
import { RealtimeGateway } from '../src/modules/realtime/realtime.gateway';

/**
 * Bloc 7.1 §3 — the two hardening fixes interacting: multi-instance fan-out
 * (step 1) AND JWT-expiry handling (step 2) exercised TOGETHER, plus the
 * adversarial scenarios the mandate names (gateway down, reconnect, duplicate
 * event). Real PostgreSQL + Redis required (`pnpm infra:up`, migrations
 * applied, `pnpm db:seed` — test/README.md).
 *
 * NOT executed in this environment — Docker is unavailable here. Written so
 * it can run as-is once Docker is available, per the mandate's explicit
 * allowance: "le test peut néanmoins être écrit et documenté."
 *
 * ── Scenarios NOT re-created here, and why ──────────────────────────────
 * - "worker redémarré": the relay/consumer's own crash-and-resume behaviour
 *   (stale-entry reclaim via XAUTOCLAIM, at-least-once redelivery) is already
 *   covered exhaustively at the unit level in
 *   `domain-events.consumer.spec.ts` and `outbox-relay.processor.spec.ts`
 *   (Bloc 7). Re-deriving it here against a live worker process would
 *   duplicate that coverage without adding a new failure mode to check.
 * - "Redis temporairement indisponible": genuinely toggling the Redis
 *   container mid-test is infrastructure orchestration (stopping/starting a
 *   docker-compose service), not something a single Vitest process can do to
 *   its own dependency safely or deterministically. Noted as a scenario that
 *   needs a CI-level or manual chaos test, not a unit/integration test.
 */

const CUSTOMER_PHONE = '+23566000001'; // seeded (apps/api/prisma/seed.ts)

interface Instance {
  app: NestFastifyApplication;
  gateway: RealtimeGateway;
  port: number;
  server: Server;
}

async function bootInstance(): Promise<Instance> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  configureApp(app);
  const config = app.get(AppConfigService);
  await attachSocketIoRedisAdapter(app, config.get('REDIS_URL'));
  await app.listen(0, '127.0.0.1');
  await app.getHttpAdapter().getInstance().ready();
  const server = app.getHttpAdapter().getInstance().server as unknown as Server;
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { app, gateway: app.get(RealtimeGateway), port, server };
}

async function loginViaOtp(server: Server, redis: RedisService, phone: string): Promise<string> {
  await request(server).post('/v1/auth/otp/request').send({ phone, purpose: 'login' }).expect(202);
  const code = await redis.client.get(mockOtpKey(phone));
  if (!code) throw new Error(`No mock OTP code for ${phone}`);
  const res = await request(server)
    .post('/v1/auth/otp/verify')
    .send({ phone, code, purpose: 'login' })
    .expect(200);
  return (res.body as { access: string }).access;
}

function connectClient(port: number, token: string): ClientSocket {
  return io(`http://127.0.0.1:${port}/rt`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
}

function waitForConnect(client: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('connect_error', (err: Error) => reject(err));
  });
}

function waitForDisconnect(client: ClientSocket, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timed out waiting for disconnect')),
      timeoutMs,
    );
    client.once('disconnect', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function waitForEvent<T>(client: ClientSocket, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${event}"`)),
      timeoutMs,
    );
    client.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function assertNoEvent(client: ClientSocket, event: string, windowMs = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (): void => {
      clearTimeout(timer);
      reject(new Error(`unexpectedly received "${event}"`));
    };
    client.once(event, handler);
    const timer = setTimeout(() => {
      client.off(event, handler);
      resolve();
    }, windowMs);
  });
}

let instanceA: Instance;
let instanceB: Instance;
let redisA: RedisService;
let customerId: string;
let customerToken: string;

beforeAll(async () => {
  instanceA = await bootInstance();
  instanceB = await bootInstance();
  redisA = instanceA.app.get(RedisService);
  customerToken = await loginViaOtp(instanceA.server, redisA, CUSTOMER_PHONE);
  const prisma = instanceA.app.get(PrismaService);
  const customer = await prisma.user.findFirstOrThrow({ where: { phone: CUSTOMER_PHONE } });
  customerId = customer.id;
}, 30_000);

afterAll(async () => {
  await instanceA?.app.close().catch(() => undefined);
  await instanceB?.app.close().catch(() => undefined);
});

describe('multi-instance fan-out + JWT expiry, combined (Bloc 7.1 §3)', () => {
  it('event -> cross-instance delivery -> expiry -> reconnect -> new event -> still correctly authorized', async () => {
    // 1. Client on B, subscribed to its own customer room.
    const client1 = connectClient(instanceB.port, customerToken);
    await waitForConnect(client1);
    client1.emit('subscribe', { room: `customer:${customerId}` });
    await new Promise((r) => setTimeout(r, 200));

    // 2. An event emitted on A's server reaches the client connected to B —
    //    proves the adapter still works alongside the expiry mechanism.
    const firstEvent = waitForEvent(client1, 'test.combined', 2000);
    instanceA.gateway.server.to(`customer:${customerId}`).emit('test.combined', { seq: 1 });
    await expect(firstEvent).resolves.toEqual({ seq: 1 });

    // 3. Force this socket's stored token to be treated as expired, as the
    //    periodic sweep (Bloc 7.1 §2) would find it, and run that sweep.
    const tokenExpiry = (
      instanceB.gateway as unknown as {
        tokenExpiry: Map<string, { client: unknown; exp: number }>;
      }
    ).tokenExpiry;
    let entry: { client: unknown; exp: number } | undefined;
    for (const [, v] of tokenExpiry) entry = v; // only one socket on B in this test
    expect(entry).toBeDefined();
    tokenExpiry.set([...tokenExpiry.keys()][0]!, {
      client: entry!.client,
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    (
      instanceB.gateway as unknown as { disconnectExpiredSockets: () => void }
    ).disconnectExpiredSockets();

    await waitForDisconnect(client1);

    // 4. Reconnect with a FRESH token (simulating the client's own refresh
    //    + reconnect flow, docs/27 §17's `useRoomRealtime`) — to instance A
    //    this time, proving re-authorization works regardless of which
    //    instance handles it.
    const freshToken = await loginViaOtp(instanceA.server, redisA, CUSTOMER_PHONE);
    const client2 = connectClient(instanceA.port, freshToken);
    try {
      await waitForConnect(client2);
      client2.emit('subscribe', { room: `customer:${customerId}` });
      await new Promise((r) => setTimeout(r, 200));

      // 5. A new event, emitted on B this time, must still reach the
      //    reconnected client on A — cross-instance in the OTHER direction,
      //    proving the adapter is symmetric and expiry handling on one
      //    instance does not impair the other.
      const secondEvent = waitForEvent(client2, 'test.combined', 2000);
      instanceB.gateway.server.to(`customer:${customerId}`).emit('test.combined', { seq: 2 });
      await expect(secondEvent).resolves.toEqual({ seq: 2 });
    } finally {
      client2.disconnect();
    }
  }, 10_000);

  it('an unauthorized actor is refused on both instances throughout the sequence', async () => {
    // A customer who does not own `customerId`'s room must never receive
    // anything, whether before or after the expiry/reconnect dance above —
    // security must hold at every step, not just at the start.
    await request(instanceA.server)
      .post('/v1/auth/otp/request')
      .send({ phone: '+23566000098', purpose: 'login' })
      .expect(202);
    const code = await redisA.client.get(mockOtpKey('+23566000098'));
    const verifyRes = await request(instanceA.server)
      .post('/v1/auth/otp/verify')
      .send({ phone: '+23566000098', code, purpose: 'login' })
      .expect(200);
    const strangerToken = (verifyRes.body as { access: string }).access;

    const strangerOnA = connectClient(instanceA.port, strangerToken);
    const strangerOnB = connectClient(instanceB.port, strangerToken);
    try {
      await Promise.all([waitForConnect(strangerOnA), waitForConnect(strangerOnB)]);
      strangerOnA.emit('subscribe', { room: `customer:${customerId}` });
      strangerOnB.emit('subscribe', { room: `customer:${customerId}` });
      await new Promise((r) => setTimeout(r, 200));

      instanceA.gateway.server.to(`customer:${customerId}`).emit('test.stranger_check', { seq: 1 });

      await assertNoEvent(strangerOnA, 'test.stranger_check');
      await assertNoEvent(strangerOnB, 'test.stranger_check');
    } finally {
      strangerOnA.disconnect();
      strangerOnB.disconnect();
    }
  });

  it('a duplicate emit across instances is delivered twice — no cross-instance dedup either', async () => {
    const client = connectClient(instanceB.port, customerToken);
    try {
      await waitForConnect(client);
      client.emit('subscribe', { room: `customer:${customerId}` });
      await new Promise((r) => setTimeout(r, 200));

      const received: unknown[] = [];
      client.on('test.duplicate_combined', (p: unknown) => received.push(p));

      instanceA.gateway.server
        .to(`customer:${customerId}`)
        .emit('test.duplicate_combined', { seq: 1 });
      instanceA.gateway.server
        .to(`customer:${customerId}`)
        .emit('test.duplicate_combined', { seq: 1 });

      await new Promise((r) => setTimeout(r, 300));
      expect(received).toHaveLength(2);
    } finally {
      client.disconnect();
    }
  });
});

describe('gateway instance failure (Bloc 7.1 §3)', () => {
  it('instance B stopping does not affect clients connected to instance A', async () => {
    const transient = await bootInstance();
    const clientOnTransient = connectClient(transient.port, customerToken);
    const clientOnA = connectClient(instanceA.port, customerToken);
    try {
      await Promise.all([waitForConnect(clientOnTransient), waitForConnect(clientOnA)]);
      clientOnA.emit('subscribe', { room: `customer:${customerId}` });
      await new Promise((r) => setTimeout(r, 200));

      // Stop the transient instance entirely.
      clientOnTransient.disconnect();
      await transient.app.close();

      // Instance A keeps working completely normally.
      const got = waitForEvent(clientOnA, 'test.after_gateway_down', 2000);
      instanceA.gateway.server
        .to(`customer:${customerId}`)
        .emit('test.after_gateway_down', { ok: true });
      await expect(got).resolves.toEqual({ ok: true });
    } finally {
      clientOnA.disconnect();
    }
  });

  it('a client whose instance stopped can reconnect to a surviving instance and resume normally', async () => {
    const transient = await bootInstance();
    const client = connectClient(transient.port, customerToken);
    await waitForConnect(client);
    client.emit('subscribe', { room: `customer:${customerId}` });
    await new Promise((r) => setTimeout(r, 200));

    client.disconnect();
    await transient.app.close();

    // The client's own reconnect logic (docs/27 §17) would pick a surviving
    // instance — simulated here by connecting directly to B.
    const reconnected = connectClient(instanceB.port, customerToken);
    try {
      await waitForConnect(reconnected);
      reconnected.emit('subscribe', { room: `customer:${customerId}` });
      await new Promise((r) => setTimeout(r, 200));

      const got = waitForEvent(reconnected, 'test.resumed', 2000);
      instanceA.gateway.server.to(`customer:${customerId}`).emit('test.resumed', { ok: true });
      await expect(got).resolves.toEqual({ ok: true });
    } finally {
      reconnected.disconnect();
    }
  });
});
