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
import { keepRestaurantOpen } from './open-restaurant.helper';

const CUSTOMER_PHONE = '+23566000001'; // seeded (apps/api/prisma/seed.ts)
const COURIER_PHONE = '+23566000002'; // seeded "Livreur Test"
// "Staff Restaurant Test" — scoped to 'chez-fatime' (Bloc 9, docs/30 §restaurant-scope).
const RESTAURANT_STAFF_PHONE = '+23566000004';

/** Drives a full OTP login for a seeded phone number via real HTTP calls (same as identity.int.spec.ts). */
async function loginViaOtp(
  server: Server,
  redis: RedisService,
  phone: string,
): Promise<{ access: string; userId: string }> {
  await request(server).post('/v1/auth/otp/request').send({ phone, purpose: 'login' }).expect(202);
  const code = await redis.client.get(mockOtpKey(phone));
  if (!code)
    throw new Error(`No mock OTP code found for ${phone} — did MockOtpDeliveryProvider run?`);
  const res = await request(server)
    .post('/v1/auth/otp/verify')
    .send({ phone, code, purpose: 'login' })
    .expect(200);
  const body = res.body as { access: string; user: { id: string } };
  return { access: body.access, userId: body.user.id };
}

/**
 * Poll until `read()` returns something truthy, or fail after `timeoutMs`.
 *
 * Dispatch is triggered by `@OnEvent('order.ready')` (deliveries.service.ts)
 * and `EventEmitter2.emit` does NOT await async listeners, so the offer is
 * created shortly AFTER `POST /orders/:id/ready` has already answered 200.
 * Polling is the honest way to observe that — a fixed sleep would either be
 * flaky or slow.
 */
async function waitFor<T>(
  read: () => Promise<T | undefined | null>,
  what: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline)
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
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
let courierUserId: string;
let restaurantStaffAccess: string;
/** Set by `beforeAll` — see `keepRestaurantOpen` (BUG-PAY-INT-7). */
let restoreHours: () => Promise<void>;

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
  // BUG-PAY-INT-14 — `rawBody: true` is part of the app's PRODUCTION shape and
  // has to be part of the test's too.
  //
  // Webhook signatures HMAC the bytes as sent (docs/08 §8.6), so
  // `verifyAndParseWebhook` reads `req.rawBody` — attached by Nest's own JSON
  // parser only when the app is created with `rawBody: true`, which `main.ts`
  // passes to `NestFactory.create` and which `configureApp` deliberately does
  // NOT do (registering a second `application/json` parser collides with
  // Nest's: `FST_ERR_CTP_ALREADY_PRESENT`). Built without it, `req.rawBody`
  // was undefined here, the HMAC was computed over the wrong bytes and a
  // perfectly valid signature came back 401 — a defect of the harness, not of
  // the product: the same request works against `pnpm dev`. The comment below
  // used to claim `configureApp` supplied the raw-body parser; it never did.
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  configureApp(app); // URI versioning + global exception filter — same as main.ts
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  server = app.getHttpAdapter().getInstance().server as unknown as Server;

  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
  fx = await loadFixtures();
  // The flow COMMITS an order, refused outside opening hours (BUG-PAY-INT-7).
  restoreHours = await keepRestaurantOpen(prisma, fx.restaurantId);
  ({ access: customerAccess } = await loginViaOtp(server, redis, CUSTOMER_PHONE));
  ({ access: courierAccess, userId: courierUserId } = await loginViaOtp(
    server,
    redis,
    COURIER_PHONE,
  ));
  ({ access: restaurantStaffAccess } = await loginViaOtp(server, redis, RESTAURANT_STAFF_PHONE));

  // BUG-PAY-INT-9 (fixture) — free the seeded courier from whatever a previous
  // run (or the pilot, docs/36 §6.3 "six stranded rows") left them attached to.
  //
  // Two invariants, both of which a previous ABORTED run of this very file can
  // leave dangling, and both of which must be cleared or dispatch finds nobody:
  //
  //   - `couriers.active_delivery_id` — what `findEligibleCandidates` filters
  //     on directly;
  //   - `deliveries_one_active_per_courier_idx` (migration 0024), a PARTIAL
  //     unique index on `(courier_id) WHERE status IN (the active statuses)`.
  //     Clearing only the courier row (as this fixture originally did) left a
  //     PREVIOUS run's delivery sitting in `on_the_way` with this courier's id
  //     still on it — itself still "active" by that index's own definition —
  //     so the very next dispatch wave's `UPDATE deliveries SET courier_id =
  //     ...` hit `Unique constraint failed on the fields: (courier_id)` and
  //     `runAssignmentTransaction` swallowed it as "lost to a concurrent
  //     writer", leaving the NEW delivery stuck in `searching_courier` forever
  //     — indistinguishable from outside the process from dispatch finding no
  //     candidate at all. The index itself is correct (docs/25 §B6.1); a test
  //     run that died mid-delivery is the "buggy caller" it was built to
  //     survive, and surviving it still means a human has to clear the row —
  //     which is what this fixture now does on the test's behalf.
  await prisma.$executeRaw`
    UPDATE deliveries SET status = 'cancelled', cancelled_at = now(),
           cancelled_reason = 'test-fixture: released from a previous aborted run',
           courier_id = NULL
    WHERE courier_id = ${courierUserId}::uuid
      AND status IN ('courier_assigned', 'courier_accepted', 'pickup_in_progress', 'picked_up', 'on_the_way')
  `;
  await prisma.$executeRaw`
    UPDATE couriers SET status = 'offline', active_delivery_id = NULL WHERE user_id = ${courierUserId}::uuid
  `;
});

afterAll(async () => {
  await restoreHours?.();
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
    // ── 0. snapshot the money this flow is about to move ──
    //
    // Every ledger/wallet assertion below is a DELTA against this snapshot
    // (BUG-PAY-INT-12b): the integration database is long-lived, so the
    // seeded restaurant and courier already carry whatever previous runs put
    // in their wallets, and an absolute expectation can only ever be right
    // once. Read BEFORE anything happens, with the same helpers used later.
    const walletRowOf = async (
      ownerType: 'restaurant' | 'courier',
      ownerId: string,
    ): Promise<{ pending: bigint; available: bigint }> => {
      const row = await prisma.walletBalanceRow.findUnique({
        where: { ownerType_ownerId_currency: { ownerType, ownerId, currency: 'XAF' } },
      });
      return { pending: row?.pendingMinor ?? 0n, available: row?.availableMinor ?? 0n };
    };
    /**
     * Signed balance of one ledger ACCOUNT, debit-positive.
     *
     * `ledger_entries` carries `account_id`, not the string account ref — the
     * ref (`COURIER_FEE_POOL`, `COURIER_PAYABLE:<uuid>`) is resolved to a row
     * in `ledger_accounts` by the repository, so reading it back means the
     * same join, by `code` (the pool is un-owned, one row, no owner suffix).
     */
    const accountBalance = async (code: string): Promise<bigint> => {
      // Normalised through `BigInt(...)`: the driver can hand a `::bigint`
      // aggregate back as a plain number, and mixing the two silently turns
      // every delta below into a false comparison (`-1000 !== -1000n`).
      const rows = await prisma.$queryRaw<Array<{ balance: bigint | number | string }>>`
        SELECT COALESCE(
                 SUM(CASE WHEN e.direction = 'debit' THEN e.amount_minor ELSE -e.amount_minor END), 0
               ) AS balance
        FROM ledger_entries e
        JOIN ledger_accounts a ON a.id = e.account_id
        WHERE a.code = ${code}
      `;
      return BigInt(rows[0]!.balance);
    };
    const restaurantWalletBefore = await walletRowOf('restaurant', fx.restaurantId);
    const courierWalletBefore = await walletRowOf('courier', courierUserId);
    const poolAtStart = await accountBalance('COURIER_FEE_POOL');

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
    expect(order.items[0].options ?? order.items[1].options).toBeDefined(); // option snapshot present (docs/22 §9)
    const orderId: string = order.id;

    // BUG-PAY-INT-10 — there is no courier at order creation any more, and
    // there should not be. This asserted `order.courierId` was a string,
    // "single seeded courier resolved": true of the Bloc 0.5 skeleton, which
    // picked the one seeded courier as the order was written. Bloc 6
    // (docs/25) replaced that with real dispatch — a delivery, offered to
    // eligible couriers in widening waves, ACCEPTED by one of them — and a
    // courier is attached only once someone accepts, long after creation. The
    // field is no longer in the order payload at all, so the old assertion
    // read `undefined` and compared it to `expect.any(String)`. The suite
    // never ran after Bloc 6, so it kept asserting the Bloc 0.5 contract.
    // Dispatch is driven for real further down (step 8).
    expect(order.courierId).toBeUndefined();

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
    /** The owning customer's own view of the order — the only authorized one. */
    const readOrder = async (): Promise<{ status: string }> =>
      (
        await request(server)
          .get(`/v1/orders/${orderId}`)
          .set('Authorization', `Bearer ${customerAccess}`)
          .expect(200)
      ).body as { status: string };

    /**
     * Wait for an order status the DELIVERY side drives through an event.
     *
     * BUG-PAY-INT-16 — `courier_assigned`, `on_the_way` and `delivered` are
     * applied by `@OnEvent('delivery.*')` reactions in `orders.service.ts`,
     * and `EventEmitter2.emit` does not await async listeners: the courier's
     * HTTP call can answer 200 while the order is still one transition
     * behind. `POST /pickup` is the clearest case — its listener performs TWO
     * transitions (`picked_up` then `on_the_way`), so a single read right
     * after the response legitimately sees `picked_up` and the old
     * `toBe('on_the_way')` failed on a system that was working correctly.
     * Waiting asserts the same end state without encoding a race.
     */
    const waitForOrderStatus = (status: string): Promise<{ status: string }> =>
      waitFor(async () => {
        const order = await readOrder();
        return order.status === status ? order : undefined;
      }, `order ${orderId} to reach "${status}"`);

    // BUG-PAY-INT-11 — these calls were ANONYMOUS and the endpoints are not.
    // `POST /v1/payments` is `@RequireAuth() @RequireRole('customer')` plus an
    // ownership check on the order being paid (closing docs/19 D-15, which
    // recorded it as "was unauthenticated"), and `GET /v1/orders/:id` /
    // `GET /v1/payments/:id` were tenant-scoped by BUG-10.1.x. Written when
    // all three were open, never run since they were closed: every one of
    // them would now answer 401. Driving them with the OWNER's token is also
    // what a real client does.
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

    // ── 4. payment succeeded -> order placed (via the in-process event) ──
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
    // BUG-PAY-INT-15 — `SUM(bigint)` is `numeric` in Postgres, which Prisma
    // hands back as a `Decimal` OBJECT. `toBe` is `Object.is`, so this
    // compared two distinct objects and failed on values that were equal
    // ("expected 5500 to be 5500 ... serializes to the same string"). The
    // `::bigint` casts make both sides real BigInts, where
    // `Object.is(5500n, 5500n)` is true and the assertion means what it says.
    const accrualSums = await prisma.$queryRaw<Array<{ debit: bigint; credit: bigint }>>`
      SELECT
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0)::bigint  AS debit,
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0)::bigint AS credit
      FROM ledger_entries WHERE entry_group = ${accrualGroup!.id}::uuid
    `;
    expect(accrualSums[0]!.debit).toBe(accrualSums[0]!.credit);
    expect(accrualSums[0]!.debit).toBeGreaterThan(0n); // and it really posted // Σdebit === Σcredit

    // ── 6. wallet PENDING reflects the restaurant share; the courier's sits in
    //      the un-owned pool, because no courier exists yet (docs/25 §B6.1-3) ──
    //
    // BUG-PAY-INT-12 — this asserted `courier` wallet pending === 1000 right
    // after payment. In a PREPAID flow the payment always succeeds before
    // `ready`, so dispatch has not run and `buildOrderAccrualEntries` credits
    // the un-owned `COURIER_FEE_POOL` rather than `COURIER_PAYABLE:<id>`
    // (accrual-entries.ts) — there is no courier to name. The 1000 is moved to
    // the courier at ACCEPTANCE by `buildCourierFeeReclassificationEntries`,
    // which is asserted below once a courier has actually accepted. The old
    // expectation described the Bloc 0.5 world where the order knew its
    // courier from creation.
    // BUG-PAY-INT-12b — assert DELTAS, never absolute wallet totals.
    //
    // `wallet_balances` is one running row per owner, and the integration
    // database is long-lived: the seeded restaurant accumulates 3600 for every
    // order this flow has ever completed. `expect(availableMinor).toBe(3600n)`
    // is therefore true on the first execution of this suite and false on
    // every one after it — a test that passes once is not a test. The deltas
    // below are exactly as strong (3600 arrived, 1000 arrived, nothing else
    // did) and hold on run number 50.
    const walletOf = walletRowOf;
    const balanceOfAccount = accountBalance;

    const restaurantAfterAccrual = await walletOf('restaurant', fx.restaurantId);
    expect(restaurantAfterAccrual.pending - restaurantWalletBefore.pending).toBe(3600n); // subtotal(4500) - commission(900)
    expect(restaurantAfterAccrual.available - restaurantWalletBefore.available).toBe(0n); // nothing released yet

    // The courier's share is parked, not lost: the pool took a 1000 credit for
    // THIS order (a liability, hence negative under debit-positive signing),
    // and no courier wallet moved, because no courier exists yet.
    const poolBeforeAccept = await balanceOfAccount('COURIER_FEE_POOL');
    expect(poolBeforeAccept - poolAtStart).toBe(-1000n);
    const courierAfterAccrual = await walletOf('courier', courierUserId);
    expect(courierAfterAccrual.pending - courierWalletBefore.pending).toBe(0n);

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

    // ── 7b. make the seeded courier DISPATCHABLE, through the real courier
    //      endpoints, BEFORE `ready` fires dispatch ──
    //
    // `findEligibleCandidates` (couriers.service.ts) takes only couriers that
    // are `online`, carry no `active_delivery_id`, and have a location newer
    // than `courier_location_stale_seconds` (120 s) within the dispatch radius
    // (3 km first wave) of the restaurant's own `geom`. A seeded courier
    // satisfies none of that by default — offline, with no position — so
    // dispatch would correctly find nobody.
    const pickup = await prisma.$queryRaw<Array<{ lat: number | null; lng: number | null }>>`
      SELECT ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng
      FROM restaurants WHERE id = ${fx.restaurantId}::uuid
    `;
    const pickupPoint = pickup[0];
    if (!pickupPoint?.lat || !pickupPoint?.lng) {
      throw new Error(
        'Seeded restaurant has no `geom` — dispatch cannot compute candidates (seed.ts).',
      );
    }
    await request(server)
      .post('/v1/couriers/me/status')
      .set('Authorization', `Bearer ${courierAccess}`)
      .send({ status: 'online' })
      .expect(201);
    await request(server)
      .post('/v1/couriers/me/location')
      .set('Authorization', `Bearer ${courierAccess}`)
      // Right at the pickup point — distance is not what this flow tests.
      .send([{ lat: pickupPoint.lat, lng: pickupPoint.lng }])
      .expect(201);

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

    // ── 8. delivery: offer -> accept -> pickup -> deliver (with proof code) ──
    //
    // BUG-PAY-INT-13 — this whole section drove endpoints that no longer
    // exist. It called an admin-only `POST /v1/deliveries` anonymously and
    // expected 201 plus an already-`assigned` delivery, then
    // `POST /v1/deliveries/{ORDER id}/picked-up` and `/delivered` — also
    // anonymously. The real Bloc 6/11 contract is:
    //
    //   `order.ready` -> automatic dispatch (@OnEvent, deliveries.service.ts)
    //   -> a `DeliveryOffer` to one eligible courier
    //   -> `POST /v1/deliveries/:deliveryId/accept` (the courier's own token)
    //   -> `/pickup` -> `/deliver` carrying the customer's 4-digit proof code,
    //
    // every one of them keyed by the DELIVERY id, authenticated, and
    // idempotency-keyed. `POST /v1/deliveries` survives only as an admin
    // re-dispatch trigger answering 202. Driving the real path is also what
    // lets this test prove what the unit suites cannot: that dispatch, the
    // offer, the ownership guards, the proof code and the ledger release are
    // wired together exactly as `app.module.ts` assembles them.
    const offer = await waitFor(async () => {
      const res = await request(server)
        .get('/v1/couriers/me/offers')
        .set('Authorization', `Bearer ${courierAccess}`)
        .expect(200);
      return (res.body as Array<{ deliveryId: string }>)[0];
    }, 'the dispatch offer to reach the seeded courier');
    const deliveryId = offer.deliveryId;

    const acceptRes = await request(server)
      .post(`/v1/deliveries/${deliveryId}/accept`)
      .set('Authorization', `Bearer ${courierAccess}`)
      .set('idempotency-key', `int-accept-${randomUUID()}`)
      .expect(200);
    expect(acceptRes.body.delivery.courierId).toBe(courierUserId);
    await waitForOrderStatus('courier_assigned');

    // The parked fee is now the COURIER's: the pool was debited and
    // `COURIER_PAYABLE:<id>` credited for the same 1000, so the courier's
    // wallet carries it as pending while the pool returns to where it started
    // (docs/25 §B6.1-3 — "jamais de creation d'argent").
    const courierAfterAccept = await walletOf('courier', courierUserId);
    expect(courierAfterAccept.pending - courierWalletBefore.pending).toBe(1000n); // courierFee === deliveryFee (A5)
    expect(await balanceOfAccount('COURIER_FEE_POOL')).toBe(poolBeforeAccept + 1000n); // pool drained

    await request(server)
      .post(`/v1/deliveries/${deliveryId}/pickup`)
      .set('Authorization', `Bearer ${courierAccess}`)
      .set('idempotency-key', `int-pickup-${randomUUID()}`)
      .expect(200);
    await waitForOrderStatus('on_the_way');

    // The proof code is readable by the OWNING CUSTOMER and by nobody else —
    // least of all the courier, who has to ask them for it (pilot fix, docs/36).
    await request(server)
      .get(`/v1/deliveries/${deliveryId}/code`)
      .set('Authorization', `Bearer ${courierAccess}`)
      .expect(403);
    const codeRes = await request(server)
      .get(`/v1/deliveries/${deliveryId}/code`)
      .set('Authorization', `Bearer ${customerAccess}`)
      .expect(200);
    const proofCode = codeRes.body.code as string;
    expect(proofCode).toMatch(/^[0-9]{4}$/);

    // A wrong code never completes a delivery — that is the whole point of it.
    await request(server)
      .post(`/v1/deliveries/${deliveryId}/deliver`)
      .set('Authorization', `Bearer ${courierAccess}`)
      .set('idempotency-key', `int-deliver-wrong-${randomUUID()}`)
      .send({ proofCode: proofCode === '0000' ? '1111' : '0000' })
      .expect(409);
    expect((await readOrder()).status).toBe('on_the_way'); // unchanged

    const deliveredIdemKey = `int-delivered-${randomUUID()}`;
    const deliveredRes = await request(server)
      .post(`/v1/deliveries/${deliveryId}/deliver`)
      .set('Authorization', `Bearer ${courierAccess}`)
      .set('idempotency-key', deliveredIdemKey)
      .send({ proofCode })
      .expect(200);
    expect(deliveredRes.body.delivery.status).toBe('delivered');
    await waitForOrderStatus('delivered');

    // Idempotent replay: funds must NOT be released twice.
    const deliveredReplayRes = await request(server)
      .post(`/v1/deliveries/${deliveryId}/deliver`)
      .set('Authorization', `Bearer ${courierAccess}`)
      .set('idempotency-key', deliveredIdemKey)
      .send({ proofCode })
      .expect(200);
    expect(deliveredReplayRes.body.delivery.status).toBe('delivered');

    // ── 9. funds_available must be balanced, and wallet AVAILABLE now holds the shares ──
    const deliveryRow = await prisma.delivery.findUniqueOrThrow({ where: { orderId } });
    const releaseGroup = await prisma.ledgerEntryGroup.findUnique({
      where: { idempotencyKey: `delivery:${deliveryRow.id}:funds_available` },
    });
    expect(releaseGroup?.kind).toBe('funds_available');
    // Same `::bigint` casts, same reason — see BUG-PAY-INT-15 above.
    const releaseSums = await prisma.$queryRaw<Array<{ debit: bigint; credit: bigint }>>`
      SELECT
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0)::bigint  AS debit,
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0)::bigint AS credit
      FROM ledger_entries WHERE entry_group = ${releaseGroup!.id}::uuid
    `;
    expect(releaseSums[0]!.debit).toBe(releaseSums[0]!.credit);
    expect(releaseSums[0]!.debit).toBeGreaterThan(0n);

    // PENDING -> AVAILABLE, per owner: what this order put in pending has
    // moved out of it, and the same amount has landed in available. Stated as
    // deltas against the pre-flow snapshot — see BUG-PAY-INT-12b.
    const restaurantFinal = await walletOf('restaurant', fx.restaurantId);
    expect(restaurantFinal.pending - restaurantWalletBefore.pending).toBe(0n);
    expect(restaurantFinal.available - restaurantWalletBefore.available).toBe(3600n);
    const courierFinal = await walletOf('courier', courierUserId);
    expect(courierFinal.pending - courierWalletBefore.pending).toBe(0n);
    expect(courierFinal.available - courierWalletBefore.available).toBe(1000n);

    // A second `deliver` call did not double-release: the second 200 was a
    // replay, so available moved by 1000 and not 2000 — which the deltas above
    // already pin exactly — and pending came back to where it started rather
    // than going negative.
    expect(courierFinal.pending).toBeGreaterThanOrEqual(0n);
    expect(restaurantFinal.pending).toBeGreaterThanOrEqual(0n);

    // The pool is flat for this order: credited at accrual, drained at accept.
    expect(await balanceOfAccount('COURIER_FEE_POOL')).toBe(poolAtStart);

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
