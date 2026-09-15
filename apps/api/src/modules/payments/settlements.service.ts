import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { money } from '@djafat/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { toMoneyJson } from '../../common/money/money.mapper';
import { LedgerService } from '../ledger/ledger.service';
import type { RecordSettlementInput } from './dto/record-settlement.schema';

export interface SettlementDto {
  id: string;
  providerCode: string;
  periodStart: string;
  periodEnd: string;
  gross: { minor: string; currency: string };
  fees: { minor: string; currency: string };
  net: { minor: string; currency: string };
  status: string;
  reconciliationNotes: string | null;
}

/**
 * Minimal settlement PRIMITIVE (docs/08 §8.9, docs/15 AD-11) — NOT a
 * statement-ingestion/auto-matching engine (mandate scope exclusion: no full
 * banking engine). An admin manually records what the PSP statement says for
 * a period; this posts the `settlement` ledger group (`PSP_CLEARING ->
 * DJAFAT_BANK`, the net actually received) and flags a mismatch against the
 * caller-supplied `expectedNetMinor` as `discrepancy` — NEVER auto-corrected,
 * same rule as the webhook amount-mismatch guard.
 */
@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
  ) {}

  async recordSettlement(
    input: RecordSettlementInput,
    idempotencyKey: string,
    actorUserId: string,
  ): Promise<{ status: 'created' | 'replayed'; settlement: SettlementDto }> {
    const run = await this.idempotency.run('settlements', idempotencyKey, input, () =>
      this.doRecordSettlement(input, idempotencyKey, actorUserId),
    );
    return { status: run.status, settlement: run.response };
  }

  private async doRecordSettlement(
    input: RecordSettlementInput,
    idempotencyKey: string,
    actorUserId: string,
  ): Promise<SettlementDto> {
    const grossMinor = BigInt(input.grossMinor);
    const feesMinor = BigInt(input.feesMinor);
    const netMinor = BigInt(input.netMinor);
    if (grossMinor - feesMinor !== netMinor) {
      throw new ConflictException({
        code: 'VALIDATION_ERROR',
        message: `netMinor (${netMinor}) must equal grossMinor (${grossMinor}) - feesMinor (${feesMinor}).`,
      });
    }
    const expectedNetMinor =
      input.expectedNetMinor !== undefined ? BigInt(input.expectedNetMinor) : null;
    const status =
      expectedNetMinor !== null && expectedNetMinor !== netMinor ? 'discrepancy' : 'reconciled';

    const settlement = await this.prisma.$transaction(async (tx) => {
      const created = await tx.settlement.create({
        data: {
          providerCode: input.providerCode,
          periodStart: new Date(input.periodStart),
          periodEnd: new Date(input.periodEnd),
          currency: input.currency,
          grossMinor,
          feesMinor,
          netMinor,
          expectedNetMinor,
          status,
          providerReference: input.providerReference ?? null,
          idempotencyKey,
          createdBy: actorUserId,
          reconciliationNotes:
            status === 'discrepancy'
              ? `Expected net ${expectedNetMinor} but provider reported ${netMinor}.`
              : null,
          reconciledAt: status === 'reconciled' ? new Date() : null,
        },
      });

      // The net amount is what actually left PSP_CLEARING for the bank — gross
      // and fees are metadata on the settlement row, not separate ledger legs
      // (the fee was already recognised at order_accrual time, docs/08 §8.9 G1).
      if (netMinor > 0n) {
        const posted = await this.ledger.postEntryGroupTx(tx, {
          kind: 'settlement',
          idempotencyKey: `settlement:${created.id}`,
          currency: input.currency,
          entries: [
            {
              accountRef: 'DJAFAT_BANK',
              direction: 'debit',
              amount: money(netMinor, input.currency),
            },
            {
              accountRef: 'PSP_CLEARING',
              direction: 'credit',
              amount: money(netMinor, input.currency),
            },
          ],
          refs: {},
          createdBy: 'payments',
        });
        await tx.settlement.update({ where: { id: created.id }, data: { entryGroup: posted.id } });
      }

      await this.outbox.enqueue(tx, {
        aggregate: 'settlement',
        aggregateId: created.id,
        eventType: status === 'discrepancy' ? 'settlement.discrepancy' : 'settlement.reconciled',
        payload: { settlementId: created.id, providerCode: input.providerCode, status },
      });

      return created;
    });

    if (status === 'discrepancy') {
      this.logger.warn(
        `settlement ${settlement.id} flagged discrepancy: expected ${expectedNetMinor}, got ${netMinor}`,
      );
    }
    return this.toDto(settlement);
  }

  async listSettlements(): Promise<SettlementDto[]> {
    const rows = await this.prisma.settlement.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.toDto(r));
  }

  private toDto(s: {
    id: string;
    providerCode: string;
    periodStart: Date;
    periodEnd: Date;
    grossMinor: bigint;
    feesMinor: bigint;
    netMinor: bigint;
    currency: string;
    status: string;
    reconciliationNotes: string | null;
  }): SettlementDto {
    return {
      id: s.id,
      providerCode: s.providerCode,
      periodStart: s.periodStart.toISOString(),
      periodEnd: s.periodEnd.toISOString(),
      gross: toMoneyJson(s.grossMinor, s.currency),
      fees: toMoneyJson(s.feesMinor, s.currency),
      net: toMoneyJson(s.netMinor, s.currency),
      status: s.status,
      reconciliationNotes: s.reconciliationNotes,
    };
  }
}
