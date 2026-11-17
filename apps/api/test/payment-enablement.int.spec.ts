import 'reflect-metadata';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { RedisService } from '../src/common/redis/redis.service';
import { mockOtpKey } from '../src/modules/auth/providers/mock-otp-delivery.provider';

const CUSTOMER_PHONE = '+23566000001'; // seeded (apps/api/prisma/seed.ts)

/**
 * Payment creation against real PostgreSQL (audit finding PAY-01). With `mock`
 * disabled in `payment_provider_configs` (the payment screen then lists
 * nothing), `POST /v1/payments {"providerCode":"mock"}` still answered
 * `succeeded` and placed the order: creation only checked that the provider's
 * class was registered. It now applies the screen's own rule. The client's
 * `methodCode` was also stored as sent, so an unknown one hit a foreign key
 * (HTTP 500); the provider's own method is stored instead.
 */

let app: NestFastifyApplication;
let prisma: PrismaService;
let redis: RedisService;
let server: Server;
let auth: { Authorization: string };
let disabledIds: string[] = [];

async function loginViaOtp(phone: string): Promise<string> {
  await request(server).post('/v1/auth/otp/request').send({ phone, purpose: 'login' }).expect(202);
  const code = await redis.client.get(mockOtpKey(phone));
  if (!code) throw new Error(`No mock OTP code found for ${phone}`);
  const res = await request(server)
    .post('/v1/auth/otp/verify')
    .send({ phone, code, purpose: 'login' })
    .expect(200);
  return (res.body as { access: string }).access;
}

/** A fresh order awaiting payment. */
async function orderAwaitingPayment(): Promise<string> {
  const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
  const frites = await prisma.product.findFirstOrThrow({
    where: { restaurantId: restaurant.id, name: 'Frites' },
  });
  await request(server).delete('/v1/carts').set(auth).expect(200);
  await request(server)
    .post('/v1/carts/items')
    .set(auth)
    .send({ productId: frites.id, quantity: 1, selectedOptionIds: [] })
    .expect(201);
  const res = await request(server)
    .post('/v1/orders')
    .set(auth)
    .set('idempotency-key', `int-enablement-order-${randomUUID()}`)
    .send({})
    .expect(201);
  return (res.body.order as { id: string }).id;
}

const pay = (orderId: string, methodCode = 'mobile_money') =>
  request(server)
    .post('/v1/payments')
    .set(auth)
    .set('idempotency-key', `int-enablement-payment-${randomUUID()}`)
    .send({ orderId, providerCode: 'mock', methodCode });

/** Switches the enabled `mock` rows off, remembering which, so they can be restored. */
async function disableMock(): Promise<void> {
  const rows = await prisma.paymentProviderConfig.findMany({
    where: { providerCode: 'mock', enabled: true },
    select: { id: true },
  });
  disabledIds = rows.map((r) => r.id);
  expect(disabledIds.length).toBeGreaterThan(0); // the seed enables mock outside production
  await prisma.paymentProviderConfig.updateMany({
    where: { id: { in: disabledIds } },
    data: { enabled: false },
  });
}

async function restoreMock(): Promise<void> {
  if (disabledIds.length === 0) return;
  await prisma.paymentProviderConfig.updateMany({
    where: { id: { in: disabledIds } },
    data: { enabled: true },
  });
  disabledIds = [];
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  server = app.getHttpAdapter().getInstance().server as unknown as Server;
  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
  auth = { Authorization: `Bearer ${await loginViaOtp(CUSTOMER_PHONE)}` };
});

afterAll(async () => {
  await restoreMock(); // the other files rely on the seeded configuration
  await app.close();
});

describe('payment creation honours provider enablement, against real PostgreSQL (PAY-01)', () => {
  it('a disabled provider is refused with 409 and nothing is written; enabled again, it works', async () => {
    const orderId = await orderAwaitingPayment();
    await disableMock();
    try {
      const refused = await pay(orderId).expect(409);
      expect(refused.body.error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
        'awaiting_payment',
      );
      expect(await prisma.payment.count({ where: { orderId } })).toBe(0);
    } finally {
      await restoreMock();
    }
    const accepted = await pay(orderId).expect(201);
    expect((accepted.body.payment as { status: string }).status).toBe('succeeded');
  });

  it("stores the provider's own method, whatever methodCode the client sends", async () => {
    const orderId = await orderAwaitingPayment();
    const res = await pay(orderId, 'no-such-method').expect(201);
    const payment = res.body.payment as { id: string; methodCode: string };
    expect(payment.methodCode).toBe('mobile_money');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).methodCode).toBe(
      'mobile_money',
    );
  });
});
