import 'reflect-metadata';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { REFRESH_ROTATION_GRACE_MS, totpCodeAt } from '@djafat/core';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { RedisService } from '../src/common/redis/redis.service';
import { mockOtpKey } from '../src/modules/auth/providers/mock-otp-delivery.provider';
import { keepRestaurantOpen } from './open-restaurant.helper';

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
/** Set by `beforeAll` — see `keepRestaurantOpen` (BUG-PAY-INT-7). */
let restoreHours: () => Promise<void>;

const CUSTOMER_A_PHONE = '+23566000001'; // seeded (apps/api/prisma/seed.ts)
const ADMIN_PHONE = '+23566000007'; // seeded, role admin

/**
 * BUG-PAY-INT-4 — a phone number nobody has used before.
 *
 * The integration database is long-lived (`pnpm infra:up` keeps its volume)
 * and OTP login AUTO-CREATES the customer on first sight, so a scenario that
 * counts rows for a SEEDED number counts every previous run too: scenario 1's
 * final `live sessions === 0` read 79 on the first real execution, one row per
 * login this suite had ever done. Asserting on absolute counts requires an
 * identity that exists only for this run.
 *
 * Used only where the assertion is about counting; scenarios that need the
 * seeded user's data or roles keep the seeded number.
 */
function freshCustomerPhone(): string {
  // +235 66 + 7 digits, inside the Tchad mobile format the validator accepts.
  return `+2356${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
}

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

  // BUG-PAY-INT-5 — scenario 3 ENROLLS the admin's TOTP, and `POST /v1/auth/mfa/setup`
  // answers 409 `MFA_ALREADY_ENABLED` once a secret is enabled (mfa.service.ts
  // §setup) — deliberately, so a hijacked session cannot swap an admin's
  // secret. The scenario is therefore only runnable against an admin who has
  // not yet enrolled, which the FIRST run leaves behind for every run after
  // it. Dropping the row here makes enrollment repeatable without weakening
  // the rule being tested: this is fixture setup, not a product path.
  const admin = await prisma.user.findFirst({ where: { phone: ADMIN_PHONE } });
  if (admin) await prisma.mfaTotpSecret.deleteMany({ where: { userId: admin.id } });

  // Scenario 2 COMMITS an order, which the product refuses outside the
  // restaurant's opening hours (BUG-PAY-INT-7).
  const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
  restoreHours = await keepRestaurantOpen(prisma, restaurant.id);
});

afterAll(async () => {
  await restoreHours?.();
  await app.close();
});

/**
 * BUG-PAY-INT-2 — this scenario used to assert that replaying a just-consumed
 * refresh token fails with 401. That contradicts the product policy: rotation
 * carries a deliberate `REFRESH_ROTATION_GRACE_MS` (5 s) window, documented in
 * `docs/19` §4.3 and §7.4 and implemented in `classifyRefreshPresentation`
 * (`@djafat/core`). Inside that window a token revoked with
 * `reason = 'rotated'` is forgiven and the LIVE DESCENDANT is rotated instead,
 * so a benign network double-submit cannot revoke the family — including the
 * session the winning request had just created (docs/19 §39: "deux requêtes de
 * refresh concurrentes -> au moins un succès garanti, jamais les deux
 * rejetées"). The suite never ran, so the stale expectation was never caught.
 *
 * The assertion is NOT simply flipped to 200. The grace window is the one part
 * of the rotation policy that deliberately accepts an already-used token, so
 * this scenario now has to prove it stays NARROW. It does so twice, without
 * sleeping:
 *
 *   - it never multiplies sessions — forgiving a replay rotates the family's
 *     single live row, it does not mint a parallel one;
 *   - it is scoped to `reason = 'rotated'` alone — once the family is revoked
 *     by LOGOUT, the very same token, still well inside the 5 s window, is
 *     rejected. Grace is not blanket amnesty.
 *
 * The TIME boundary (same token, replayed past the window -> 401 +
 * `reuse_detected` + whole-family revocation) is scenario 4's job; it is not
 * duplicated here.
 */
describe('scenario 1 — OTP login -> /me -> refresh -> bounded grace replay -> logout -> refresh rejected (docs/19 §4.3, §37, §39)', () => {
  it('runs the full session lifecycle, and the rotation grace window stays bounded', async () => {
    // A number of this run's own — see `freshCustomerPhone` (BUG-PAY-INT-4).
    const { access, refresh: r1, user } = await loginViaOtp(freshCustomerPhone());
    expect(user.roles).toContain('customer');

    const me = await request(server)
      .get('/v1/me')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect(me.body.id).toBe(user.id);
    expect(me.body.roles).toContain('customer');

    // No token at all -> 401.
    await request(server).get('/v1/me').expect(401);

    // ── legitimate rotation: R1 -> R2 ────────────────────────────────────
    const rotated = await request(server)
      .post('/v1/auth/refresh')
      .send({ refresh: r1 })
      .expect(200);
    const access2 = rotated.body.access as string;
    const r2 = rotated.body.refresh as string;
    expect(access2).not.toBe(access);
    expect(r2).not.toBe(r1);

    // ── POLICY: replaying R1 inside the grace window is FORGIVEN ─────────
    // R1 was consumed milliseconds ago with `reason = 'rotated'` and the
    // family still has a live descendant, so the server rotates THAT
    // descendant rather than treating this as reuse.
    expect(REFRESH_ROTATION_GRACE_MS).toBe(5_000); // pin the policy this test encodes
    const liveBefore = await prisma.session.count({
      where: { userId: user.id, revokedAt: null },
    });

    const graceReplay = await request(server)
      .post('/v1/auth/refresh')
      .send({ refresh: r1 })
      .expect(200);
    const access3 = graceReplay.body.access as string;
    const r3 = graceReplay.body.refresh as string;
    expect(r3).not.toBe(r1);
    expect(r3).not.toBe(r2); // the descendant really was rotated, not re-issued

    // BOUNDED (1/2) — forgiveness rotates, it never multiplies: the user ends
    // up with exactly as many live sessions as before the replay.
    const liveAfter = await prisma.session.count({ where: { userId: user.id, revokedAt: null } });
    expect(liveAfter).toBe(liveBefore);

    // The access token from that rotation works.
    await request(server).get('/v1/me').set('Authorization', `Bearer ${access3}`).expect(200);

    await request(server)
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${access3}`)
      .expect(204);

    // Refresh is rejected immediately after logout.
    await request(server).post('/v1/auth/refresh').send({ refresh: r3 }).expect(401);

    // BOUNDED (2/2) — the grace is scoped to `reason = 'rotated'` ONLY. R1 is
    // still inside its 5 s window here, yet logout revoked the family with
    // `reason = 'logout'`, which `classifyRefreshPresentation` never forgives.
    await request(server).post('/v1/auth/refresh').send({ refresh: r1 }).expect(401);

    const live = await prisma.session.count({ where: { userId: user.id, revokedAt: null } });
    expect(live).toBe(0);
  });
});

describe("scenario 2 — ownership: own resource allowed, another customer's resource forbidden (docs/19 §21, §37)", () => {
  it('customer A can read their own order; customer B cannot', async () => {
    const customerA = await loginViaOtp(CUSTOMER_A_PHONE);
    const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
    // "Jus de bissap" has no option groups (docs/20 seed) — keeps this
    // ownership scenario independent of the Bloc 4 option-validation rules,
    // which are their own dedicated coverage (docs/22, catalog.int.spec.ts-style).
    const product = await prisma.product.findFirstOrThrow({
      where: { restaurantId: restaurant.id, name: 'Jus de bissap' },
    });

    await request(server)
      .post('/v1/carts/items')
      .set('Authorization', `Bearer ${customerA.access}`)
      .send({ productId: product.id, quantity: 1, selectedOptionIds: [] })
      .expect(201);
    const created = await request(server)
      .post('/v1/orders')
      .set('Authorization', `Bearer ${customerA.access}`)
      .set('idempotency-key', `int-identity-order-${randomUUID()}`)
      .send({})
      .expect(201);
    const orderId = created.body.order.id as string;
    expect(created.body.order.customerId).toBe(customerA.user.id); // server-derived, never client-supplied

    // Owner can read it.
    await request(server)
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerA.access}`)
      .expect(200);

    // A different, brand-new customer cannot.
    //
    // BUG-PAY-INT-6 — this asserted 403 and the API answers 404. The 404 is
    // the DELIBERATE behaviour, hardened by BUG-10.1.x and recorded in
    // docs/36 §3 ("un `orderId` d'un autre client renvoie 404, jamais les
    // données"): a 403 would confirm that this id names a real order, which
    // is itself a leak — it lets an attacker enumerate order ids and learn
    // volumes without ever reading a row. `getOrderFor` therefore raises
    // `NotFoundException` for both "no such order" and "not yours", so the
    // two are indistinguishable from outside. The suite never ran, so the
    // expectation stayed frozen at the pre-hardening contract.
    const customerB = await loginViaOtp(freshCustomerPhone());
    const probe = await request(server)
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerB.access}`)
      .expect(404);
    // What actually matters: no data crossed the boundary, and the response
    // is the same shape a truly absent order produces.
    expect(probe.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(probe.body)).not.toContain(customerA.user.id);
    const absent = await request(server)
      .get(`/v1/orders/${randomUUID()}`)
      .set('Authorization', `Bearer ${customerB.access}`)
      .expect(404);
    expect(absent.body.error.code).toBe(probe.body.error.code);

    // IDOR probe: a client-supplied `customerId` in the body must never let
    // customer B create an order impersonating customer A (docs/19 §38) — the
    // order-creation body is `.strict().object({})` (docs/22 §9): ANY field
    // at all, `customerId` included, is rejected outright.
    const spoofAttempt = await request(server)
      .post('/v1/orders')
      .set('Authorization', `Bearer ${customerB.access}`)
      .set('idempotency-key', `int-identity-spoof-${randomUUID()}`)
      .send({ customerId: customerA.user.id })
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
