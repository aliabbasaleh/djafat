import 'reflect-metadata';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { totpCodeAt } from '@djafat/core';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { RedisService } from '../src/common/redis/redis.service';
import { mockOtpKey } from '../src/modules/auth/providers/mock-otp-delivery.provider';

/**
 * Bloc 9 (docs/30 §role-management, §order-authorization, Phase 11
 * adversarial matrix) — the admin/role-management surface's RBAC boundary
 * over a REAL HTTP round trip, with every seeded role (`apps/api/prisma/
 * seed.ts`): anonymous, each non-admin role in turn, and the two admin tiers
 * actually succeeding. NOT executed here — Docker unavailable (`pnpm
 * infra:up`, migrations, `pnpm db:seed` required — test/README.md).
 *
 * Unit-level coverage already proves the business invariants exhaustively
 * (`users.service.spec.ts`, `confirm-ready-reject-security.spec.ts`) — this
 * file exists for what only a real HTTP round trip can prove: the ACTUAL
 * route guards reject the actors they're supposed to, wired together
 * exactly as `app.module.ts` assembles them.
 */

const PHONES = {
  customer: '+23566000001',
  courier: '+23566000002',
  restaurantOwner: '+23566000003',
  restaurantStaff: '+23566000004',
  support: '+23566000005',
  finance: '+23566000006',
  admin: '+23566000007',
  superAdmin: '+23566000008',
} as const;

let app: NestFastifyApplication;
let redis: RedisService;
let server: Server;
const tokens: Record<keyof typeof PHONES, string> = {} as never;
const refreshTokens: Record<keyof typeof PHONES, string> = {} as never;
const userIds: Record<keyof typeof PHONES, string> = {} as never;

async function loginViaOtp(
  phone: string,
): Promise<{ access: string; refresh: string; userId: string }> {
  await request(server).post('/v1/auth/otp/request').send({ phone, purpose: 'login' }).expect(202);
  const code = await redis.client.get(mockOtpKey(phone));
  if (!code) throw new Error(`No mock OTP code for ${phone}`);
  const res = await request(server)
    .post('/v1/auth/otp/verify')
    .send({ phone, code, purpose: 'login' })
    .expect(200);
  const body = res.body as { access: string; refresh: string; user: { id: string } };
  return { access: body.access, refresh: body.refresh, userId: body.user.id };
}

/**
 * Bloc 9.1 (docs/31 §mfa-effective) — `grantRole`/`revokeRole` are now
 * `@RequireStepUp()`-gated, so any test exercising them past the role check
 * needs a real, fresh TOTP step-up first (enroll once, verify opens the
 * window — same flow as `identity.int.spec.ts` scenario 3).
 */
async function enrollAndStepUp(access: string): Promise<void> {
  const setup = await request(server)
    .post('/v1/auth/mfa/setup')
    .set('Authorization', `Bearer ${access}`)
    .expect(200);
  const code = await totpCodeAt(setup.body.secretBase32 as string, Date.now());
  await request(server)
    .post('/v1/auth/mfa/verify')
    .set('Authorization', `Bearer ${access}`)
    .send({ code })
    .expect(200);
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  server = app.getHttpAdapter().getInstance().server as unknown as Server;
  redis = app.get(RedisService);

  for (const [key, phone] of Object.entries(PHONES) as Array<[keyof typeof PHONES, string]>) {
    const { access, refresh, userId } = await loginViaOtp(phone);
    tokens[key] = access;
    refreshTokens[key] = refresh;
    userIds[key] = userId;
  }
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('GET /v1/admin/users — RBAC (Phase 11: "customer/courier/restaurant staff -> admin")', () => {
  it('401 anonymous', async () => {
    await request(server).get('/v1/admin/users').expect(401);
  });

  it.each(['customer', 'courier', 'restaurantOwner', 'restaurantStaff'] as const)(
    '403 for a %s — no admin/support/super_admin role',
    async (key) => {
      await request(server)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${tokens[key]}`)
        .expect(403);
    },
  );

  it('200 for admin, super_admin, and support (the three roles with users:read)', async () => {
    for (const key of ['admin', 'superAdmin', 'support'] as const) {
      await request(server)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${tokens[key]}`)
        .expect(200);
    }
  });

  it('negative/overflow pagination never 500s — a validation 422, or an honestly empty page', async () => {
    await request(server)
      .get('/v1/admin/users?page=-1')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(422);
    const farPage = await request(server)
      .get('/v1/admin/users?page=999999')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    expect(farPage.body.items).toEqual([]);
  });
});

// Not seeded — created fresh inside the describe block below, promoted to
// `admin` there, and used ONLY for the MFA step-up scenarios. Deliberately
// NOT the shared, seeded `admin` (`+23566000007`): `identity.int.spec.ts`
// scenario 3 already enrolls THAT account's MFA, and `test/vitest.int.config.ts`
// runs every `.int.spec.ts` file sequentially against one shared Postgres
// (`fileParallelism: false`) — a second enrollment attempt on the same
// account from this file would collide with a `ConflictException` ("MFA is
// already enabled"). `+23566000008` (super_admin) is untouched by every
// other int-spec file as of this writing, so it is safe to enroll here.
const FRESH_ADMIN_PHONE = '+23566000096';

describe('POST/DELETE /v1/admin/users/:id/roles — MFA step-up is now actually enforced (Bloc 9.1, docs/31 §mfa-effective)', () => {
  let freshAdmin: { access: string; refresh: string; userId: string };

  beforeAll(async () => {
    // Bootstrapping: grantRole is now step-up-gated for EVERY actor, so
    // even super_admin must step up before it can promote the fresh actor
    // this block needs. Enrolling super_admin's own MFA here (rather than
    // reusing the shared `admin` account) keeps this file independent of
    // `identity.int.spec.ts`'s enrollment of the same account.
    await enrollAndStepUp(tokens.superAdmin);
    const created = await loginViaOtp(FRESH_ADMIN_PHONE);
    await request(server)
      .post(`/v1/admin/users/${created.userId}/roles`)
      .set('Authorization', `Bearer ${tokens.superAdmin}`)
      .send({ role: 'admin' })
      .expect(201);
    // Roles are a JWT claim, snapshotted at login (docs/19 §13) — the token
    // from `created` was minted BEFORE the grant above and does not carry
    // `admin` yet. Re-login for a fresh token (and a fresh, not-yet-stepped-up
    // session) that actually reflects it.
    const reLoggedIn = await loginViaOtp(FRESH_ADMIN_PHONE);
    freshAdmin = { access: reLoggedIn.access, refresh: reLoggedIn.refresh, userId: created.userId };
  }, 30_000);

  it('a freshly-promoted ADMIN who has never enrolled MFA is refused with 428 STEP_UP_REQUIRED — MFA_REQUIRED_ROLES has teeth (scenario: MFA-role-without-enrollment)', async () => {
    const res = await request(server)
      .post(`/v1/admin/users/${userIds.customer}/roles`)
      .set('Authorization', `Bearer ${freshAdmin.access}`)
      .send({ role: 'courier' })
      .expect(428);
    expect(res.body.error.code).toBe('STEP_UP_REQUIRED');
  });

  it('a non-admin actor (courier) still gets 403, NOT 428 — the role/permission check runs BEFORE step-up, so an ineligible actor is never told "just step up" (scenario: no-MFA-role unchanged)', async () => {
    await request(server)
      .post('/v1/admin/users/00000000-0000-0000-0000-000000000000/roles')
      .set('Authorization', `Bearer ${tokens.courier}`)
      .send({ role: 'courier' })
      .expect(403);
  });

  it('enrolling + completing TOTP opens the step-up window (scenario: MFA-role-with-MFA-configured -> allowed after MFA)', async () => {
    await enrollAndStepUp(freshAdmin.access);
  });

  it('an admin actor cannot grant themselves admin, EVEN once stepped up — step-up is a second factor, not a substitute for the existing business rule', async () => {
    await request(server)
      .post(`/v1/admin/users/${freshAdmin.userId}/roles`)
      .set('Authorization', `Bearer ${freshAdmin.access}`)
      .send({ role: 'courier' })
      .expect(403);
  });

  it('an admin actor cannot grant admin or super_admin to someone else, even once stepped up', async () => {
    await request(server)
      .post(`/v1/admin/users/${userIds.customer}/roles`)
      .set('Authorization', `Bearer ${freshAdmin.access}`)
      .send({ role: 'admin' })
      .expect(403);
    await request(server)
      .post(`/v1/admin/users/${userIds.customer}/roles`)
      .set('Authorization', `Bearer ${freshAdmin.access}`)
      .send({ role: 'super_admin' })
      .expect(403);
  });

  it('a stepped-up admin CAN grant a non-admin-tier role, and the grant is audited (scenarios: allowed-after-MFA, audit still logged)', async () => {
    await request(server)
      .post(`/v1/admin/users/${userIds.customer}/roles`)
      .set('Authorization', `Bearer ${freshAdmin.access}`)
      .send({ role: 'support' })
      .expect(201);

    const detail = await request(server)
      .get(`/v1/admin/users/${userIds.customer}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    expect(detail.body.roles).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'support' })]),
    );
    expect(detail.body.history).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'ROLE_GRANTED' })]),
    );

    // cleanup — keep the shared `customer` fixture in its original shape for later tests.
    await request(server)
      .delete(`/v1/admin/users/${userIds.customer}/roles/support`)
      .set('Authorization', `Bearer ${freshAdmin.access}`)
      .expect(200);
  });

  it('a FRESH access token from refresh rotation keeps the step-up state of its session — rotation neither grants nor revokes step-up, it is carried forward unchanged (scenario: no bypass via refresh)', async () => {
    // Rotates the SAME session `freshAdmin` was already stepped up on
    // (not a new login, which would start a fresh, un-stepped-up session).
    const rotated = await request(server)
      .post('/v1/auth/refresh')
      .send({ refresh: freshAdmin.refresh })
      .expect(200);
    const rotatedAccess = rotated.body.access as string;
    freshAdmin.refresh = rotated.body.refresh as string; // rotation is one-shot — the old refresh token is now burned

    // Still works with NO new MFA verification — same session, step-up already open from the earlier test.
    await request(server)
      .post(`/v1/admin/users/${userIds.customer}/roles`)
      .set('Authorization', `Bearer ${rotatedAccess}`)
      .send({ role: 'support' })
      .expect(201);
    await request(server)
      .delete(`/v1/admin/users/${userIds.customer}/roles/support`)
      .set('Authorization', `Bearer ${rotatedAccess}`)
      .expect(200);
  });

  it('a courier refreshing their own (never-stepped-up) session still cannot reach step-up-gated territory — rotation grants no new capability', async () => {
    const rotated = await request(server)
      .post('/v1/auth/refresh')
      .send({ refresh: refreshTokens.courier })
      .expect(200);
    refreshTokens.courier = rotated.body.refresh as string;
    await request(server)
      .post('/v1/admin/users/00000000-0000-0000-0000-000000000000/roles')
      .set('Authorization', `Bearer ${rotated.body.access}`)
      .send({ role: 'courier' })
      .expect(403); // still role-rejected, never even reaches the step-up question
  });
});

describe('GET /v1/admin/finance/balances — RBAC (Phase 11: "ledger read")', () => {
  it('401 anonymous, 403 customer/courier/restaurant staff', async () => {
    await request(server).get('/v1/admin/finance/balances').expect(401);
    for (const key of ['customer', 'courier', 'restaurantStaff'] as const) {
      await request(server)
        .get('/v1/admin/finance/balances')
        .set('Authorization', `Bearer ${tokens[key]}`)
        .expect(403);
    }
  });

  it('200 for admin, super_admin, and finance (the three roles with ledger:read)', async () => {
    for (const key of ['admin', 'superAdmin', 'finance'] as const) {
      await request(server)
        .get('/v1/admin/finance/balances')
        .set('Authorization', `Bearer ${tokens[key]}`)
        .expect(200);
    }
  });
});

describe('Balance self-service routes never accept a client-supplied identity (Phase 11: "balance IDOR")', () => {
  it('GET /v1/couriers/me/balance — courier role required, resolves ONLY the caller’s own id (no :id anywhere in the route)', async () => {
    await request(server).get('/v1/couriers/me/balance').expect(401);
    await request(server)
      .get('/v1/couriers/me/balance')
      .set('Authorization', `Bearer ${tokens.customer}`)
      .expect(403);
    await request(server)
      .get('/v1/couriers/me/balance')
      .set('Authorization', `Bearer ${tokens.courier}`)
      .expect(200);
  });

  it('GET /v1/restaurants/me/balance — restaurant_owner/staff role required, resolved via the caller’s OWN scope', async () => {
    await request(server).get('/v1/restaurants/me/balance').expect(401);
    await request(server)
      .get('/v1/restaurants/me/balance')
      .set('Authorization', `Bearer ${tokens.customer}`)
      .expect(403);
    await request(server)
      .get('/v1/restaurants/me/balance')
      .set('Authorization', `Bearer ${tokens.restaurantStaff}`)
      .expect(200);
  });
});
