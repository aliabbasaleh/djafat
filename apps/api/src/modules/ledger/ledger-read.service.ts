import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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

  /**
   * FEAT-010: cash a courier physically holds = debit balance of
   * `CASH_FLOAT:<courierId>` (an asset: debits − credits). 0 when the courier
   * has no such account yet. Read-only, like everything in this file.
   */
  getCashHeld(courierId: string, currency: string): Promise<bigint> {
    return this.getCashHeldTx(this.prisma, courierId, currency);
  }

  /** Same, inside a caller's transaction (a remittance checks it before posting). */
  async getCashHeldTx(
    tx: Prisma.TransactionClient,
    courierId: string,
    currency: string,
  ): Promise<bigint> {
    const rows = await tx.$queryRaw<Array<{ held: bigint | null }>>`
      SELECT COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount_minor ELSE -e.amount_minor END), 0)::bigint AS held
      FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e.account_id
      WHERE a.code = 'CASH_FLOAT' AND a.owner_id = ${courierId}::uuid AND e.currency = ${currency}
    `;
    return rows[0]?.held ?? 0n;
  }

  /**
   * PAY-04: the entries of one posted group, found by its idempotency key, as
   * `accountRef`s (`CODE` or `CODE:<ownerId>`): what an order's accrual
   * actually credited, so a reversal can mirror it exactly. Empty when no
   * group has that key. Read-only.
   */
  async getEntryGroupEntriesTx(
    tx: Prisma.TransactionClient,
    idempotencyKey: string,
  ): Promise<
    Array<{
      accountRef: string;
      direction: 'debit' | 'credit';
      amountMinor: bigint;
      currency: string;
    }>
  > {
    const rows = await tx.$queryRaw<
      Array<{
        code: string;
        owner_id: string | null;
        direction: 'debit' | 'credit';
        amount_minor: bigint;
        currency: string;
      }>
    >`
      SELECT a.code, a.owner_id::text AS owner_id, e.direction, e.amount_minor, e.currency
      FROM ledger_entries e
      JOIN ledger_entry_groups g ON g.id = e.entry_group
      JOIN ledger_accounts a ON a.id = e.account_id
      WHERE g.idempotency_key = ${idempotencyKey}
      ORDER BY e.created_at, e.id
    `;
    return rows.map((r) => ({
      accountRef: r.owner_id ? `${r.code}:${r.owner_id}` : r.code,
      direction: r.direction,
      amountMinor: r.amount_minor,
      currency: r.currency,
    }));
  }

  /**
   * FEAT-014: a courier's AVAILABLE earnings (`COURIER_AVAILABLE`, a liability:
   * credits minus debits), read from the entries themselves so it is exact
   * inside the payout transaction.
   */
  getCourierAvailable(courierId: string, currency: string): Promise<bigint> {
    return this.getCourierAvailableTx(this.prisma, courierId, currency);
  }

  async getCourierAvailableTx(
    tx: Prisma.TransactionClient,
    courierId: string,
    currency: string,
  ): Promise<bigint> {
    const rows = await tx.$queryRaw<Array<{ available: bigint | null }>>`
      SELECT COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount_minor ELSE -e.amount_minor END), 0)::bigint AS available
      FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e.account_id
      WHERE a.code = 'COURIER_AVAILABLE' AND a.owner_id = ${courierId}::uuid AND e.currency = ${currency}
    `;
    return rows[0]?.available ?? 0n;
  }
}
