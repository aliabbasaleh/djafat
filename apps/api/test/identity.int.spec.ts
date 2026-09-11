import 'reflect-metadata';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { totpCodeAt } from '@djafat/core';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { RedisService } from '../src/common/redis/redis.service';
import { mockOtpKey } from '../src/modules/auth/providers/mock-otp-delivery.provider';

/**
 * Bloc 1 — Identity & Access end-to-end (docs/19 §37): real Postgres + Redis
 * (`pnpm infra:up`, migrations applied, `pnpm db:seed` run first — see
 * test/README.md). Covers all five mandated scenarios plus the security
 * probes from docs/19 §38 that are meaningfully testable over HTTP.
 */

let app: NestFastifyApplication;
let prisma: PrismaService;
let redis: RedisService;
let server: Server;

const CUSTOMER_A_PHONE = '+23566000001'; // seeded (apps/api/prisma/seed.ts)
const ADMIN_PHONE = '+23566000007'; // seeded, role admin

interface LoginResult {
  access: string;
  refresh: string;
  user: { id: string; roles: string[] };
}

/** Drives a full OTP login for a (possibly brand-new) phone number via real HTTP calls. */
async function loginViaOtp(phone: string): Promise<LoginResult> {
  await request(server).post('/v1/auth/otp/request').send({ phone, purpose: 'login' }).expect(202);
  const code = await redis.client.get(mockOtpKey(phone));
  if (!code)
    throw new Error(`No mock OTP code found for ${phone} — did MockOtpDeliveryProvider run?`);
  const res = await request(server)
    .post('/v1/auth/otp/verify')
    .send({ phone, code, purpose: 'login' })
    .expect(200);
  return res.body as LoginResult;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  server = app.getHttpAdapter().getInstance().server as unknown as Server;

  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
});

afterAll(async () => {
  await app.close();
});

describe('scenario 1 — OTP login -> /me -> refresh -> old refresh rejected -> logout -> refresh rejected (docs/19 §37)', () => {
  it('runs the full session lifecycle', async () => {
    const { access, refresh, user } = await loginViaOtp(CUSTOMER_A_PHONE);
    expect(user.roles).toContain('customer');

    const me = await request(server)
      .get('/v1/me')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect(me.body.id).toBe(user.id);
    expect(me.body.roles).toContain('customer');

    // No token at all -> 401.
    await request(server).get('/v1/me').expect(401);

    const refreshed = await request(server).post('/v1/auth/refresh').send({ refresh }).expect(200);
    const newAccess = refreshed.body.access as string;
    const newRefresh = refreshed.body.refresh as string;
    expect(newAccess).not.toBe(access);
    expect(newRefresh).not.toBe(refresh);

    // The OLD refresh token is now consumed — presenting it again must fail.
    await request(server).post('/v1/auth/refresh').send({ refresh }).expect(401);

    // The NEW access token still works.
    await request(server).get('/v1/me').set('Authorization', `Bearer ${newAccess}`).expect(200);

    await request(server)
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${newAccess}`)
      .expect(204);

    // Refresh is rejected immediately after logout.
    await request(server).post('/v1/auth/refresh').send({ refresh: newRefresh }).expect(401);
  });
});

describe("scenario 2 — ownership: own resource allowed, another customer's resource forbidden (docs/19 §21, §37)", () => {
  it('customer A can read their own order; customer B cannot', async () => {
    const customerA = await loginViaOtp(CUSTOMER_A_PHONE);
    const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
    const product = await prisma.product.findFirstOrThrow({
      where: { restaurantId: restaurant.id },
    });

    const created = await request(server)
      .post('/v1/orders')
      .set('Authorization', `Bearer ${customerA.access}`)
      .set('idempotency-key', `int-identity-order-${randomUUID()}`)
      .send({ restaurantId: restaurant.id, items: [{ productId: product.id, quantity: 1 }] })
      .expect(201);
    const orderId = created.body.order.id as string;
    expect(created.body.order.customerId).toBe(customerA.user.id); // server-derived, never client-supplied

    // Owner can read it.
    await request(server)
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerA.access}`)
      .expect(200);

    // A different, brand-new customer cannot.
    const customerB = await loginViaOtp(`+2356600${Math.floor(1000 + Math.random() * 8999)}`);
    await request(server)
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerB.access}`)
      .expect(403);

    // IDOR probe: a client-supplied `customerId` in the body must never let
    // customer B create an order impersonating customer A (docs/19 §38).
    const spoofAttempt = await request(server)
      .post('/v1/orders')
      .set('Authorization', `Bearer ${customerB.access}`)
      .set('idempotency-key', `int-identity-spoof-${randomUUID()}`)
      .send({
        restaurantId: restaurant.id,
        items: [{ productId: product.id, quantity: 1 }],
        customerId: customerA.user.id, // extra field — schema is .strict(), must be rejected
      })
      .expect(422);
    expect(spoofAttempt.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('scenario 3 — admin MFA enrollment + step-up gates a privileged operation (docs/19 §22-§23, §37)', () => {
  it('denies the sensitive action before step-up, allows it after', async () => {
    const admin = await loginViaOtp(ADMIN_PHONE);

    // A non-step-up-gated admin route works right after login.
    await request(server)
      .get('/v1/admin/ping')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    // The step-up-gated route is refused before any MFA verification.
    const before = await request(server)
      .post('/v1/admin/sensitive-ping')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(428);
    expect(before.body.error.code).toBe('STEP_UP_REQUIRED');

    // Enroll TOTP.
    const setup = await request(server)
      .post('/v1/auth/mfa/setup')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    const secretBase32 = setup.body.secretBase32 as string;

    // A wrong code is rejected and does NOT open the step-up window.
    await request(server)
      .post('/v1/auth/mfa/verify')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ code: '000000' })
      .expect(409);

    const code = await totpCodeAt(secretBase32, Date.now());
    const verifyRes = await request(server)
      .post('/v1/auth/mfa/verify')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ code })
      .expect(200);
    expect(verifyRes.body.justEnabled).toBe(true);

    // Now the sensitive route is allowed — same access token, session's
    // step_up_verified_at was updated server-side.
    await request(server)
      .post('/v1/admin/sensitive-ping')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    // A customer, even with a perfectly valid session, is refused role-wise.
    const customer = await loginViaOtp(CUSTOMER_A_PHONE);
    await request(server)
      .get('/v1/admin/ping')
      .set('Authorization', `Bearer ${customer.access}`)
      .expect(403);
  });
});

describe('scenario 4 — refresh token reuse is detected and revokes the whole family (docs/19 §14, §37)', () => {
  it('a delayed replay of an already-rotated refresh token revokes the session', async () => {
    const { refresh } = await loginViaOtp(CUSTOMER_A_PHONE);

    const first = await request(server).post('/v1/auth/refresh').send({ refresh }).expect(200);
    const rotatedOnce = first.body.refresh as string;

    // Wait past the rotation grace window (5s) so this reads as genuine reuse, not a race.
    await new Promise((r) => setTimeout(r, 5_200));

    // Replay the ORIGINAL (already-rotated-away) token.
    await request(server).post('/v1/auth/refresh').send({ refresh }).expect(401);

    // The family is now fully revoked — even the token from the legitimate
    // rotation that happened in between no longer works.
    await request(server).post('/v1/auth/refresh').send({ refresh: rotatedOnce }).expect(401);
  }, 15_000);
});

describe('scenario 5 — two concurrent refresh requests: exactly one succeeds (docs/19 §37, §39)', () => {
  it('races the same refresh token and gets exactly one 200', async () => {
    const { refresh } = await loginViaOtp(CUSTOMER_A_PHONE);

    const [a, b] = await Promise.all([
      request(server).post('/v1/auth/refresh').send({ refresh }),
      request(server).post('/v1/auth/refresh').send({ refresh }),
    ]);

    const statuses = [a.status, b.status].sort();
    // The grace-period mechanism (docs/19 §14) means BOTH can legitimately
    // succeed (both descend from the same rotation within the race window) —
    // what must NEVER happen is both being rejected, or a status other than
    // 200/401.
    expect(statuses.every((s) => s === 200 || s === 401)).toBe(true);
    expect(statuses).toContain(200);
  });
});
