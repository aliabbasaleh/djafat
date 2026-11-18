import 'reflect-metadata';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { listenOnLoopback } from './listen-on-loopback';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { RedisService } from '../src/common/redis/redis.service';
import { mockOtpKey } from '../src/modules/auth/providers/mock-otp-delivery.provider';
import { MockPaymentProvider } from '../src/modules/payments/providers/mock/mock-payment.provider';
import { PaymentsService } from '../src/modules/payments/payments.service';

const CUSTOMER_PHONE = '+23566000001'; // seeded (apps/api/prisma/seed.ts)
const SUPER_ADMIN_PHONE = '+23566000008'; // seeded "Super Admin Test", the refunds' requester

/**
 * Refunds against real PostgreSQL (audit finding PAY-03). The refundable
 * remainder and the final status come from `SUM(amount_minor)`, which
 * PostgreSQL returns as `numeric`: without a `::bigint` cast Prisma hands back
 * a Decimal and the bigint arithmetic throws "Cannot mix BigInt and other
 * types", so every refund failed with a 500. The unit tests could not see it:
 * their Prisma fake returns a bigint.
 *
 * The refund is called on the service: the HTTP route adds the staff step-up
 * (TOTP), which is not what this test is about. The paid order is made through
 * the real HTTP flow (cart, order, mock payment, signed webhook).
 */

let app: NestFastifyApplication;
let prisma: PrismaService;
let redis: RedisService;
let server: Server;
let payments: PaymentsService;
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

/** A placed order paid in full by the mock provider: 3500 + 1000 + 1000 delivery = 5500 XAF. */
async function paidOrder(): Promise<{ paymentId: string; totalMinor: bigint }> {
  const auth = { Authorization: `Bearer ${customerAccess}` };
  const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
  const poulet = await prisma.product.findFirstOrThrow({
    where: { restaurantId: restaurant.id, name: 'Poulet braisé' },
  });
  const frites = await prisma.product.findFirstOrThrow({
    where: { restaurantId: restaurant.id, name: 'Frites' },
  });
  const portion = await prisma.productOptionGroup.findFirstOrThrow({
    where: { productId: poulet.id, name: 'Portion' },
  });
  const entier = await prisma.productOption.findFirstOrThrow({
    where: { optionGroupId: portion.id, name: 'Entier' },
  });

  await request(server).delete('/v1/carts').set(auth).expect(200);
  await request(server)
    .post('/v1/carts/items')
    .set(auth)
    .send({ productId: poulet.id, quantity: 1, selectedOptionIds: [entier.id] })
    .expect(201);
  await request(server)
    .post('/v1/carts/items')
    .set(auth)
    .send({ productId: frites.id, quantity: 1, selectedOptionIds: [] })
    .expect(201);
  const orderRes = await request(server)
    .post('/v1/orders')
    .set(auth)
    .set('idempotency-key', `int-refund-order-${randomUUID()}`)
    .send({})
    .expect(201);
  const order = orderRes.body.order as { id: string; total: { minor: string; currency: string } };

  const paymentRes = await request(server)
    .post('/v1/payments')
    .set(auth)
    .set('idempotency-key', `int-refund-payment-${randomUUID()}`)
    .send({
      orderId: order.id,
      providerCode: 'mock',
      methodCode: 'mobile_money',
      metadata: { mockOutcome: 'pending_then_succeed' },
    })
    .expect(201);
  const payment = paymentRes.body.payment as { id: string; providerRef: string };

  const webhookBody = JSON.stringify({
    eventId: `evt-${randomUUID()}`,
    providerRef: payment.providerRef,
    status: 'succeeded',
    amountMinor: order.total.minor,
    currency: order.total.currency,
  });
  await request(server)
    .post('/v1/payments/webhook/mock')
    .set('content-type', 'application/json')
    .set('x-mock-signature', MockPaymentProvider.sign(webhookBody))
    .send(webhookBody)
    .expect(200);

  const paid = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  expect(paid.status).toBe('succeeded');
  return { paymentId: payment.id, totalMinor: paid.amountMinor };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true, // webhook signatures are checked on the raw bytes, as in main.ts
  });
  configureApp(app);
  server = await listenOnLoopback(app);
  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
  payments = app.get(PaymentsService);
  customerAccess = await loginViaOtp(CUSTOMER_PHONE);
});

afterAll(async () => {
  await app.close();
});

describe('refunds against real PostgreSQL (PAY-03)', () => {
  it('partial refund, over-refund refused, then the remainder: partially_refunded, 409, refunded', async () => {
    const { paymentId, totalMinor } = await paidOrder();
    const requestedBy = (
      await prisma.user.findFirstOrThrow({
        where: { phone: SUPER_ADMIN_PHONE },
        select: { id: true },
      })
    ).id;
    const refund = (minor: bigint) =>
      payments.refundPayment(
        paymentId,
        {
          amount: { minor: minor.toString(), currency: 'XAF' },
          reason: 'integration test (PAY-03)',
        },
        `int-refund-${randomUUID()}`,
        requestedBy,
      );

    const first = await refund(2000n);
    expect(first.refund.status).toBe('succeeded');
    expect(first.payment.status).toBe('partially_refunded');

    const over = await refund(totalMinor - 2000n + 1n).catch((e: unknown) => e);
    expect(over).toBeInstanceOf(ConflictException);
    expect((over as ConflictException).getResponse()).toMatchObject({
      code: 'REFUND_EXCEEDS_PAYMENT',
    });

    const rest = await refund(totalMinor - 2000n);
    expect(rest.refund.status).toBe('succeeded');
    expect(rest.payment.status).toBe('refunded');

    const unbalanced = await prisma.$queryRaw<Array<{ entry_group: string }>>`
      SELECT entry_group FROM ledger_entries
      GROUP BY entry_group, currency
      HAVING SUM(CASE WHEN direction = 'debit' THEN amount_minor ELSE -amount_minor END) <> 0
    `;
    expect(unbalanced).toEqual([]);
  });
});
