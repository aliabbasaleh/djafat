import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../infra/prisma/prisma.service';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import type { PaymentsService } from '../payments.service';
import { MerchantWalletPaymentProvider } from '../providers/wallet/merchant-wallet-payment.provider';
import { MobileMoneyReceiptsService } from './mobile-money-receipts.service';

// FEAT-009 — docs/features/FEAT-009-mobile-money-transfer-matching (SPEC-009-03, SPEC-009-04).
// In-memory stand-in for the two tables; PostgreSQL's own guarantees (unique
// constraints) are checked on a real database in e2e-demo.md (SPEC-009-03-SC03).

const AT = (hhmm: string) => new Date(`2026-11-07T${hhmm}:00Z`);

// The scenarios happen in the afternoon; freeze "now" after them.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AT('15:00'));
});
afterEach(() => {
  vi.useRealTimers();
});

interface ReceiptRow {
  id: string;
  providerCode: string;
  transactionRef: string;
  amountMinor: bigint;
  currency: string;
  senderPhone: string;
  receivedAt: Date;
  status: string;
  source: string;
  paymentId: string | null;
  matchedAt: Date | null;
  recordedBy: string | null;
  createdAt: Date;
}
interface PaymentRow {
  id: string;
  orderId: string;
  providerCode: string;
  status: string;
  amountMinor: bigint;
  currency: string;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
}

function harness(paymentsSeed: PaymentRow[] = []) {
  const receipts: ReceiptRow[] = [];
  const payments = [...paymentsSeed];
  let seq = 0;
  const receiptApi = {
    create: vi.fn(
      async ({
        data,
      }: {
        data: Omit<ReceiptRow, 'id' | 'status' | 'paymentId' | 'matchedAt' | 'createdAt'>;
      }) => {
        if (
          receipts.some(
            (r) => r.providerCode === data.providerCode && r.transactionRef === data.transactionRef,
          )
        ) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        const row: ReceiptRow = {
          id: `r-${++seq}`,
          status: 'unmatched',
          paymentId: null,
          matchedAt: null,
          createdAt: new Date(),
          ...data,
        };
        receipts.push(row);
        return row;
      },
    ),
    findMany: vi.fn(
      async ({ where }: { where: { providerCode: string; status: string; currency: string } }) =>
        receipts.filter(
          (r) =>
            r.providerCode === where.providerCode &&
            r.status === where.status &&
            r.currency === where.currency,
        ),
    ),
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
        data: Partial<ReceiptRow>;
      }) => {
        const r = receipts.find((x) => x.id === where.id && x.status === where.status);
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      },
    ),
  };
  const paymentApi = {
    findMany: vi.fn(
      async ({
        where,
      }: {
        where: { providerCode: string; status: string; amountMinor: bigint; currency: string };
      }) =>
        payments.filter(
          (p) =>
            p.providerCode === where.providerCode &&
            p.status === where.status &&
            p.amountMinor === where.amountMinor &&
            p.currency === where.currency,
        ),
    ),
    findUnique: vi.fn(
      async ({ where }: { where: { id: string } }) =>
        payments.find((p) => p.id === where.id) ?? null,
    ),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<PaymentRow> }) => {
      const p = payments.find((x) => x.id === where.id)!;
      Object.assign(p, data);
      return p;
    }),
  };
  const tx = { mobileMoneyReceipt: receiptApi, payment: paymentApi };
  const prisma = {
    ...tx,
    // Like PostgreSQL: a throw inside the callback undoes its writes.
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      const snapshot = receipts.map((r) => ({ ...r }));
      try {
        return await fn(tx);
      } catch (err) {
        receipts.splice(0, receipts.length, ...snapshot);
        throw err;
      }
    }),
  } as unknown as PrismaService;

  const ledgerPosts: string[] = [];
  const paymentsService = {
    succeedInTx: vi.fn(async (_tx: unknown, paymentId: string) => {
      const p = payments.find((x) => x.id === paymentId);
      if (!p || p.status !== 'pending') return null; // conditional UPDATE, like the real one
      p.status = 'succeeded';
      ledgerPosts.push(paymentId);
      return { paymentId, orderId: p.orderId };
    }),
    emitSucceeded: vi.fn(),
  } as unknown as PaymentsService;

  const registry = new PaymentProviderRegistry([
    new MerchantWalletPaymentProvider('airtel_money', '+23560000010'),
  ]);
  const service = new MobileMoneyReceiptsService(prisma, registry, paymentsService);
  return { service, receipts, payments, ledgerPosts, paymentsService };
}

const pending = (over: Partial<PaymentRow> = {}): PaymentRow => ({
  id: 'pay-1',
  orderId: 'ord-1',
  providerCode: 'airtel_money',
  status: 'pending',
  amountMinor: 12_000n,
  currency: 'XAF',
  createdAt: AT('14:30'),
  metadata: { payerPhone: '+23566123456' },
  ...over,
});

const transfer = {
  providerCode: 'airtel_money',
  transactionRef: ' ci251107.1432.a81234 ',
  amount: { minor: 12_000n, currency: 'XAF' },
  senderPhone: '66 12 34 56',
  receivedAt: AT('14:32'),
};

describe('SPEC-009-03 — record the transfers received on the merchant phone', () => {
  // SPEC-009-03-SC01
  it('SPEC-009-03-SC01 — stored normalised, unmatched, with its author', async () => {
    const { service, receipts } = harness();
    const { receipt } = await service.recordReceipt(transfer, 'u-finance');
    expect(receipt).toMatchObject({
      transactionRef: 'CI251107.1432.A81234',
      senderPhone: '+23566123456',
      status: 'unmatched',
      recordedBy: 'u-finance',
      source: 'manual',
    });
    expect(receipts).toHaveLength(1);

    // a reception time more than 5 min in the future is refused (SPEC-009-03, cas limites)
    await expect(
      service.recordReceipt(
        { ...transfer, transactionRef: 'FUT1', receivedAt: AT('15:10') },
        'u-finance',
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(receipts).toHaveLength(1);
  });

  // SPEC-009-03-SC02
  it('SPEC-009-03-SC02 — the same transaction number twice is refused with 409 RECEIPT_ALREADY_RECORDED', async () => {
    const { service, receipts } = harness();
    await service.recordReceipt(transfer, 'u-finance');
    await expect(
      service.recordReceipt({ ...transfer, transactionRef: 'CI251107.1432.A81234' }, 'u-support'),
    ).rejects.toMatchObject({ status: 409, response: { code: 'RECEIPT_ALREADY_RECORDED' } });
    expect(receipts).toHaveLength(1);
  });
});

describe('SPEC-009-04 — match a transfer to a payment', () => {
  // SPEC-009-04-SC04
  it('SPEC-009-04-SC04 — the claim takes the transfer and succeeds the payment once; a second attempt validates nothing', async () => {
    const { service, receipts, payments, ledgerPosts, paymentsService } = harness([pending()]);
    // Paid from another phone than the one on the payment: no auto-match at
    // recording. Since SPEC-009-04 v3 the claim must name that phone along with
    // the transaction number (a number alone is SC07's refused case).
    await service.recordReceipt({ ...transfer, senderPhone: '99 88 77 66' }, 'u-finance');
    expect(receipts[0]?.status).toBe('unmatched');

    const first = await service.claim('pay-1', {
      transactionRef: 'CI251107.1432.A81234',
      payerPhone: '99 88 77 66',
    });
    expect(first.outcome).toBe('paid');
    expect(receipts[0]).toMatchObject({ status: 'matched', paymentId: 'pay-1' });
    expect(payments[0]?.status).toBe('succeeded');
    expect(ledgerPosts).toEqual(['pay-1']);
    expect(paymentsService.emitSucceeded).toHaveBeenCalledTimes(1);

    const again = await service.claim('pay-1', { transactionRef: 'CI251107.1432.A81234' });
    expect(again.outcome).toBe('paid'); // idempotent answer for an already-paid payment
    expect(ledgerPosts).toEqual(['pay-1']); // ledger posted exactly once
  });

  // SPEC-009-04-SC05
  it('SPEC-009-04-SC05 — recording a transfer auto-matches only when exactly one pending payment fits', async () => {
    const one = harness([pending()]);
    const { matchedPaymentId } = await one.service.recordReceipt(transfer, 'u-finance');
    expect(matchedPaymentId).toBe('pay-1');
    expect(one.payments[0]?.status).toBe('succeeded');

    const two = harness([pending(), pending({ id: 'pay-2', orderId: 'ord-2' })]);
    const res = await two.service.recordReceipt(transfer, 'u-finance');
    expect(res.matchedPaymentId).toBeNull();
    expect(two.receipts[0]?.status).toBe('unmatched');
    expect(two.payments.every((p) => p.status === 'pending')).toBe(true);
    expect(two.ledgerPosts).toEqual([]);
  });

  it('a claim with a different amount answers amount_mismatch and validates nothing (SPEC-009-04 R2)', async () => {
    const { service, receipts, ledgerPosts } = harness([pending()]);
    await service.recordReceipt(
      { ...transfer, amount: { minor: 11_000n, currency: 'XAF' } },
      'u-finance',
    );
    const r = await service.claim('pay-1', { transactionRef: 'CI251107.1432.A81234' });
    expect(r.outcome).toBe('amount_mismatch');
    expect(receipts[0]?.status).toBe('unmatched');
    expect(ledgerPosts).toEqual([]);
  });

  it('if the payment stops being pending inside the transaction, the transfer is rolled back to unmatched (SPEC-009-04 R5)', async () => {
    const { service, receipts, paymentsService, ledgerPosts } = harness([pending()]);
    await service.recordReceipt({ ...transfer, senderPhone: '99 88 77 66' }, 'u-finance');
    vi.mocked(paymentsService.succeedInTx).mockResolvedValueOnce(null); // e.g. expired meanwhile
    const r = await service.claim('pay-1', {
      transactionRef: 'CI251107.1432.A81234',
      payerPhone: '99 88 77 66',
    });
    expect(r.outcome).toBe('pending');
    expect(receipts[0]).toMatchObject({ status: 'unmatched', paymentId: null });
    expect(ledgerPosts).toEqual([]);
  });

  it('manual match by staff: same checks; a payment that is not pending is refused with 409 PAYMENT_INVALID_STATE', async () => {
    const { service, receipts, payments } = harness([pending()]);
    await service.recordReceipt({ ...transfer, senderPhone: '99 88 77 66' }, 'u-finance');
    payments[0]!.status = 'cancelled';
    await expect(service.manualMatch(receipts[0]!.id, 'pay-1')).rejects.toMatchObject({
      status: 409,
      response: { code: 'PAYMENT_INVALID_STATE' },
    });
    expect(receipts[0]?.status).toBe('unmatched');

    const ok = harness([pending()]);
    await ok.service.recordReceipt({ ...transfer, senderPhone: '99 88 77 66' }, 'u-finance');
    const m = await ok.service.manualMatch(ok.receipts[0]!.id, 'pay-1');
    expect(m.outcome).toBe('paid');
    expect(ok.payments[0]?.status).toBe('succeeded');
  });
});
