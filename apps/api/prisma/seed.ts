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
    { code: 'admin', label: 'Administrateur' },
    { code: 'super_admin', label: 'Super administrateur' },
  ];
  for (const r of roles) {
    await prisma.role.upsert({ where: { code: r.code }, create: r, update: r });
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
      `walking-skeleton fixtures: customer ${customerId}, courier ${courierId}, restaurant ${restaurantId} (${products.length} products).`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
