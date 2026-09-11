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

  const restaurant = await prisma.restaurant.findFirst({ where: { slug: 'chez-fatime' } });
  const restaurantId = (
    restaurant ??
    (await prisma.restaurant.create({
      data: {
        countryId: country.id,
        cityId: city.id,
        slug: 'chez-fatime',
        name: 'Chez Fatimé',
        currency: 'XAF',
        status: 'active',
      },
    }))
  ).id;

  const products = [
    { name: 'Poulet braisé', priceMinor: 3500n },
    { name: 'Frites', priceMinor: 1000n },
  ];
  for (const p of products) {
    const existingProduct = await prisma.product.findFirst({
      where: { restaurantId, name: p.name },
    });
    if (!existingProduct) {
      await prisma.product.create({
        data: {
          restaurantId,
          name: p.name,
          priceMinor: p.priceMinor,
          currency: 'XAF',
          isAvailable: true,
        },
      });
    }
  }

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
      `${roles.length} roles, ${permissions.length} permissions, ` +
      `walking-skeleton fixtures: customer ${customerId}, courier ${courierId}, restaurant ${restaurantId} (${products.length} products). ` +
      `Identity fixtures: restaurant_owner ${restaurantOwnerId}, restaurant_staff ${restaurantStaffId}, ` +
      `support ${supportId}, finance ${financeId}, admin ${adminId}, super_admin ${superAdminId}.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
