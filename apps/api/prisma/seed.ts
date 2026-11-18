/**
 * The DEMO and development seed: the reference data (`reference-data.ts`) plus the
 * fixtures — eight test accounts on published numbers, one per role, the super_admin
 * among them, test restaurants and products, an online test courier. Refused on a live
 * production server (audit SEC-02): there, `seed-reference.ts` runs at every deploy and
 * `create-super-admin.ts` creates the first administrator.
 *
 * IMPORTANT: no business code assumes these values — this is data only
 * (docs/06 §6.14, decision A7/A8). Re-runnable (upserts).
 */
import { PrismaClient } from '@prisma/client';
import { assertFixturesAllowed } from './seed-guards';
import { seedReferenceData } from './reference-data';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // Demo fixtures: eight test accounts on published numbers (the super_admin among
  // them) and test restaurants. Never on a live server (audit SEC-02).
  assertFixturesAllowed(process.env);
  // The reference data first, with the defaults put back as this seed always did.
  const { country, city, counts } = await seedReferenceData(prisma, { resetTunables: true });

  // --- Bloc 0.5 walking skeleton: test customer, test courier, restaurant, products ---
  // Bloc 6: the courier is a real dispatch candidate (`couriers` row, below),
  // found by `deliveries`' PostGIS search once an order reaches `ready` —
  // never resolved eagerly at order creation any more (docs/25 §2).
  async function findOrCreateUser(phone: string, fullName: string): Promise<string> {
    const existing = await prisma.user.findFirst({ where: { phone, deletedAt: null } });
    if (existing) return existing.id;
    const created = await prisma.user.create({
      data: { phone, fullName, countryId: country.id, locale: 'fr', status: 'active' },
    });
    return created.id;
  }

  /**
   * Idempotent on (user_id, role) — NOT on the full (user_id, role, scope)
   * tuple. A re-run against a database already seeded under the PRE-Bloc-9
   * seed (which granted `restaurant_owner`/`restaurant_staff` unscoped)
   * must MIGRATE that row's scope in place rather than insert a second one:
   * migration 0028's partial unique index allows at most one
   * (user_id, role) row for those two roles, scope or no scope, and a blind
   * INSERT here would violate it outright on every `pnpm db:seed` after
   * upgrading. Safe for every other role too — this seed only ever grants
   * each of them once per user.
   */
  async function ensureRole(
    userId: string,
    role: string,
    scopeRestaurantId: string | null = null,
  ): Promise<void> {
    const existing = await prisma.$queryRaw<Array<{ scope_restaurant_id: string | null }>>`
      SELECT scope_restaurant_id FROM user_roles
      WHERE user_id = ${userId}::uuid AND role = ${role}
        AND scope_country_id IS NULL AND scope_city_id IS NULL
    `;
    if (existing.length === 0) {
      await prisma.$executeRaw`
        INSERT INTO user_roles (user_id, role, scope_restaurant_id)
        VALUES (${userId}::uuid, ${role}, ${scopeRestaurantId}::uuid)
      `;
      return;
    }
    if (existing[0]!.scope_restaurant_id !== scopeRestaurantId) {
      await prisma.$executeRaw`
        UPDATE user_roles SET scope_restaurant_id = ${scopeRestaurantId}::uuid
        WHERE user_id = ${userId}::uuid AND role = ${role}
          AND scope_country_id IS NULL AND scope_city_id IS NULL
      `;
    }
  }

  const customerId = await findOrCreateUser('+23566000001', 'Client Test');
  await ensureRole(customerId, 'customer');

  const courierId = await findOrCreateUser('+23566000002', 'Livreur Test');
  await ensureRole(courierId, 'courier');

  // --- Bloc 6 — a default delivery address for the test customer ------------
  // `orders.create` snapshots the customer's DEFAULT address at order
  // creation (docs/25 §8) — without one, order creation fails outright, so
  // this fixture is load-bearing for every manual/dev flow, not cosmetic.
  const existingDefaultAddress = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM addresses WHERE user_id = ${customerId}::uuid AND is_default = true LIMIT 1
  `;
  if (existingDefaultAddress.length === 0) {
    await prisma.$executeRaw`
      INSERT INTO addresses (user_id, label, recipient_phone, city_id, quartier, street, landmark, geom, geocode_status, is_default)
      VALUES (${customerId}::uuid, 'Domicile', '+23566000001', ${city.id}::uuid, 'Klemat', 'Rue 42',
        'Près du rond-point Kondolé', ST_SetSRID(ST_MakePoint(15.0620, 12.1400), 4326)::geography, 'ok', true)
    `;
  }

  // --- Bloc 6 — the test courier is ONLINE with a fresh position near the
  // seeded restaurants, so the walking-skeleton dispatch flow actually finds
  // a candidate out of the box (docs/25 §4, §11).
  await prisma.$executeRaw`
    INSERT INTO couriers (user_id, status, last_geom, last_accuracy_m, last_location_at)
    VALUES (${courierId}::uuid, 'online',
      ST_SetSRID(ST_MakePoint(15.0570, 12.1360), 4326)::geography, 15, now())
    ON CONFLICT (user_id) DO UPDATE SET
      status = 'online', last_geom = EXCLUDED.last_geom,
      last_accuracy_m = EXCLUDED.last_accuracy_m, last_location_at = now()
  `;

  // --- Bloc 1 — Identity & Access: one test user per role (docs/19 §46) -----
  // Dev/test fixtures ONLY. No password/OTP/MFA secret is seeded here — every
  // login still goes through the real OTP flow; this just pre-creates the
  // identity + role grant so `pnpm db:seed` alone is enough to exercise RBAC
  // end to end in the integration tests.
  // `restaurant_owner`/`restaurant_staff` are scoped roles (Bloc 9, docs/30
  // §restaurant-scope) — their grant is deferred until the first seeded
  // restaurant exists below (`restaurantId`), so this fixture scopes to a
  // REAL restaurant rather than a global grant `isMemberOfRestaurant` could
  // never match.
  const restaurantOwnerId = await findOrCreateUser('+23566000003', 'Restaurateur Test');
  const restaurantStaffId = await findOrCreateUser('+23566000004', 'Staff Restaurant Test');

  const supportId = await findOrCreateUser('+23566000005', 'Support Test');
  await ensureRole(supportId, 'support');

  const financeId = await findOrCreateUser('+23566000006', 'Finance Test');
  await ensureRole(financeId, 'finance');

  const adminId = await findOrCreateUser('+23566000007', 'Admin Test');
  await ensureRole(adminId, 'admin');

  const superAdminId = await findOrCreateUser('+23566000008', 'Super Admin Test');
  await ensureRole(superAdminId, 'super_admin');

  // --- Bloc 2 — Catalog & Restaurant Discovery (docs/20 §47-§48) -------------
  function slugify(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async function ensureRestaurant(input: {
    slug: string;
    name: string;
    description: string;
    phone: string;
    addressText: string;
    logoUrl: string;
    coverUrl: string;
    status: string;
    ownerUserId?: string;
    ratingAvg: number;
    ratingCount: number;
    prepTimeMin: number;
    minOrderMinor: bigint;
  }): Promise<string> {
    const existing = await prisma.restaurant.findFirst({ where: { slug: input.slug } });
    if (existing) return existing.id;
    const created = await prisma.restaurant.create({
      data: {
        countryId: country.id,
        cityId: city.id,
        slug: input.slug,
        name: input.name,
        description: input.description,
        phone: input.phone,
        addressText: input.addressText,
        logoUrl: input.logoUrl,
        coverUrl: input.coverUrl,
        currency: 'XAF',
        status: input.status,
        ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
        ratingAvg: input.ratingAvg,
        ratingCount: input.ratingCount,
        prepTimeMin: input.prepTimeMin,
        minOrderMinor: input.minOrderMinor,
      },
    });
    return created.id;
  }

  async function ensureCategory(
    restaurantId: string,
    name: string,
    sortOrder: number,
  ): Promise<string> {
    const existing = await prisma.menuCategory.findFirst({ where: { restaurantId, name } });
    if (existing) return existing.id;
    const created = await prisma.menuCategory.create({
      data: { restaurantId, name, sortOrder },
    });
    return created.id;
  }

  async function ensureProduct(input: {
    restaurantId: string;
    categoryId: string;
    name: string;
    description: string;
    imageUrl: string;
    priceMinor: bigint;
    sortOrder: number;
    isAvailable?: boolean;
  }): Promise<string> {
    const existing = await prisma.product.findFirst({
      where: { restaurantId: input.restaurantId, name: input.name },
    });
    if (existing) return existing.id;
    const created = await prisma.product.create({
      data: {
        restaurantId: input.restaurantId,
        categoryId: input.categoryId,
        slug: `${slugify(input.name)}-${input.restaurantId.slice(0, 8)}`,
        name: input.name,
        description: input.description,
        imageUrl: input.imageUrl,
        priceMinor: input.priceMinor,
        currency: 'XAF',
        sortOrder: input.sortOrder,
        isAvailable: input.isAvailable ?? true,
      },
    });
    return created.id;
  }

  async function ensureOptionGroup(input: {
    productId: string;
    name: string;
    selectionType: 'single' | 'multiple';
    minSelections: number;
    maxSelections: number;
    isRequired: boolean;
    options: Array<{ name: string; priceDeltaMinor: bigint; isAvailable?: boolean }>;
  }): Promise<void> {
    const existing = await prisma.productOptionGroup.findFirst({
      where: { productId: input.productId, name: input.name },
    });
    if (existing) return;
    const group = await prisma.productOptionGroup.create({
      data: {
        productId: input.productId,
        name: input.name,
        selectionType: input.selectionType,
        minSelections: input.minSelections,
        maxSelections: input.maxSelections,
        isRequired: input.isRequired,
      },
    });
    for (const [i, o] of input.options.entries()) {
      await prisma.productOption.create({
        data: {
          optionGroupId: group.id,
          name: o.name,
          priceDeltaMinor: o.priceDeltaMinor,
          currency: 'XAF',
          isAvailable: o.isAvailable ?? true,
          sortOrder: i,
        },
      });
    }
  }

  const minutesOf = (hour: number, minute = 0): number => hour * 60 + minute;

  async function ensureHours(
    restaurantId: string,
    shifts: Array<{ weekday: number; opens: [number, number?]; closes: [number, number?] }>,
  ): Promise<void> {
    for (const s of shifts) {
      const opensMinutes = minutesOf(s.opens[0], s.opens[1] ?? 0);
      const existing = await prisma.restaurantHours.findFirst({
        where: { restaurantId, weekday: s.weekday, opensMinutes },
      });
      if (existing) continue;
      await prisma.restaurantHours.create({
        data: {
          restaurantId,
          weekday: s.weekday,
          opensMinutes,
          closesMinutes: minutesOf(s.closes[0], s.closes[1] ?? 0),
        },
      });
    }
  }

  const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
  const dailyHours = (opens: [number, number?], closes: [number, number?]) =>
    EVERY_DAY.map((weekday) => ({ weekday, opens, closes }));

  // Chez Fatimé (Bloc 0.5 walking-skeleton fixture — slug/product names
  // preserved EXACTLY, only enriched with Bloc 2 profile/catalog data).
  const restaurantId = await ensureRestaurant({
    slug: 'chez-fatime',
    name: 'Chez Fatimé',
    description: 'Cuisine tchadienne familiale — poulet braisé, grillades et plats mijotés.',
    phone: '+23566100001',
    addressText: 'Avenue Charles de Gaulle, N’Djamena',
    logoUrl: 'https://placehold.co/128x128/E8531B/FFFFFF.png?text=CF',
    coverUrl: 'https://placehold.co/800x400/E8531B/FFFFFF.png?text=Chez+Fatim%C3%A9',
    status: 'active',
    ownerUserId: restaurantOwnerId,
    ratingAvg: 4.6,
    ratingCount: 128,
    prepTimeMin: 25,
    minOrderMinor: 1000n,
  });
  // Bloc 6 (docs/25 §21): pickup location comes from the restaurant's OWN
  // geom, never asked of the client. `geom` is PostGIS — set via raw SQL
  // (docs/17 D-02 convention, same as `orders.dropoff_geom`/`couriers.last_geom`).
  await prisma.$executeRaw`
    UPDATE restaurants SET geom = ST_SetSRID(ST_MakePoint(15.0557, 12.1348), 4326)::geography
    WHERE id = ${restaurantId}::uuid
  `;
  // Bloc 9 (docs/30 §restaurant-scope): the owner/staff fixtures are scoped
  // to THIS restaurant — matches `ownerUserId: restaurantOwnerId` above, and
  // is what lets the integration tests actually confirm/ready/reject one of
  // its orders through the real authorization check.
  await ensureRole(restaurantOwnerId, 'restaurant_owner', restaurantId);
  await ensureRole(restaurantStaffId, 'restaurant_staff', restaurantId);
  await ensureHours(restaurantId, dailyHours([11, 0], [22, 0]));
  const fatimePlats = await ensureCategory(restaurantId, 'Plats', 0);
  const fatimeBoissons = await ensureCategory(restaurantId, 'Boissons', 1);
  const pouletId = await ensureProduct({
    restaurantId,
    categoryId: fatimePlats,
    name: 'Poulet braisé',
    description: 'Poulet mariné et braisé au feu de bois, servi avec attiéké.',
    imageUrl: 'https://placehold.co/400x300/E8531B/FFFFFF.png?text=Poulet+Brais%C3%A9',
    priceMinor: 3500n,
    sortOrder: 0,
  });
  await ensureOptionGroup({
    productId: pouletId,
    name: 'Portion',
    selectionType: 'single',
    minSelections: 1,
    maxSelections: 1,
    isRequired: true,
    options: [
      { name: 'Demi', priceDeltaMinor: -500n },
      { name: 'Entier', priceDeltaMinor: 0n },
      { name: 'Familial', priceDeltaMinor: 1500n },
    ],
  });
  const fritesId = await ensureProduct({
    restaurantId,
    categoryId: fatimePlats,
    name: 'Frites',
    description: 'Frites maison croustillantes.',
    imageUrl: 'https://placehold.co/400x300/E8531B/FFFFFF.png?text=Frites',
    priceMinor: 1000n,
    sortOrder: 1,
  });
  await ensureOptionGroup({
    productId: fritesId,
    name: 'Sauce',
    selectionType: 'multiple',
    minSelections: 0,
    maxSelections: 2,
    isRequired: false,
    options: [
      { name: 'Mayonnaise', priceDeltaMinor: 0n },
      { name: 'Piment', priceDeltaMinor: 0n },
      { name: 'Sans sauce', priceDeltaMinor: 0n },
    ],
  });
  await ensureProduct({
    restaurantId,
    categoryId: fatimeBoissons,
    name: 'Jus de bissap',
    description: 'Jus d’hibiscus frais, légèrement sucré.',
    imageUrl: 'https://placehold.co/400x300/0E7C66/FFFFFF.png?text=Bissap',
    priceMinor: 800n,
    sortOrder: 0,
  });

  // Le Sahel Grill — active, exceptional closure fixture (docs/20 §22, §48).
  const sahelId = await ensureRestaurant({
    slug: 'le-sahel-grill',
    name: 'Le Sahel Grill',
    description: 'Grillades, burgers maison et jus frais.',
    phone: '+23566100002',
    addressText: 'Quartier Klemat, N’Djamena',
    logoUrl: 'https://placehold.co/128x128/0E7C66/FFFFFF.png?text=SG',
    coverUrl: 'https://placehold.co/800x400/0E7C66/FFFFFF.png?text=Le+Sahel+Grill',
    status: 'active',
    ratingAvg: 4.3,
    ratingCount: 64,
    prepTimeMin: 30,
    minOrderMinor: 1500n,
  });
  await ensureHours(sahelId, dailyHours([11, 30], [23, 0]));
  const sahelBurgers = await ensureCategory(sahelId, 'Burgers', 0);
  const sahelBoissons = await ensureCategory(sahelId, 'Boissons', 1);
  const burgerId = await ensureProduct({
    restaurantId: sahelId,
    categoryId: sahelBurgers,
    name: 'Burger Sahel',
    description: 'Steak grillé, cheddar, salade, sauce maison.',
    imageUrl: 'https://placehold.co/400x300/0E7C66/FFFFFF.png?text=Burger',
    priceMinor: 2800n,
    sortOrder: 0,
  });
  await ensureOptionGroup({
    productId: burgerId,
    name: 'Supplément',
    selectionType: 'multiple',
    minSelections: 0,
    maxSelections: 3,
    isRequired: false,
    options: [
      { name: 'Fromage', priceDeltaMinor: 500n },
      { name: 'Œuf', priceDeltaMinor: 400n },
      { name: 'Bacon', priceDeltaMinor: 700n },
    ],
  });
  await ensureProduct({
    restaurantId: sahelId,
    categoryId: sahelBurgers,
    name: 'Brochettes de bœuf',
    description: 'Brochettes marinées, servies avec oignons grillés.',
    imageUrl: 'https://placehold.co/400x300/0E7C66/FFFFFF.png?text=Brochettes',
    priceMinor: 3000n,
    sortOrder: 1,
  });
  await ensureProduct({
    restaurantId: sahelId,
    categoryId: sahelBoissons,
    name: 'Jus de gingembre',
    description: 'Jus de gingembre frais, servi glacé.',
    imageUrl: 'https://placehold.co/400x300/0E7C66/FFFFFF.png?text=Gingembre',
    priceMinor: 700n,
    sortOrder: 0,
  });
  const closureExisting = await prisma.restaurantClosure.findFirst({
    where: { restaurantId: sahelId },
  });
  if (!closureExisting) {
    await prisma.restaurantClosure.create({
      data: {
        restaurantId: sahelId,
        startsAt: new Date('2026-12-25T00:00:00Z'),
        endsAt: new Date('2026-12-26T00:00:00Z'),
        reason: 'Fermeture — jour férié',
      },
    });
  }

  // Pizza N'Djam — active, OVERNIGHT hours fixture (18:00 -> 02:00, docs/20 §20, §48).
  const pizzaId = await ensureRestaurant({
    slug: 'pizza-ndjam',
    name: "Pizza N'Djam",
    description: 'Pizzas au feu de bois, ouvert tard le soir.',
    phone: '+23566100003',
    addressText: 'Avenue Mobutu, N’Djamena',
    logoUrl: 'https://placehold.co/128x128/C43D0C/FFFFFF.png?text=PN',
    coverUrl: 'https://placehold.co/800x400/C43D0C/FFFFFF.png?text=Pizza+NDjam',
    status: 'active',
    ratingAvg: 4.8,
    ratingCount: 201,
    prepTimeMin: 35,
    minOrderMinor: 2000n,
  });
  await ensureHours(pizzaId, dailyHours([18, 0], [2, 0]));
  const pizzaCat = await ensureCategory(pizzaId, 'Pizzas', 0);
  const pizzaDesserts = await ensureCategory(pizzaId, 'Desserts', 1);
  await ensureProduct({
    restaurantId: pizzaId,
    categoryId: pizzaCat,
    name: 'Pizza Margherita',
    description: 'Tomate, mozzarella, basilic frais.',
    imageUrl: 'https://placehold.co/400x300/C43D0C/FFFFFF.png?text=Margherita',
    priceMinor: 4500n,
    sortOrder: 0,
  });
  await ensureProduct({
    restaurantId: pizzaId,
    categoryId: pizzaCat,
    name: 'Pizza 4 Fromages',
    description: 'Mozzarella, chèvre, gorgonzola, emmental.',
    imageUrl: 'https://placehold.co/400x300/C43D0C/FFFFFF.png?text=4+Fromages',
    priceMinor: 5500n,
    sortOrder: 1,
  });
  await ensureProduct({
    restaurantId: pizzaId,
    categoryId: pizzaDesserts,
    name: 'Tiramisu',
    description: 'Tiramisu classique au café.',
    imageUrl: 'https://placehold.co/400x300/C43D0C/FFFFFF.png?text=Tiramisu',
    priceMinor: 2000n,
    sortOrder: 0,
    isAvailable: false, // deliberately unavailable — docs/20 §48 test fixture
  });

  // Snack Rapide — PAUSED (visible, temporarily unavailable — docs/20 §6, §48).
  const snackId = await ensureRestaurant({
    slug: 'snack-rapide',
    name: 'Snack Rapide',
    description: 'Sandwichs et snacks à emporter.',
    phone: '+23566100004',
    addressText: 'Marché Central, N’Djamena',
    logoUrl: 'https://placehold.co/128x128/8A8078/FFFFFF.png?text=SR',
    coverUrl: 'https://placehold.co/800x400/8A8078/FFFFFF.png?text=Snack+Rapide',
    status: 'paused',
    ratingAvg: 4.0,
    ratingCount: 22,
    prepTimeMin: 15,
    minOrderMinor: 500n,
  });
  const snackCat = await ensureCategory(snackId, 'Sandwichs', 0);
  await ensureProduct({
    restaurantId: snackId,
    categoryId: snackCat,
    name: 'Sandwich Poulet',
    description: 'Sandwich au poulet grillé, crudités.',
    imageUrl: 'https://placehold.co/400x300/8A8078/FFFFFF.png?text=Sandwich',
    priceMinor: 1500n,
    sortOrder: 0,
  });

  // Le Palace Fermé — SUSPENDED (must NEVER appear in the public catalogue — docs/20 §6, §48, §51).
  const suspendedId = await ensureRestaurant({
    slug: 'le-palace-ferme',
    name: 'Le Palace Fermé',
    description: 'Restaurant suspendu — fixture de test de visibilité.',
    phone: '+23566100005',
    addressText: 'Zone industrielle, N’Djamena',
    logoUrl: 'https://placehold.co/128x128/C62828/FFFFFF.png?text=X',
    coverUrl: 'https://placehold.co/800x400/C62828/FFFFFF.png?text=Suspendu',
    status: 'suspended',
    ratingAvg: 3.2,
    ratingCount: 5,
    prepTimeMin: 20,
    minOrderMinor: 0n,
  });
  const suspendedCat = await ensureCategory(suspendedId, 'Plats', 0);
  await ensureProduct({
    restaurantId: suspendedId,
    categoryId: suspendedCat,
    name: 'Plat fantôme',
    description: 'Ne doit jamais apparaître publiquement.',
    imageUrl: 'https://placehold.co/400x300/C62828/FFFFFF.png?text=X',
    priceMinor: 1000n,
    sortOrder: 0,
  });

  const catalogRestaurantIds = [restaurantId, sahelId, pizzaId, snackId, suspendedId];

  console.log(
    `Seed OK — market ${country.isoCode}/${city.slug}, ${counts.currencies} currencies, ` +
      `${counts.providers} payment providers (active: ${counts.activeProviders.join('+')}), ` +
      `${counts.accounts} ledger accounts, ${counts.roles} roles, ${counts.permissions} permissions. ` +
      `Identity fixtures: customer ${customerId}, courier ${courierId}, restaurant_owner ${restaurantOwnerId}, ` +
      `restaurant_staff ${restaurantStaffId}, support ${supportId}, finance ${financeId}, admin ${adminId}, ` +
      `super_admin ${superAdminId}. Catalog: ${catalogRestaurantIds.length} restaurants seeded ` +
      `(active: chez-fatime, le-sahel-grill, pizza-ndjam; paused: snack-rapide; suspended: le-palace-ferme). ` +
      `Bloc 6: customer has a default geocoded address, courier is online with a fresh position, ` +
      `chez-fatime has a pickup geom — dispatch is exercisable out of the box.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
