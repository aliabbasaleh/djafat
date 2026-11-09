import { Inject, Injectable } from '@nestjs/common';
import type { MoneyJson, OrderAmountPort } from '@djafat/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { toMoneyJson } from '../../common/money/money.mapper';
import { ORDER_AMOUNT_PORT } from '../../common/ports/order-amount.port';
import { LedgerReadService } from '../ledger/ledger-read.service';
import { earningsPeriodStarts, netToReceive } from '@djafat/core';

/** Launch market currency (same as FEAT-010's cash ceiling). */
const CURRENCY = 'XAF';
const HISTORY_LIMIT = 50;

export interface CourierEarningsDto {
  readonly today: { readonly amount: MoneyJson; readonly count: number };
  readonly week: { readonly amount: MoneyJson; readonly count: number; readonly since: string };
  readonly items: ReadonlyArray<{
    readonly deliveryId: string;
    readonly deliveredAt: string;
    readonly restaurantName: string;
    readonly quartier: string | null;
    readonly fee: MoneyJson;
  }>;
  readonly balance: {
    readonly available: MoneyJson;
    readonly cashHeld: MoneyJson;
    readonly net: MoneyJson;
  };
}

/**
 * What a courier earned (FEAT-014, SPEC-014-01): today, this week (from
 * Monday, N'Djamena time), each delivered course with its fee, and the
 * balance to receive (available earnings minus cash still owed). Never an
 * order amount: only the courier's own fee (`deliveries.courier_fee_minor`).
 */
@Injectable()
export class CourierEarningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerRead: LedgerReadService,
    @Inject(ORDER_AMOUNT_PORT) private readonly orders: OrderAmountPort,
  ) {}

  async getEarnings(courierId: string, now = new Date()): Promise<CourierEarningsDto> {
    const { dayStart, weekStart } = earningsPeriodStarts(now);
    const sum = async (since: Date) => {
      const agg = await this.prisma.delivery.aggregate({
        where: { courierId, status: 'delivered', deliveredAt: { gte: since } },
        _sum: { courierFeeMinor: true },
        _count: { _all: true },
      });
      return { amount: agg._sum.courierFeeMinor ?? 0n, count: agg._count._all };
    };
    const [today, week, rows, available, cashHeld] = await Promise.all([
      sum(dayStart),
      sum(weekStart),
      this.prisma.delivery.findMany({
        where: { courierId, status: 'delivered' },
        orderBy: { deliveredAt: 'desc' },
        take: HISTORY_LIMIT,
        select: { id: true, orderId: true, deliveredAt: true, courierFeeMinor: true },
      }),
      this.ledgerRead.getCourierAvailable(courierId, CURRENCY),
      this.ledgerRead.getCashHeld(courierId, CURRENCY),
    ]);
    const items = await Promise.all(
      rows.map(async (r) => {
        const ctx = await this.orders.getDeliveryContext(r.orderId);
        return {
          deliveryId: r.id,
          deliveredAt: (r.deliveredAt ?? now).toISOString(),
          restaurantName: ctx.restaurantName,
          // the neighbourhood only — the courier's history never needs the full address
          quartier: ctx.dropoffAddress?.split(',')[0]?.trim() || null,
          fee: toMoneyJson(r.courierFeeMinor, CURRENCY),
        };
      }),
    );
    return {
      today: { amount: toMoneyJson(today.amount, CURRENCY), count: today.count },
      week: {
        amount: toMoneyJson(week.amount, CURRENCY),
        count: week.count,
        since: weekStart.toISOString(),
      },
      items,
      balance: {
        available: toMoneyJson(available, CURRENCY),
        cashHeld: toMoneyJson(cashHeld, CURRENCY),
        net: toMoneyJson(netToReceive(available, cashHeld), CURRENCY),
      },
    };
  }
}
