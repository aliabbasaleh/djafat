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
 * Bloc 8 — `/v1/users/me/addresses` over real HTTP (docs/29). Real
 * PostgreSQL + Redis required (`pnpm infra:up`, migrations applied,
 * `pnpm db:seed` — test/README.md).
 *
 * NOT executed in this environment — Docker is unavailable here. Written and
 * reviewed so it runs as-is in CI (same `integration` job that already runs
 * `apps/api`'s other `*.int.spec.ts` files, `.github/workflows/ci.yml`).
 *
 * The service-level ownership/concurrency logic is already proven exhaustively
 * in `addresses.service.spec.ts` (27 tests) and the DTO shape in
 * `dto/addresses.schema.spec.ts` (14 tests) — both unit-level, both executed.
 * This file exists for what ONLY a real HTTP round trip can prove: the guard
 * stack actually rejects an unauthenticated request, the error contract shape
 * is what the client really receives on the wire, and two real users (via
 * real OTP login) are genuinely isolated from each other's addresses.
 */

const CUSTOMER_PHONE = '+23566000001'; // seeded (apps/api/prisma/seed.ts)
const OTHER_PHONE = '+23566000097';

let app: NestFastifyApplication;
let redis: RedisService;
let server: Server;
let aliceToken: string;
let bobToken: string;

async function loginViaOtp(phone: string): Promise<string> {
  await request(server).post('/v1/auth/otp/request').send({ phone, purpose: 'login' }).expect(202);
  const code = await redis.client.get(mockOtpKey(phone));
  if (!code) throw new Error(`No mock OTP code for ${phone}`);
  const res = await request(server)
    .post('/v1/auth/otp/verify')
    .send({ phone, code, purpose: 'login' })
    .expect(200);
  return (res.body as { access: string }).access;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  server = app.getHttpAdapter().getInstance().server as unknown as Server;
  redis = app.get(RedisService);

  aliceToken = await loginViaOtp(CUSTOMER_PHONE);
  bobToken = await loginViaOtp(OTHER_PHONE);
}, 30_000);

afterAll(async () => {
  await app?.close();
});

describe('authentication (Bloc 8 §API, mandate CHECKPOINT 2)', () => {
  it('401 with no token at all', async () => {
    const res = await request(server).get('/v1/users/me/addresses').expect(401);
    expect(res.body).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    expect(res.body.error.traceId).toEqual(expect.any(String));
  });

  it('401 with a forged token', async () => {
    await request(server)
      .get('/v1/users/me/addresses')
      .set('Authorization', 'Bearer forged.token.value')
      .expect(401);
  });
});

describe('CRUD over real HTTP (Bloc 8 §API)', () => {
  let addressId: string;

  it('201 on create, with a clean body shape — never a raw DB row', async () => {
    const res = await request(server)
      .post('/v1/users/me/addresses')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ label: 'Domicile', quartier: 'Klemat', landmark: 'Près du marché' })
      .expect(201);

    expect(res.body).toMatchObject({ label: 'Domicile', quartier: 'Klemat' });
    expect(res.body).not.toHaveProperty('userId'); // internal column name never leaks
    addressId = res.body.id;
  });

  it('422/400 on a malformed body — never a raw 500', async () => {
    const res = await request(server)
      .post('/v1/users/me/addresses')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ cityId: 'not-a-uuid' });
    expect(res.status).toBeLessThan(500);
    expect(res.body.error).toBeDefined();
  });

  it('lists the created address back', async () => {
    const res = await request(server)
      .get('/v1/users/me/addresses')
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200);
    const list = res.body as Array<{ id: string }>;
    expect(list.some((a) => a.id === addressId)).toBe(true);
  });

  it('gets a single address by id', async () => {
    const res = await request(server)
      .get(`/v1/users/me/addresses/${addressId}`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200);
    expect(res.body.id).toBe(addressId);
  });

  it('updates a field via PATCH', async () => {
    const res = await request(server)
      .patch(`/v1/users/me/addresses/${addressId}`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ label: 'Nouveau nom' })
      .expect(200);
    expect(res.body.label).toBe('Nouveau nom');
  });

  it('404 on an unknown address id', async () => {
    const res = await request(server)
      .get('/v1/users/me/addresses/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('sets the address as default via the dedicated route', async () => {
    const res = await request(server)
      .post(`/v1/users/me/addresses/${addressId}/default`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200);
    expect(res.body.isDefault).toBe(true);
  });

  it('204 on delete, then a subsequent GET is 404', async () => {
    await request(server)
      .delete(`/v1/users/me/addresses/${addressId}`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(204);
    await request(server)
      .get(`/v1/users/me/addresses/${addressId}`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(404);
  });
});

describe('cross-owner isolation over real HTTP — IDOR (Bloc 8 §API, mandate PARTIE 8)', () => {
  let alicesAddressId: string;

  beforeAll(async () => {
    const res = await request(server)
      .post('/v1/users/me/addresses')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ label: "Alice's home" })
      .expect(201);
    alicesAddressId = res.body.id;
  });

  it('Bob cannot read Alice’s address — a clean 404, not 403 (never confirms it exists)', async () => {
    const res = await request(server)
      .get(`/v1/users/me/addresses/${alicesAddressId}`)
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('Bob cannot update Alice’s address', async () => {
    await request(server)
      .patch(`/v1/users/me/addresses/${alicesAddressId}`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ label: 'Hacked' })
      .expect(404);
  });

  it('Bob cannot delete Alice’s address', async () => {
    await request(server)
      .delete(`/v1/users/me/addresses/${alicesAddressId}`)
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(404);
  });

  it('Bob cannot set Alice’s address as his default', async () => {
    await request(server)
      .post(`/v1/users/me/addresses/${alicesAddressId}/default`)
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(404);
  });

  it('Bob’s own list never contains Alice’s address', async () => {
    const res = await request(server)
      .get('/v1/users/me/addresses')
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(200);
    const list = res.body as Array<{ id: string }>;
    expect(list.some((a) => a.id === alicesAddressId)).toBe(false);
  });
});
