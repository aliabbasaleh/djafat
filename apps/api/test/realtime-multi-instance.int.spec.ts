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
 * Bloc 7.1 §1 — two API instances sharing one Socket.IO fan-out via the Redis
 * adapter (docs/28). Real PostgreSQL + Redis required (`pnpm infra:up`,
 * migrations applied, `pnpm db:seed` run first — test/README.md).
 *
 * NOT executed in this environment — Docker is unavailable here. Written and
 * reviewed so it can run as-is in CI or on any machine with Docker, per the
 * mandate: "le test peut néanmoins être écrit et documenté."
 *
 * ── What this tests, deliberately, and what it does not ───────────────────
 * The event ROUTING table (`domain-event-router.ts`: which room an event type
 * reaches) is already exhaustively unit-tested without any infrastructure.
 * What can ONLY be proven with a real Redis is whether `server.to(room).emit`
 * on ONE process reaches a socket held by ANOTHER process — that is exactly,
 * and only, what the Redis adapter is for. So this file calls the gateway's
 * `server.to(room).emit(...)` directly on instance A and asserts the event
 * reaches a socket connected to instance B, rather than re-driving the whole
 * outbox->worker->consumer chain (covered elsewhere, and orthogonal to the
 * adapter).
 *
 * Uses the `customer:{userId}` room: its authorization is a pure identity
 * check with no order/cart dependency, which keeps this file about the
 * adapter and not about unrelated fixture setup.
 */

const CUSTOMER_PHONE = '+23566000001'; // seeded (apps/api/prisma/seed.ts)
const WRONG_USER_PHONE = '+23566000099'; // does not exist — used for the IDOR case

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
  // The exact call `main.ts` makes — this is what is under test.
  await attachSocketIoRedisAdapter(app, config.get('REDIS_URL'));

  await app.listen(0); // ephemeral port — a real socket.io-client needs a real TCP port
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

/** Resolves once no `event` arrives within `windowMs` — used to prove a room/event did NOT reach a client. */
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
  await instanceA?.app.close();
  await instanceB?.app.close();
});

describe('one event, two instances (Bloc 7.1 §1)', () => {
  it('a client on instance B receives an event emitted on instance A', async () => {
    const clientA = connectClient(instanceA.port, customerToken);
    const clientB = connectClient(instanceB.port, customerToken);
    try {
      await Promise.all([waitForConnect(clientA), waitForConnect(clientB)]);

      clientA.emit('subscribe', { room: `customer:${customerId}` });
      clientB.emit('subscribe', { room: `customer:${customerId}` });
      await new Promise((r) => setTimeout(r, 200)); // let the join round-trip land

      const onB = waitForEvent(clientB, 'test.cross_instance');
      const onA = waitForEvent(clientA, 'test.cross_instance');

      // Emitted ONLY on instance A's server — never touches instance B's process directly.
      instanceA.gateway.server
        .to(`customer:${customerId}`)
        .emit('test.cross_instance', { from: 'A' });

      const [resultA, resultB] = await Promise.all([onA, onB]);
      expect(resultA).toEqual({ from: 'A' });
      expect(resultB).toEqual({ from: 'A' }); // <- the adapter did its job
    } finally {
      clientA.disconnect();
      clientB.disconnect();
    }
  });

  it('a room nobody on instance B joined receives nothing there', async () => {
    const clientA = connectClient(instanceA.port, customerToken);
    const clientB = connectClient(instanceB.port, customerToken);
    try {
      await Promise.all([waitForConnect(clientA), waitForConnect(clientB)]);
      clientA.emit('subscribe', { room: `customer:${customerId}` });
      // clientB deliberately does NOT subscribe to this room.
      await new Promise((r) => setTimeout(r, 200));

      instanceA.gateway.server
        .to(`customer:${customerId}`)
        .emit('test.room_isolated', { from: 'A' });

      await expect(waitForEvent(clientA, 'test.room_isolated', 1000)).resolves.toEqual({
        from: 'A',
      });
      await assertNoEvent(clientB, 'test.room_isolated');
    } finally {
      clientA.disconnect();
      clientB.disconnect();
    }
  });

  it('an unauthorized user cannot join the room on EITHER instance', async () => {
    // A token for a DIFFERENT user than the one the room is scoped to.
    await request(instanceA.server)
      .post('/v1/auth/otp/request')
      .send({ phone: WRONG_USER_PHONE, purpose: 'login' })
      .expect(202);
    const code = await redisA.client.get(mockOtpKey(WRONG_USER_PHONE));
    const verifyRes = await request(instanceA.server)
      .post('/v1/auth/otp/verify')
      .send({ phone: WRONG_USER_PHONE, code, purpose: 'login' })
      .expect(200);
    const strangerToken = (verifyRes.body as { access: string }).access;

    const strangerOnA = connectClient(instanceA.port, strangerToken);
    const strangerOnB = connectClient(instanceB.port, strangerToken);
    try {
      await Promise.all([waitForConnect(strangerOnA), waitForConnect(strangerOnB)]);
      strangerOnA.emit('subscribe', { room: `customer:${customerId}` });
      strangerOnB.emit('subscribe', { room: `customer:${customerId}` });
      await new Promise((r) => setTimeout(r, 200));

      instanceA.gateway.server.to(`customer:${customerId}`).emit('test.idor_check', { from: 'A' });

      await assertNoEvent(strangerOnA, 'test.idor_check');
      await assertNoEvent(strangerOnB, 'test.idor_check');
    } finally {
      strangerOnA.disconnect();
      strangerOnB.disconnect();
    }
  });

  it('a duplicate emit is delivered twice — no dedup at the socket layer', async () => {
    const clientB = connectClient(instanceB.port, customerToken);
    try {
      await waitForConnect(clientB);
      clientB.emit('subscribe', { room: `customer:${customerId}` });
      await new Promise((r) => setTimeout(r, 200));

      const received: unknown[] = [];
      clientB.on('test.duplicate', (payload: unknown) => received.push(payload));

      instanceA.gateway.server.to(`customer:${customerId}`).emit('test.duplicate', { seq: 1 });
      instanceA.gateway.server.to(`customer:${customerId}`).emit('test.duplicate', { seq: 1 }); // same payload, sent twice

      await new Promise((r) => setTimeout(r, 300));
      expect(received).toHaveLength(2); // dedup is the CLIENT's job (eventId), not this layer's
    } finally {
      clientB.disconnect();
    }
  });

  it('disconnecting from instance B and reconnecting to instance A still authorizes the same room', async () => {
    const first = connectClient(instanceB.port, customerToken);
    await waitForConnect(first);
    first.emit('subscribe', { room: `customer:${customerId}` });
    await new Promise((r) => setTimeout(r, 200));
    first.disconnect();

    const second = connectClient(instanceA.port, customerToken);
    try {
      await waitForConnect(second);
      second.emit('subscribe', { room: `customer:${customerId}` });
      await new Promise((r) => setTimeout(r, 200));

      const got = waitForEvent(second, 'test.reconnect');
      instanceA.gateway.server.to(`customer:${customerId}`).emit('test.reconnect', { ok: true });
      await expect(got).resolves.toEqual({ ok: true });
    } finally {
      second.disconnect();
    }
  });
});
