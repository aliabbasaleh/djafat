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
import { keepRestaurantOpen } from './open-restaurant.helper';

/**
 * Bloc 4 — Cart + Core Order end-to-end (docs/22): real Postgres + Redis
 * (`pnpm infra:up`, migrations applied, `pnpm db:seed` run first — see
 * test/README.md). Covers the cart lifecycle, live option/quantity
 * validation, the one-restaurant-per-cart rule, the quote step, order
 * creation from a cart, and the ownership/IDOR probes.
 */

let app: NestFastifyApplication;
let prisma: PrismaService;
let redis: RedisService;
let server: Server;
/** Set by `beforeAll` — see `keepRestaurantOpen` (BUG-PAY-INT-7). */
let restoreHours: () => Promise<void>;

interface LoginResult {
  access: string;
  user: { id: string };
}

async function loginViaOtp(phone: string): Promise<LoginResult> {
  await request(server).post('/v1/auth/otp/request').send({ phone, purpose: 'login' }).expect(202);
  const code = await redis.client.get(mockOtpKey(phone));
  if (!code)
    throw new Error(`No mock OTP code found for ${phone} — did MockOtpDeliveryProvider run?`);
  const res = await request(server)
    .post('/v1/auth/otp/verify')
    .send({ phone, code, purpose: 'login' })
    .expect(200);
  return res.body as LoginResult;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  server = app.getHttpAdapter().getInstance().server as unknown as Server;

  prisma = app.get(PrismaService);
  redis = app.get(RedisService);

  // This file's full flow COMMITS an order, which the product refuses outside
  // the restaurant's opening hours (BUG-PAY-INT-7).
  const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
  restoreHours = await keepRestaurantOpen(prisma, restaurant.id);
});

afterAll(async () => {
  await restoreHours?.();
  await app.close();
});

describe('auth required (docs/22 §6)', () => {
  it('every /v1/carts route rejects an unauthenticated request', async () => {
    await request(server).get('/v1/carts').expect(401);
    await request(server).post('/v1/carts/items').send({}).expect(401);
    await request(server).post('/v1/carts/quote').expect(401);
    await request(server).delete('/v1/carts').expect(401);
  });
});

describe('full flow — add item with options -> quote -> create order (docs/22 §3-§9)', () => {
  it('runs end to end with a fresh customer', async () => {
    const phone = `+2356600${Math.floor(1000 + Math.random() * 8999)}`;
    const customer = await loginViaOtp(phone);
    const auth = `Bearer ${customer.access}`;

    // Empty cart to start.
    const empty = await request(server).get('/v1/carts').set('Authorization', auth).expect(200);
    expect(empty.body.cart).toBeNull();

    const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
    const poulet = await prisma.product.findFirstOrThrow({
      where: { restaurantId: restaurant.id, name: 'Poulet braisé' },
    });
    const portionGroup = await prisma.productOptionGroup.findFirstOrThrow({
      where: { productId: poulet.id, name: 'Portion' },
    });
    const familial = await prisma.productOption.findFirstOrThrow({
      where: { optionGroupId: portionGroup.id, name: 'Familial' }, // +1500
    });

    const added = await request(server)
      .post('/v1/carts/items')
      .set('Authorization', auth)
      .send({ productId: poulet.id, quantity: 2, selectedOptionIds: [familial.id] })
      .expect(201);
    expect(added.body.cart.restaurantId).toBe(restaurant.id);
    expect(added.body.cart.items).toHaveLength(1);
    const itemId = added.body.cart.items[0].id as string;

    // GET /v1/carts reflects the same content (cheap, stored snapshot).
    const got = await request(server).get('/v1/carts').set('Authorization', auth).expect(200);
    expect(got.body.cart.items[0].quantity).toBe(2);

    // Live quote: (3500 + 1500) * 2 = 10000 subtotal.
    const quote = await request(server)
      .post('/v1/carts/quote')
      .set('Authorization', auth)
      .expect(201);
    expect(quote.body.subtotal).toEqual({ minor: '10000', currency: 'XAF' });
    expect(quote.body.lines[0].effectiveUnitPrice).toEqual({ minor: '5000', currency: 'XAF' });
    expect(quote.body.lines[0].cartItemId).toBe(itemId);

    // BUG-PAY-INT-8 — a FRESH customer has an empty address book, and Bloc 8
    // (docs/29 §checkout) made a default delivery address a precondition of
    // order creation: `POST /v1/orders` freezes a dropoff snapshot and
    // refuses with 409 `VALIDATION_ERROR` when there is none
    // (orders.service.ts §dropoff). This file predates that rule and was
    // never executed afterwards, so it still expected 201 from a customer who
    // could not legally order. The address is created through the REAL
    // endpoint, not by a direct insert — the first address a user creates
    // becomes their default automatically (addresses.service.ts §create), so
    // this one call is the whole precondition.
    await request(server)
      .post('/v1/users/me/addresses')
      .set('Authorization', auth)
      .send({ label: 'Domicile', quartier: 'Klemat' })
      .expect(201);

    // Order creation — body carries nothing, cart is resolved from the actor.
    const order = await request(server)
      .post('/v1/orders')
      .set('Authorization', auth)
      .set('idempotency-key', `int-cart-order-${randomUUID()}`)
      .send({})
      .expect(201);
    expect(order.body.order.subtotal).toEqual({ minor: '10000', currency: 'XAF' });
    expect(order.body.order.items[0].options).toEqual([
      expect.objectContaining({ name: 'Familial', priceDelta: { minor: '1500', currency: 'XAF' } }),
    ]);

    // The cart that funded the order is now spent.
    const afterOrder = await request(server)
      .get('/v1/carts')
      .set('Authorization', auth)
      .expect(200);
    expect(afterOrder.body.cart).toBeNull();
  });
});

describe('one restaurant per cart (docs/22 §2.1)', () => {
  it('refuses a product from a different restaurant, then accepts it with replaceCart', async () => {
    const phone = `+2356600${Math.floor(1000 + Math.random() * 8999)}`;
    const customer = await loginViaOtp(phone);
    const auth = `Bearer ${customer.access}`;

    const fatime = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
    const bissap = await prisma.product.findFirstOrThrow({
      where: { restaurantId: fatime.id, name: 'Jus de bissap' },
    });
    const sahel = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'le-sahel-grill' } });
    const gingembre = await prisma.product.findFirstOrThrow({
      where: { restaurantId: sahel.id, name: 'Jus de gingembre' },
    });

    await request(server)
      .post('/v1/carts/items')
      .set('Authorization', auth)
      .send({ productId: bissap.id, quantity: 1, selectedOptionIds: [] })
      .expect(201);

    const mismatch = await request(server)
      .post('/v1/carts/items')
      .set('Authorization', auth)
      .send({ productId: gingembre.id, quantity: 1, selectedOptionIds: [] })
      .expect(409);
    expect(mismatch.body.error.code).toBe('CART_RESTAURANT_MISMATCH');

    // The original item is untouched — never a silent merge.
    const stillOriginal = await request(server)
      .get('/v1/carts')
      .set('Authorization', auth)
      .expect(200);
    expect(stillOriginal.body.cart.restaurantId).toBe(fatime.id);

    const replaced = await request(server)
      .post('/v1/carts/items')
      .set('Authorization', auth)
      .send({ productId: gingembre.id, quantity: 1, selectedOptionIds: [], replaceCart: true })
      .expect(201);
    expect(replaced.body.cart.restaurantId).toBe(sahel.id);
    expect(replaced.body.cart.items).toHaveLength(1);
  });
});

describe('option validation (docs/22 §4)', () => {
  async function freshAuth(): Promise<string> {
    const phone = `+2356600${Math.floor(1000 + Math.random() * 8999)}`;
    const { access } = await loginViaOtp(phone);
    return `Bearer ${access}`;
  }

  it('rejects a required option group left empty', async () => {
    const auth = await freshAuth();
    const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
    const poulet = await prisma.product.findFirstOrThrow({
      where: { restaurantId: restaurant.id, name: 'Poulet braisé' },
    });
    const res = await request(server)
      .post('/v1/carts/items')
      .set('Authorization', auth)
      .send({ productId: poulet.id, quantity: 1, selectedOptionIds: [] })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects two selections in a SINGLE-selection group', async () => {
    const auth = await freshAuth();
    const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
    const poulet = await prisma.product.findFirstOrThrow({
      where: { restaurantId: restaurant.id, name: 'Poulet braisé' },
    });
    const group = await prisma.productOptionGroup.findFirstOrThrow({
      where: { productId: poulet.id, name: 'Portion' },
    });
    const opts = await prisma.productOption.findMany({
      where: { optionGroupId: group.id },
      take: 2,
    });
    await request(server)
      .post('/v1/carts/items')
      .set('Authorization', auth)
      .send({ productId: poulet.id, quantity: 1, selectedOptionIds: opts.map((o) => o.id) })
      .expect(422);
  });

  it('rejects an option id that belongs to a DIFFERENT product entirely', async () => {
    const auth = await freshAuth();
    const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
    const poulet = await prisma.product.findFirstOrThrow({
      where: { restaurantId: restaurant.id, name: 'Poulet braisé' },
    });
    const frites = await prisma.product.findFirstOrThrow({
      where: { restaurantId: restaurant.id, name: 'Frites' },
    });
    const fritesGroup = await prisma.productOptionGroup.findFirstOrThrow({
      where: { productId: frites.id },
    });
    const fritesOption = await prisma.productOption.findFirstOrThrow({
      where: { optionGroupId: fritesGroup.id },
    });
    const res = await request(server)
      .post('/v1/carts/items')
      .set('Authorization', auth)
      // A Frites option sent for the Poulet product — must never be accepted.
      .send({ productId: poulet.id, quantity: 1, selectedOptionIds: [fritesOption.id] })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('quantity bounds (docs/22 §5)', () => {
  async function freshAuth(): Promise<string> {
    const phone = `+2356600${Math.floor(1000 + Math.random() * 8999)}`;
    const { access } = await loginViaOtp(phone);
    return `Bearer ${access}`;
  }

  it('rejects 0, a negative number, and a value above the wire-level ceiling', async () => {
    const auth = await freshAuth();
    const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
    const bissap = await prisma.product.findFirstOrThrow({
      where: { restaurantId: restaurant.id, name: 'Jus de bissap' },
    });

    for (const quantity of [0, -1, 100, 1.5]) {
      const res = await request(server)
        .post('/v1/carts/items')
        .set('Authorization', auth)
        .send({ productId: bissap.id, quantity, selectedOptionIds: [] });
      expect(res.status).toBe(422);
    }
  });
});

describe('CART_EMPTY (docs/22 §8, §9)', () => {
  it('quote and order creation both refuse an empty cart, never price it as zero', async () => {
    const phone = `+2356600${Math.floor(1000 + Math.random() * 8999)}`;
    const { access } = await loginViaOtp(phone);
    const auth = `Bearer ${access}`;

    const quoteRes = await request(server).post('/v1/carts/quote').set('Authorization', auth);
    expect(quoteRes.status).toBe(409);
    expect(quoteRes.body.error.code).toBe('CART_EMPTY');

    const orderRes = await request(server)
      .post('/v1/orders')
      .set('Authorization', auth)
      .set('idempotency-key', `int-cart-empty-${randomUUID()}`)
      .send({});
    expect(orderRes.status).toBe(409);
    expect(orderRes.body.error.code).toBe('CART_EMPTY');
  });
});

describe('IDOR — a cart item id is only ever reachable through its OWNER (docs/22 §6)', () => {
  it("another customer cannot patch or delete someone else's cart item", async () => {
    const phoneA = `+2356600${Math.floor(1000 + Math.random() * 8999)}`;
    const ownerA = await loginViaOtp(phoneA);
    const authA = `Bearer ${ownerA.access}`;
    const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
    const bissap = await prisma.product.findFirstOrThrow({
      where: { restaurantId: restaurant.id, name: 'Jus de bissap' },
    });
    const added = await request(server)
      .post('/v1/carts/items')
      .set('Authorization', authA)
      .send({ productId: bissap.id, quantity: 1, selectedOptionIds: [] })
      .expect(201);
    const itemId = added.body.cart.items[0].id as string;

    const phoneB = `+2356600${Math.floor(1000 + Math.random() * 8999)}`;
    const strangerB = await loginViaOtp(phoneB);
    const authB = `Bearer ${strangerB.access}`;

    await request(server)
      .patch(`/v1/carts/items/${itemId}`)
      .set('Authorization', authB)
      .send({ quantity: 5 })
      .expect(404);
    await request(server)
      .delete(`/v1/carts/items/${itemId}`)
      .set('Authorization', authB)
      .expect(404);

    // Untouched from owner A's point of view.
    const stillThere = await request(server)
      .get('/v1/carts')
      .set('Authorization', authA)
      .expect(200);
    expect(stillThere.body.cart.items[0].quantity).toBe(1);
  });
});

describe('security — invalid identifiers (docs/22)', () => {
  it('a non-UUID productId is rejected (422), never a 500', async () => {
    const phone = `+2356600${Math.floor(1000 + Math.random() * 8999)}`;
    const { access } = await loginViaOtp(phone);
    const res = await request(server)
      .post('/v1/carts/items')
      .set('Authorization', `Bearer ${access}`)
      .send({ productId: 'not-a-uuid', quantity: 1, selectedOptionIds: [] });
    expect(res.status).toBe(422);
  });

  it('an unknown (but well-formed) productId 404s', async () => {
    const phone = `+2356600${Math.floor(1000 + Math.random() * 8999)}`;
    const { access } = await loginViaOtp(phone);
    await request(server)
      .post('/v1/carts/items')
      .set('Authorization', `Bearer ${access}`)
      .send({ productId: randomUUID(), quantity: 1, selectedOptionIds: [] })
      .expect(404);
  });

  it("a suspended restaurant's product cannot be added to a cart", async () => {
    const phone = `+2356600${Math.floor(1000 + Math.random() * 8999)}`;
    const { access } = await loginViaOtp(phone);
    const suspended = await prisma.restaurant.findFirstOrThrow({
      where: { slug: 'le-palace-ferme' },
    });
    const ghost = await prisma.product.findFirstOrThrow({ where: { restaurantId: suspended.id } });
    await request(server)
      .post('/v1/carts/items')
      .set('Authorization', `Bearer ${access}`)
      .send({ productId: ghost.id, quantity: 1, selectedOptionIds: [] })
      .expect(404);
  });
});
