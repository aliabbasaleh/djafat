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

/**
 * Bloc 2 — Catalog & Restaurant Discovery end-to-end (docs/20 §49-§52): real
 * Postgres + Redis (`pnpm infra:up`, migrations applied, `pnpm db:seed` run
 * first — see test/README.md). Covers the public GET endpoints, search
 * safety, pagination bounds, the full owner-creates-catalog flow, and the
 * ownership/RBAC/IDOR security probes.
 */

let app: NestFastifyApplication;
let prisma: PrismaService;
let redis: RedisService;
let server: Server;

const RESTAURANT_OWNER_PHONE = '+23566000003'; // seeded, owns "chez-fatime" (apps/api/prisma/seed.ts)
const ADMIN_PHONE = '+23566000007'; // seeded, role admin
const CUSTOMER_PHONE = '+23566000001'; // seeded, role customer only

interface LoginResult {
  access: string;
  refresh: string;
  user: { id: string; roles: string[] };
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

/** Grants a role directly (bypassing any onboarding flow) — same raw-SQL shape as `apps/api/prisma/seed.ts`. */
async function grantRole(userId: string, role: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, ${role})
    ON CONFLICT DO NOTHING
  `;
}

/**
 * Re-scopes an EXISTING role grant to a specific restaurant (Bloc 9.1,
 * docs/31 §restaurant-ownership) — needed after restaurant creation:
 * `user_roles.scope_restaurant_id` is now the sole authorization source for
 * `restaurants/categories/products`, and a grant cannot be scoped to a
 * restaurant that doesn't exist yet. Mirrors the real two-step flow (create
 * the restaurant, THEN an admin scopes a `restaurant_owner` grant to it via
 * `POST /admin/users/:id/roles`) without going through that HTTP surface.
 */
async function scopeRoleToRestaurant(
  userId: string,
  role: string,
  restaurantId: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE user_roles SET scope_restaurant_id = ${restaurantId}::uuid
    WHERE user_id = ${userId}::uuid AND role = ${role}
  `;
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
});

afterAll(async () => {
  await app.close();
});

describe('public catalogue reads (docs/20 §24, §32-§34)', () => {
  it('GET /v1/restaurants lists only publicly-visible restaurants — suspended never appears', async () => {
    const res = await request(server).get('/v1/restaurants').query({ limit: 50 }).expect(200);
    const slugs = (res.body.items as Array<{ slug: string }>).map((r) => r.slug);
    expect(slugs).toContain('chez-fatime');
    expect(slugs).toContain('le-sahel-grill');
    expect(slugs).toContain('snack-rapide'); // paused — visible-but-unavailable (docs/20 §6)
    expect(slugs).not.toContain('le-palace-ferme'); // suspended — never visible
    expect(res.body.page).toBe(1);
    expect(typeof res.body.total).toBe('number');
  });

  it('GET /v1/restaurants/:slug returns full detail for an active restaurant', async () => {
    const res = await request(server).get('/v1/restaurants/chez-fatime').expect(200);
    expect(res.body.slug).toBe('chez-fatime');
    expect(res.body.name).toBeTruthy();
    expect(['OPEN', 'CLOSED']).toContain(res.body.availability); // active -> never PAUSED/UNAVAILABLE
    expect(res.body.minOrder).toHaveProperty('minor');
    expect(res.body.minOrder).toHaveProperty('currency');
  });

  it('a paused restaurant is visible but its availability is PAUSED, never OPEN', async () => {
    const res = await request(server).get('/v1/restaurants/snack-rapide').expect(200);
    expect(res.body.availability).toBe('PAUSED');
  });

  it('GET /v1/restaurants/:slug/menu returns active categories with their active products', async () => {
    const res = await request(server).get('/v1/restaurants/chez-fatime/menu').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    const category = (res.body as Array<{ name: string; products: unknown[] }>).find(
      (c) => c.products.length > 0,
    );
    expect(category).toBeDefined();
  });

  it('GET /v1/products/:id returns option groups for a product that has them', async () => {
    const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
    const product = await prisma.product.findFirstOrThrow({
      where: { restaurantId: restaurant.id, name: 'Poulet braisé' },
    });
    const res = await request(server).get(`/v1/products/${product.id}`).expect(200);
    expect(res.body.optionGroups.length).toBeGreaterThan(0);
    const group = res.body.optionGroups[0];
    expect(group.options.length).toBeGreaterThan(0);
    expect(group.options[0]).toHaveProperty('priceDelta');
  });

  it('GET /v1/categories returns the distinct category names in use', async () => {
    const res = await request(server).get('/v1/categories').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('name');
    expect(res.body[0]).toHaveProperty('restaurantCount');
  });
});

describe('security — visibility of non-public restaurants (docs/20 §3, §52 IDOR)', () => {
  it('a suspended restaurant 404s exactly like an unknown slug — no distinguishing signal', async () => {
    const suspended = await request(server).get('/v1/restaurants/le-palace-ferme').expect(404);
    const unknown = await request(server)
      .get('/v1/restaurants/this-slug-does-not-exist')
      .expect(404);
    expect(suspended.body.error.code).toBe(unknown.body.error.code);
  });

  it('the menu and product-detail of a suspended restaurant are also unreachable', async () => {
    await request(server).get('/v1/restaurants/le-palace-ferme/menu').expect(404);
    const restaurant = await prisma.restaurant.findFirstOrThrow({
      where: { slug: 'le-palace-ferme' },
    });
    const product = await prisma.product.findFirstOrThrow({
      where: { restaurantId: restaurant.id },
    });
    await request(server).get(`/v1/products/${product.id}`).expect(404);
  });
});

describe('search — validation and injection safety (docs/20 §28, §52)', () => {
  it('rejects an empty search string (422, never a 500)', async () => {
    const res = await request(server).get('/v1/restaurants').query({ search: '' }).expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an over-long search string (> 80 chars)', async () => {
    const res = await request(server)
      .get('/v1/restaurants')
      .query({ search: 'a'.repeat(81) })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a unicode query without crashing', async () => {
    await request(server)
      .get('/v1/restaurants')
      .query({ search: 'Poulet 🍗 Ndjaména' })
      .expect(200);
  });

  it('a SQL-injection-attempt query is treated as inert text, never breaks the query', async () => {
    const res = await request(server)
      .get('/v1/restaurants')
      .query({ search: "'; DROP TABLE restaurants; --" })
      .expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    // The table must still exist and still serve normal queries afterwards.
    await request(server).get('/v1/restaurants').expect(200);
  });

  it('a search matching a PRODUCT name (not just restaurant name) still finds the restaurant', async () => {
    const res = await request(server)
      .get('/v1/restaurants')
      .query({ search: 'Bissap' })
      .expect(200);
    const slugs = (res.body.items as Array<{ slug: string }>).map((r) => r.slug);
    expect(slugs).toContain('chez-fatime');
  });
});

describe('pagination bounds (docs/20 §26, §52 abuse)', () => {
  it('rejects limit above the maximum', async () => {
    const res = await request(server).get('/v1/restaurants').query({ limit: 9999 }).expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects page below 1', async () => {
    await request(server).get('/v1/restaurants').query({ page: 0 }).expect(422);
  });

  it('an out-of-range page returns an empty (not error) result', async () => {
    const res = await request(server)
      .get('/v1/restaurants')
      .query({ page: 999, limit: 5 })
      .expect(200);
    expect(res.body.items).toEqual([]);
  });
});

describe('security — invalid identifiers (docs/20 §52)', () => {
  it('a non-UUID restaurant/product id on a management route is rejected, not 500', async () => {
    const owner = await loginViaOtp(RESTAURANT_OWNER_PHONE);
    const res = await request(server)
      .patch('/v1/restaurants/not-a-uuid')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ name: 'X' });
    expect([400, 403, 404, 422]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });

  it('an unknown product id 404s', async () => {
    await request(server).get(`/v1/products/${randomUUID()}`).expect(404);
  });
});

describe('full flow — owner creates restaurant -> category -> product -> options -> publicly visible (docs/20 §49)', () => {
  it('runs end to end', async () => {
    // A FRESH actor, not the pre-scoped seeded RESTAURANT_OWNER_PHONE: that
    // account is already scoped to 'chez-fatime' (Bloc 9 seed), and
    // migration 0028 allows at most one restaurant per `restaurant_owner`/
    // `restaurant_staff` grant — it could never ALSO be scoped to a
    // brand-new restaurant in the same test.
    const freshOwnerPhone = `+2356600${Math.floor(1000 + Math.random() * 8999)}`;
    let owner = await loginViaOtp(freshOwnerPhone);
    // Unscoped for now — enough to pass `@RequireRole`/`restaurants:write`
    // for the CREATE call itself; a restaurant-scoped grant cannot exist
    // before the restaurant does (Bloc 9.1, docs/31 §restaurant-ownership).
    await grantRole(owner.user.id, 'restaurant_owner');
    owner = await loginViaOtp(freshOwnerPhone); // refresh JWT role claims

    const city = await prisma.city.findFirstOrThrow();
    const suffix = randomUUID().slice(0, 8);

    const createdRestaurant = await request(server)
      .post('/v1/restaurants')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ cityId: city.id, name: `Resto Test ${suffix}`, description: 'Un resto de test.' })
      .expect(201);
    const restaurantId = createdRestaurant.body.id as string;
    expect(createdRestaurant.body.status).toBe('draft'); // never auto-published
    expect(createdRestaurant.body.ownerUserId).toBe(owner.user.id); // catalog metadata only

    // Bloc 9.1 (docs/31 §restaurant-ownership) — the PROOF of the fix: being
    // `ownerUserId` (just set, above) is NOT sufficient authority on its
    // own anymore. The actor's ONLY role grant is still unscoped at this
    // point — `user_roles` is the sole source of truth now, so this 403s
    // exactly like a total stranger would.
    const beforeScoping = await request(server)
      .patch(`/v1/restaurants/${restaurantId}`)
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ name: 'Should be rejected' });
    expect(beforeScoping.status).toBe(403);

    // The realistic second step of onboarding (docs/31): an admin scopes
    // the owner's grant to the restaurant they just registered. Mirrored
    // here directly rather than through POST /admin/users/:id/roles — same
    // raw-SQL shape `scopeRoleToRestaurant` already documents.
    await scopeRoleToRestaurant(owner.user.id, 'restaurant_owner', restaurantId);

    // A freshly-created (draft) restaurant is NOT publicly visible yet.
    await request(server).get(`/v1/restaurants/${createdRestaurant.body.slug}`).expect(404);

    // The owner publishes it themselves (self-service draft -> active, docs/20 §6).
    await request(server)
      .patch(`/v1/restaurants/${restaurantId}`)
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ status: 'active' })
      .expect(200);

    const createdCategory = await request(server)
      .post(`/v1/restaurants/${restaurantId}/categories`)
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ name: 'Plats test' })
      .expect(201);
    const categoryId = createdCategory.body.id as string;

    const createdProduct = await request(server)
      .post(`/v1/restaurants/${restaurantId}/products`)
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ categoryId, name: 'Plat Test', priceMinor: '2500' })
      .expect(201);
    const productId = createdProduct.body.id as string;

    await request(server)
      .post(`/v1/products/${productId}/option-groups`)
      .set('Authorization', `Bearer ${owner.access}`)
      .send({
        name: 'Taille',
        selectionType: 'single',
        minSelections: 1,
        maxSelections: 1,
        isRequired: true,
        options: [
          { name: 'Petit', priceDeltaMinor: '-500' },
          { name: 'Grand', priceDeltaMinor: '500' },
        ],
      })
      .expect(201);

    // Now everything is publicly visible, unauthenticated, exactly as the
    // owner built it — the catalogue is the server-side source of truth.
    const detail = await request(server)
      .get(`/v1/restaurants/${createdRestaurant.body.slug}`)
      .expect(200);
    // Status is 'active' but there are no `RestaurantHours` rows at all yet —
    // `computeRestaurantAvailability` treats "no matching hours" as CLOSED,
    // never OPEN-by-default (docs/20 §20-§23).
    expect(detail.body.availability).toBe('CLOSED');
    const menu = await request(server)
      .get(`/v1/restaurants/${createdRestaurant.body.slug}/menu`)
      .expect(200);
    const menuCategories = menu.body as Array<{ id: string }>;
    expect(menuCategories.some((c) => c.id === categoryId)).toBe(true);
    const publicProduct = await request(server).get(`/v1/products/${productId}`).expect(200);
    expect(publicProduct.body.name).toBe('Plat Test');
    expect(publicProduct.body.optionGroups[0].options).toHaveLength(2);
  });
});

describe('ownership & RBAC (docs/20 §10, §21, §51)', () => {
  it('the owner can update their own restaurant', async () => {
    const owner = await loginViaOtp(RESTAURANT_OWNER_PHONE);
    const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
    await request(server)
      .patch(`/v1/restaurants/${restaurant.id}`)
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ description: 'Description mise à jour par le propriétaire.' })
      .expect(200);
  });

  it("a DIFFERENT restaurant owner cannot modify someone else's restaurant (403)", async () => {
    const otherPhone = `+2356600${Math.floor(1000 + Math.random() * 8999)}`;
    const other = await loginViaOtp(otherPhone);
    await grantRole(other.user.id, 'restaurant_owner');
    // Re-login so the new role is reflected in a fresh access token.
    const otherReloaded = await loginViaOtp(otherPhone);

    const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
    const res = await request(server)
      .patch(`/v1/restaurants/${restaurant.id}`)
      .set('Authorization', `Bearer ${otherReloaded.access}`)
      .send({ name: 'Hijacked Name' });
    expect(res.status).toBe(403);

    // The restaurant's name must be untouched.
    const stillOriginal = await prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurant.id },
    });
    expect(stillOriginal.name).not.toBe('Hijacked Name');
  });

  it('restaurant_staff of restaurant A cannot create a category for restaurant B (Bloc 9.1, docs/31 §restaurant-ownership)', async () => {
    const staffPhone = `+2356600${Math.floor(1000 + Math.random() * 8999)}`;
    const staff = await loginViaOtp(staffPhone);
    const otherRestaurant = await prisma.restaurant.findFirstOrThrow({
      where: { slug: 'le-sahel-grill' },
    });
    // Scoped to a DIFFERENT restaurant than the one they're about to target.
    await grantRole(staff.user.id, 'restaurant_staff');
    await scopeRoleToRestaurant(staff.user.id, 'restaurant_staff', otherRestaurant.id);
    const staffReloaded = await loginViaOtp(staffPhone);

    const chezFatime = await prisma.restaurant.findFirstOrThrow({
      where: { slug: 'chez-fatime' },
    });
    const res = await request(server)
      .post(`/v1/restaurants/${chezFatime.id}/categories`)
      .set('Authorization', `Bearer ${staffReloaded.access}`)
      .send({ name: 'Intrusion' });
    expect(res.status).toBe(403);

    const leaked = await prisma.menuCategory.findFirst({
      where: { restaurantId: chezFatime.id, name: 'Intrusion' },
    });
    expect(leaked).toBeNull();
  });

  it('restaurant_staff of restaurant A cannot update a product belonging to restaurant B', async () => {
    const staffPhone = `+2356600${Math.floor(1000 + Math.random() * 8999)}`;
    const staff = await loginViaOtp(staffPhone);
    const otherRestaurant = await prisma.restaurant.findFirstOrThrow({
      where: { slug: 'le-sahel-grill' },
    });
    await grantRole(staff.user.id, 'restaurant_staff');
    await scopeRoleToRestaurant(staff.user.id, 'restaurant_staff', otherRestaurant.id);
    const staffReloaded = await loginViaOtp(staffPhone);

    const product = await prisma.product.findFirstOrThrow({
      where: { restaurant: { slug: 'chez-fatime' } },
    });
    const res = await request(server)
      .patch(`/v1/products/${product.id}`)
      .set('Authorization', `Bearer ${staffReloaded.access}`)
      .send({ name: 'Hijacked Product Name' });
    expect(res.status).toBe(403);

    const stillOriginal = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stillOriginal.name).not.toBe('Hijacked Product Name');
  });

  it('a restaurant_staff member of THIS restaurant (not just the owner) CAN manage its menu — the whole point of the fix', async () => {
    const staffPhone = `+2356600${Math.floor(1000 + Math.random() * 8999)}`;
    const staff = await loginViaOtp(staffPhone);
    const chezFatime = await prisma.restaurant.findFirstOrThrow({
      where: { slug: 'chez-fatime' },
    });
    await grantRole(staff.user.id, 'restaurant_staff');
    await scopeRoleToRestaurant(staff.user.id, 'restaurant_staff', chezFatime.id);
    const staffReloaded = await loginViaOtp(staffPhone);

    // This staff member holds no Restaurant.ownerUserId entry at all — the
    // pre-Bloc-9.1 ownerUserId-based check would have rejected this.
    await request(server)
      .post(`/v1/restaurants/${chezFatime.id}/categories`)
      .set('Authorization', `Bearer ${staffReloaded.access}`)
      .send({ name: `Staff Category ${randomUUID().slice(0, 8)}` })
      .expect(201);
  });

  it('a plain customer (no restaurants:write) is forbidden from creating a restaurant', async () => {
    const customer = await loginViaOtp(CUSTOMER_PHONE);
    const city = await prisma.city.findFirstOrThrow();
    const res = await request(server)
      .post('/v1/restaurants')
      .set('Authorization', `Bearer ${customer.access}`)
      .send({ cityId: city.id, name: 'Should Not Exist' });
    expect(res.status).toBe(403);
  });

  it('an unauthenticated request to a write endpoint is rejected (401)', async () => {
    const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
    await request(server).patch(`/v1/restaurants/${restaurant.id}`).send({ name: 'X' }).expect(401);
  });

  it('an owner cannot self-suspend their own restaurant — only admin:write can (docs/20 §6, §35)', async () => {
    const owner = await loginViaOtp(RESTAURANT_OWNER_PHONE);
    const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'chez-fatime' } });
    const res = await request(server)
      .patch(`/v1/restaurants/${restaurant.id}`)
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ status: 'suspended' });
    expect(res.status).toBe(403);
  });

  it('an admin MAY suspend any restaurant regardless of ownership, then restores it', async () => {
    const admin = await loginViaOtp(ADMIN_PHONE);
    const restaurant = await prisma.restaurant.findFirstOrThrow({
      where: { slug: 'le-sahel-grill' },
    });
    await request(server)
      .patch(`/v1/restaurants/${restaurant.id}`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ status: 'suspended' })
      .expect(200);

    // Restore it so it stays publicly visible for any test that runs after this one.
    await request(server)
      .patch(`/v1/restaurants/${restaurant.id}`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ status: 'active' })
      .expect(200);
  });

  it('role spoofing: a client-supplied `ownerUserId`/`status` in the create body is ignored (schema is .strict())', async () => {
    const owner = await loginViaOtp(RESTAURANT_OWNER_PHONE);
    const city = await prisma.city.findFirstOrThrow();
    const res = await request(server)
      .post('/v1/restaurants')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({
        cityId: city.id,
        name: `Spoof Attempt ${randomUUID().slice(0, 8)}`,
        ownerUserId: randomUUID(), // extra field — must be rejected outright
        status: 'active',
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
