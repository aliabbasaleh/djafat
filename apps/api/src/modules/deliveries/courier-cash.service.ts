import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { MoneyJson } from '@djafat/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { toMoneyJson } from '../../common/money/money.mapper';
import { LedgerReadService } from '../ledger/ledger-read.service';
import { PlatformService } from '../platform/platform.service';
import { CouriersService } from '../couriers/couriers.service';
import { isCashBlocked } from './cash-ceiling';

/** Launch market currency; per-currency ceilings come with a second market. */
const CASH_CURRENCY = 'XAF';

export interface CourierCashStatus {
  readonly held: MoneyJson;
  readonly ceiling: MoneyJson;
  readonly blocked: boolean;
}

/**
 * Courier cash control (FEAT-010, SPEC-010-01/03). The cash held is the
 * ledger's `CASH_FLOAT:<courier>` balance — never a separate counter. Lives in
 * `deliveries` because it is the module allowed to read `ledger` AND drive
 * `couriers` (DAG); it reacts to events, it never calls `payments`.
 */
@Injectable()
export class CourierCashService {
  private readonly logger = new Logger(CourierCashService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerRead: LedgerReadService,
    private readonly platform: PlatformService,
    private readonly couriers: CouriersService,
  ) {}

  /** A cash payment succeeds at delivery: the courier of that order may now hold too much. */
  @OnEvent('payment.succeeded')
  async onPaymentSucceeded(payload: { orderId: string; paymentId: string }): Promise<void> {
    const delivery = await this.prisma.delivery.findFirst({
      where: { orderId: payload.orderId, courierId: { not: null } },
      select: { courierId: true },
    });
    if (!delivery?.courierId) return; // prepaid, not dispatched yet: no cash moved
    await this.reevaluate(delivery.courierId);
  }

  /** A remittance was recorded (`payments`): the courier may be below the ceiling again. */
  @OnEvent('courier.cash_remitted')
  async onCashRemitted(payload: { courierId: string }): Promise<void> {
    await this.reevaluate(payload.courierId);
  }

  async getCashStatus(courierId: string): Promise<CourierCashStatus> {
    const [held, ceiling, courier] = await Promise.all([
      this.ledgerRead.getCashHeld(courierId, CASH_CURRENCY),
      this.ceilingMinor(),
      this.prisma.courier.findUnique({
        where: { userId: courierId },
        select: { cashBlockedAt: true },
      }),
    ]);
    return {
      held: toMoneyJson(held, CASH_CURRENCY),
      ceiling: toMoneyJson(ceiling, CASH_CURRENCY),
      blocked: courier?.cashBlockedAt != null,
    };
  }

  private async reevaluate(courierId: string): Promise<void> {
    const [held, ceiling] = await Promise.all([
      this.ledgerRead.getCashHeld(courierId, CASH_CURRENCY),
      this.ceilingMinor(),
    ]);
    const blocked = isCashBlocked(held, ceiling);
    await this.couriers.setCashBlocked(courierId, blocked);
    if (blocked) {
      this.logger.warn(
        `courier ${courierId} holds ${held} ${CASH_CURRENCY} (ceiling ${ceiling}): no new offers`,
      );
    }
  }

  private async ceilingMinor(): Promise<bigint> {
    return BigInt(Math.trunc(await this.platform.getCourierCashCeilingMinor()));
  }
}
