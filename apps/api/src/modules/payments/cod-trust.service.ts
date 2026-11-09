import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Money, OrderAmountPort } from '@djafat/types';
import { codCapFor, isNightInNdjamena, scoreCustomerTrust, type TrustTier } from '@djafat/core';
import { ORDER_AMOUNT_PORT } from '../../common/ports/order-amount.port';
import { PlatformService } from '../platform/platform.service';

export interface CodDecision {
  readonly allowed: boolean;
  readonly tier: TrustTier;
  readonly score: number;
  readonly cap: bigint;
}

/**
 * Cash on delivery only for customers trusted for that amount (FEAT-015,
 * SPEC-015-02). Facts come from `orders` through `OrderAmountPort` (DAG);
 * the score is the pure `scoreCustomerTrust`; caps are platform settings.
 * Applied to every provider whose capability is `collectedOnDelivery` —
 * never to a provider by name.
 */
@Injectable()
export class CodTrustService {
  constructor(
    @Inject(ORDER_AMOUNT_PORT) private readonly orders: OrderAmountPort,
    private readonly platform: PlatformService,
  ) {}

  async decide(orderId: string, amount: Money, now = new Date()): Promise<CodDecision> {
    const customerId = await this.orders.getOwnerUserId(orderId);
    const facts = await this.orders.getCustomerTrustSignals(customerId);
    const { score, tier } = scoreCustomerTrust({ ...facts, night: isNightInNdjamena(now) });
    const caps = await this.platform.getCodCapsMinor();
    const cap = codCapFor(tier, caps);
    return { allowed: amount.minor <= cap, tier, score, cap };
  }

  async assertAllowed(orderId: string, amount: Money): Promise<void> {
    const d = await this.decide(orderId, amount);
    if (!d.allowed) {
      throw new ConflictException({
        code: 'COD_LIMIT',
        message:
          d.cap === 0n
            ? 'Cash on delivery is not available for this account: please pay first by mobile money.'
            : `Cash on delivery is limited to ${d.cap} ${amount.currency} for this account: please pay first by mobile money.`,
      });
    }
  }
}
