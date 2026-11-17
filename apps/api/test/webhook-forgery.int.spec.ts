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
import { MockPaymentProvider } from '../src/modules/payments/providers/mock/mock-payment.provider';

const CUSTOMER_PHONE = '+23566000001'; // seeded (apps/api/prisma/seed.ts)

/**
 * A forged payment webhook against real PostgreSQL (audit finding PAY-05). The
 * `(provider_code, event_id)` row of `webhook_events` is the webhook's
 * idempotency key, and it used to be written BEFORE the signature was checked:
 * a request with a bad signature and the event id of the genuine webhook got
 * its 401, but its row stayed, so the genuine, correctly signed webhook was
 * answered `{"status":"duplicate"}` and the payment stayed pending. The event
 * id is read from the request body, so the attacker chooses it.
 */

let app: NestFastifyApplication;
let prisma: PrismaService;
let redis: RedisService;
let server: Server;
let customerAccess: string;

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

/** An order awaiting a mock payment that only a webhook can settle. */
async function orderWithPendingPayment(): Promise<{
  orderId: string;
  paymentId: string;
  providerRef: string;
  total: { minor: string; currency: string };
}> {
  const auth = { Authorization: `Bearer ${customerAccess}` };
  const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
  const frites = await prisma.product.findFirstOrThrow({
    where: { restaurantId: restaurant.id, name: 'Frites' },
  });
  await request(server).delete('/v1/carts').set(auth).expect(200);
  await request(server)
    .post('/v1/carts/items')
    .set(auth)
    .send({ productId: frites.id, quantity: 2, selectedOptionIds: [] })
    .expect(201);
  const orderRes = await request(server)
    .post('/v1/orders')
    .set(auth)
    .set('idempotency-key', `int-forgery-order-${randomUUID()}`)
    .send({})
    .expect(201);
  const order = orderRes.body.order as { id: string; total: { minor: string; currency: string } };
  const paymentRes = await request(server)
    .post('/v1/payments')
    .set(auth)
    .set('idempotency-key', `int-forgery-payment-${randomUUID()}`)
    .send({
      orderId: order.id,
      providerCode: 'mock',
      methodCode: 'mobile_money',
      metadata: { mockOutcome: 'pending_then_succeed' },
    })
    .expect(201);
  const payment = paymentRes.body.payment as { id: string; providerRef: string; status: string };
  expect(payment.status).toBe('pending');
  return {
    orderId: order.id,
    paymentId: payment.id,
    providerRef: payment.providerRef,
    total: order.total,
  };
}

/** The order is placed by an in-process event after the response: wait up to 5 s for `want`. */
async function orderStatus(orderId: string, want: string): Promise<string> {
  let status = '';
  for (let i = 0; i < 50; i++) {
    status = (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;
    if (status === want) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return status;
}

const postWebhook = (body: string, signature: string) =>
  request(server)
    .post('/v1/payments/webhook/mock')
    .set('content-type', 'application/json')
    .set('x-mock-signature', signature)
    .send(body);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true, // webhook signatures are checked on the raw bytes, as in main.ts
  });
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  server = app.getHttpAdapter().getInstance().server as unknown as Server;
  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
  customerAccess = await loginViaOtp(CUSTOMER_PHONE);
});

afterAll(async () => {
  await app.close();
});

describe('a forged payment webhook against real PostgreSQL (PAY-05)', () => {
  it('is refused without a trace, and the genuine webhook with the same event id still settles the payment', async () => {
    const { orderId, paymentId, providerRef, total } = await orderWithPendingPayment();
    const eventId = `evt-${randomUUID()}`;
    const body = JSON.stringify({
      eventId,
      providerRef,
      status: 'succeeded',
      amountMinor: total.minor,
      currency: total.currency,
    });

    // 1. the attacker: the genuine body and event id, a wrong signature
    const forged = await postWebhook(body, 'forged-signature').expect(401);
    expect(forged.body.error.code).toBe('UNAUTHENTICATED');
    expect(await prisma.webhookEvent.count({ where: { providerCode: 'mock', eventId } })).toBe(0);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
      'pending',
    );

    // 2. the provider: the same body, correctly signed
    await postWebhook(body, MockPaymentProvider.sign(body)).expect(200).expect({ status: 'ok' });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
      'succeeded',
    );
    const events = await prisma.webhookEvent.findMany({ where: { providerCode: 'mock', eventId } });
    expect(events.map((e) => e.status)).toEqual(['processed']);
    expect(await orderStatus(orderId, 'placed')).toBe('placed');

    // 3. a replay of the genuine webhook is still a no-op
    await postWebhook(body, MockPaymentProvider.sign(body))
      .expect(200)
      .expect({ status: 'duplicate' });
  });
});
