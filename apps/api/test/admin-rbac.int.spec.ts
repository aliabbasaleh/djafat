import 'reflect-metadata';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
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
const userIds: Record<keyof typeof PHONES, string> = {} as never;

async function loginViaOtp(phone: string): Promise<{ access: string; userId: string }> {
  await request(server).post('/v1/auth/otp/request').send({ phone, purpose: 'login' }).expect(202);
  const code = await redis.client.get(mockOtpKey(phone));
  if (!code) throw new Error(`No mock OTP code for ${phone}`);
  const res = await request(server)
    .post('/v1/auth/otp/verify')
    .send({ phone, code, purpose: 'login' })
    .expect(200);
  const body = res.body as { access: string; user: { id: string } };
  return { access: body.access, userId: body.user.id };
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
    const { access, userId } = await loginViaOtp(phone);
    tokens[key] = access;
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

describe('POST /v1/admin/users/:id/roles — escalation (Phase 11: self-escalation, admin -> super_admin)', () => {
  it('an admin actor cannot grant themselves admin (self-targeting is rejected before the role check even matters)', async () => {
    await request(server)
      .post(`/v1/admin/users/${userIds.admin}/roles`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ role: 'courier' })
      .expect(403);
  });

  it('an admin actor cannot grant admin or super_admin to someone else', async () => {
    await request(server)
      .post(`/v1/admin/users/${userIds.customer}/roles`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ role: 'admin' })
      .expect(403);
    await request(server)
      .post(`/v1/admin/users/${userIds.customer}/roles`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ role: 'super_admin' })
      .expect(403);
  });

  it('a non-admin actor (courier) cannot grant any role at all', async () => {
    await request(server)
      .post('/v1/admin/users/00000000-0000-0000-0000-000000000000/roles')
      .set('Authorization', `Bearer ${tokens.courier}`)
      .send({ role: 'courier' })
      .expect(403);
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
