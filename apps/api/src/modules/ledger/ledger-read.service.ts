import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { toMoneyJson } from '../../common/money/money.mapper';
import type { MoneyJson } from '@djafat/types';

export interface OwnerBalanceDto {
  readonly currency: string;
  readonly pending: MoneyJson;
  readonly available: MoneyJson;
}

export interface GlobalAccountBalanceDto {
  readonly code: string;
  readonly currency: string;
  readonly balance: MoneyJson;
}

/** `ledger_accounts.type` → whether a DEBIT or a CREDIT increases its natural balance (standard double-entry convention). */
const DEBIT_NORMAL_TYPES = new Set(['asset', 'expense']);

/**
 * READ-ONLY financial projections (Bloc 9, docs/30 §ledger-read). Never
 * writes `ledger_*`/`wallet_*` — the single-writer invariant
 * (`LedgerService`/`LedgerRepository`, docs/15 AD-02) is completely
 * untouched by this file; it only ever `SELECT`s.
 *
 * `wallet_balances` already IS the correct pending/available projection for
 * `restaurant`/`courier` owners (maintained transactionally by the ledger
 * engine on every post) — this service does not recompute it, just reads it.
 * For the global, non-owned accounts (`DJAFAT_BANK`, `DJAFAT_REVENUE`,
 * `PSP_CLEARING`, ...), there is no pre-aggregated projection, so the
 * balance is summed directly from `ledger_entries`, sign-flipped per the
 * account's OWN `type` — exactly the same debit/credit convention
 * `ledger-assert.processor.ts` (the worker's reconciliation job) already
 * uses for the owned accounts, generalised to every account type.
 */
@Injectable()
export class LedgerReadService {
  constructor(private readonly prisma: PrismaService) {}

  /** `restaurant`/`courier` pending + available, straight from the projection — no computation. */
  async getOwnerBalances(
    ownerType: 'restaurant' | 'courier',
    ownerId: string,
  ): Promise<OwnerBalanceDto[]> {
    const rows = await this.prisma.walletBalanceRow.findMany({
      where: { ownerType, ownerId },
      orderBy: { currency: 'asc' },
    });
    return rows.map((r) => ({
      currency: r.currency,
      pending: toMoneyJson(r.pendingMinor, r.currency),
      available: toMoneyJson(r.availableMinor, r.currency),
    }));
  }

  /** Σ `pending`/`available` across EVERY restaurant (or courier) — the admin global liability view. */
  async getOwnerBalanceTotals(
    ownerType: 'restaurant' | 'courier',
  ): Promise<Array<{ currency: string; totalPending: MoneyJson; totalAvailable: MoneyJson }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ currency: string; pending_minor: bigint; available_minor: bigint }>
    >`
      SELECT currency,
             COALESCE(SUM(pending_minor), 0)::bigint AS pending_minor,
             COALESCE(SUM(available_minor), 0)::bigint AS available_minor
      FROM wallet_balances
      WHERE owner_type = ${ownerType}
      GROUP BY currency
    `;
    return rows.map((r) => ({
      currency: r.currency,
      totalPending: toMoneyJson(r.pending_minor, r.currency),
      totalAvailable: toMoneyJson(r.available_minor, r.currency),
    }));
  }

  /**
   * The platform's own global accounts (`owner_id IS NULL`) — DJAFAT_BANK,
   * DJAFAT_REVENUE, PSP_CLEARING, PSP_FEE_EXPENSE, PROMO_EXPENSE,
   * REFUNDS_PAYABLE, CUSTOMER_CLEARING (docs/08 chart of accounts, seeded).
   * Never a per-restaurant/courier drill-down — that's `getOwnerBalances`.
   */
  async getGlobalAccountBalances(): Promise<GlobalAccountBalanceDto[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ code: string; type: string; currency: string; balance_minor: bigint }>
    >`
      SELECT la.code, la.type, la.currency,
             COALESCE(SUM(
               CASE WHEN le.direction = 'debit' THEN le.amount_minor ELSE -le.amount_minor END
             ), 0)::bigint AS balance_minor
      FROM ledger_accounts la
      LEFT JOIN ledger_entries le ON le.account_id = la.id
      WHERE la.owner_id IS NULL
      GROUP BY la.id, la.code, la.type, la.currency
      ORDER BY la.code
    `;
    return rows.map((r) => {
      const debitMinusCredit = r.balance_minor;
      const natural = DEBIT_NORMAL_TYPES.has(r.type) ? debitMinusCredit : -debitMinusCredit;
      return { code: r.code, currency: r.currency, balance: toMoneyJson(natural, r.currency) };
    });
  }
}
