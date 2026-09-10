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

  console.log(
    `Seed OK — market ${country.isoCode}/${city.slug}, ${currencies.length} currencies, ` +
      `${providers.length} payment providers (cash+mock active), ${accounts.length} ledger accounts.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
