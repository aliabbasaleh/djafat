import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import type { MoneyJson } from '@djafat/types';
import { money } from '@djafat/core';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { toMoneyJson } from '../../../common/money/money.mapper';
import { LedgerService } from '../../ledger/ledger.service';
import { LedgerReadService } from '../../ledger/ledger-read.service';
import { PlatformService } from '../../platform/platform.service';
import { UsersService } from '../../users/users.service';
import { settlePayout, type FeePayer } from '../payout-settlement';

/** Launch market currency (FEAT-010 / FEAT-014). */
const CURRENCY = 'XAF';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface PayoutRow {
  id: string;
  courierId: string;
  kind: string;
  status: string;
  feePayer: string;
  currency: string;
  requestedMinor: bigint;
  paidMinor: bigint | null;
  receivedMinor: bigint | null;
  airtelFeeMinor: bigint | null;
  periodStart: Date | null;
  transactionRef: string | null;
  requestedAt: Date;
  sentAt: Date | null;
}

export interface CourierPayoutDto {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly feePayer: string;
  readonly requested: MoneyJson;
  readonly received: MoneyJson | null;
  readonly airtelFee: MoneyJson | null;
  readonly transactionRef: string | null;
  readonly requestedAt: string;
  readonly sentAt: string | null;
}

/**
 * A courier's earnings paid to their Airtel Money (FEAT-014, SPEC-014-02).
 * Requested by the courier (on demand, fee on them) or prepared each Monday
 * (weekly, fee on DJAFAT); sent by staff, who record the operator's
 * transaction number. Money moves ONLY when a payout is marked sent, through
 * the ledger, in one transaction under the courier's lock: the cash they owe
 * is settled against their earnings first (`cash_reconciliation`), then the
 * rest is paid (`payout`). `courier_payouts` keeps one open request per
 * courier and one weekly payout per courier and week (unique indexes).
 */
@Injectable()
export class CourierPayoutsService {
  private readonly logger = new Logger(CourierPayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly ledgerRead: LedgerReadService,
    private readonly platform: PlatformService,
    private readonly users: UsersService,
    private readonly events: EventEmitter2,
  ) {}

  async listMine(courierId: string): Promise<CourierPayoutDto[]> {
    const rows = await this.prisma.courierPayout.findMany({
      where: { courierId },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    });
    return rows.map(toDto);
  }

  /** On demand: the whole net, from the minimum up; Airtel's fee on the courier. */
  async requestOnDemand(courierId: string): Promise<CourierPayoutDto> {
    const min = BigInt(await this.platform.getCourierPayoutMinMinor());
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`courier-cash:${courierId}`}))`;
        const net = await this.netTx(tx, courierId);
        if (net < min) {
          throw new ConflictException({
            code: 'PAYOUT_NOT_ALLOWED',
            message: `Withdrawals start at ${min} ${CURRENCY}; ${net} ${CURRENCY} available to withdraw.`,
          });
        }
        return tx.courierPayout.create({
          data: {
            courierId,
            kind: 'on_demand',
            feePayer: 'courier',
            currency: CURRENCY,
            requestedMinor: net,
          },
        });
      });
      return toDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'PAYOUT_NOT_ALLOWED',
          message: 'A withdrawal is already on its way.',
        });
      }
      throw err;
    }
  }

  /**
   * Monday: a weekly payout for every courier with a positive net and no open
   * request, for the week that just ended. Idempotent per week.
   */
  async prepareWeekly(weekStart: Date): Promise<{ created: number }> {
    const periodStart = new Date(weekStart.getTime() - WEEK_MS);
    const couriers = await this.prisma.courier.findMany({ select: { userId: true } });
    let created = 0;
    for (const { userId } of couriers) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`courier-cash:${userId}`}))`;
          const net = await this.netTx(tx, userId);
          if (net <= 0n) return;
          await tx.courierPayout.create({
            data: {
              courierId: userId,
              kind: 'weekly',
              feePayer: 'djafat',
              currency: CURRENCY,
              requestedMinor: net,
              periodStart,
            },
          });
          created++;
        });
      } catch (err) {
        // already prepared this week, or a withdrawal already open: nothing to add
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
    this.logger.log(`weekly payouts prepared for ${periodStart.toISOString()}: ${created}`);
    return { created };
  }

  /** Staff: payouts to send (or all), with the courier's Airtel number. */
  async listForStaff(status?: string) {
    const rows = await this.prisma.courierPayout.findMany({
      where: status ? { status } : {},
      orderBy: { requestedAt: 'asc' },
      take: 200,
    });
    return Promise.all(
      rows.map(async (r) => {
        const u = await this.users.getById(r.courierId);
        return {
          ...toDto(r),
          courier: { id: r.courierId, name: u?.fullName ?? null, phone: u?.phone ?? null },
        };
      }),
    );
  }

  /** Staff sent it by Airtel Money: settle cash owed, pay the rest — once. */
  async markSent(
    payoutId: string,
    staffUserId: string,
    input: { transactionRef: string; airtelFeeMinor: bigint },
  ): Promise<CourierPayoutDto> {
    const { row, cashSettled } = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ courier_id: string; status: string }>>`
        SELECT courier_id, status FROM courier_payouts WHERE id = ${payoutId}::uuid FOR UPDATE
      `;
      const head = locked[0];
      if (!head) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: `Payout ${payoutId} not found.`,
        });
      }
      if (head.status !== 'requested') {
        throw new ConflictException({
          code: 'PAYMENT_INVALID_STATE',
          message: `This payout is already ${head.status}.`,
        });
      }
      const payout = (await tx.courierPayout.findUnique({ where: { id: payoutId } }))!;
      const courierId = payout.courierId;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`courier-cash:${courierId}`}))`;
      const [available, cashHeld] = await Promise.all([
        this.ledgerRead.getCourierAvailableTx(tx, courierId, payout.currency),
        this.ledgerRead.getCashHeldTx(tx, courierId, payout.currency),
      ]);
      const plan = settlePayout({
        requested: payout.requestedMinor,
        available,
        cashHeld,
        airtelFee: input.airtelFeeMinor,
        feePayer: payout.feePayer as FeePayer,
      });
      if (plan.kind === 'cancel') {
        const cancelled = await tx.courierPayout.update({
          where: { id: payoutId },
          data: { status: 'cancelled' },
        });
        return { row: cancelled, cashSettled: 0n };
      }
      if (plan.kind === 'fee_too_high') {
        throw new ConflictException({
          code: 'VALIDATION_ERROR',
          message: 'The Airtel fee is not less than the amount sent.',
        });
      }
      const ccy = payout.currency;
      if (plan.cashSettled > 0n) {
        await this.ledger.postEntryGroupTx(tx, {
          kind: 'cash_reconciliation',
          idempotencyKey: `payout-cash:${payoutId}`,
          currency: ccy,
          entries: [
            {
              accountRef: `COURIER_AVAILABLE:${courierId}`,
              direction: 'debit',
              amount: money(plan.cashSettled, ccy),
            },
            {
              accountRef: `CASH_FLOAT:${courierId}`,
              direction: 'credit',
              amount: money(plan.cashSettled, ccy),
            },
          ],
          memo: `cash owed settled against earnings, payout ${payoutId}`,
          createdBy: 'payments',
        });
      }
      await this.ledger.postEntryGroupTx(tx, {
        kind: 'payout',
        idempotencyKey: `payout:${payoutId}`,
        currency: ccy,
        entries: [
          {
            accountRef: `COURIER_AVAILABLE:${courierId}`,
            direction: 'debit',
            amount: money(plan.paid, ccy),
          },
          ...(plan.feeExpense > 0n
            ? [
                {
                  accountRef: 'PSP_FEE_EXPENSE',
                  direction: 'debit' as const,
                  amount: money(plan.feeExpense, ccy),
                },
              ]
            : []),
          {
            accountRef: 'PSP_CLEARING',
            direction: 'credit',
            amount: money(plan.paid + plan.feeExpense, ccy),
          },
        ],
        memo: `courier payout ${payoutId}, Airtel transaction ${input.transactionRef}`,
        createdBy: 'payments',
      });
      const sent = await tx.courierPayout.update({
        where: { id: payoutId },
        data: {
          status: 'sent',
          paidMinor: plan.paid,
          receivedMinor: plan.received,
          airtelFeeMinor: input.airtelFeeMinor,
          transactionRef: input.transactionRef,
          sentBy: staffUserId,
          sentAt: new Date(),
        },
      });
      return { row: sent, cashSettled: plan.cashSettled };
    });
    // Cash owed went down: `deliveries` re-evaluates the cash ceiling (FEAT-010, by event).
    if (cashSettled > 0n) this.events.emit('courier.cash_remitted', { courierId: row.courierId });
    this.logger.log(`payout ${payoutId} ${row.status}`);
    return toDto(row);
  }

  private async netTx(tx: Prisma.TransactionClient, courierId: string): Promise<bigint> {
    const [available, cashHeld] = await Promise.all([
      this.ledgerRead.getCourierAvailableTx(tx, courierId, CURRENCY),
      this.ledgerRead.getCashHeldTx(tx, courierId, CURRENCY),
    ]);
    const net = available - cashHeld;
    return net > 0n ? net : 0n;
  }
}

function toDto(r: PayoutRow): CourierPayoutDto {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    feePayer: r.feePayer,
    requested: toMoneyJson(r.requestedMinor, r.currency),
    received: r.receivedMinor === null ? null : toMoneyJson(r.receivedMinor, r.currency),
    airtelFee: r.airtelFeeMinor === null ? null : toMoneyJson(r.airtelFeeMinor, r.currency),
    transactionRef: r.transactionRef,
    requestedAt: r.requestedAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
  };
}
