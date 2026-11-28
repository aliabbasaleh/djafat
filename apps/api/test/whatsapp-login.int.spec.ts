import 'reflect-metadata';
import type { Server } from 'node:http';
import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { listenOnLoopback } from './listen-on-loopback';
import { RedisService } from '../src/common/redis/redis.service';
import { mockAccountNoticeKey } from '../src/modules/auth/providers/mock-account-notice.provider';
import { mockEmailOtpKey } from '../src/modules/auth/providers/mock-email-otp-delivery.provider';

/**
 * FEAT-023 — free WhatsApp login end to end (docs/features/FEAT-023-whatsapp-gratuit):
 * real PostgreSQL (migration 0042) and Redis, Meta's webhook signed with this
 * run's app secret, the e-mail mock (notices readable in Redis). The WhatsApp
 * settings are this file's own — CI sets none — and are restored afterwards.
 */

const WHATSAPP_ENV = {
  WHATSAPP_PROVIDER: 'mock',
  WHATSAPP_BUSINESS_NUMBER: '+23566868973',
  WHATSAPP_PHONE_NUMBER_ID: '100000000000001',
  WHATSAPP_APP_SECRET: `int-${randomUUID()}`,
  WHATSAPP_VERIFY_TOKEN: `int-${randomUUID()}`,
} as const;
const saved = new Map<string, string | undefined>();

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

let app: NestFastifyApplication;
let server: Server;
let redis: RedisService;
const prisma = new PrismaClient();

beforeAll(async () => {
  for (const [key, value] of Object.entries(WHATSAPP_ENV)) {
    saved.set(key, process.env[key]);
    process.env[key] = value;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true, // the webhook signature is checked on the raw bytes, as in main.ts
  });
  configureApp(app);
  server = await listenOnLoopback(app);
  redis = app.get(RedisService);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

interface WhatsappCode {
  token: string;
  code: string;
  text: string;
  link: string;
  number: string;
  expiresAt: string;
}

/** A Chad mobile nobody holds yet (« 66 xx xx xx »), E.164. */
function freshChadPhone(): string {
  return `+23566${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
}

/** What Meta posts when `from` sends `text` to DJAFAT's number, signed like Meta. */
async function customerSends(from: string, text: string): Promise<void> {
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '23566868973',
                phone_number_id: WHATSAPP_ENV.WHATSAPP_PHONE_NUMBER_ID,
              },
              messages: [
                {
                  from: from.replace(/^\+/, ''),
                  id: `wamid.${randomUUID()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const signature = `sha256=${createHmac('sha256', WHATSAPP_ENV.WHATSAPP_APP_SECRET).update(raw).digest('hex')}`;
  await request(server)
    .post('/v1/auth/whatsapp/webhook')
    .set('content-type', 'application/json')
    .set('x-hub-signature-256', signature)
    .send(raw)
    .expect(200);
}

const status = (token: string, rememberDevice = false) =>
  request(server)
    .post('/v1/auth/whatsapp/status')
    .set('user-agent', ANDROID_CHROME)
    .send({ token, rememberDevice });

/** An account the classic way (FEAT-020): e-mail code accepted; its number only typed. */
async function registered(phone: string) {
  const tag = randomUUID().slice(0, 8);
  const email = `feat023-${tag}@example.td`;
  const res = await request(server)
    .post('/v1/auth/register')
    .send({ fullName: 'Awa Hassan', phone, email, password: `kissar-boulou-${tag}` })
    .expect(202);
  const code = await redis.client.get(mockEmailOtpKey(email));
  const verified = await request(server)
    .post('/v1/auth/register/verify')
    .send({ registrationId: (res.body as { registrationId: string }).registrationId, code })
    .expect(200);
  return {
    email,
    password: `kissar-boulou-${tag}`,
    ...(verified.body as { access: string; user: { id: string } }),
  };
}

/** Waits for the mock notice of an address (the alert leaves in the background). */
async function noticeOf(email: string): Promise<{ kind: string; subject: string } | null> {
  for (let i = 0; i < 50; i += 1) {
    const raw = await redis.client.get(mockAccountNoticeKey(email));
    const notice = raw ? (JSON.parse(raw) as { kind: string; subject: string }) : null;
    if (notice?.kind === 'whatsapp_login') return notice;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

describe('FEAT-023 — free WhatsApp login on PostgreSQL and Redis', () => {
  // SPEC-023-01-SC01, SPEC-023-02-SC01, SPEC-023-03-SC01, SPEC-023-04-SC01
  it('SPEC-023-01-SC01 — SPEC-023-03-SC01 — a code, the customer sends it, the screen is signed in once; SPEC-023-04-SC01 — the alert e-mail', async () => {
    const phone = freshChadPhone();
    const account = await registered(phone);
    // « Mon profil » confirms the number by WhatsApp first (SPEC-023-06).
    const confirm = await request(server)
      .post('/v1/me/phone/whatsapp')
      .set('Authorization', `Bearer ${account.access}`)
      .send({})
      .expect(201);
    await customerSends(phone, (confirm.body as WhatsappCode).text);
    await status((confirm.body as WhatsappCode).token).expect(200, { status: 'confirmed' });
    await redis.client.del(mockAccountNoticeKey(account.email));

    const started = await request(server).post('/v1/auth/whatsapp/start').send({}).expect(201);
    const code = started.body as WhatsappCode;
    expect(code.text).toBe(
      `Je me connecte à DJAFAT : ${code.code} (n'envoyez ce code que pour vous connecter vous-même)`,
    );
    expect(code.link).toBe(`https://wa.me/23566868973?text=${encodeURIComponent(code.text)}`);
    expect(code.number).toBe('+23566868973');
    // Nothing in clear in the database (SPEC-023-01 R5).
    const rows = await prisma.$queryRaw<Array<{ row: string }>>`
      SELECT row_to_json(w)::text AS row FROM whatsapp_codes w WHERE created_at > now() - interval '1 minute'`;
    for (const { row } of rows) {
      expect(row).not.toContain(code.token);
      expect(row).not.toContain(`"${code.code}"`);
    }

    const waiting = await status(code.token).expect(200);
    expect(waiting.body).toEqual({ status: 'waiting', expiresAt: code.expiresAt });

    await customerSends(phone, code.text);
    const signedIn = await status(code.token).expect(200);
    expect(signedIn.body).toMatchObject({
      status: 'signed_in',
      access: expect.any(String),
      refresh: expect.any(String),
      user: { id: account.user.id, phoneVerified: true },
    });
    await status(code.token).expect(200, { status: 'expired' });

    await expect(noticeOf(account.email)).resolves.toEqual({
      kind: 'whatsapp_login',
      subject: 'Nouvelle connexion par WhatsApp',
    });
  });

  // SPEC-023-02-SC08 (review round 2, note 3): the real route and the real lock table.
  it('SPEC-023-02-SC08 — a number locked by wrong SMS codes typed by a stranger still logs in by WhatsApp', async () => {
    const phone = freshChadPhone();
    const account = await registered(phone);
    const confirm = (
      await request(server)
        .post('/v1/me/phone/whatsapp')
        .set('Authorization', `Bearer ${account.access}`)
        .send({})
        .expect(201)
    ).body as WhatsappCode;
    await customerSends(phone, confirm.text);
    await status(confirm.token).expect(200, { status: 'confirmed' });

    // A stranger types wrong SMS codes for this number until it is locked (10 by default).
    for (let i = 0; i < 10; i += 1) {
      await request(server)
        .post('/v1/auth/otp/verify')
        .send({ phone, code: '000000', purpose: 'login' })
        .expect(401);
    }
    await request(server)
      .post('/v1/auth/otp/verify')
      .send({ phone, code: '000000', purpose: 'login' })
      .expect(423);

    const code = (await request(server).post('/v1/auth/whatsapp/start').send({}).expect(201))
      .body as WhatsappCode;
    await customerSends(phone, code.text);
    const signedIn = await status(code.token).expect(200);
    expect(signedIn.body).toMatchObject({ status: 'signed_in', user: { id: account.user.id } });
  });

  // SPEC-023-02-SC03, SPEC-023-03-SC03
  it('SPEC-023-02-SC03 — SPEC-023-03-SC03 — a number on no account, or typed only: « confirmed on no account », the number given, nothing created', async () => {
    const stranger = '+33612345678';
    const before = await prisma.user.count();
    const first = (await request(server).post('/v1/auth/whatsapp/start').send({}).expect(201))
      .body as WhatsappCode;
    await customerSends(stranger, first.text);
    await status(first.token).expect(200, { status: 'not_confirmed', phone: stranger });
    await status(first.token).expect(200, { status: 'expired' });

    const typedOnly = freshChadPhone();
    await registered(typedOnly);
    const second = (await request(server).post('/v1/auth/whatsapp/start').send({}).expect(201))
      .body as WhatsappCode;
    await customerSends(typedOnly, second.text);
    await status(second.token).expect(200, { status: 'not_confirmed', phone: typedOnly });
    expect(await prisma.user.count()).toBe(before + 1); // only the registered one
  });

  // SPEC-023-02-SC07, SPEC-023-03-SC05
  it('SPEC-023-02-SC07 — SPEC-023-03-SC05 — a confirmation from another number is refused; from the account’s own, confirmed', async () => {
    const phone = freshChadPhone();
    const account = await registered(phone);
    const auth = { Authorization: `Bearer ${account.access}` };
    const wrong = (
      await request(server).post('/v1/me/phone/whatsapp').set(auth).send({}).expect(201)
    ).body as WhatsappCode;
    expect(wrong.text).toContain('Je confirme mon numéro sur DJAFAT');
    await customerSends(freshChadPhone(), wrong.text);
    await status(wrong.token).expect(200, { status: 'wrong_number' });
    const me = await request(server).get('/v1/me').set(auth).expect(200);
    expect(me.body).toMatchObject({ phoneVerified: false });

    const right = (
      await request(server).post('/v1/me/phone/whatsapp').set(auth).send({}).expect(201)
    ).body as WhatsappCode;
    await customerSends(phone, right.text);
    await status(right.token).expect(200, { status: 'confirmed' });
    const after = await request(server).get('/v1/me').set(auth).expect(200);
    expect(after.body).toMatchObject({ phoneVerified: true });
    const again = await request(server)
      .post('/v1/me/phone/whatsapp')
      .set(auth)
      .send({})
      .expect(409);
    expect(again.body).toMatchObject({ error: { code: 'PHONE_ALREADY_CONFIRMED' } });
  });

  // SPEC-023-03-SC04
  it('SPEC-023-03-SC04 — a password login on a new device finished by WhatsApp: session and remembered device', async () => {
    const phone = freshChadPhone();
    const account = await registered(phone);
    const confirm = (
      await request(server)
        .post('/v1/me/phone/whatsapp')
        .set('Authorization', `Bearer ${account.access}`)
        .send({})
        .expect(201)
    ).body as WhatsappCode;
    await customerSends(phone, confirm.text);
    await status(confirm.token).expect(200, { status: 'confirmed' });

    const login = await request(server)
      .post('/v1/auth/password/login')
      .send({ email: account.email, password: account.password })
      .expect(200);
    const challenge = login.body as {
      status: string;
      challengeId: string;
      channels: Array<{ id: string; available: boolean; link?: string }>;
    };
    expect(challenge.status).toBe('code_required');
    expect(challenge.channels.find((c) => c.id === 'whatsapp')).toMatchObject({ available: true });
    expect(challenge.channels.find((c) => c.id === 'whatsapp')).not.toHaveProperty('link');

    const device = (
      await request(server)
        .post('/v1/auth/whatsapp/start')
        .send({ challengeId: challenge.challengeId })
        .expect(201)
    ).body as WhatsappCode;
    await customerSends(phone, device.text);
    const signedIn = await status(device.token, true).expect(200);
    expect(signedIn.body).toMatchObject({
      status: 'signed_in',
      user: { id: account.user.id },
      deviceToken: expect.any(String),
    });
  });

  // SPEC-023-08-SC01
  it('SPEC-023-08-SC01 — no code leaves by WhatsApp: the FEAT-008 route is gone, the typed-code channels refuse WhatsApp', async () => {
    await request(server)
      .post('/v1/auth/whatsapp/verify')
      .send({ phone: '+23566123456', code: '123456' })
      .expect(404);
    const account = await registered(freshChadPhone());
    await request(server)
      .post('/v1/me/phone/verify')
      .set('Authorization', `Bearer ${account.access}`)
      .send({ channel: 'whatsapp', code: '123456' })
      .expect(422);
    await request(server)
      .post('/v1/auth/password/challenge/verify')
      .send({
        challengeId: randomUUID(),
        channel: 'whatsapp',
        code: '123456',
        rememberDevice: false,
      })
      .expect(422);
    // « Code DJAFAT » (FEAT-008): handled, nothing stored, nothing sent.
    const before = await prisma.whatsappCode.count({ where: { receivedAt: { not: null } } });
    await customerSends('+23566123456', 'Code DJAFAT');
    expect(await prisma.whatsappCode.count({ where: { receivedAt: { not: null } } })).toBe(before);
    expect(await redis.client.lrange('wa:mock:reply:+23566123456', 0, -1)).toEqual([]);
  });
});
