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

  // SPEC-022-09-SC02
  it('SPEC-022-09-SC02 — « Autre » keeps the typed name, without a neighbourhood from the list', async () => {
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
  });
});
