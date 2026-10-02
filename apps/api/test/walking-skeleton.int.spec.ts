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
const COURIER_PHONE = '+23566000002'; // seeded "Livreur Test"
// "Staff Restaurant Test" — scoped to 'chez-fatime' (Bloc 9, docs/30 §restaurant-scope).
const RESTAURANT_STAFF_PHONE = '+23566000004';

/** Drives a full OTP login for a seeded phone number via real HTTP calls (same as identity.int.spec.ts). */
async function loginViaOtp(
  server: Server,
  redis: RedisService,
  phone: string,
): Promise<{ access: string }> {
  await request(server).post('/v1/auth/otp/request').send({ phone, purpose: 'login' }).expect(202);
  const code = await redis.client.get(mockOtpKey(phone));
  if (!code)
    throw new Error(`No mock OTP code found for ${phone} — did MockOtpDeliveryProvider run?`);
  const res = await request(server)
    .post('/v1/auth/otp/verify')
    .send({ phone, code, purpose: 'login' })
    .expect(200);
  return { access: (res.body as { access: string }).access };
}

/**
 * The Bloc 0.5 walking-skeleton end-to-end flow (docs/18 §21, §28): real
 * Postgres + Redis (`pnpm infra:up`, migrations applied, `pnpm db:seed` run
 * first — see test/README.md). Drives the HTTP surface exactly like a real
 * client would, then asserts the ledger/wallet projections directly against
 * the database — the thing a pure HTTP assertion can't see.
 *
 * catalogue -> order (no client price) -> mock payment (pending) -> signed
 * webhook -> payment succeeded -> order placed -> order_accrual balanced ->
 * wallet pending -> confirm/ready -> delivery assign/pickup/deliver ->
 * funds_available balanced -> wallet available -> outbox rows -> idempotency
 * (order create, payment create, webhook duplicate) -> invalid signature.
 */

let app: NestFastifyApplication;
let prisma: PrismaService;
let redis: RedisService;
let server: Server;
let customerAccess: string;
let courierAccess: string;
let restaurantStaffAccess: string;

interface Fixtures {
  customerId: string;
  restaurantId: string;
  pouletId: string;
  /** "Entier" — the zero price-delta choice in Poulet braisé's required "Portion" group (docs/20 seed), so the flow's existing subtotal assertions (3500 for poulet) stay exact. */
  pouletPortionEntierOptionId: string;
  fritesId: string;
}
let fx: Fixtures;

async function loadFixtures(): Promise<Fixtures> {
  const customer = await prisma.user.findFirst({ where: { phone: CUSTOMER_PHONE } });
  const restaurant = await prisma.restaurant.findFirst({ where: { slug: 'chez-fatime' } });
  if (!customer || !restaurant) {
    throw new Error(
      'Bloc 0.5 seed fixtures not found — run `pnpm --filter @djafat/api run db:seed` before `test:int`.',
    );
  }
  const poulet = await prisma.product.findFirstOrThrow({
    where: { restaurantId: restaurant.id, name: 'Poulet braisé' },
  });
  const frites = await prisma.product.findFirstOrThrow({
    where: { restaurantId: restaurant.id, name: 'Frites' },
  });
  const portionGroup = await prisma.productOptionGroup.findFirstOrThrow({
    where: { productId: poulet.id, name: 'Portion' },
  });
  const entier = await prisma.productOption.findFirstOrThrow({
    where: { optionGroupId: portionGroup.id, name: 'Entier' },
  });
  return {
    customerId: customer.id,
    restaurantId: restaurant.id,
    pouletId: poulet.id,
    pouletPortionEntierOptionId: entier.id,
    fritesId: frites.id,
  };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  configureApp(app); // raw-body parser + URI versioning + global exception filter — same as main.ts
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  server = app.getHttpAdapter().getInstance().server as unknown as Server;

  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
  fx = await loadFixtures();
  ({ access: customerAccess } = await loginViaOtp(server, redis, CUSTOMER_PHONE));
  ({ access: courierAccess } = await loginViaOtp(server, redis, COURIER_PHONE));
  ({ access: restaurantStaffAccess } = await loginViaOtp(server, redis, RESTAURANT_STAFF_PHONE));
});

afterAll(async () => {
  await app.close();
});

describe('system', () => {
  it('GET /v1/health is always ok', async () => {
    const res = await request(server).get('/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'djafat-api' });
  });

  it('GET /v1/ready reports postgres + redis reachable', async () => {
    const res = await request(server).get('/v1/ready').expect(200);
    expect(res.body).toMatchObject({
      status: 'ready',
      checks: { postgres: { ok: true }, redis: { ok: true } },
    });
  });
});

describe('walking skeleton — full flow', () => {
  it('runs catalogue -> cart -> quote -> order -> payment -> webhook -> delivery -> funds_available end to end', async () => {
    // ── 1. build the cart (docs/22 §3-§6) — the client supplies references and
    // choices only, options are validated server-side, prices are never trusted ──
    await request(server)
      .post('/v1/carts/items')
      .set('Authorization', `Bearer ${customerAccess}`)
      .send({
        productId: fx.pouletId,
        quantity: 1, // 3500
        selectedOptionIds: [fx.pouletPortionEntierOptionId], // "Entier" — 0 delta, required group
      })
      .expect(201);
    await request(server)
      .post('/v1/carts/items')
      .set('Authorization', `Bearer ${customerAccess}`)
      .send({ productId: fx.fritesId, quantity: 1, selectedOptionIds: [] }) // 1000, "Sauce" is optional
      .expect(201);

    // ── 2. a live quote (docs/22 §8) — never persisted, never trusted back ──
    const quoteRes = await request(server)
      .post('/v1/carts/quote')
      .set('Authorization', `Bearer ${customerAccess}`)
      .expect(201);
    expect(quoteRes.body.subtotal).toEqual({ minor: '4500', currency: 'XAF' });
    expect(quoteRes.body.total).toEqual({ minor: '5500', currency: 'XAF' });

    // ── 3. create the order FROM the cart — the body carries nothing at all ──
    const orderIdemKey = `int-order-${randomUUID()}`;
    const createOrderRes = await request(server)
      .post('/v1/orders')
      .set('Authorization', `Bearer ${customerAccess}`)
      .set('idempotency-key', orderIdemKey)
      .send({})
      .expect(201);

    expect(createOrderRes.body.status).toBe('created');
    const order = createOrderRes.body.order;
    expect(order.status).toBe('awaiting_payment');
    expect(order.subtotal).toEqual({ minor: '4500', currency: 'XAF' });
    expect(order.deliveryFee).toEqual({ minor: '1000', currency: 'XAF' }); // seeded flat fee
    expect(order.commissionBps).toBe(2000); // seeded 20% country rule
    expect(order.commission).toEqual({ minor: '900', currency: 'XAF' }); // 20% of 4500
    expect(order.courierFee).toEqual(order.deliveryFee); // decision A5, structural
    expect(order.total).toEqual({ minor: '5500', currency: 'XAF' }); // 4500 + 1000
    expect(order.courierId).toEqual(expect.any(String)); // single seeded courier resolved
    expect(order.items[0].options ?? order.items[1].options).toBeDefined(); // option snapshot present (docs/22 §9)
    const orderId: string = order.id;
    const courierId: string = order.courierId;

    // ── idempotency: replaying the SAME key must return the SAME order — the
    // cart is already `converted` by now, proving the replay short-circuits
    // before ever touching it again ──
    const replayOrderRes = await request(server)
      .post('/v1/orders')
      .set('Authorization', `Bearer ${customerAccess}`)
      .set('idempotency-key', orderIdemKey)
      .send({})
      .expect(201);
    expect(replayOrderRes.body.status).toBe('replayed');
    expect(replayOrderRes.body.order.id).toBe(orderId);

    // ── 2. initiate a mock payment — pending_then_succeed, so the webhook does the work ──
    const paymentIdemKey = `int-payment-${randomUUID()}`;
    const createPaymentRes = await request(server)
      .post('/v1/payments')
      .set('idempotency-key', paymentIdemKey)
      .send({
        orderId,
        providerCode: 'mock',
        methodCode: 'mobile_money',
        metadata: { mockOutcome: 'pending_then_succeed' },
      })
      .expect(201);

    expect(createPaymentRes.body.status).toBe('created');
    const payment = createPaymentRes.body.payment;
    expect(payment.status).toBe('pending');
    expect(payment.amount).toEqual(order.total); // server-authoritative — never client-supplied
    expect(payment.providerRef).toEqual(expect.any(String));
    const paymentId: string = payment.id;
    const providerRef: string = payment.providerRef;

    // Order is still awaiting_payment — nothing happens until the webhook lands.
    const stillAwaiting = await request(server).get(`/v1/orders/${orderId}`).expect(200);
    expect(stillAwaiting.body.status).toBe('awaiting_payment');

    // ── 3. the signed webhook resolves the payment ──
    const webhookBody = JSON.stringify({
      eventId: `evt-${randomUUID()}`,
      providerRef,
      status: 'succeeded',
      amountMinor: order.total.minor,
      currency: order.total.currency,
    });
    const signature = MockPaymentProvider.sign(webhookBody);

    await request(server)
      .post('/v1/payments/webhook/mock')
      .set('content-type', 'application/json')
      .set('x-mock-signature', signature)
      .send(webhookBody)
      .expect(200)
      .expect({ status: 'ok' });

    // ── 4. payment succeeded -> order placed (via the in-process event) ──
    const paidOrder = await request(server).get(`/v1/orders/${orderId}`).expect(200);
    expect(paidOrder.body.status).toBe('placed');
    const paidPayment = await request(server).get(`/v1/payments/${paymentId}`).expect(200);
    expect(paidPayment.body.status).toBe('succeeded');

    // ── duplicate webhook (same eventId+providerRef) must be a pure no-op ──
    await request(server)
      .post('/v1/payments/webhook/mock')
      .set('content-type', 'application/json')
      .set('x-mock-signature', signature)
      .send(webhookBody)
      .expect(200)
      .expect({ status: 'duplicate' });

    // ── invalid signature must be rejected, never silently accepted ──
    const badWebhookRes = await request(server)
      .post('/v1/payments/webhook/mock')
      .set('content-type', 'application/json')
      .set('x-mock-signature', 'not-a-valid-signature')
      .send(JSON.stringify({ eventId: `evt-${randomUUID()}`, providerRef, status: 'succeeded' }))
      .expect(401);
    expect(badWebhookRes.body.error.code).toBe('UNAUTHENTICATED');

    // ── 5. order_accrual must be balanced, and posted exactly once ──
    const accrualGroup = await prisma.ledgerEntryGroup.findUnique({
      where: { idempotencyKey: `payment:${paymentId}` },
    });
    expect(accrualGroup?.kind).toBe('order_accrual');
    const accrualSums = await prisma.$queryRaw<Array<{ debit: bigint; credit: bigint }>>`
      SELECT
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0)  AS debit,
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0) AS credit
      FROM ledger_entries WHERE entry_group = ${accrualGroup!.id}::uuid
    `;
    expect(accrualSums[0]!.debit).toBe(accrualSums[0]!.credit); // Σdebit === Σcredit

    // ── 6. wallet PENDING reflects the restaurant/courier shares (docs/08 §8.9) ──
    const restaurantWalletPending = await prisma.walletBalanceRow.findUnique({
      where: {
        ownerType_ownerId_currency: {
          ownerType: 'restaurant',
          ownerId: fx.restaurantId,
          currency: 'XAF',
        },
      },
    });
    expect(restaurantWalletPending?.pendingMinor).toBe(3600n); // subtotal(4500) - commission(900)
    const courierWalletPending = await prisma.walletBalanceRow.findUnique({
      where: {
        ownerType_ownerId_currency: { ownerType: 'courier', ownerId: courierId, currency: 'XAF' },
      },
    });
    expect(courierWalletPending?.pendingMinor).toBe(1000n); // courierFee === deliveryFee (A5)

    // ── 7. restaurant confirms + marks ready (Bloc 9, docs/30 §order-authorization,
    //      Phase 5 adversarial matrix) — rejected BEFORE the legitimate call, against
    //      the SAME real order, still sitting in 'placed': ──
    await request(server).post(`/v1/orders/${orderId}/confirm`).expect(401); // anonymous
    await request(server)
      .post(`/v1/orders/${orderId}/confirm`)
      .set('Authorization', `Bearer ${customerAccess}`)
      .expect(403); // the customer who placed it is not restaurant staff
    await request(server)
      .post(`/v1/orders/${orderId}/confirm`)
      .set('Authorization', `Bearer ${courierAccess}`)
      .expect(403); // a courier role never confirms an order

    await request(server)
      .post(`/v1/orders/${orderId}/confirm`)
      .set('Authorization', `Bearer ${restaurantStaffAccess}`)
      .expect(200);

    await request(server).post(`/v1/orders/${orderId}/ready`).expect(401); // anonymous
    await request(server)
      .post(`/v1/orders/${orderId}/ready`)
      .set('Authorization', `Bearer ${customerAccess}`)
      .expect(403);
    const readyRes = await request(server)
      .post(`/v1/orders/${orderId}/ready`)
      .set('Authorization', `Bearer ${restaurantStaffAccess}`)
      .expect(200);
    expect(readyRes.body.status).toBe('ready');

    // ── 8. delivery: assign -> picked-up -> delivered ──
    const deliveryIdemKey = `int-delivery-${randomUUID()}`;
    const assignRes = await request(server)
      .post('/v1/deliveries')
      .set('idempotency-key', deliveryIdemKey)
      .send({ orderId })
      .expect(201);
    expect(assignRes.body.delivery.status).toBe('assigned');
    expect(assignRes.body.delivery.courierId).toBe(courierId);
    expect((await request(server).get(`/v1/orders/${orderId}`).expect(200)).body.status).toBe(
      'courier_assigned',
    );

    await request(server)
      .post(`/v1/deliveries/${orderId}/picked-up`)
      .set('idempotency-key', `int-pickup-${randomUUID()}`)
      .expect(200);
    expect((await request(server).get(`/v1/orders/${orderId}`).expect(200)).body.status).toBe(
      'on_the_way',
    );

    const deliveredIdemKey = `int-delivered-${randomUUID()}`;
    const deliveredRes = await request(server)
      .post(`/v1/deliveries/${orderId}/delivered`)
      .set('idempotency-key', deliveredIdemKey)
      .expect(200);
    expect(deliveredRes.body.delivery.status).toBe('delivered');
    expect((await request(server).get(`/v1/orders/${orderId}`).expect(200)).body.status).toBe(
      'delivered',
    );

    // Idempotent replay: funds must NOT be released twice.
    const deliveredReplayRes = await request(server)
      .post(`/v1/deliveries/${orderId}/delivered`)
      .set('idempotency-key', deliveredIdemKey)
      .expect(200);
    expect(deliveredReplayRes.body.delivery.status).toBe('delivered');

    // ── 9. funds_available must be balanced, and wallet AVAILABLE now holds the shares ──
    const deliveryRow = await prisma.delivery.findUniqueOrThrow({ where: { orderId } });
    const releaseGroup = await prisma.ledgerEntryGroup.findUnique({
      where: { idempotencyKey: `delivery:${deliveryRow.id}:funds_available` },
    });
    expect(releaseGroup?.kind).toBe('funds_available');
    const releaseSums = await prisma.$queryRaw<Array<{ debit: bigint; credit: bigint }>>`
      SELECT
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0)  AS debit,
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0) AS credit
      FROM ledger_entries WHERE entry_group = ${releaseGroup!.id}::uuid
    `;
    expect(releaseSums[0]!.debit).toBe(releaseSums[0]!.credit);

    const restaurantWalletFinal = await prisma.walletBalanceRow.findUnique({
      where: {
        ownerType_ownerId_currency: {
          ownerType: 'restaurant',
          ownerId: fx.restaurantId,
          currency: 'XAF',
        },
      },
    });
    expect(restaurantWalletFinal).toMatchObject({ pendingMinor: 0n, availableMinor: 3600n });
    const courierWalletFinal = await prisma.walletBalanceRow.findUnique({
      where: {
        ownerType_ownerId_currency: { ownerType: 'courier', ownerId: courierId, currency: 'XAF' },
      },
    });
    expect(courierWalletFinal).toMatchObject({ pendingMinor: 0n, availableMinor: 1000n });

    // A second `delivered` call did not double-release funds: pending is 0, not negative.
    expect(restaurantWalletFinal!.pendingMinor).toBe(0n);
    expect(courierWalletFinal!.pendingMinor).toBe(0n);

    // ── 10. the outbox carries the full event trail (relayed to Redis by the worker) ──
    const outboxTypes = (
      await prisma.outbox.findMany({ where: { aggregateId: orderId }, select: { eventType: true } })
    ).map((r) => r.eventType);
    for (const expected of [
      'order.awaiting_payment',
      'order.placed',
      'order.confirmed',
      'order.preparing',
      'order.ready',
      'order.courier_assigned',
      'order.picked_up',
      'order.on_the_way',
      'order.delivered',
    ]) {
      expect(outboxTypes).toContain(expected);
    }
    const paymentOutbox = await prisma.outbox.findMany({
      where: { aggregateId: paymentId },
      select: { eventType: true },
    });
    expect(paymentOutbox.map((r) => r.eventType)).toContain('payment.succeeded');
  });
});
