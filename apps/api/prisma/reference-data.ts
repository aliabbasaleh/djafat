/**
 * The reference data every DJAFAT database needs, in every mode, a live production
 * server included (audit findings OPS-05, SEC-02): the launch market and its landmarks,
 * roles and permissions, payment methods and providers (sandbox providers never active in
 * production), the commission default, platform settings, feature flags and the ledger
 * chart of accounts. No user, no restaurant, no test data: those are the demo fixtures of
 * `seed.ts`.
 *
 * Idempotent. `resetTunables` decides what happens to values operations may change
 * (provider switches, platform settings): the demo seed puts the defaults back, as it
 * always did; a live deploy (`seed-reference.ts`, run at every `install.sh`) only creates
 * what is missing, so it never undoes a setting changed on the server.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { LAUNCH_MARKET, PLATFORM_SETTINGS_DEFAULTS } from '@djafat/config';
import { placeNameKey } from '@djafat/core';
import { CashPaymentProvider } from '../src/modules/payments/providers/cash/cash-payment.provider';
import { MockPaymentProvider } from '../src/modules/payments/providers/mock/mock-payment.provider';
import {
  sandboxOnlyCodes,
  seedPaymentProviderPlan,
} from '../src/modules/payments/payment-provider-selection';

export interface ReferenceDataResult {
  readonly country: { id: string; isoCode: string };
  readonly city: { id: string; slug: string };
  readonly counts: {
    readonly currencies: number;
    readonly providers: number;
    readonly activeProviders: readonly string[];
    readonly accounts: number;
    readonly roles: number;
    readonly permissions: number;
  };
}

export async function seedReferenceData(
  prisma: PrismaClient,
  { resetTunables }: { readonly resetTunables: boolean },
): Promise<ReferenceDataResult> {
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

  // --- landmarks (FEAT-018) -----------------------------------------------------
  // Well-known N'Djamena landmarks customers place their address against.
  // Coordinates are APPROXIMATE (demo seed) and must be checked on the ground
  // before launch; each delivery then refines the customer's own point.
  const landmarks: Array<[string, string, string[], number, number]> = [
    [
      'Grande Mosquée Roi Fayçal',
      'mosque',
      ['grande mosquee', 'mosquee roi faycal'],
      12.1066,
      15.0436,
    ],
    ['Marché central', 'market', ['grand marche'], 12.1078, 15.0418],
    ['Place de la Nation', 'administration', ['place de la nation'], 12.1101, 15.0486],
    ['Rond-point Hamama', 'roundabout', ['hamama'], 12.1215, 15.0634],
    ['Rond-point Kondolé', 'roundabout', ['kondole'], 12.14, 15.062],
    ['Marché de Dembé', 'market', ['dembe'], 12.1102, 15.0785],
    ['Hôpital de la Liberté', 'health', ['hopital liberte'], 12.1131, 15.0571],
    ['Cathédrale Notre-Dame de la Paix', 'church', ['cathedrale'], 12.1068, 15.0505],
    ['Stade Idriss Mahamat Ouya', 'other', ['stade omnisport', 'stade'], 12.1146, 15.0699],
    [
      'Université de N’Djamena (Ardep Djoumbal)',
      'school',
      ['universite', 'ardep djoumbal'],
      12.1203,
      15.0455,
    ],
  ];
  for (const [name, kind, aliases, lat, lng] of landmarks) {
    await prisma.$executeRaw`
      INSERT INTO landmarks (city_id, name, kind, aliases, geom)
      VALUES (${city.id}::uuid, ${name}, ${kind}, ${aliases}::text[],
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography)
      ON CONFLICT (city_id, name) DO NOTHING
    `;
  }

  // --- neighbourhoods (FEAT-022, SPEC-022-09) ------------------------------------
  // The first list of N'Djamena's neighbourhoods; DJAFAT corrects it in the admin
  // console (FEAT-022-Q12). Each reference row has a stable `code`: a reinstall
  // skips it even after an admin renamed or disabled it (R1), and a name an admin
  // already added is skipped too (any unique index, no conflict target).
  const neighbourhoods: Array<[string, string]> = [
    ['abena', 'Abéna'],
    ['ambassatna', 'Ambassatna'],
    ['amriguebe', 'Amriguébé'],
    ['ardep-djoumbal', 'Ardep Djoumbal'],
    ['atrone', 'Atrone'],
    ['bololo', 'Bololo'],
    ['boutalbagar', 'Boutalbagar'],
    ['chagoua', 'Chagoua'],
    ['dembe', 'Dembé'],
    ['diguel', 'Diguel'],
    ['djambal-bahr', 'Djambal Bahr'],
    ['farcha', 'Farcha'],
    ['gardole', 'Gardolé'],
    ['gassi', 'Gassi'],
    ['goudji', 'Goudji'],
    ['habbena', 'Habbena'],
    ['kabalaye', 'Kabalaye'],
    ['klemat', 'Klémat'],
    ['lamadji', 'Lamadji'],
    ['madjorio', 'Madjorio'],
    ['milezi', 'Milézi'],
    ['moursal', 'Moursal'],
    ['ndingangali', 'Ndingangali'],
    ['paris-congo', 'Paris-Congo'],
    ['ridina', 'Ridina'],
    ['sabangali', 'Sabangali'],
    ['toukra', 'Toukra'],
    ['walia', 'Walia'],
  ];
  for (const [code, name] of neighbourhoods) {
    await prisma.$executeRaw`
      INSERT INTO neighbourhoods (city_id, code, name, name_key)
      VALUES (${city.id}::uuid, ${code}, ${name}, ${placeNameKey(name)})
      ON CONFLICT DO NOTHING`;
  }

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
    { code: 'couriers:read', label: 'Lire les profils livreurs' },
    { code: 'couriers:write', label: 'Suspendre/réintégrer un livreur' },
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
    support: [
      'users:read',
      'orders:read',
      'payments:read',
      'deliveries:read',
      'couriers:read',
      'couriers:write',
    ],
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
      'couriers:read',
      'couriers:write',
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
      'couriers:read',
      'couriers:write',
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

  // FEAT-002: sandbox-only providers (read from their own capabilities, the
  // same source the API registry uses) are never activated in production.
  const providerPlan = seedPaymentProviderPlan({
    isProduction: process.env['NODE_ENV'] === 'production',
    sandboxCodes: sandboxOnlyCodes([new CashPaymentProvider(), new MockPaymentProvider()]),
  });
  const providers = [
    {
      code: 'cash',
      methodCode: 'cash_on_delivery',
      displayName: 'Espèces',
      active: providerPlan.isActive('cash'),
    },
    // Deterministic mock — permanent, dev/CI only; inactive in production.
    {
      code: 'mock',
      methodCode: 'mobile_money',
      displayName: 'Mock Payment (dev)',
      active: providerPlan.isActive('mock'),
    },
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
    // FEAT-009: paid to DJAFAT's merchant number, matched by transaction
    // number. Activated by ops once the merchant number is configured
    // (MOBILE_MONEY_WALLETS) — never by the seed.
    {
      code: 'tigo_cash',
      methodCode: 'mobile_money',
      displayName: 'Tigo Cash',
      active: false,
    },
  ];
  for (const p of providers) {
    await prisma.paymentProviderRow.upsert({
      where: { code: p.code },
      create: { ...p, capabilities: {} },
      // A live deploy keeps what operations switched on or off; it only forces
      // sandbox providers off in production. The demo seed resets to the plan.
      update: resetTunables
        ? { active: p.active }
        : providerPlan.configsToDisable.includes(p.code)
          ? { active: false }
          : {},
    });
  }

  // Availability for the launch market: cash (+ mock outside production).
  for (const providerCode of providerPlan.availabilityCodes) {
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

  // FEAT-009: launch-market availability for the merchant wallets, DISABLED,
  // with an explicit 0 fee (unknown until the merchant contracts are signed —
  // without a row the fee would fall back to the mock default). Ops enable it.
  for (const providerCode of ['airtel_money', 'tigo_cash']) {
    const existing = await prisma.paymentProviderConfig.findFirst({
      where: { providerCode, countryId: country.id, cityId: city.id },
    });
    if (!existing) {
      await prisma.paymentProviderConfig.create({
        data: {
          providerCode,
          countryId: country.id,
          cityId: city.id,
          enabled: false,
          priority: 50,
          feeBps: 0,
        },
      });
    }
  }

  // Re-seeding production over a dev-seeded base: switch off what the dev
  // seed enabled for sandbox providers (SPEC-002-02 R3, FEAT-002).
  if (providerPlan.configsToDisable.length > 0) {
    await prisma.paymentProviderConfig.updateMany({
      where: { providerCode: { in: [...providerPlan.configsToDisable] } },
      data: { enabled: false },
    });
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
    {
      key: 'order_confirmation_timeout_seconds',
      value: PLATFORM_SETTINGS_DEFAULTS.order_confirmation_timeout_seconds,
    },
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
      // Tuned by operations: only the demo seed puts the default back.
      if (resetTunables) {
        await prisma.platformSetting.update({
          where: { id: existing.id },
          data: { value: s.value },
        });
      }
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
    if (resetTunables) {
      await prisma.platformSetting.update({
        where: { id: floatCap.id },
        data: { value: PLATFORM_SETTINGS_DEFAULTS.courier_cash_float_cap_minor },
      });
    }
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
      create: {
        key,
        enabled: key === 'mock_payment_provider' && providerPlan.mockPaymentFlagEnabled,
      },
      // Re-seeding production turns the mock flag off; elsewhere manual toggles are kept.
      update:
        key === 'mock_payment_provider' && !providerPlan.mockPaymentFlagEnabled
          ? { enabled: false }
          : {},
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
    // Holds a courier's fee between payment success and dispatch assignment
    // (Bloc 6) — un-owned, same liability nature as COURIER_PAYABLE, which
    // `courier-fee-reclassification.ts` later debits this to credit.
    { code: 'COURIER_FEE_POOL', type: 'liability', ownerType: 'djafat' },
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

  // --- flat delivery fee (Bloc 0.5; zone pricing comes later — docs/18 §4) -------
  // Same value as `PricingService`'s fallback. A live deploy only creates it.
  const flatFee = await prisma.platformSetting.findFirst({
    where: { key: 'skeleton_flat_delivery_fee_minor', scope: 'global' },
  });
  if (flatFee) {
    if (resetTunables) {
      await prisma.platformSetting.update({ where: { id: flatFee.id }, data: { value: 1000 } });
    }
  } else {
    await prisma.platformSetting.create({
      data: { key: 'skeleton_flat_delivery_fee_minor', scope: 'global', value: 1000 },
    });
  }

  return {
    country,
    city,
    counts: {
      currencies: currencies.length,
      providers: providers.length,
      activeProviders: providers.filter((p) => p.active).map((p) => p.code),
      accounts: accounts.length,
      roles: roles.length,
      permissions: permissions.length,
    },
  };
}
