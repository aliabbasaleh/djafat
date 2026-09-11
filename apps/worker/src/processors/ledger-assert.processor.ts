import type { Job } from 'bullmq';
import type { LedgerEntryInput } from '@djafat/types';
import { assertBalanced } from '@djafat/core';
import { logger } from '../logger';
import { pool } from '../db';

export interface LedgerAssertResult {
  groupsChecked: number;
  unbalancedGroups: Array<{ entryGroup: string; currency: string; debit: string; credit: string }>;
  walletMismatches: Array<{
    ownerType: string;
    ownerId: string;
    currency: string;
    bucket: string;
    wallet: string;
    ledger: string;
  }>;
}

/**
 * The invariant that must NEVER be false (docs/08 §8.9, docs/15 AD-02):
 * for every `entry_group` and currency, `Σdebit === Σcredit`; and every
 * `wallet_balances` row equals the sum of its ledger entries. Run hourly in
 * production; the CI integration test calls it after the walking-skeleton
 * flow and asserts zero findings (docs/18 §20, §21).
 */
export async function ledgerAssertProcessor(): Promise<LedgerAssertResult> {
  const groupsRes = await pool.query<{ id: string }>(`SELECT id FROM ledger_entry_groups`);

  const unbalancedRes = await pool.query<{
    entry_group: string;
    currency: string;
    debit: string;
    credit: string;
  }>(`
    SELECT entry_group, currency,
           COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0)::text  AS debit,
           COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0)::text AS credit
    FROM ledger_entries
    GROUP BY entry_group, currency
    HAVING COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0)
         != COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0)
  `);

  const walletRes = await pool.query<{
    owner_type: string;
    owner_id: string;
    currency: string;
    bucket: string;
    wallet_minor: string;
    ledger_minor: string;
  }>(`
    WITH ledger_by_bucket AS (
      SELECT
        la.owner_type,
        la.owner_id,
        la.currency,
        CASE WHEN la.code LIKE '%_PAYABLE' THEN 'pending' WHEN la.code LIKE '%_AVAILABLE' THEN 'available' END AS bucket,
        SUM(CASE WHEN le.direction = 'credit' THEN le.amount_minor ELSE -le.amount_minor END) AS ledger_minor
      FROM ledger_entries le
      JOIN ledger_accounts la ON la.id = le.account_id
      WHERE la.owner_type IN ('restaurant', 'courier') AND la.owner_id IS NOT NULL
        AND (la.code LIKE '%_PAYABLE' OR la.code LIKE '%_AVAILABLE')
      GROUP BY la.owner_type, la.owner_id, la.currency, bucket
    )
    SELECT
      wb.owner_type, wb.owner_id::text AS owner_id, wb.currency,
      lb.bucket,
      (CASE lb.bucket WHEN 'pending' THEN wb.pending_minor ELSE wb.available_minor END)::text AS wallet_minor,
      lb.ledger_minor::text AS ledger_minor
    FROM wallet_balances wb
    JOIN ledger_by_bucket lb
      ON lb.owner_type = wb.owner_type AND lb.owner_id = wb.owner_id AND lb.currency = wb.currency
    WHERE (lb.bucket = 'pending' AND wb.pending_minor != lb.ledger_minor)
       OR (lb.bucket = 'available' AND wb.available_minor != lb.ledger_minor)
  `);

  const result: LedgerAssertResult = {
    groupsChecked: groupsRes.rowCount ?? 0,
    unbalancedGroups: unbalancedRes.rows.map((r) => ({
      entryGroup: r.entry_group,
      currency: r.currency,
      debit: r.debit,
      credit: r.credit,
    })),
    walletMismatches: walletRes.rows.map((r) => ({
      ownerType: r.owner_type,
      ownerId: r.owner_id,
      currency: r.currency,
      bucket: r.bucket,
      wallet: r.wallet_minor,
      ledger: r.ledger_minor,
    })),
  };

  if (result.unbalancedGroups.length > 0 || result.walletMismatches.length > 0) {
    logger.error({ result }, 'LEDGER INVARIANT VIOLATION — see docs/08 §8.9 / docs/15 AD-02');
  }
  return result;
}

export function makeLedgerAssertProcessor() {
  return async (job: Job): Promise<LedgerAssertResult> => {
    const result = await ledgerAssertProcessor();
    logger.debug({ jobId: job.id, groupsChecked: result.groupsChecked }, 'ledger-assert tick');
    return result;
  };
}

/** Pure self-test that the invariant primitive from `@djafat/core` is wired correctly. */
export function selfTestPureInvariant(): void {
  const balanced: LedgerEntryInput[] = [
    { accountRef: 'A', direction: 'debit', amount: { minor: 100n, currency: 'XAF' } },
    { accountRef: 'B', direction: 'credit', amount: { minor: 100n, currency: 'XAF' } },
  ];
  assertBalanced(balanced, 'XAF');
}
