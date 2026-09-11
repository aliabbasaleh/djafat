import { Injectable, Logger } from '@nestjs/common';
import type { Money } from '@djafat/types';
import { addMoney, applyRateBps, money } from '@djafat/core';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface PriceOrderInput {
  readonly restaurantId: string;
  readonly countryId: string;
  readonly cityId: string;
  readonly subtotal: Money;
}

export interface OrderPriceBreakdown {
  readonly subtotal: Money;
  readonly deliveryFee: Money;
  readonly commissionBps: number;
  readonly commission: Money;
  /** = deliveryFee (decision A5: courier_compensation_policy = "delivery_fee"). */
  readonly courierFee: Money;
  readonly total: Money;
}

/** Fallback ONLY if the DB setting is missing — the real value lives in `platform_settings`. */
const FALLBACK_FLAT_DELIVERY_FEE_MINOR = 1000n;

/**
 * Server-authoritative pricing (docs/15 AD-06, docs/16 §C-quater). The client
 * NEVER supplies a price — `orders` calls this with a subtotal it computed
 * itself from catalog reads, and gets back a frozen breakdown.
 *
 * Bloc 0.5 simplification: delivery fee is a single flat, configurable amount
 * (`platform_settings['skeleton_flat_delivery_fee_minor']`) instead of the
 * real zone/distance pricing, which needs `geo`/`delivery_zones` (Bloc 6).
 * Commission is resolved for real against `commission_rules`.
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async priceOrder(input: PriceOrderInput): Promise<OrderPriceBreakdown> {
    const currency = input.subtotal.currency;
    const commissionBps = await this.resolveCommissionBps(input);
    const commission = applyRateBps(input.subtotal, commissionBps);
    const deliveryFee = await this.resolveFlatDeliveryFee(currency);
    // A5: courier compensation = delivery fee, verbatim.
    const courierFee = deliveryFee;
    const total = addMoney(input.subtotal, deliveryFee);

    return { subtotal: input.subtotal, deliveryFee, commissionBps, commission, courierFee, total };
  }

  private async resolveCommissionBps(input: PriceOrderInput): Promise<number> {
    const now = new Date();
    const rules = await this.prisma.commissionRule.findMany({
      where: {
        active: true,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
        AND: [
          {
            OR: [
              { scope: 'restaurant', restaurantId: input.restaurantId },
              { scope: 'city', cityId: input.cityId },
              { scope: 'country', countryId: input.countryId },
              { scope: 'global' },
            ],
          },
        ],
      },
    });

    if (rules.length === 0) {
      this.logger.warn(
        `No commission_rule resolved for restaurant ${input.restaurantId} — using 0 bps.`,
      );
      return 0;
    }

    const specificity = (scope: string): number =>
      scope === 'restaurant' ? 4 : scope === 'city' ? 3 : scope === 'country' ? 2 : 1;

    rules.sort((a, b) => specificity(b.scope) - specificity(a.scope) || b.priority - a.priority);
    return rules[0]!.rateBps;
  }

  private async resolveFlatDeliveryFee(currency: string): Promise<Money> {
    const row = await this.prisma.platformSetting.findFirst({
      where: { key: 'skeleton_flat_delivery_fee_minor', scope: 'global' },
    });
    if (typeof row?.value === 'number' && Number.isInteger(row.value)) {
      return money(row.value, currency);
    }
    if (typeof row?.value === 'string' && /^\d+$/.test(row.value)) {
      return money(row.value, currency);
    }
    return money(FALLBACK_FLAT_DELIVERY_FEE_MINOR, currency);
  }
}
