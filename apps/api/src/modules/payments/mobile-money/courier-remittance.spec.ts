import { describe, expect, it, vi } from 'vitest';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '../../../infra/prisma/prisma.service';
import type { LedgerService } from '../../ledger/ledger.service';
import type { LedgerReadService } from '../../ledger/ledger-read.service';
import { CourierRemittanceService } from './courier-remittance.service';

// FEAT-010 — docs/features/FEAT-010-courier-cash-control (SPEC-010-02).

interface Receipt {
  id: string;
  amountMinor: bigint;
  currency: string;
  status: string;
  paymentId: string | null;
  courierId: string | null;
  matchedAt: Date | null;
}

function harness(opts: { held: bigint; receipt?: Partial<Receipt> }) {
  const receipts: Receipt[] = [
    {
      id: 'r-1',
      amountMinor: 20_000n,
      currency: 'XAF',
      status: 'unmatched',
      paymentId: null,
      courierId: null,
      matchedAt: null,
      ...opts.receipt,
    },
  ];
  const posted: Array<{ kind: string; idempotencyKey: string; entries: unknown[] }> = [];
  const locks: string[] = [];
  const tx = {
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      locks.push(strings.join('?') + JSON.stringify(values));
      return 1;
    }),
    mobileMoneyReceipt: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          receipts.find((r) => r.id === where.id) ?? null,
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status: string };
          data: Partial<Receipt>;
        }) => {
          const r = receipts.find((x) => x.id === where.id && x.status === where.status);
          if (!r) return { count: 0 };
          Object.assign(r, data);
          return { count: 1 };
        },
      ),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      const snapshot = receipts.map((r) => ({ ...r }));
      const before = posted.length;
      try {
        return await fn(tx);
      } catch (err) {
        receipts.splice(0, receipts.length, ...snapshot);
        posted.splice(before);
        throw err;
      }
    }),
  } as unknown as PrismaService;
  const ledger = {
    postEntryGroupTx: vi.fn(async (_tx: unknown, input: (typeof posted)[number]) => {
      posted.push(input);
      return { id: 'g-1' };
    }),
  } as unknown as LedgerService;
  const ledgerRead = {
    getCashHeldTx: vi.fn(async () => opts.held),
  } as unknown as LedgerReadService;
  const events = { emit: vi.fn() } as unknown as EventEmitter2;
  const service = new CourierRemittanceService(prisma, ledger, ledgerRead, events);
  return { service, receipts, posted, events, locks };
}

describe('SPEC-010-02 — assign a received transfer to a courier remittance', () => {
  // SPEC-010-02-SC01
  it('SPEC-010-02-SC01 — receipt matched to the courier, balanced cash_reconciliation posted once, event emitted', async () => {
    const { service, receipts, posted, events, locks } = harness({ held: 31_000n });
    const res = await service.remitToCourier('r-1', 'courier-L');
    expect(receipts[0]).toMatchObject({
      status: 'matched',
      courierId: 'courier-L',
      paymentId: null,
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      kind: 'cash_reconciliation',
      idempotencyKey: 'remittance:r-1',
      entries: [
        {
          accountRef: 'PSP_CLEARING',
          direction: 'debit',
          amount: { minor: 20_000n, currency: 'XAF' },
        },
        {
          accountRef: 'CASH_FLOAT:courier-L',
          direction: 'credit',
          amount: { minor: 20_000n, currency: 'XAF' },
        },
      ],
    });
    expect(locks[0]).toContain('pg_advisory_xact_lock');
    expect(events.emit).toHaveBeenCalledWith('courier.cash_remitted', { courierId: 'courier-L' });
    expect(res.cashHeld).toEqual({ minor: '11000', currency: 'XAF' });
  });

  // SPEC-010-02-SC02
  it('SPEC-010-02-SC02 — more than the cash held: 409 REMITTANCE_EXCEEDS_CASH_HELD, nothing written', async () => {
    const { service, receipts, posted, events } = harness({ held: 5_000n });
    await expect(service.remitToCourier('r-1', 'courier-L')).rejects.toMatchObject({
      status: 409,
      response: { code: 'REMITTANCE_EXCEEDS_CASH_HELD' },
    });
    expect(receipts[0]?.status).toBe('unmatched');
    expect(posted).toEqual([]);
    expect(events.emit).not.toHaveBeenCalled();
  });

  // SPEC-010-02-SC03
  it('SPEC-010-02-SC03 — an already used transfer: 409 PAYMENT_INVALID_STATE, nothing written', async () => {
    const { service, posted } = harness({
      held: 31_000n,
      receipt: { status: 'matched', paymentId: 'pay-9', matchedAt: new Date() },
    });
    await expect(service.remitToCourier('r-1', 'courier-L')).rejects.toMatchObject({
      status: 409,
      response: { code: 'PAYMENT_INVALID_STATE' },
    });
    expect(posted).toEqual([]);
  });
});
