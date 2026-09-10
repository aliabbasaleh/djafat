import { describe, expect, it, vi } from 'vitest';
import type { PostEntryGroupInput } from '@djafat/types';
import { money } from '@djafat/core';
import { LedgerService } from './ledger.service';
import type { LedgerRepository } from './ledger.repository';

const XAF = (n: bigint) => money(n, 'XAF');

const repoStub = () =>
  ({
    persistEntryGroup: vi.fn(async () => ({ id: 'grp-1', replayed: false })),
    getWalletBalance: vi.fn(),
  }) as unknown as LedgerRepository;

/** Reference 10 000 XAF order — G1 order_accrual (Mobile Money). */
const g1 = (revenueMinor: bigint): PostEntryGroupInput => ({
  kind: 'order_accrual',
  idempotencyKey: 'payment:p1',
  currency: 'XAF',
  createdBy: 'payments',
  refs: { orderId: 'o1', paymentId: 'p1' },
  entries: [
    { accountRef: 'PSP_CLEARING:mock', direction: 'debit', amount: XAF(9850n) },
    { accountRef: 'PSP_FEE_EXPENSE', direction: 'debit', amount: XAF(150n) },
    { accountRef: 'RESTAURANT_PAYABLE:r1', direction: 'credit', amount: XAF(6400n) },
    { accountRef: 'COURIER_PAYABLE:c1', direction: 'credit', amount: XAF(1200n) },
    { accountRef: 'DJAFAT_REVENUE', direction: 'credit', amount: XAF(revenueMinor) },
  ],
});

describe('LedgerService.postEntryGroup', () => {
  it('accepts the balanced reference group and persists it once', async () => {
    const repo = repoStub();
    const svc = new LedgerService(repo);
    const posted = await svc.postEntryGroup(g1(2400n)); // GROSS revenue
    expect(posted.id).toBe('grp-1');
    expect(posted.kind).toBe('order_accrual');
    expect(repo.persistEntryGroup).toHaveBeenCalledOnce();
  });

  it('REFUSES an unbalanced group (the historical 2250 bug) and never touches the repo', async () => {
    const repo = repoStub();
    const svc = new LedgerService(repo);
    await expect(svc.postEntryGroup(g1(2250n))).rejects.toThrow(/UNBALANCED_ENTRY_GROUP/);
    expect(repo.persistEntryGroup).not.toHaveBeenCalled();
  });

  it('refuses an empty idempotency key', async () => {
    const svc = new LedgerService(repoStub());
    await expect(svc.postEntryGroup({ ...g1(2400n), idempotencyKey: '' })).rejects.toThrow(
      /idempotencyKey/,
    );
  });
});
