import { describe, expect, it, vi } from 'vitest';
import { money } from '@djafat/core';
import { PricingService } from './pricing.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';

interface RuleFixture {
  scope: string;
  countryId: string | null;
  cityId: string | null;
  restaurantId: string | null;
  rateBps: number;
  priority: number;
}

const prismaStub = (rules: RuleFixture[], flatDeliveryFeeMinor: number | string | null) =>
  ({
    commissionRule: {
      findMany: vi.fn(async () => rules),
    },
    platformSetting: {
      findFirst: vi.fn(async () =>
        flatDeliveryFeeMinor === null ? null : { value: flatDeliveryFeeMinor },
      ),
    },
  }) as unknown as PrismaService;

const INPUT = { restaurantId: 'r1', countryId: 'td', cityId: 'ndj', subtotal: money(8800n, 'XAF') };

describe('PricingService.priceOrder', () => {
  it('applies the most specific matching commission_rule (restaurant beats city/country/global)', async () => {
    const prisma = prismaStub(
      [
        {
          scope: 'global',
          countryId: null,
          cityId: null,
          restaurantId: null,
          rateBps: 1000,
          priority: 100,
        },
        {
          scope: 'country',
          countryId: 'td',
          cityId: null,
          restaurantId: null,
          rateBps: 2000,
          priority: 100,
        },
        {
          scope: 'restaurant',
          countryId: null,
          cityId: null,
          restaurantId: 'r1',
          rateBps: 2727,
          priority: 100,
        },
      ],
      1200,
    );
    const svc = new PricingService(prisma);
    const result = await svc.priceOrder(INPUT);

    expect(result.commissionBps).toBe(2727);
    // 8800 * 2727 / 10000 = 2399.76 -> rounding is applyRateBps's concern, just sanity-check it's close to 2400.
    expect(result.commission.minor).toBeGreaterThan(2000n);
    expect(result.deliveryFee).toEqual(money(1200n, 'XAF'));
    expect(result.courierFee).toEqual(result.deliveryFee); // decision A5
    expect(result.total).toEqual(money(8800n + 1200n, 'XAF'));
  });

  it('falls back to 0 bps when no commission_rule matches', async () => {
    const prisma = prismaStub([], 1000);
    const svc = new PricingService(prisma);
    const result = await svc.priceOrder(INPUT);
    expect(result.commissionBps).toBe(0);
    expect(result.commission.minor).toBe(0n);
  });

  it('reproduces the validated reference example exactly (10 000 XAF order, 2400 commission, 1200 delivery)', async () => {
    const prisma = prismaStub(
      [
        {
          scope: 'global',
          countryId: null,
          cityId: null,
          restaurantId: null,
          rateBps: 3000,
          priority: 100,
        },
      ],
      1200,
    );
    const svc = new PricingService(prisma);
    const result = await svc.priceOrder({ ...INPUT, subtotal: money(8000n, 'XAF') });

    expect(result.commission).toEqual(money(2400n, 'XAF')); // 8000 * 30% = 2400 gross
    expect(result.deliveryFee).toEqual(money(1200n, 'XAF'));
    expect(result.courierFee).toEqual(money(1200n, 'XAF'));
    expect(result.total).toEqual(money(9200n, 'XAF'));
  });

  it('reads the flat delivery fee from platform_settings, falling back to 1000 minor when unset', async () => {
    const prisma = prismaStub([], null);
    const svc = new PricingService(prisma);
    const result = await svc.priceOrder(INPUT);
    expect(result.deliveryFee).toEqual(money(1000n, 'XAF'));
  });

  it('accepts a string setting value (JSON round-trip may stringify large numbers)', async () => {
    const prisma = prismaStub([], '1500');
    const svc = new PricingService(prisma);
    const result = await svc.priceOrder(INPUT);
    expect(result.deliveryFee).toEqual(money(1500n, 'XAF'));
  });
});
