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
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { PhotoStorage } from '../src/infra/storage/photo-storage';
import { mockEmailOtpKey } from '../src/modules/auth/providers/mock-email-otp-delivery.provider';
import { mockAccountNoticeKey } from '../src/modules/auth/providers/mock-account-notice.provider';
import { mockOtpKey } from '../src/modules/auth/providers/mock-otp-delivery.provider';
import { seedReferenceData } from '../prisma/reference-data';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte, on a real
// PostgreSQL (migration 0041, reference data) and Redis (mock e-mail codes).

let app: NestFastifyApplication;
let server: Server;
let redis: RedisService;
let prisma: PrismaService;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  configureApp(app);
  server = await listenOnLoopback(app);
  redis = app.get(RedisService);
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

interface SignedIn {
  access: string;
  user: { id: string };
}

function fresh() {
  const tag = randomUUID().slice(0, 8);
  const digits = String(randomInt(0, 1_000_000)).padStart(6, '0');
  return {
    fullName: 'Abakar Mahamat',
    phone: `66 ${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4)}`,
    email: `feat022-${tag}@example.td`,
    password: `kissar-boulou-${tag}`,
  };
}

/** A birth date `years` ago in N'Djamena. */
function bornYearsAgo(years: number): string {
  const now = new Date(Date.now() + 60 * 60 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

async function emailCode(email: string): Promise<string> {
  for (let i = 0; i < 50; i += 1) {
    const code = await redis.client.get(mockEmailOtpKey(email));
    if (code) return code;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no mock email code for ${email}`);
}

async function signUp(body: Record<string, unknown> & { email: string }): Promise<SignedIn> {
  const res = await request(server).post('/v1/auth/register').send(body).expect(202);
  const { registrationId } = res.body as { registrationId: string };
  const verified = await request(server)
    .post('/v1/auth/register/verify')
    .send({ registrationId, code: await emailCode(body.email) })
    .expect(200);
  return verified.body as SignedIn;
}

async function neighbourhood(name: string): Promise<string> {
  const res = await request(server).get('/v1/geo/neighbourhoods').expect(200);
  const found = (
    res.body as { neighbourhoods: Array<{ id: string; name: string }> }
  ).neighbourhoods.find((n) => n.name === name);
  if (!found) throw new Error(`no neighbourhood ${name}`);
  return found.id;
}

/** Seeded staff (`prisma/seed.ts`), signed in by SMS code (mock). */
const STAFF = { admin: '+23566000007', support: '+23566000005' } as const;

async function staffToken(phone: string): Promise<string> {
  await request(server).post('/v1/auth/otp/request').send({ phone, purpose: 'login' }).expect(202);
  const code = await redis.client.get(mockOtpKey(phone));
  if (!code) throw new Error(`no mock SMS code for ${phone}`);
  const res = await request(server)
    .post('/v1/auth/otp/verify')
    .send({ phone, code, purpose: 'login' })
    .expect(200);
  return (res.body as { access: string }).access;
}

/** The smallest JPEG `PhotoStorage` accepts (SOI, a scan, EOI). */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x33, 0xff, 0xd9]);

function upload(access: string, kind: string, body: Buffer, type = 'image/jpeg') {
  return request(server)
    .post(`/v1/couriers/me/application/files/${kind}`)
    .set('Authorization', `Bearer ${access}`)
    .set('Content-Type', type)
    .send(body);
}

/** A courier who signed up (moto) — then, if asked, every item of the list filled (SPEC-022-06 R1). */
async function motoCourier(
  options: { complete?: boolean } = {},
): Promise<SignedIn & { email: string }> {
  const input = fresh();
  const signedIn = await signUp({
    ...input,
    accountType: 'courier',
    vehicle: 'moto',
    neighbourhoodId: await neighbourhood('Moursal'),
    birthDate: bornYearsAgo(25),
    acceptTerms: true,
  });
  if (options.complete) {
    for (const kind of [
      'face',
      'id_card',
      'driving_licence',
      'vehicle_registration',
      'insurance',
      'plate',
    ]) {
      await upload(signedIn.access, kind, JPEG).expect(200);
    }
    await request(server)
      .put('/v1/couriers/me/application')
      .set('Authorization', `Bearer ${signedIn.access}`)
      .send({
        mobileMoney: { provider: 'airtel', number: '66 00 00 01' },
        emergencyContact: { name: 'Halimé Abakar', phone: '99 11 22 33' },
      })
      .expect(200);
  }
  return { ...signedIn, email: input.email };
}

async function submit(access: string) {
  return request(server)
    .post('/v1/couriers/me/application/submit')
    .set('Authorization', `Bearer ${access}`);
}

async function roles(userId: string): Promise<Array<{ role: string; scope: string | null }>> {
  return prisma.$queryRaw<Array<{ role: string; scope: string | null }>>`
    SELECT role, scope_restaurant_id::text AS scope FROM user_roles WHERE user_id = ${userId}::uuid ORDER BY role`;
}

describe('FEAT-022 — sign-up by account type on PostgreSQL and Redis', () => {
  // SPEC-022-02-SC01, SPEC-022-02-SC04
  it('SPEC-022-02-SC01 — a courier: customer + courier roles, an offline courier, an application to complete; SC04 — no going online', async () => {
    const moursal = await neighbourhood('Moursal');
    const input = fresh();
    const signedIn = await signUp({
      ...input,
      accountType: 'courier',
      vehicle: 'moto',
      neighbourhoodId: moursal,
      birthDate: bornYearsAgo(25),
      acceptTerms: true,
    });
    const userId = signedIn.user.id;

    expect(await roles(userId)).toEqual([
      { role: 'courier', scope: null },
      { role: 'customer', scope: null },
    ]);
    const courier = await prisma.courier.findUniqueOrThrow({ where: { userId } });
    expect(courier).toMatchObject({
      status: 'offline',
      vehicleType: 'moto',
      neighbourhoodId: moursal,
    });
    const application = await prisma.courierApplication.findUniqueOrThrow({
      where: { courierUserId: userId },
    });
    expect(application.status).toBe('to_complete');
    expect(application.termsAcceptedAt).toBeInstanceOf(Date);

    // SPEC-022-02-SC04: not approved, so never online.
    const online = await request(server)
      .post('/v1/couriers/me/status')
      .set('Authorization', `Bearer ${signedIn.access}`)
      .send({ status: 'online' })
      .expect(409);
    expect(online.body).toMatchObject({ error: { code: 'COURIER_NOT_APPROVED' } });
    expect((await prisma.courier.findUniqueOrThrow({ where: { userId } })).status).toBe('offline');
  });

  // SPEC-022-02-SC02
  it('SPEC-022-02-SC02 — under 18: 422 UNDERAGE over HTTP, nothing stored', async () => {
    const input = fresh();
    const res = await request(server)
      .post('/v1/auth/register')
      .send({
        ...input,
        accountType: 'courier',
        vehicle: 'velo',
        neighbourhoodOther: 'Gassi Est',
        birthDate: bornYearsAgo(17),
        acceptTerms: true,
      })
      .expect(422);
    expect(res.body).toMatchObject({ error: { code: 'UNDERAGE' } });
    expect(await prisma.authChallenge.count({ where: { email: input.email } })).toBe(0);
  });

  // SPEC-022-03-SC01, SPEC-022-03-SC02
  it('SPEC-022-03-SC01 — a restaurant: draft in N’Djamena, XAF, owned, application to complete, owner role limited to it; SC02 — invisible to customers', async () => {
    const klemat = await neighbourhood('Klémat');
    const input = fresh();
    const name = `Chez Fatimé ${randomUUID().slice(0, 6)}`;
    const signedIn = await signUp({
      ...input,
      accountType: 'restaurant',
      restaurantName: name,
      neighbourhoodId: klemat,
      acceptTerms: true,
    });
    const userId = signedIn.user.id;

    const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { ownerUserId: userId } });
    expect(restaurant).toMatchObject({
      name,
      status: 'draft',
      currency: 'XAF',
      neighbourhoodId: klemat,
    });
    expect(restaurant.slug).toMatch(/^chez-fatime-/);
    const city = await prisma.city.findUniqueOrThrow({ where: { id: restaurant.cityId } });
    expect(city.slug).toBe('ndjamena');
    const application = await prisma.restaurantApplication.findUniqueOrThrow({
      where: { restaurantId: restaurant.id },
    });
    expect(application.status).toBe('to_complete');
    expect(await roles(userId)).toEqual([
      { role: 'customer', scope: null },
      { role: 'restaurant_owner', scope: restaurant.id },
    ]);

    // SPEC-022-03-SC02: not in the list, its page is 404.
    const list = await request(server).get('/v1/restaurants').expect(200);
    expect(JSON.stringify(list.body)).not.toContain(restaurant.id);
    await request(server).get(`/v1/restaurants/${restaurant.slug}`).expect(404);
  });

  // SPEC-022-03-SC02 (review of parts 1-2, finding 1)
  it('SPEC-022-03-SC02 — its owner cannot publish it: « active » and « paused » are refused until DJAFAT approves', async () => {
    const owner = await signUp({
      ...fresh(),
      accountType: 'restaurant',
      restaurantName: `Chez Fatimé ${randomUUID().slice(0, 6)}`,
      neighbourhoodId: await neighbourhood('Klémat'),
      acceptTerms: true,
    });
    const restaurant = await prisma.restaurant.findFirstOrThrow({
      where: { ownerUserId: owner.user.id },
    });

    for (const status of ['paused', 'active']) {
      const refused = await request(server)
        .patch(`/v1/restaurants/${restaurant.id}`)
        .set('Authorization', `Bearer ${owner.access}`)
        .send({ status })
        .expect(409);
      expect(refused.body).toMatchObject({ error: { code: 'RESTAURANT_NOT_APPROVED' } });
    }
    expect(
      (await prisma.restaurant.findUniqueOrThrow({ where: { id: restaurant.id } })).status,
    ).toBe('draft');
    const list = await request(server).get('/v1/restaurants').expect(200);
    expect(JSON.stringify(list.body)).not.toContain(restaurant.id);
    await request(server).get(`/v1/restaurants/${restaurant.slug}`).expect(404);
  });

  // SPEC-022-02-SC05, SPEC-022-03-SC03
  it('SPEC-022-03-SC03 — sent but never confirmed: no account, no restaurant, no role', async () => {
    const input = fresh();
    const name = `Grill ${randomUUID().slice(0, 6)}`;
    await request(server)
      .post('/v1/auth/register')
      .send({
        ...input,
        accountType: 'restaurant',
        restaurantName: name,
        neighbourhoodOther: 'Gassi',
        acceptTerms: true,
      })
      .expect(202);
    expect(await prisma.user.count({ where: { email: input.email } })).toBe(0);
    expect(await prisma.restaurant.count({ where: { name } })).toBe(0);
  });

  // SPEC-022-09 R3, first half (SC02's console half — the names to add — comes with the « Quartiers » page, part 3)
  it('SPEC-022-09 R3 — « Autre » keeps the typed name, without a neighbourhood from the list', async () => {
    const input = fresh();
    const signedIn = await signUp({
      ...input,
      accountType: 'courier',
      vehicle: 'velo',
      neighbourhoodOther: '  Gassi   Est ',
      birthDate: bornYearsAgo(30),
      acceptTerms: true,
    });
    const courier = await prisma.courier.findUniqueOrThrow({ where: { userId: signedIn.user.id } });
    expect(courier).toMatchObject({ neighbourhoodId: null, neighbourhoodOther: 'Gassi Est' });
  });

  // SPEC-022-09-SC04
  it('SPEC-022-09-SC04 — reloading the reference data undoes neither a rename nor a disable', async () => {
    const moursal = await prisma.neighbourhood.findFirstOrThrow({ where: { code: 'moursal' } });
    const abena = await prisma.neighbourhood.findFirstOrThrow({ where: { code: 'abena' } });
    const before = await prisma.neighbourhood.count();
    try {
      await prisma.neighbourhood.update({
        where: { id: moursal.id },
        data: { name: 'Moursal Centre', nameKey: 'moursal centre' },
      });
      await prisma.neighbourhood.update({ where: { id: abena.id }, data: { active: false } });

      await seedReferenceData(prisma, { resetTunables: false }); // as a server reinstall does

      expect(
        (await prisma.neighbourhood.findUniqueOrThrow({ where: { id: moursal.id } })).name,
      ).toBe('Moursal Centre');
      expect(
        (await prisma.neighbourhood.findUniqueOrThrow({ where: { id: abena.id } })).active,
      ).toBe(false);
      expect(await prisma.neighbourhood.count()).toBe(before);
    } finally {
      await prisma.neighbourhood.update({
        where: { id: moursal.id },
        data: { name: moursal.name, nameKey: moursal.nameKey },
      });
      await prisma.neighbourhood.update({ where: { id: abena.id }, data: { active: true } });
    }
  });

  // SPEC-022-04-SC01, SPEC-022-04-SC02
  it('SPEC-022-04-SC01 — a private photo is never served without a valid link; SC02 — the signed link serves it', async () => {
    const photos = app.get(PhotoStorage);
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x33, 0xff, 0xd9,
    ]);
    const { key } = await photos.store('private', jpeg);

    await request(server).get(`/v1/files/${key}`).expect(403);
    await request(server).get(`/v1/files/${key}?exp=9999999999&sig=forged`).expect(403);

    const link = new URL(await photos.link(key));
    const served = await request(server).get(`${link.pathname}${link.search}`).expect(200);
    expect(served.headers['content-type']).toContain('image/jpeg');
    expect(served.headers['cache-control']).toBe('private, no-store');
    // The consoles (admin., livreur.) show it; another site cannot (FEAT-022 part 2).
    expect(served.headers['cross-origin-resource-policy']).toBe('same-site');
  });
});

describe('FEAT-022 part 2 — the courier’s application and DJAFAT’s decision, over HTTP', () => {
  // SPEC-022-04-SC03
  it('SPEC-022-04-SC03 — a PDF sent as a photo: 415 UNSUPPORTED_FILE; 6 MB: 413 FILE_TOO_LARGE; nothing kept', async () => {
    const courier = await motoCourier();
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n', 'latin1');

    const refused = await upload(courier.access, 'id_card', pdf).expect(415);
    expect(refused.body).toMatchObject({ error: { code: 'UNSUPPORTED_FILE' } });
    const big = await upload(courier.access, 'id_card', Buffer.alloc(6 * 1024 * 1024, 0xff)).expect(
      413,
    );
    expect(big.body).toMatchObject({ error: { code: 'FILE_TOO_LARGE' } });

    const application = await prisma.courierApplication.findUniqueOrThrow({
      where: { courierUserId: courier.user.id },
    });
    expect(application.idCardPhotoKey).toBeNull();
  });

  // SPEC-022-04-SC01, SPEC-022-04-SC02, SPEC-022-07-SC04
  it('SPEC-022-04-SC01/SC02 — the ID photo opens for its owner and an admin only; SPEC-022-07-SC04 — support is refused', async () => {
    const courier = await motoCourier();
    const stranger = await motoCourier();
    const sent = await upload(courier.access, 'id_card', JPEG).expect(200);
    expect(sent.body).toMatchObject({
      photos: expect.arrayContaining([{ kind: 'id_card', uploaded: true }]),
    });
    const key = (
      await prisma.courierApplication.findUniqueOrThrow({
        where: { courierUserId: courier.user.id },
      })
    ).idCardPhotoKey!;

    // No public address; another courier only ever reaches their own application.
    await request(server).get(`/v1/files/${key}`).expect(403);
    await request(server)
      .get('/v1/couriers/me/application/files/id_card')
      .set('Authorization', `Bearer ${stranger.access}`)
      .expect(404);

    const mine = await request(server)
      .get('/v1/couriers/me/application/files/id_card')
      .set('Authorization', `Bearer ${courier.access}`)
      .expect(200);
    expect(mine.body).toMatchObject({ expiresInSeconds: 300 });
    const ownLink = new URL((mine.body as { url: string }).url);
    await request(server).get(`${ownLink.pathname}${ownLink.search}`).expect(200);
    const forged = new URL(ownLink.toString());
    const sig = forged.searchParams.get('sig') ?? '';
    forged.searchParams.set('sig', `${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`);
    await request(server).get(`${forged.pathname}${forged.search}`).expect(403);

    const admin = await staffToken(STAFF.admin);
    const adminLink = await request(server)
      .get(`/v1/admin/applications/courier/${courier.user.id}/files/id_card`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    const link = new URL((adminLink.body as { url: string }).url);
    const image = await request(server).get(`${link.pathname}${link.search}`).expect(200);
    expect(image.headers['content-type']).toContain('image/jpeg');

    const support = await staffToken(STAFF.support);
    await request(server)
      .get(`/v1/admin/applications/courier/${courier.user.id}/files/id_card`)
      .set('Authorization', `Bearer ${support}`)
      .expect(403);
    await request(server)
      .get('/v1/admin/applications')
      .set('Authorization', `Bearer ${support}`)
      .expect(403);
  });

  // SPEC-022-06-SC02, SPEC-022-06-SC03
  it('SPEC-022-06-SC02 — sent without the licence: 409 with ["driving_licence"]; SC03 — complete: pending_review, then locked', async () => {
    const courier = await motoCourier();
    for (const kind of ['face', 'id_card', 'vehicle_registration', 'insurance', 'plate']) {
      await upload(courier.access, kind, JPEG).expect(200);
    }
    await request(server)
      .put('/v1/couriers/me/application')
      .set('Authorization', `Bearer ${courier.access}`)
      .send({
        mobileMoney: { provider: 'moov', number: '99 00 00 01' },
        emergencyContact: { name: 'Halimé Abakar', phone: '99 11 22 33' },
      })
      .expect(200);

    const incomplete = (await submit(courier.access)).body;
    expect(incomplete).toMatchObject({
      error: { code: 'APPLICATION_INCOMPLETE', details: { missing: ['driving_licence'] } },
    });

    await upload(courier.access, 'driving_licence', JPEG).expect(200);
    const sent = await submit(courier.access);
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ status: 'pending_review' });
    const row = await prisma.courierApplication.findUniqueOrThrow({
      where: { courierUserId: courier.user.id },
    });
    expect(row.status).toBe('pending_review');
    expect(row.submittedAt).toBeInstanceOf(Date);

    const changed = await request(server)
      .put('/v1/couriers/me/application')
      .set('Authorization', `Bearer ${courier.access}`)
      .send({ vehicle: 'velo' })
      .expect(409);
    expect(changed.body).toMatchObject({ error: { code: 'APPLICATION_LOCKED' } });
    await upload(courier.access, 'face', JPEG).expect(409);
  });

  it('SPEC-022-06 — a mistyped number and the courier’s own number as emergency contact: 422', async () => {
    const courier = await motoCourier();
    const own = await prisma.user.findUniqueOrThrow({ where: { id: courier.user.id } });

    const typo = await request(server)
      .put('/v1/couriers/me/application')
      .set('Authorization', `Bearer ${courier.access}`)
      .send({ mobileMoney: { provider: 'airtel', number: '66 00' } })
      .expect(422);
    expect(typo.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    const self = await request(server)
      .put('/v1/couriers/me/application')
      .set('Authorization', `Bearer ${courier.access}`)
      .send({ emergencyContact: { name: 'Moi-même', phone: own.phone } })
      .expect(422);
    expect(self.body).toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: [{ path: 'emergencyContact.phone' }] },
    });
  });

  // SPEC-022-07-SC03
  it('SPEC-022-07-SC03 — refused without a reason: 422; with « La photo du permis est floue. »: rejected, e-mailed, corrected and back in the queue', async () => {
    const courier = await motoCourier({ complete: true });
    await submit(courier.access);
    const admin = await staffToken(STAFF.admin);
    const reject = (reason: string | undefined) =>
      request(server)
        .post(`/v1/admin/applications/courier/${courier.user.id}/reject`)
        .set('Authorization', `Bearer ${admin}`)
        .send(reason === undefined ? {} : { reason });

    expect((await reject(undefined)).status).toBe(422);
    expect((await reject('Floue.')).status).toBe(422);
    const refused = await reject('La photo du permis est floue.');
    expect(refused.status).toBe(200);
    expect(refused.body).toMatchObject({ status: 'rejected', email: 'sent' });

    const notice = JSON.parse(
      (await redis.client.get(mockAccountNoticeKey(courier.email))) ?? '{}',
    );
    expect(notice).toEqual({
      kind: 'application_rejected',
      subject: 'Votre demande de livreur DJAFAT est refusée',
    });
    const seen = await request(server)
      .get('/v1/couriers/me/application')
      .set('Authorization', `Bearer ${courier.access}`)
      .expect(200);
    expect(seen.body).toMatchObject({
      status: 'rejected',
      rejectionReason: 'La photo du permis est floue.',
    });

    await upload(courier.access, 'driving_licence', JPEG).expect(200);
    expect((await submit(courier.access)).status).toBe(200);
    const queue = await request(server)
      .get('/v1/admin/applications?type=courier')
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect((queue.body as { items: Array<{ id: string }> }).items.map((i) => i.id)).toContain(
      courier.user.id,
    );
  });

  // SPEC-022-07-SC06
  it('SPEC-022-07-SC06 — two admins decide at the same time: one decision, the other 409 ALREADY_DECIDED', async () => {
    const courier = await motoCourier({ complete: true });
    await submit(courier.access);
    const admin = await staffToken(STAFF.admin);
    const path = `/v1/admin/applications/courier/${courier.user.id}`;

    const [approve, reject] = await Promise.all([
      request(server).post(`${path}/approve`).set('Authorization', `Bearer ${admin}`).send({}),
      request(server)
        .post(`${path}/reject`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ reason: 'Le permis a expiré, merci.' }),
    ]);

    expect([approve.status, reject.status].sort()).toEqual([200, 409]);
    const loser = approve.status === 409 ? approve : reject;
    expect(loser.body).toMatchObject({ error: { code: 'ALREADY_DECIDED' } });
    const row = await prisma.courierApplication.findUniqueOrThrow({
      where: { courierUserId: courier.user.id },
    });
    expect(row.status).toBe(approve.status === 200 ? 'approved' : 'rejected');
    const decisions = await prisma.auditLog.count({
      where: {
        entityId: courier.user.id,
        action: { in: ['APPLICATION_APPROVED', 'APPLICATION_REJECTED'] },
      },
    });
    expect(decisions).toBe(1);
  });

  // SPEC-022-06-SC04
  it('SPEC-022-06-SC04 — « En ligne » refused while checked, accepted once approved; a courier without application works as before', async () => {
    const courier = await motoCourier({ complete: true });
    await submit(courier.access);
    const goOnline = (access: string) =>
      request(server)
        .post('/v1/couriers/me/status')
        .set('Authorization', `Bearer ${access}`)
        .send({ status: 'online' });

    const waiting = await goOnline(courier.access);
    expect(waiting.status).toBe(409);
    expect(waiting.body).toMatchObject({ error: { code: 'COURIER_NOT_APPROVED' } });

    const admin = await staffToken(STAFF.admin);
    await request(server)
      .post(`/v1/admin/applications/courier/${courier.user.id}/approve`)
      .set('Authorization', `Bearer ${admin}`)
      .send({})
      .expect(200);
    const notice = JSON.parse(
      (await redis.client.get(mockAccountNoticeKey(courier.email))) ?? '{}',
    );
    expect(notice).toMatchObject({ kind: 'application_approved' });
    expect((await goOnline(courier.access)).status).toBe(201);

    // A courier the team created has a role and a profile, no application.
    const team = await motoCourier();
    await prisma.courierApplication.delete({ where: { courierUserId: team.user.id } });
    expect((await goOnline(team.access)).status).toBe(201);

    for (const c of [courier, team]) {
      await request(server)
        .post('/v1/couriers/me/status')
        .set('Authorization', `Bearer ${c.access}`)
        .send({ status: 'offline' });
    }
  });

  // SPEC-022-07-SC01
  it('SPEC-022-07-SC01 — the restaurants sent are listed oldest first, a draft never; both tabs counted', async () => {
    const klemat = await neighbourhood('Klémat');
    const restaurants: string[] = [];
    for (const name of ['Grill', 'Chez Fatimé', 'Brouillon']) {
      const owner = await signUp({
        ...fresh(),
        accountType: 'restaurant',
        restaurantName: `${name} ${randomUUID().slice(0, 6)}`,
        neighbourhoodId: klemat,
        acceptTerms: true,
      });
      const r = await prisma.restaurant.findFirstOrThrow({ where: { ownerUserId: owner.user.id } });
      restaurants.push(r.id);
    }
    const [later, earlier, draft] = restaurants;
    // Sent (the four steps come with SPEC-022-05): earlier first, even if created second.
    await prisma.restaurantApplication.update({
      where: { restaurantId: later! },
      data: { status: 'pending_review', submittedAt: new Date('2026-11-22T10:02:00Z') },
    });
    await prisma.restaurantApplication.update({
      where: { restaurantId: earlier! },
      data: { status: 'pending_review', submittedAt: new Date('2026-11-22T09:14:00Z') },
    });
    const admin = await staffToken(STAFF.admin);

    const res = await request(server)
      .get('/v1/admin/applications?type=restaurant')
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    const body = res.body as {
      counts: { restaurant: number; courier: number };
      items: Array<{ id: string; neighbourhood: string }>;
    };
    const ids = body.items.map((i) => i.id);
    expect(ids.indexOf(earlier!)).toBeLessThan(ids.indexOf(later!));
    expect(ids.indexOf(earlier!)).toBeGreaterThanOrEqual(0);
    expect(ids).not.toContain(draft);
    expect(body.counts.restaurant).toBe(body.items.length);
    expect(body.items.find((i) => i.id === earlier)?.neighbourhood).toBe('Klémat');
    const couriers = await request(server)
      .get('/v1/admin/applications?type=courier')
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect((couriers.body as { counts: unknown }).counts).toEqual(body.counts);

    for (const id of [later!, earlier!]) {
      await prisma.restaurantApplication.update({
        where: { restaurantId: id },
        data: { status: 'to_complete', submittedAt: null },
      });
    }
  });
});

/** The last notice the mock e-mail kept for an address (`{ kind, subject }`), waited for briefly. */
async function lastNotice(email: string, kind: string): Promise<{ kind: string; subject: string }> {
  for (let i = 0; i < 50; i += 1) {
    const raw = await redis.client.get(mockAccountNoticeKey(email));
    const notice = raw ? (JSON.parse(raw) as { kind: string; subject: string }) : null;
    if (notice?.kind === kind) return notice;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no "${kind}" notice for ${email}`);
}

// FEAT-022 — SPEC-022-02 R8, SPEC-022-03 R6, SPEC-022-08, on a real database.
describe('FEAT-022 — welcome e-mail and « Mon profil » roles', () => {
  it('SPEC-022-02-SC07 — a courier who signs up gets « Bienvenue sur DJAFAT »', async () => {
    const courier = await motoCourier();
    expect(await lastNotice(courier.email, 'welcome')).toEqual({
      kind: 'welcome',
      subject: 'Bienvenue sur DJAFAT : votre compte livreur est créé',
    });
  });

  it('SPEC-022-08-SC01 — a customer becomes a courier on the same account; asking again: 409', async () => {
    const input = fresh();
    const customer = await signUp(input);
    const res = await request(server)
      .post('/v1/me/roles/courier')
      .set('Authorization', `Bearer ${customer.access}`)
      .send({
        vehicle: 'velo',
        neighbourhoodId: await neighbourhood('Chagoua'),
        birthDate: bornYearsAgo(30),
        acceptTerms: true,
      })
      .expect(201);
    expect((res.body as { id: string; roles: string[] }).id).toBe(customer.user.id);
    expect((res.body as { roles: string[] }).roles).toEqual(
      expect.arrayContaining(['customer', 'courier']),
    );
    const application = await prisma.courierApplication.findUniqueOrThrow({
      where: { courierUserId: customer.user.id },
    });
    expect(application.status).toBe('to_complete');
    expect(application.termsAcceptedAt).toBeInstanceOf(Date);
    expect(await prisma.user.count({ where: { email: input.email } })).toBe(1);
    expect(
      await prisma.user.count({ where: { phone: `+235${input.phone.replace(/\s/g, '')}` } }),
    ).toBe(1);
    expect(await lastNotice(input.email, 'welcome')).toMatchObject({ kind: 'welcome' });
    // R3: « Mon profil » shows the new role at once, with the same session (database roles).
    const me = await request(server)
      .get('/v1/me')
      .set('Authorization', `Bearer ${customer.access}`)
      .expect(200);
    expect((me.body as { roles: string[] }).roles).toEqual(
      expect.arrayContaining(['customer', 'courier']),
    );

    const again = await request(server)
      .post('/v1/me/roles/courier')
      .set('Authorization', `Bearer ${customer.access}`)
      .send({
        vehicle: 'moto',
        neighbourhoodOther: 'Gassi Est',
        birthDate: bornYearsAgo(30),
        acceptTerms: true,
      })
      .expect(409);
    expect(again.body).toMatchObject({ error: { code: 'ROLE_ALREADY_HELD' } });
  });

  it('SPEC-022-08 R2 — two « Inscrire mon restaurant » at once: one restaurant, one 409', async () => {
    const customer = await signUp(fresh());
    const send = () =>
      request(server)
        .post('/v1/me/roles/restaurant')
        .set('Authorization', `Bearer ${customer.access}`)
        .send({ restaurantName: 'Chez Awa', neighbourhoodOther: 'Klémat Nord', acceptTerms: true });
    const statuses = (await Promise.all([send(), send()])).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(await prisma.restaurant.count({ where: { ownerUserId: customer.user.id } })).toBe(1);
  });
});

// FEAT-024 — docs/features/FEAT-024-saisies-verifiees (SPEC-024-01, SPEC-024-02), on a real database.
describe('FEAT-024 — numbers checked by the server', () => {
  it('SPEC-024-01-SC01 — a foreign number asking for an SMS: 422 SMS_FOREIGN_NUMBER, no code stored', async () => {
    const phone = `+336${String(randomInt(10_000_000, 100_000_000))}`;
    const res = await request(server)
      .post('/v1/auth/otp/request')
      .send({ phone, purpose: 'login' })
      .expect(422);
    expect(res.body).toMatchObject({ error: { code: 'SMS_FOREIGN_NUMBER' } });
    expect(await prisma.otpCode.count({ where: { target: phone } })).toBe(0);
    expect(await redis.client.get(mockOtpKey(phone))).toBeNull();
  });

  it('SPEC-024-01-SC03 — a Chad fixed line asking for an SMS: 422 PHONE_FIXED_LINE', async () => {
    const res = await request(server)
      .post('/v1/auth/otp/request')
      .send({ phone: '22 51 23 45', purpose: 'login' })
      .expect(422);
    expect(res.body).toMatchObject({ error: { code: 'PHONE_FIXED_LINE' } });
    expect(await prisma.otpCode.count({ where: { target: '+23522512345' } })).toBe(0);
  });

  it('SPEC-024-02-SC02 — a fixed line at sign-up: 422 on the phone, nothing pending, no e-mail', async () => {
    const input = { ...fresh(), phone: '22 51 23 45' };
    const res = await request(server).post('/v1/auth/register').send(input).expect(422);
    expect(JSON.stringify(res.body)).toContain('Ce numéro est un fixe');
    expect(await prisma.authChallenge.count({ where: { email: input.email } })).toBe(0);
    expect(await redis.client.get(mockEmailOtpKey(input.email))).toBeNull();
  });

  it('SPEC-024-02-SC01 — a foreign number signs up; the account keeps it in international format', async () => {
    const input = { ...fresh(), phone: `+33 6 ${String(randomInt(10_000_000, 100_000_000))}` };
    const signedIn = await signUp(input);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: signedIn.user.id } });
    expect(user.phone).toBe(input.phone.replace(/\s/g, ''));
  });
});

describe('FEAT-024 / FEAT-022 — more over HTTP', () => {
  it('SPEC-024-01-SC05 — a confirmed foreign number: no SMS on a new device (offered: e-mail), and asking anyway: 422', async () => {
    const input = { ...fresh(), phone: `+33 6 ${String(randomInt(10_000_000, 100_000_000))}` };
    const signedIn = await signUp(input);
    await prisma.user.update({
      where: { id: signedIn.user.id },
      data: { phoneVerifiedAt: new Date() },
    });
    const login = await request(server)
      .post('/v1/auth/password/login')
      .send({ email: input.email, password: input.password })
      .expect(200);
    const challenge = login.body as {
      status: string;
      challengeId: string;
      channels: Array<{ id: string; available: boolean }>;
    };
    expect(challenge.status).toBe('code_required');
    expect(challenge.channels.find((c) => c.id === 'sms')?.available).toBe(false);
    expect(challenge.channels.find((c) => c.id === 'email')?.available).toBe(true);
    const sms = await request(server)
      .post('/v1/auth/password/challenge/send')
      .send({ challengeId: challenge.challengeId, channel: 'sms' })
      .expect(422);
    expect(sms.body).toMatchObject({ error: { code: 'SMS_FOREIGN_NUMBER' } });
  });

  it('SPEC-022-08-SC04 — a courier sign-up with a used e-mail: FEAT-020’s answer, no second account; a used number: 409', async () => {
    const existing = fresh();
    await signUp(existing);
    const courierFields = {
      accountType: 'courier',
      vehicle: 'moto',
      neighbourhoodId: await neighbourhood('Moursal'),
      birthDate: bornYearsAgo(25),
      acceptTerms: true,
    };
    const sameEmail = { ...fresh(), email: existing.email, ...courierFields };
    await request(server).post('/v1/auth/register').send(sameEmail).expect(202);
    expect(await lastNotice(existing.email, 'already_registered')).toMatchObject({
      kind: 'already_registered',
    });
    expect(await prisma.user.count({ where: { email: existing.email } })).toBe(1);

    const samePhone = { ...fresh(), phone: existing.phone, ...courierFields };
    const refused = await request(server).post('/v1/auth/register').send(samePhone).expect(409);
    expect(refused.body).toMatchObject({ error: { code: 'PHONE_ALREADY_USED' } });
  });
});
