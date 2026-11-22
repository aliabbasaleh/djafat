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
import { mockOtpKey } from '../src/modules/auth/providers/mock-otp-delivery.provider';

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
    email: `feat020-${tag}@example.td`,
    password: `kissar-boulou-${tag}`,
  };
}

/**
 * The code sent AFTER `previous` (review FEAT-020 #4): login codes and reset codes
 * of a known address leave in the background, so the answer and its timing are
 * the same for an unknown one. Waits for the new code (5 s at most).
 */
async function nextEmailCode(email: string, previous: string | null): Promise<string> {
  for (let i = 0; i < 50; i += 1) {
    const code = await redis.client.get(mockEmailOtpKey(email));
    if (code && code !== previous) return code;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no new mock email code for ${email}`);
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

    const registrationCode = await redis.client.get(mockEmailOtpKey(input.email));
    await request(server).post('/v1/auth/email/request').send({ email: input.email }).expect(202);
    const byCode = await request(server)
      .post('/v1/auth/email/verify')
      .send({ email: input.email, code: await nextEmailCode(input.email, registrationCode) })
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

    const before = await redis.client.get(mockEmailOtpKey(input.email));
    await request(server).post('/v1/auth/password/forgot').send({ email: input.email }).expect(202);
    const newPassword = `nouveau-Mot-${randomUUID().slice(0, 6)}`;
    const reset = await request(server)
      .post('/v1/auth/password/reset')
      .send({
        email: input.email,
        code: await nextEmailCode(input.email, before),
        password: newPassword,
      })
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

/** Clears limiter keys, as `int-setup.ts` does before each test (test hygiene, never an assertion). */
async function clearLimiter(pattern: string): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = await redis.client.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    if (keys.length > 0) await redis.client.del(...keys);
  } while (cursor !== '0');
}

const e164 = (phone: string) => `+235${phone.replace(/\s/g, '')}`;

// Review FEAT-020 #3, #4, #6, #10, #11 — the corrections on the real stack.
describe('FEAT-020 review corrections on PostgreSQL and Redis', () => {
  // SPEC-020-03-SC06
  it('SPEC-020-03-SC06 — two registrations for one address: the code of the first never completes the second', async () => {
    const first = fresh();
    const second = { ...fresh(), email: first.email };
    await request(server).post('/v1/auth/register').send(first).expect(202);
    const firstCode = await lastEmailCode(first.email);
    const res = await request(server).post('/v1/auth/register').send(second).expect(202);
    const { registrationId } = res.body as { registrationId: string };
    const secondCode = await lastEmailCode(first.email);

    if (firstCode !== secondCode) {
      await request(server)
        .post('/v1/auth/register/verify')
        .send({ registrationId, code: firstCode })
        .expect(401);
    }
    await request(server)
      .post('/v1/auth/register/verify')
      .send({ registrationId, code: secondCode })
      .expect(200);
  });

  // SPEC-020-03-SC11
  it('SPEC-020-03-SC11 — a used address and a free one, both locked: registration answers the same 423', async () => {
    await clearLimiter('ratelimit:pwd:*');
    const taken = fresh();
    await register(taken);
    const free = fresh();
    for (const email of [taken.email, free.email]) {
      for (let i = 0; i < 10; i += 1) {
        await request(server)
          .post('/v1/auth/password/login')
          .send({ email, password: 'pas-le-bon-mot-de-passe' });
      }
      await request(server)
        .post('/v1/auth/password/login')
        .send({ email, password: 'pas-le-bon-mot-de-passe' })
        .expect(423);
    }
    for (const email of [taken.email, free.email]) {
      const res = await request(server)
        .post('/v1/auth/register')
        .send({ ...fresh(), email });
      expect(res.status).toBe(423);
      expect(res.body.error.code).toBe('OTP_LOCKED');
    }
  });

  // SPEC-020-05-SC09
  it('SPEC-020-05-SC09 — « Mot de passe oublié ? »: a known and an unknown address both get 202 three times, then 429', async () => {
    const known = fresh();
    await register(known);
    await clearLimiter('ratelimit:otp:*'); // the registration code spent one from the address's budget
    const unknown = `feat020-${randomUUID().slice(0, 8)}@example.td`;
    for (const email of [known.email, unknown]) {
      for (let i = 0; i < 3; i += 1) {
        await request(server).post('/v1/auth/password/forgot').send({ email }).expect(202);
      }
      await request(server).post('/v1/auth/password/forgot').send({ email }).expect(429);
    }
  });

  // SPEC-020-05-SC05
  it('SPEC-020-05-SC05 — PUT /me/password: 204, the other session is logged out, 401 without a token', async () => {
    const input = fresh();
    const first = await register(input);
    const login = await request(server)
      .post('/v1/auth/password/login')
      .send({ email: input.email, password: input.password })
      .expect(200);
    const { challengeId } = login.body as { challengeId: string };
    const second = (
      await request(server)
        .post('/v1/auth/password/challenge/verify')
        .send({
          challengeId,
          channel: 'email',
          code: await lastEmailCode(input.email),
          rememberDevice: false,
        })
        .expect(200)
    ).body as SignedIn;

    await request(server)
      .put('/v1/me/password')
      .send({ currentPassword: input.password, newPassword: 'nouveau-Baobab-77' })
      .expect(401);
    await request(server)
      .put('/v1/me/password')
      .set('Authorization', `Bearer ${first.access}`)
      .send({ currentPassword: input.password, newPassword: 'nouveau-Baobab-77' })
      .expect(204);
    await request(server).post('/v1/auth/refresh').send({ refresh: second.refresh }).expect(401);
    await request(server).post('/v1/auth/refresh').send({ refresh: first.refresh }).expect(200);
  });

  // SPEC-020-06-SC02
  it('SPEC-020-06-SC02 — /me/phone: the SMS code of this account confirms its number; another account’s code does not', async () => {
    const awaInput = fresh();
    const awa = await register(awaInput);
    const other = await register(fresh());

    await request(server)
      .post('/v1/me/phone/request')
      .set('Authorization', `Bearer ${other.access}`)
      .send({ channel: 'sms' })
      .expect(202);
    const otherMe = await request(server)
      .get('/v1/me')
      .set('Authorization', `Bearer ${other.access}`);
    const otherCode = await redis.client.get(mockOtpKey((otherMe.body as { phone: string }).phone));

    await request(server)
      .post('/v1/me/phone/request')
      .set('Authorization', `Bearer ${awa.access}`)
      .send({ channel: 'sms' })
      .expect(202);
    const awaCode = await redis.client.get(mockOtpKey(e164(awaInput.phone)));
    if (otherCode && otherCode !== awaCode) {
      await request(server)
        .post('/v1/me/phone/verify')
        .set('Authorization', `Bearer ${awa.access}`)
        .send({ channel: 'sms', code: otherCode })
        .expect(401);
    }
    const verified = await request(server)
      .post('/v1/me/phone/verify')
      .set('Authorization', `Bearer ${awa.access}`)
      .send({ channel: 'sms', code: awaCode })
      .expect(200);
    expect((verified.body as { phoneVerified: boolean }).phoneVerified).toBe(true);
  });

  // SPEC-020-12-SC01
  it('SPEC-020-12-SC01 — POST /me/email asks for the current password of an account that has one', async () => {
    const input = fresh();
    const signedIn = await register(input);
    const newEmail = `feat020-new-${randomUUID().slice(0, 8)}@example.td`;
    const refused = await request(server)
      .post('/v1/me/email')
      .set('Authorization', `Bearer ${signedIn.access}`)
      .send({ email: newEmail });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');
    await request(server)
      .post('/v1/me/email')
      .set('Authorization', `Bearer ${signedIn.access}`)
      .send({ email: newEmail, currentPassword: input.password })
      .expect(202);
  });
});
