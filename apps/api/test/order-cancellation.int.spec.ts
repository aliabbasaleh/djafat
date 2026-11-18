import 'reflect-metadata';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { totpCodeAt } from '@djafat/core';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { listenOnLoopback } from './listen-on-loopback';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { RedisService } from '../src/common/redis/redis.service';
import { RELAYED_DOMAIN_EVENT } from '../src/common/events/relayed-domain-event';
import { mockOtpKey } from '../src/modules/auth/providers/mock-otp-delivery.provider';
import { MockPaymentProvider } from '../src/modules/payments/providers/mock/mock-payment.provider';

/**
 * Cancelling an order and the money that follows (audit findings ORD-01,
 * PAY-04, ORD-02), against real PostgreSQL, through the HTTP routes.
 *
 * Policy under test: an order that ends before the restaurant started cooking
 * (rejected, cancelled by the customer, not confirmed in time) is refunded in
 * full and its accrual reversed, so the restaurant, the courier pool, DJAFAT's
 * revenue and the debt to the customer all end at zero. Cancelled later (staff
 * only), the customer is still refunded in full and DJAFAT absorbs it: the
 * restaurant keeps its share (docs/08 §8.8, docs/25 "Remboursement").
 *
 * The in-process reaction runs after the HTTP response, so the tests wait for
 * its result instead of assuming it is there.
 */

const CUSTOMER_PHONE = '+23566000001'; // seeded
const RESTAURANT_OWNER_PHONE = '+23566000003'; // seeded, owner of chez-fatime
// Fresh accounts, used by no other test file (MFA can be enrolled once per account).
const OTHER_CUSTOMER_PHONE = '+23566000092';
const STAFF_ADMIN_PHONE = '+23566000091';

let app: NestFastifyApplication;
let prisma: PrismaService;
let redis: RedisService;
let server: Server;
let customer: string;
let otherCustomer: string;
let owner: string;
let admin: string;

async function loginViaOtp(phone: string): Promise<{ access: string; userId: string }> {
  await request(server).post('/v1/auth/otp/request').send({ phone, purpose: 'login' }).expect(202);
  const code = await redis.client.get(mockOtpKey(phone));
  if (!code) throw new Error(`No mock OTP code found for ${phone}`);
  const res = await request(server)
    .post('/v1/auth/otp/verify')
    .send({ phone, code, purpose: 'login' })
    .expect(200);
  const body = res.body as { access: string; user: { id: string } };
  return { access: body.access, userId: body.user.id };
}

async function enrollAndStepUp(access: string): Promise<void> {
  const setup = await request(server)
    .post('/v1/auth/mfa/setup')
    .set('Authorization', `Bearer ${access}`)
    .expect(200);
  const code = await totpCodeAt(setup.body.secretBase32 as string, Date.now());
  await request(server)
    .post('/v1/auth/mfa/verify')
    .set('Authorization', `Bearer ${access}`)
    .send({ code })
    .expect(200);
}

const bearer = (access: string) => ({ Authorization: `Bearer ${access}` });

/** Polls until `check` returns a value (not undefined/null/false), or fails after `ms`. */
async function waitFor<T>(
  check: () => Promise<T | null | undefined | false>,
  ms = 10_000,
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error('waitFor: condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** A chez-fatime order from the customer's cart: 3500 + 1000 + 1000 delivery = 5500 XAF. */
async function placeOrder(
  access: string,
): Promise<{ id: string; total: { minor: string; currency: string } }> {
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
  await request(server).delete('/v1/carts').set(bearer(access)).expect(200);
  await request(server)
    .post('/v1/carts/items')
    .set(bearer(access))
    .send({ productId: poulet.id, quantity: 1, selectedOptionIds: [entier.id] })
    .expect(201);
  await request(server)
    .post('/v1/carts/items')
    .set(bearer(access))
    .send({ productId: frites.id, quantity: 1, selectedOptionIds: [] })
    .expect(201);
  const res = await request(server)
    .post('/v1/orders')
    .set(bearer(access))
    .set('idempotency-key', `int-cancel-order-${randomUUID()}`)
    .send({})
    .expect(201);
  return res.body.order as { id: string; total: { minor: string; currency: string } };
}

/** A mock payment for the order, left pending unless `succeed`. */
async function pay(
  access: string,
  order: { id: string; total: { minor: string; currency: string } },
  succeed: boolean,
): Promise<string> {
  const res = await request(server)
    .post('/v1/payments')
    .set(bearer(access))
    .set('idempotency-key', `int-cancel-payment-${randomUUID()}`)
    .send({
      orderId: order.id,
      providerCode: 'mock',
      methodCode: 'mobile_money',
      metadata: { mockOutcome: 'pending_then_succeed' },
    })
    .expect(201);
  const payment = res.body.payment as { id: string; providerRef: string };
  if (succeed) {
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
    await waitFor(async () => {
      const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      return o.status === 'placed';
    });
  }
  return payment.id;
}

async function paidOrder(access = customer) {
  const order = await placeOrder(access);
  const paymentId = await pay(access, order, true);
  return { orderId: order.id, paymentId, totalMinor: BigInt(order.total.minor) };
}

/** Net (debits − credits) per account code over every ledger group of the order. */
async function orderBalances(orderId: string): Promise<Record<string, bigint>> {
  const rows = await prisma.$queryRaw<Array<{ code: string; net: bigint }>>`
    SELECT a.code,
      SUM(CASE WHEN e.direction = 'debit' THEN e.amount_minor ELSE -e.amount_minor END)::bigint AS net
    FROM ledger_entries e
    JOIN ledger_entry_groups g ON g.id = e.entry_group
    JOIN ledger_accounts a ON a.id = e.account_id
    WHERE g.order_id = ${orderId}::uuid
    GROUP BY a.code
  `;
  return Object.fromEntries(rows.map((r) => [r.code, r.net]));
}

async function unbalancedGroups(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ entry_group: string }>>`
    SELECT entry_group FROM ledger_entries
    GROUP BY entry_group, currency
    HAVING SUM(CASE WHEN direction = 'debit' THEN amount_minor ELSE -amount_minor END) <> 0
  `;
  return rows.map((r) => r.entry_group);
}

const refundOf = (paymentId: string) =>
  prisma.refund.findFirst({ where: { paymentId, idempotencyKey: 'order-ended' } });

/** The automatic refund settled at the provider, with the payment fully refunded. */
async function settledRefund(paymentId: string) {
  return waitFor(async () => {
    const refund = await refundOf(paymentId);
    return refund?.status === 'succeeded' ? refund : null;
  });
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

  customer = (await loginViaOtp(CUSTOMER_PHONE)).access;
  otherCustomer = (await loginViaOtp(OTHER_CUSTOMER_PHONE)).access;
  owner = (await loginViaOtp(RESTAURANT_OWNER_PHONE)).access;

  // A fresh admin, promoted in the database (granting through the API needs a
  // stepped-up super_admin, which another test file enrols), then re-logged so
  // the token carries the role, and stepped up for the admin cancel route.
  const created = await loginViaOtp(STAFF_ADMIN_PHONE);
  await prisma.$executeRaw`INSERT INTO user_roles (user_id, role) VALUES (${created.userId}::uuid, 'admin')`;
  admin = (await loginViaOtp(STAFF_ADMIN_PHONE)).access;
  await enrollAndStepUp(admin);
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('the customer cancels (ORD-01) and is refunded (PAY-04)', () => {
  it('a paid, placed order: cancelled, refunded in full, and every share of the accrual taken back', async () => {
    const { orderId, paymentId, totalMinor } = await paidOrder();
    const before = await orderBalances(orderId);
    expect(before['RESTAURANT_PAYABLE']).toBeLessThan(0n); // the accrual credited the restaurant

    const res = await request(server)
      .post(`/v1/orders/${orderId}/cancel`)
      .set(bearer(customer))
      .send({ reason: 'Je me suis trompé de plat' })
      .expect(200);
    expect(res.body.status).toBe('cancelled');

    const refund = await settledRefund(paymentId);
    expect(refund.amountMinor).toBe(totalMinor);
    expect(refund.compensatesAccrual).toBe(true);
    expect(refund.requestedBy).toBeNull();
    expect(refund.reason).toContain('annulée par le client');
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe('refunded');

    const after = await orderBalances(orderId);
    expect(after['RESTAURANT_PAYABLE']).toBe(0n);
    expect(after['COURIER_FEE_POOL']).toBe(0n);
    expect(after['DJAFAT_REVENUE']).toBe(0n);
    expect(after['REFUNDS_PAYABLE']).toBe(0n);
    // DJAFAT bears the provider's fee (psp_fee_policy 'absorb').
    expect(after['PSP_FEE_EXPENSE'] ?? 0n).toBe(-(after['PSP_CLEARING'] ?? 0n));
    expect(await unbalancedGroups()).toEqual([]);
  });

  it('an order awaiting payment: cancelled, and its open payment cancelled with it', async () => {
    const order = await placeOrder(customer);
    const paymentId = await pay(customer, order, false);

    await request(server)
      .post(`/v1/orders/${order.id}/cancel`)
      .set(bearer(customer))
      .send({})
      .expect(200);

    await waitFor(async () => {
      const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      return p.status === 'cancelled';
    });
    expect(await refundOf(paymentId)).toBeNull();
  });

  it("someone else's order answers 404, and the order is untouched", async () => {
    const { orderId } = await paidOrder();
    await request(server)
      .post(`/v1/orders/${orderId}/cancel`)
      .set(bearer(otherCustomer))
      .send({})
      .expect(404);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('placed');
  });

  it('once the restaurant has cooked it, the customer can no longer cancel: 409, no refund', async () => {
    const { orderId, paymentId } = await paidOrder();
    await request(server).post(`/v1/orders/${orderId}/confirm`).set(bearer(owner)).expect(200);
    await request(server).post(`/v1/orders/${orderId}/ready`).set(bearer(owner)).expect(200);

    const res = await request(server)
      .post(`/v1/orders/${orderId}/cancel`)
      .set(bearer(customer))
      .send({})
      .expect(409);
    expect(res.body.error.code).toBe('ORDER_INVALID_TRANSITION');
    expect(await refundOf(paymentId)).toBeNull();
  });
});

describe('the restaurant rejects a paid order (PAY-04)', () => {
  it('refunded in full; the rejecting restaurant keeps nothing', async () => {
    const { orderId, paymentId, totalMinor } = await paidOrder();
    await request(server)
      .post(`/v1/orders/${orderId}/reject`)
      .set(bearer(owner))
      .send({ reason: 'Rupture de poulet' })
      .expect(200);

    const refund = await settledRefund(paymentId);
    expect(refund.amountMinor).toBe(totalMinor);
    expect(refund.reason).toContain('refusée par le restaurant — Rupture de poulet');
    const after = await orderBalances(orderId);
    expect(after['RESTAURANT_PAYABLE']).toBe(0n);
    expect(after['REFUNDS_PAYABLE']).toBe(0n);
    expect(await unbalancedGroups()).toEqual([]);
  });
});

describe('staff cancel (ORD-01): after preparation, DJAFAT absorbs the refund', () => {
  it('a ready order: delivery stopped, customer refunded, restaurant keeps its share', async () => {
    const { orderId, paymentId, totalMinor } = await paidOrder();
    await request(server).post(`/v1/orders/${orderId}/confirm`).set(bearer(owner)).expect(200);
    await request(server).post(`/v1/orders/${orderId}/ready`).set(bearer(owner)).expect(200);
    const delivery = await waitFor(() => prisma.delivery.findUnique({ where: { orderId } }));
    const restaurantShare = (await orderBalances(orderId))['RESTAURANT_PAYABLE']!;

    await request(server)
      .post(`/v1/admin/orders/${orderId}/cancel`)
      .set(bearer(customer))
      .send({ reason: 'test' })
      .expect(403);
    const res = await request(server)
      .post(`/v1/admin/orders/${orderId}/cancel`)
      .set(bearer(admin))
      .send({ reason: 'Client injoignable, cuisine fermée' })
      .expect(200);
    expect(res.body.status).toBe('cancelled');

    await waitFor(async () => {
      const d = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      return d.status === 'cancelled';
    });
    const refund = await settledRefund(paymentId);
    expect(refund.amountMinor).toBe(totalMinor);
    expect(refund.compensatesAccrual).toBe(false);
    expect(refund.reason).toContain("annulée par l'équipe DJAFAT");

    const after = await orderBalances(orderId);
    expect(after['RESTAURANT_PAYABLE']).toBe(restaurantShare); // unchanged
    expect(after['REFUNDS_PAYABLE'] ?? 0n).toBe(0n);
    expect(await unbalancedGroups()).toEqual([]);
  });
});

describe('refunds sent by hand (merchant wallets: no refund API)', () => {
  it('the refund waits for operations, who record the transfer: then it is settled', async () => {
    const mock = app.get(MockPaymentProvider);
    const real = mock.getCapabilities();
    const spy = vi.spyOn(mock, 'getCapabilities').mockReturnValue({ ...real, refund: false });
    let refundId: string;
    let orderId: string;
    try {
      const paid = await paidOrder();
      orderId = paid.orderId;
      const paymentId = paid.paymentId;
      await request(server)
        .post(`/v1/orders/${orderId}/cancel`)
        .set(bearer(customer))
        .send({})
        .expect(200);
      const pending = await waitFor(() => refundOf(paymentId));
      refundId = pending.id;
      // Give the in-process reaction time to (wrongly) call the provider.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect((await refundOf(paymentId))?.status).toBe('pending');
    } finally {
      spy.mockRestore();
    }

    const list = await request(server).get('/v1/admin/refunds').set(bearer(admin)).expect(200);
    const open = (list.body as Array<{ id: string; automatic: boolean; orderCode: string }>).find(
      (r) => r.id === refundId,
    );
    expect(open).toMatchObject({ automatic: true, status: 'pending', providerCode: 'mock' });
    expect(open?.orderCode).toMatch(/\S+/);
    await request(server).get('/v1/admin/refunds').set(bearer(customer)).expect(403);

    const done = await request(server)
      .post(`/v1/admin/refunds/${refundId}/complete`)
      .set(bearer(admin))
      .send({ providerRef: 'AIRTEL.TX123456' })
      .expect(200);
    expect(done.body.status).toBe('succeeded');
    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
    expect(refund.providerRef).toBe('AIRTEL.TX123456');
    const after = await orderBalances(orderId);
    expect(after['REFUNDS_PAYABLE']).toBe(0n);
    expect(after['RESTAURANT_PAYABLE']).toBe(0n);

    await request(server)
      .post(`/v1/admin/refunds/${refundId}/complete`)
      .set(bearer(admin))
      .send({ providerRef: 'AIRTEL.TX123456' })
      .expect(409);
  });
});

describe('the durable path: a cancellation relayed from the outbox (ORD-02, the worker timeout)', () => {
  it('refunds once, however many times the event is delivered', async () => {
    const { orderId, paymentId } = await paidOrder();
    // What the worker's confirmation-timeout job writes (it runs in another process).
    await prisma.$executeRaw`UPDATE orders SET status = 'cancelled' WHERE id = ${orderId}::uuid`;
    await prisma.$executeRaw`
      INSERT INTO order_status_history (order_id, from_status, to_status, actor_role, reason)
      VALUES (${orderId}::uuid, 'placed', 'cancelled', 'system', 'confirmation_timeout')
    `;
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const envelope = {
      id: randomUUID(),
      aggregate: 'order',
      aggregateId: orderId,
      eventType: 'order.cancelled',
      payload: { orderId, status: 'cancelled', restaurantId: order.restaurantId },
      createdAt: new Date().toISOString(),
    };
    const events = app.get(EventEmitter2);
    await events.emitAsync(RELAYED_DOMAIN_EVENT, envelope);
    await events.emitAsync(RELAYED_DOMAIN_EVENT, envelope); // at-least-once: a redelivery

    const refund = await settledRefund(paymentId);
    expect(refund.reason).toContain('non confirmée à temps par le restaurant');
    expect(await prisma.refund.count({ where: { paymentId } })).toBe(1);
    const reversals = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM ledger_entry_groups WHERE idempotency_key = ${`order-reversal:${paymentId}`}
    `;
    expect(reversals[0]?.n).toBe(1n);
    expect((await orderBalances(orderId))['RESTAURANT_PAYABLE']).toBe(0n);
  });
});
