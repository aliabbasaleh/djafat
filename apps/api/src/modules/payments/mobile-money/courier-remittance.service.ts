import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { MoneyJson } from '@djafat/types';
import { money } from '@djafat/core';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { toMoneyJson } from '../../../common/money/money.mapper';
import { LedgerService } from '../../ledger/ledger.service';
import { LedgerReadService } from '../../ledger/ledger-read.service';

/**
 * A courier remits the cash collected at delivery by sending it to DJAFAT's
 * merchant number; staff assign the recorded transfer to that courier
 * (FEAT-010, SPEC-010-02). One transaction: per-courier advisory lock, cash
 * held re-read, receipt claimed (conditional), `cash_reconciliation` posted
 * through the ledger — so two remittances can never both pass the check.
 */
@Injectable()
export class CourierRemittanceService {
  private readonly logger = new Logger(CourierRemittanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly ledgerRead: LedgerReadService,
    private readonly events: EventEmitter2,
  ) {}

  async remitToCourier(
    receiptId: string,
    courierId: string,
  ): Promise<{ receiptId: string; cashHeld: MoneyJson }> {
    const cashHeld = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`courier-cash:${courierId}`}))`;
      const receipt = await tx.mobileMoneyReceipt.findUnique({ where: { id: receiptId } });
      if (!receipt) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: `Receipt ${receiptId} not found.`,
        });
      }
      if (receipt.status !== 'unmatched') {
        throw new ConflictException({
          code: 'PAYMENT_INVALID_STATE',
          message: 'This transfer is already used.',
        });
      }
      const held = await this.ledgerRead.getCashHeldTx(tx, courierId, receipt.currency);
      if (receipt.amountMinor > held) {
        throw new ConflictException({
          code: 'REMITTANCE_EXCEEDS_CASH_HELD',
          message: `The courier holds ${held} ${receipt.currency}, less than this transfer.`,
        });
      }
      const claimed = await tx.mobileMoneyReceipt.updateMany({
        where: { id: receipt.id, status: 'unmatched' },
        data: { status: 'matched', courierId, matchedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: 'PAYMENT_INVALID_STATE',
          message: 'This transfer is already used.',
        });
      }
      const amount = money(receipt.amountMinor, receipt.currency);
      await this.ledger.postEntryGroupTx(tx, {
        kind: 'cash_reconciliation',
        idempotencyKey: `remittance:${receipt.id}`,
        currency: receipt.currency,
        entries: [
          { accountRef: 'PSP_CLEARING', direction: 'debit', amount },
          { accountRef: `CASH_FLOAT:${courierId}`, direction: 'credit', amount },
        ],
        memo: `courier cash remittance, transfer ${receipt.transactionRef}`,
        createdBy: 'payments',
      });
      return toMoneyJson(held - receipt.amountMinor, receipt.currency);
    });
    // After commit: `deliveries` re-evaluates the courier's ceiling (DAG: event, not a call).
    this.events.emit('courier.cash_remitted', { courierId });
    this.logger.log(`receipt ${receiptId} recorded as cash remittance of courier ${courierId}`);
    return { receiptId, cashHeld };
  }
}
