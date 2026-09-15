/**
 * Seed the launch market: Tchad / N'Djamena / XAF.
 *
 * IMPORTANT: no business code assumes these values — this is data only
 * (docs/06 §6.14, decision A7/A8). Re-runnable (upserts).
 */
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { LAUNCH_MARKET, PLATFORM_SETTINGS_DEFAULTS } from '@djafat/config';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // --- currencies ----------------------------------------------------------
  const currencies = [
    { code: 'XAF', exponent: 0, symbol: 'FCFA', displayName: 'Franc CFA (BEAC)' },
    { code: 'XOF', exponent: 0, symbol: 'CFA', displayName: 'Franc CFA (BCEAO)' },
    { code: 'EUR', exponent: 2, symbol: '€', displayName: 'Euro' },
  ];
  for (const c of currencies) {
    await prisma.currency.upsert({ where: { code: c.code }, create: c, update: c });
  }

  // --- country + city ----------------------------------------------------------
  const country = await prisma.country.upsert({
    where: { isoCode: LAUNCH_MARKET.countryIso },
    update: { active: true },
    create: {
      isoCode: LAUNCH_MARKET.countryIso,
      name: LAUNCH_MARKET.countryName,
      currency: LAUNCH_MARKET.currency,
      defaultLocale: LAUNCH_MARKET.defaultLocale,
      timezone: LAUNCH_MARKET.timezone,
      dialCode: LAUNCH_MARKET.dialCode,
      active: true,
    },
  });

  const city = await prisma.city.upsert({
    where: { countryId_slug: { countryId: country.id, slug: LAUNCH_MARKET.citySlug } },
    update: { active: true },
    create: {
      countryId: country.id,
      name: LAUNCH_MARKET.cityName,
      slug: LAUNCH_MARKET.citySlug,
      timezone: LAUNCH_MARKET.timezone,
      active: true,
    },
  });

  // --- roles -----------------------------------------------------------------
  const roles: Array<{ code: string; label: string }> = [
    { code: 'customer', label: 'Client' },
    { code: 'restaurant_owner', label: 'Propriétaire de restaurant' },
    { code: 'restaurant_staff', label: 'Personnel de restaurant' },
    { code: 'courier', label: 'Livreur' },
    { code: 'support', label: 'Support client' },
    { code: 'finance', label: 'Finance' },
    { code: 'admin', label: 'Administrateur' },
    { code: 'super_admin', label: 'Super administrateur' },
  ];
  for (const r of roles) {
    await prisma.role.upsert({ where: { code: r.code }, create: r, update: r });
  }

  // --- permissions + role_permissions (Bloc 1 — docs/19 §17-19) --------------
  const permissions: Array<{ code: string; label: string }> = [
    { code: 'users:read', label: 'Lire les utilisateurs' },
    { code: 'users:write', label: 'Modifier les utilisateurs' },
    { code: 'orders:read', label: 'Lire les commandes' },
    { code: 'orders:write', label: 'Modifier les commandes' },
    { code: 'restaurants:read', label: 'Lire les restaurants' },
    { code: 'restaurants:write', label: 'Modifier les restaurants' },
    { code: 'menus:read', label: 'Lire les menus' },
    { code: 'menus:write', label: 'Modifier les menus' },
    { code: 'deliveries:read', label: 'Lire les livraisons' },
    { code: 'deliveries:write', label: 'Modifier les livraisons' },
    { code: 'payments:read', label: 'Lire les paiements' },
    { code: 'payments:write', label: 'Annuler un paiement' },
    { code: 'payments:refund', label: 'Rembourser un paiement' },
    { code: 'ledger:read', label: 'Lire le grand livre' },
    { code: 'ledger:write', label: 'Écrire dans le grand livre' },
    { code: 'payouts:read', label: 'Lire les virements' },
    { code: 'payouts:write', label: 'Déclencher un virement' },
    { code: 'admin:read', label: "Lire la console d'administration" },
    { code: 'admin:write', label: "Modifier la console d'administration" },
  ];
  for (const p of permissions) {
    await prisma.permission.upsert({ where: { code: p.code }, create: p, update: p });
  }

  // customer/restaurant_owner/restaurant_staff/courier are deliberately ABSENT
  // here for their own resources: that access is governed by OWNERSHIP
  // (docs/19 §21), not a blanket permission grant. `ledger:write` is granted
  // to NO role — the ledger stays single-writer even for super_admin
  // (docs/15 AD-02); it exists as a defined permission for future tooling.
  const rolePermissions: Record<string, string[]> = {
    restaurant_owner: [
      'restaurants:read',
      'restaurants:write',
      'menus:read',
      'menus:write',
      'orders:read',
    ],
    restaurant_staff: ['restaurants:read', 'menus:read', 'menus:write', 'orders:read'],
    courier: ['deliveries:read', 'deliveries:write', 'orders:read'],
    support: ['users:read', 'orders:read', 'payments:read', 'deliveries:read'],
    finance: [
      'payments:read',
      'payments:write',
      'payments:refund',
      'ledger:read',
      'payouts:read',
      'payouts:write',
      'orders:read',
    ],
    admin: [
      'users:read',
      'users:write',
      'orders:read',
      'orders:write',
      'restaurants:read',
      'restaurants:write',
      'menus:read',
      'menus:write',
      'deliveries:read',
      'deliveries:write',
      'payments:read',
      'payments:write',
      'payments:refund',
      'payouts:read',
      'payouts:write',
      'ledger:read',
      'admin:read',
      'admin:write',
    ],
    super_admin: [
      'users:read',
      'users:write',
      'orders:read',
      'orders:write',
      'restaurants:read',
      'restaurants:write',
      'menus:read',
      'menus:write',
      'deliveries:read',
      'deliveries:write',
      'payments:read',
      'payments:write',
      'payments:refund',
      'payouts:read',
      'payouts:write',
      'ledger:read',
      'admin:read',
      'admin:write',
    ],
  };
  for (const [role, perms] of Object.entries(rolePermissions)) {
    for (const permission of perms) {
      await prisma.$executeRaw`
        INSERT INTO role_permissions (role, permission) VALUES (${role}, ${permission})
        ON CONFLICT (role, permission) DO NOTHING
      `;
    }
  }

  // --- payment methods / providers (data-driven — AD-04) --------------------
  const methods = [
    { code: 'cash_on_delivery', displayName: 'Paiement à la livraison' },
    { code: 'mobile_money', displayName: 'Mobile Money' },
    { code: 'card', displayName: 'Carte bancaire' },
  ];
  for (const m of methods) {
    await prisma.paymentMethod.upsert({ where: { code: m.code }, create: m, update: m });
  }

  const providers = [
    { code: 'cash', methodCode: 'cash_on_delivery', displayName: 'Espèces', active: true },
    // Deterministic mock — permanent, dev/CI only. Enabled here for non-prod.
    { code: 'mock', methodCode: 'mobile_money', displayName: 'Mock Payment (dev)', active: true },
    // Prepared but INACTIVE until API/contract access is verified (decision A1).
    {
      code: 'airtel_money',
      methodCode: 'mobile_money',
      displayName: 'Airtel Money',
      active: false,
    },
    {
      code: 'moov_money',
      methodCode: 'mobile_money',
      displayName: 'Moov Money (Flooz)',
      active: false,
    },
  ];
  for (const p of providers) {
    await prisma.paymentProviderRow.upsert({
      where: { code: p.code },
      create: { ...p, capabilities: {} },
      update: { active: p.active },
    });
  }

  // Availability for the launch market: cash + mock only.
  for (const providerCode of ['cash', 'mock']) {
    const existing = await prisma.paymentProviderConfig.findFirst({
      where: { providerCode, countryId: country.id, cityId: city.id },
    });
    if (!existing) {
      await prisma.paymentProviderConfig.create({
        data: {
          providerCode,
          countryId: country.id,
          cityId: city.id,
          enabled: true,
          priority: 100,
        },
      });
    }
  }

  // --- commission (country-level 20%) --------------------------------------
  const commission = await prisma.commissionRule.findFirst({
    where: { scope: 'country', countryId: country.id, active: true },
  });
  if (!commission) {
    await prisma.commissionRule.create({
      data: { scope: 'country', countryId: country.id, rateBps: 2000, priority: 100, active: true },
    });
  }
  // No tax rules (0%) for the launch market.

  // --- platform settings (A2–A9 defaults) --------------------------------------
  const settings: Array<{ key: string; value: Prisma.InputJsonValue }> = [
    { key: 'unpaid_order_ttl_seconds', value: PLATFORM_SETTINGS_DEFAULTS.unpaid_order_ttl_seconds },
    { key: 'offer_timeout_seconds', value: PLATFORM_SETTINGS_DEFAULTS.offer_timeout_seconds },
    { key: 'psp_fee_policy', value: PLATFORM_SETTINGS_DEFAULTS.psp_fee_policy },
    { key: 'funds_release_policy', value: PLATFORM_SETTINGS_DEFAULTS.funds_release_policy },
    {
      key: 'courier_compensation_policy',
      value: PLATFORM_SETTINGS_DEFAULTS.courier_compensation_policy,
    },
    { key: 'otp_channels', value: PLATFORM_SETTINGS_DEFAULTS.otp_channels },
  ];
  for (const s of settings) {
    const existing = await prisma.platformSetting.findFirst({
      where: { key: s.key, scope: 'global', countryId: null, cityId: null },
    });
    if (existing) {
      await prisma.platformSetting.update({ where: { id: existing.id }, data: { value: s.value } });
    } else {
      await prisma.platformSetting.create({
        data: { key: s.key, scope: 'global', value: s.value },
      });
    }
  }
  const floatCap = await prisma.platformSetting.findFirst({
    where: { key: 'courier_cash_float_cap_minor', scope: 'country', countryId: country.id },
  });
  if (floatCap) {
    await prisma.platformSetting.update({
      where: { id: floatCap.id },
      data: { value: PLATFORM_SETTINGS_DEFAULTS.courier_cash_float_cap_minor },
    });
  } else {
    await prisma.platformSetting.create({
      data: {
        key: 'courier_cash_float_cap_minor',
        scope: 'country',
        countryId: country.id,
        value: PLATFORM_SETTINGS_DEFAULTS.courier_cash_float_cap_minor,
      },
    });
  }

  // --- feature flags -------------------------------------------------------
  for (const key of ['mock_payment_provider', 'pwa_install_prompt']) {
    await prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled: key === 'mock_payment_provider' },
      update: {},
    });
  }

  // --- ledger chart of accounts (XAF singletons) --------------------------------
  const accounts: Array<{ code: string; type: string; ownerType?: string }> = [
    { code: 'DJAFAT_BANK', type: 'asset', ownerType: 'djafat' },
    { code: 'DJAFAT_REVENUE', type: 'revenue', ownerType: 'djafat' },
    { code: 'PSP_FEE_EXPENSE', type: 'expense', ownerType: 'djafat' },
    { code: 'PROMO_EXPENSE', type: 'expense', ownerType: 'djafat' },
    { code: 'PSP_CLEARING', type: 'asset', ownerType: 'psp' },
    { code: 'REFUNDS_PAYABLE', type: 'liability', ownerType: 'djafat' },
    { code: 'CUSTOMER_CLEARING', type: 'liability', ownerType: 'djafat' },
  ];
  for (const a of accounts) {
    const existing = await prisma.ledgerAccount.findFirst({
      where: { code: a.code, ownerId: null, currency: 'XAF' },
    });
    if (!existing) {
      await prisma.ledgerAccount.create({
        data: { code: a.code, type: a.type, ownerType: a.ownerType ?? null, currency: 'XAF' },
      });
    }
  }

  // --- Bloc 0.5 walking skeleton: test customer, test courier, restaurant, products ---
  // See docs/18 §4 — a single seeded courier is resolved deterministically by
  // `orders` at creation time; no real dispatch yet (Bloc 6).
  async function findOrCreateUser(phone: string, fullName: string): Promise<string> {
    const existing = await prisma.user.findFirst({ where: { phone, deletedAt: null } });
    if (existing) return existing.id;
    const created = await prisma.user.create({
      data: { phone, fullName, countryId: country.id, locale: 'fr', status: 'active' },
    });
    return created.id;
  }

  async function ensureRole(userId: string, role: string): Promise<void> {
    const existing = await prisma.$queryRaw<Array<{ user_id: string }>>`
      SELECT user_id FROM user_roles
      WHERE user_id = ${userId}::uuid AND role = ${role}
        AND scope_restaurant_id IS NULL AND scope_country_id IS NULL AND scope_city_id IS NULL
    `;
    if (existing.length === 0) {
      await prisma.$executeRaw`INSERT INTO user_roles (user_id, role) VALUES (${userId}::uuid, ${role})`;
    }
  }

  const customerId = await findOrCreateUser('+23566000001', 'Client Test');
  await ensureRole(customerId, 'customer');

  const courierId = await findOrCreateUser('+23566000002', 'Livreur Test');
  await ensureRole(courierId, 'courier');

  // --- Bloc 1 — Identity & Access: one test user per role (docs/19 §46) -----
  // Dev/test fixtures ONLY. No password/OTP/MFA secret is seeded here — every
  // login still goes through the real OTP flow; this just pre-creates the
  // identity + role grant so `pnpm db:seed` alone is enough to exercise RBAC
  // end to end in the integration tests.
  const restaurantOwnerId = await findOrCreateUser('+23566000003', 'Restaurateur Test');
  await ensureRole(restaurantOwnerId, 'restaurant_owner');

  const restaurantStaffId = await findOrCreateUser('+23566000004', 'Staff Restaurant Test');
  await ensureRole(restaurantStaffId, 'restaurant_staff');

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
    logoUrl: 'https://placehold.co/128x128/E8531B/FFFFFF?text=CF',
    coverUrl: 'https://placehold.co/800x400/E8531B/FFFFFF?text=Chez+Fatim%C3%A9',
    status: 'active',
    ownerUserId: restaurantOwnerId,
    ratingAvg: 4.6,
    ratingCount: 128,
    prepTimeMin: 25,
    minOrderMinor: 1000n,
  });
  await ensureHours(restaurantId, dailyHours([11, 0], [22, 0]));
  const fatimePlats = await ensureCategory(restaurantId, 'Plats', 0);
  const fatimeBoissons = await ensureCategory(restaurantId, 'Boissons', 1);
  const pouletId = await ensureProduct({
    restaurantId,
    categoryId: fatimePlats,
    name: 'Poulet braisé',
    description: 'Poulet mariné et braisé au feu de bois, servi avec attiéké.',
    imageUrl: 'https://placehold.co/400x300/E8531B/FFFFFF?text=Poulet+Brais%C3%A9',
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
    imageUrl: 'https://placehold.co/400x300/E8531B/FFFFFF?text=Frites',
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
    imageUrl: 'https://placehold.co/400x300/0E7C66/FFFFFF?text=Bissap',
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
    logoUrl: 'https://placehold.co/128x128/0E7C66/FFFFFF?text=SG',
    coverUrl: 'https://placehold.co/800x400/0E7C66/FFFFFF?text=Le+Sahel+Grill',
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
    imageUrl: 'https://placehold.co/400x300/0E7C66/FFFFFF?text=Burger',
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
    imageUrl: 'https://placehold.co/400x300/0E7C66/FFFFFF?text=Brochettes',
    priceMinor: 3000n,
    sortOrder: 1,
  });
  await ensureProduct({
    restaurantId: sahelId,
    categoryId: sahelBoissons,
    name: 'Jus de gingembre',
    description: 'Jus de gingembre frais, servi glacé.',
    imageUrl: 'https://placehold.co/400x300/0E7C66/FFFFFF?text=Gingembre',
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
    logoUrl: 'https://placehold.co/128x128/C43D0C/FFFFFF?text=PN',
    coverUrl: 'https://placehold.co/800x400/C43D0C/FFFFFF?text=Pizza+NDjam',
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
    imageUrl: 'https://placehold.co/400x300/C43D0C/FFFFFF?text=Margherita',
    priceMinor: 4500n,
    sortOrder: 0,
  });
  await ensureProduct({
    restaurantId: pizzaId,
    categoryId: pizzaCat,
    name: 'Pizza 4 Fromages',
    description: 'Mozzarella, chèvre, gorgonzola, emmental.',
    imageUrl: 'https://placehold.co/400x300/C43D0C/FFFFFF?text=4+Fromages',
    priceMinor: 5500n,
    sortOrder: 1,
  });
  await ensureProduct({
    restaurantId: pizzaId,
    categoryId: pizzaDesserts,
    name: 'Tiramisu',
    description: 'Tiramisu classique au café.',
    imageUrl: 'https://placehold.co/400x300/C43D0C/FFFFFF?text=Tiramisu',
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
    logoUrl: 'https://placehold.co/128x128/8A8078/FFFFFF?text=SR',
    coverUrl: 'https://placehold.co/800x400/8A8078/FFFFFF?text=Snack+Rapide',
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
    imageUrl: 'https://placehold.co/400x300/8A8078/FFFFFF?text=Sandwich',
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
    logoUrl: 'https://placehold.co/128x128/C62828/FFFFFF?text=X',
    coverUrl: 'https://placehold.co/800x400/C62828/FFFFFF?text=Suspendu',
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
    imageUrl: 'https://placehold.co/400x300/C62828/FFFFFF?text=X',
    priceMinor: 1000n,
    sortOrder: 0,
  });

  const catalogRestaurantIds = [restaurantId, sahelId, pizzaId, snackId, suspendedId];

  // Flat delivery fee for the skeleton (real zone pricing is Bloc 6 — docs/18 §4).
  const flatFee = await prisma.platformSetting.findFirst({
    where: { key: 'skeleton_flat_delivery_fee_minor', scope: 'global' },
  });
  if (flatFee) {
    await prisma.platformSetting.update({ where: { id: flatFee.id }, data: { value: 1000 } });
  } else {
    await prisma.platformSetting.create({
      data: { key: 'skeleton_flat_delivery_fee_minor', scope: 'global', value: 1000 },
    });
  }

  console.log(
    `Seed OK — market ${country.isoCode}/${city.slug}, ${currencies.length} currencies, ` +
      `${providers.length} payment providers (cash+mock active), ${accounts.length} ledger accounts, ` +
      `${roles.length} roles, ${permissions.length} permissions. ` +
      `Identity fixtures: customer ${customerId}, courier ${courierId}, restaurant_owner ${restaurantOwnerId}, ` +
      `restaurant_staff ${restaurantStaffId}, support ${supportId}, finance ${financeId}, admin ${adminId}, ` +
      `super_admin ${superAdminId}. Catalog: ${catalogRestaurantIds.length} restaurants seeded ` +
      `(active: chez-fatime, le-sahel-grill, pizza-ndjam; paused: snack-rapide; suspended: le-palace-ferme).`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
