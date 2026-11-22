import 'reflect-metadata';
import type { Server } from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { listenOnLoopback } from './listen-on-loopback';
import { RedisService } from '../src/common/redis/redis.service';
import { mockEmailOtpKey } from '../src/modules/auth/providers/mock-email-otp-delivery.provider';

/**
 * FEAT-020 — customer accounts end to end (docs/features/FEAT-020-compte-email-mot-de-passe):
 * real Postgres (migration 0040) and Redis, the email mock (codes readable in
 * Redis). One fresh account per scenario: an address receives at most 3 codes
 * per 10 minutes, and `int-setup.ts` resets the code budgets before each test.
 */

let app: NestFastifyApplication;
let redis: RedisService;
let server: Server;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  configureApp(app);
  server = await listenOnLoopback(app);
  redis = app.get(RedisService);
});

afterAll(async () => {
  await app.close();
});

interface SignedIn {
  access: string;
  refresh: string;
  user: { id: string };
  deviceToken?: string;
}

function fresh() {
  const tag = randomUUID().slice(0, 8);
  // A Chad mobile number nobody holds yet (« 66 xx xx xx », FEAT-005 format).
  const digits = String(randomInt(0, 1_000_000)).padStart(6, '0');
  return {
    fullName: 'Awa Hassan',
    phone: `66 ${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4)}`,
    email: `feat019-${tag}@example.td`,
    password: `kissar-boulou-${tag}`,
  };
}

async function lastEmailCode(email: string): Promise<string> {
  const code = await redis.client.get(mockEmailOtpKey(email));
  if (!code) throw new Error(`no mock email code for ${email}`);
  return code;
}

async function register(input: ReturnType<typeof fresh>): Promise<SignedIn> {
  const res = await request(server).post('/v1/auth/register').send(input).expect(202);
  const { registrationId } = res.body as { registrationId: string };
  const verified = await request(server)
    .post('/v1/auth/register/verify')
    .send({ registrationId, code: await lastEmailCode(input.email) })
    .expect(200);
  return verified.body as SignedIn;
}

describe('FEAT-020 — customer accounts on PostgreSQL and Redis', () => {
  // SPEC-020-03-SC10
  it('SPEC-020-03-SC10 — register, confirm the email code, /me, then log in with an email code', async () => {
    const input = fresh();
    const signedIn = await register(input);
    expect(signedIn.deviceToken).toEqual(expect.any(String));

    const me = await request(server)
      .get('/v1/me')
      .set('Authorization', `Bearer ${signedIn.access}`)
      .expect(200);
    expect(me.body).toMatchObject({
      email: input.email,
      emailVerified: true,
      phoneVerified: false,
      hasPassword: true,
      fullName: 'Awa Hassan',
      roles: ['customer'],
    });

    await request(server).post('/v1/auth/email/request').send({ email: input.email }).expect(202);
    const byCode = await request(server)
      .post('/v1/auth/email/verify')
      .send({ email: input.email, code: await lastEmailCode(input.email) })
      .expect(200);
    expect((byCode.body as SignedIn).user.id).toBe(signedIn.user.id);

    // The same number cannot register a second account (FEAT-020-Q06).
    const again = await request(server)
      .post('/v1/auth/register')
      .send({ ...fresh(), phone: input.phone })
      .expect(409);
    expect(again.body).toMatchObject({ error: { code: 'PHONE_ALREADY_USED' } });
  });

  // SPEC-020-04-SC11
  it('SPEC-020-04-SC11 — password login: direct with the device token, a code without it', async () => {
    const input = fresh();
    const { deviceToken } = await register(input);

    const direct = await request(server)
      .post('/v1/auth/password/login')
      .send({ email: input.email, password: input.password, deviceToken })
      .expect(200);
    expect(direct.body).toMatchObject({ status: 'signed_in', access: expect.any(String) });

    const pending = await request(server)
      .post('/v1/auth/password/login')
      .send({ email: input.email, password: input.password })
      .expect(200);
    expect(pending.body).toMatchObject({ status: 'code_required', sentTo: { channel: 'email' } });
    const { challengeId } = pending.body as { challengeId: string };

    const verified = await request(server)
      .post('/v1/auth/password/challenge/verify')
      .send({
        challengeId,
        channel: 'email',
        code: await lastEmailCode(input.email),
        rememberDevice: true,
      })
      .expect(200);
    expect(verified.body).toMatchObject({
      access: expect.any(String),
      deviceToken: expect.any(String),
    });

    const wrong = await request(server)
      .post('/v1/auth/password/login')
      .send({ email: input.email, password: 'not-the-password-1' })
      .expect(401);
    expect(wrong.body).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });
  });

  // SPEC-020-05-SC08
  it('SPEC-020-05-SC08 — forgot then reset: the old refresh token is refused, the new password logs in', async () => {
    const input = fresh();
    const first = await register(input);

    await request(server).post('/v1/auth/password/forgot').send({ email: input.email }).expect(202);
    const newPassword = `nouveau-Mot-${randomUUID().slice(0, 6)}`;
    const reset = await request(server)
      .post('/v1/auth/password/reset')
      .send({ email: input.email, code: await lastEmailCode(input.email), password: newPassword })
      .expect(200);
    const { deviceToken } = reset.body as SignedIn;

    await request(server).post('/v1/auth/refresh').send({ refresh: first.refresh }).expect(401);

    const login = await request(server)
      .post('/v1/auth/password/login')
      .send({ email: input.email, password: newPassword, deviceToken })
      .expect(200);
    expect(login.body).toMatchObject({ status: 'signed_in' });
    await request(server)
      .post('/v1/auth/password/login')
      .send({ email: input.email, password: input.password, deviceToken })
      .expect(401);
  });
});
