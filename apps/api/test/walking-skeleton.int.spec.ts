import 'reflect-metadata';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
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
  // `rawBody: true` exactly like main.ts: webhook signatures are checked on the raw bytes.
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  configureApp(app); // raw-body parser + URI versioning + global exception filter — same as main.ts
  server = await listenOnLoopback(app);

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

async function wallet(
  ownerType: 'restaurant' | 'courier',
  ownerId: string,
): Promise<{ pending: bigint; available: bigint }> {
  const row = await prisma.walletBalanceRow.findUnique({
    where: { ownerType_ownerId_currency: { ownerType, ownerId, currency: 'XAF' } },
  });
  return { pending: row?.pendingMinor ?? 0n, available: row?.availableMinor ?? 0n };
}

/** The order follows delivery events (`@OnEvent`, after the response): wait up to 5 s for `want`. */
async function orderStatus(orderId: string, want?: string): Promise<string> {
  let status = '';
  for (let i = 0; i < 50; i++) {
    status = (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;
    if (!want || status === want) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return status;
}

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
    // The courier is no longer chosen at order time: dispatch (`deliveries`)
    // offers the delivery once the order is ready (docs/25). The seeded courier
    // is the one this flow expects to be assigned.
    expect(order.courierId).toBeUndefined();
    expect(order.items[0].options ?? order.items[1].options).toBeDefined(); // option snapshot present (docs/22 §9)
    const orderId: string = order.id;
    const courierId: string = (
      await prisma.user.findFirstOrThrow({ where: { phone: COURIER_PHONE }, select: { id: true } })
    ).id;

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

    // Wallets before this order (other suites may have used the same accounts).
    const restaurantBefore = await wallet('restaurant', fx.restaurantId);
    const courierBefore = await wallet('courier', courierId);

    // ── 2. initiate a mock payment — pending_then_succeed, so the webhook does the work ──
    const paymentIdemKey = `int-payment-${randomUUID()}`;
    const createPaymentRes = await request(server)
      .post('/v1/payments')
      .set('Authorization', `Bearer ${customerAccess}`)
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
    const stillAwaiting = await request(server)
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerAccess}`)
      .expect(200);
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

    // ── 4. payment succeeded -> order placed (via the in-process event, which
    //      runs just after the webhook response: wait for it, up to 5 s) ──
    await orderStatus(orderId, 'placed');
    const paidOrder = await request(server)
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerAccess}`)
      .expect(200);
    expect(paidOrder.body.status).toBe('placed');
    const paidPayment = await request(server)
      .get(`/v1/payments/${paymentId}`)
      .set('Authorization', `Bearer ${customerAccess}`)
      .expect(200);
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
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0)::bigint  AS debit,
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0)::bigint AS credit
      FROM ledger_entries WHERE entry_group = ${accrualGroup!.id}::uuid
    `;
    expect(accrualSums[0]!.debit).toBe(accrualSums[0]!.credit); // Σdebit === Σcredit

    // ── 6. wallet PENDING: the restaurant's share is pending at once; the
    //      courier's fee waits in the pool until a courier accepts (docs/25 §12) ──
    expect((await wallet('restaurant', fx.restaurantId)).pending - restaurantBefore.pending).toBe(
      3600n,
    ); // subtotal(4500) - commission(900)
    expect((await wallet('courier', courierId)).pending - courierBefore.pending).toBe(0n);

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

    // The seeded courier is online, next to the restaurant, before the order is ready.
    const pickup = (
      await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
        SELECT ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng
        FROM restaurants WHERE id = ${fx.restaurantId}::uuid
      `
    )[0]!;
    await request(server)
      .post('/v1/couriers/me/status')
      .set('Authorization', `Bearer ${courierAccess}`)
      .send({ status: 'online' })
      .expect((r) => expect([200, 201]).toContain(r.status));
    await request(server)
      .post('/v1/couriers/me/location')
      .set('Authorization', `Bearer ${courierAccess}`)
      .send({ lat: pickup.lat + 0.001, lng: pickup.lng, accuracyM: 10 })
      .expect((r) => expect([200, 201, 204]).toContain(r.status));

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

    // ── 8. delivery: dispatch offers it to the courier -> accept -> pickup -> deliver
    //      with the code the customer gives at the door (docs/25, docs/36) ──
    let offer: { deliveryId: string } | null = null;
    for (let i = 0; i < 50 && !offer; i++) {
      const delivery = await prisma.delivery.findUnique({
        where: { orderId },
        select: { id: true },
      });
      offer = delivery
        ? await prisma.deliveryOffer.findFirst({
            where: { courierId, status: 'offered', deliveryId: delivery.id },
            select: { deliveryId: true },
          })
        : null;
      if (!offer) await new Promise((r) => setTimeout(r, 100));
    }
    expect(offer).not.toBeNull();
    const deliveryId = offer!.deliveryId;

    await request(server)
      .post(`/v1/deliveries/${deliveryId}/accept`)
      .set('Authorization', `Bearer ${courierAccess}`)
      .set('idempotency-key', `int-accept-${randomUUID()}`)
      .expect(200);
    expect(await orderStatus(orderId, 'courier_assigned')).toBe('courier_assigned');
    // The pooled fee is now this courier's (pending until delivered).
    expect((await wallet('courier', courierId)).pending - courierBefore.pending).toBe(1000n); // courierFee === deliveryFee (A5)

    await request(server)
      .post(`/v1/deliveries/${deliveryId}/pickup`)
      .set('Authorization', `Bearer ${courierAccess}`)
      .set('idempotency-key', `int-pickup-${randomUUID()}`)
      .expect(200);
    expect(await orderStatus(orderId, 'on_the_way')).toBe('on_the_way');

    const proofCode = (
      await request(server)
        .get(`/v1/deliveries/${deliveryId}/code`)
        .set('Authorization', `Bearer ${customerAccess}`)
        .expect(200)
    ).body.code as string;

    const deliveredIdemKey = `int-delivered-${randomUUID()}`;
    const deliveredRes = await request(server)
      .post(`/v1/deliveries/${deliveryId}/deliver`)
      .set('Authorization', `Bearer ${courierAccess}`)
      .set('idempotency-key', deliveredIdemKey)
      .send({ proofCode })
      .expect(200);
    expect(deliveredRes.body.delivery.status).toBe('delivered');
    expect(await orderStatus(orderId, 'delivered')).toBe('delivered');

    // Idempotent replay: funds must NOT be released twice.
    const deliveredReplayRes = await request(server)
      .post(`/v1/deliveries/${deliveryId}/deliver`)
      .set('Authorization', `Bearer ${courierAccess}`)
      .set('idempotency-key', deliveredIdemKey)
      .send({ proofCode })
      .expect(200);
    expect(deliveredReplayRes.body.status).toBe('replayed');
    expect(deliveredReplayRes.body.delivery.status).toBe('delivered');

    // ── 9. funds_available must be balanced, and wallet AVAILABLE now holds the shares ──
    const releaseGroup = await prisma.ledgerEntryGroup.findUnique({
      where: { idempotencyKey: `delivery:${deliveryId}:funds_available` },
    });
    expect(releaseGroup?.kind).toBe('funds_available');
    const releaseSums = await prisma.$queryRaw<Array<{ debit: bigint; credit: bigint }>>`
      SELECT
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0)::bigint  AS debit,
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0)::bigint AS credit
      FROM ledger_entries WHERE entry_group = ${releaseGroup!.id}::uuid
    `;
    expect(releaseSums[0]!.debit).toBe(releaseSums[0]!.credit);

    const restaurantAfter = await wallet('restaurant', fx.restaurantId);
    const courierAfter = await wallet('courier', courierId);
    expect(restaurantAfter.available - restaurantBefore.available).toBe(3600n);
    expect(courierAfter.available - courierBefore.available).toBe(1000n);
    // A second `deliver` call did not double-release funds: pending is back to where it was.
    expect(restaurantAfter.pending).toBe(restaurantBefore.pending);
    expect(courierAfter.pending).toBe(courierBefore.pending);

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
