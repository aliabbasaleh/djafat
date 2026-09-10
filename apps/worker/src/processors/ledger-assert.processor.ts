import type { Job } from 'bullmq';
import type { LedgerEntryInput } from '@djafat/types';
import { assertBalanced } from '@djafat/core';
import { logger } from '../logger';

/**
 * Skeleton (Bloc 0). Bloc 5 fills this in: hourly, for each recent
 * `ledger_entry_group`, re-check `Σdebit === Σcredit` per currency and
 * `wallet_balances == Σ ledger_entries per owner account`. Any divergence
 * pages ops. The pure check is `assertBalanced` from `@djafat/core` — the same
 * one the CI runs (docs/15 §4.3).
 */
export function ledgerAssertProcessor(job: Job): Promise<{ groupsChecked: number }> {
  logger.debug({ jobId: job.id }, 'ledger-assert tick (skeleton)');

  // Self-test: prove the invariant primitive is wired and behaves.
  const balanced: LedgerEntryInput[] = [
    { accountRef: 'A', direction: 'debit', amount: { minor: 100n, currency: 'XAF' } },
    { accountRef: 'B', direction: 'credit', amount: { minor: 100n, currency: 'XAF' } },
  ];
  assertBalanced(balanced, 'XAF');

  return Promise.resolve({ groupsChecked: 0 });
}
