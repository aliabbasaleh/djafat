import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { CourierPayoutsService } from './courier-payouts.service';

// FEAT-014 — docs/features/FEAT-014-courier-earnings-payouts (SPEC-014-02).

type Row = {
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
  sentBy: string | null;
  requestedAt: Date;
  sentAt: Date | null;
};

const unique = () =>
  new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });

function harness(
  balances: Record<string, { available: bigint; cash: bigint }>,
  // FEAT-022 (SPEC-022-07 R6): the Mobile Money numbers DJAFAT approved.
  approved: Record<string, { provider: 'airtel' | 'moov'; number: string }> = {},
) {
  const rows: Row[] = [];
  let n = 0;
  const courierPayout = {
    create: vi.fn(async ({ data }: { data: Partial<Row> }) => {
      const row = {
        id: `po-${++n}`,
        status: 'requested',
        paidMinor: null,
        receivedMinor: null,
        airtelFeeMinor: null,
        periodStart: null,
        transactionRef: null,
        sentBy: null,
        requestedAt: new Date(),
        sentAt: null,
        ...data,
      } as Row;
      // the two partial unique indexes of migration 0035
      if (
        row.status === 'requested' &&
        rows.some((r) => r.courierId === row.courierId && r.status === 'requested')
      )
        throw unique();
      if (
        row.kind === 'weekly' &&
        rows.some(
          (r) =>
            r.kind === 'weekly' &&
            r.courierId === row.courierId &&
            r.periodStart?.getTime() === row.periodStart?.getTime(),
        )
      )
        throw unique();
      rows.push(row);
      return row;
    }),
    findMany: vi.fn(async ({ where }: { where: { courierId?: string; status?: string } }) =>
      rows.filter(
        (r) =>
          (!where.courierId || r.courierId === where.courierId) &&
          (!where.status || r.status === where.status),
      ),
    ),
    findUnique: vi.fn(
      async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
    ),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const r = rows.find((x) => x.id === where.id)!;
      Object.assign(r, data);
      return r;
    }),
  };
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async (_s: TemplateStringsArray, id: string) => {
      const r = rows.find((x) => x.id === id);
      return r ? [{ courier_id: r.courierId, status: r.status }] : [];
    }),
    courierPayout,
  };
  const prisma = {
    courierPayout,
    courier: { findMany: vi.fn(async () => Object.keys(balances).map((userId) => ({ userId }))) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const ledgerRead = {
    getCourierAvailableTx: vi.fn(async (_t: unknown, id: string) => balances[id]?.available ?? 0n),
    getCashHeldTx: vi.fn(async (_t: unknown, id: string) => balances[id]?.cash ?? 0n),
  };
  const posted: Array<{
    kind: string;
    idempotencyKey: string;
    entries: Array<{ accountRef: string; direction: string; amount: { minor: bigint } }>;
  }> = [];
  const ledger = {
    postEntryGroupTx: vi.fn(async (_t: unknown, g: (typeof posted)[number]) => void posted.push(g)),
  };
  const platform = { getCourierPayoutMinMinor: vi.fn(async () => 2000) };
  const users = {
    getById: vi.fn(async () => ({ fullName: 'Livreur Test', phone: '+23566000002' })),
  };
  const events = { emit: vi.fn() };
  const payoutAccounts = {
    approvedPayoutAccounts: vi.fn(
      async (ids: readonly string[]) =>
        new Map(ids.flatMap((id) => (approved[id] ? [[id, approved[id]] as const] : []))),
    ),
  };
  const service = new CourierPayoutsService(
    prisma as never,
    ledger as never,
    ledgerRead as never,
    platform as never,
    users as never,
    events as never,
    payoutAccounts,
  );
  return { service, rows, posted, events, payoutAccounts };
}

describe('SPEC-014-02 — courier withdrawals and payouts', () => {
  it('SPEC-014-02-SC02 — withdraws the whole net; under the minimum or with one open → 409', async () => {
    const h = harness({
      c1: { available: 12_000n, cash: 8_500n },
      c2: { available: 1_500n, cash: 0n },
    });
    const p = await h.service.requestOnDemand('c1');
    expect(p).toMatchObject({
      kind: 'on_demand',
      status: 'requested',
      feePayer: 'courier',
      requested: { minor: '3500' },
    });
    await expect(h.service.requestOnDemand('c1')).rejects.toMatchObject({
      status: 409,
      response: { code: 'PAYOUT_NOT_ALLOWED' },
    });
    await expect(h.service.requestOnDemand('c2')).rejects.toMatchObject({
      status: 409,
      response: { code: 'PAYOUT_NOT_ALLOWED' },
    });
  });

  it('SPEC-014-02-SC03 — weekly: only couriers with a positive net and no open request, once a week, fee on DJAFAT', async () => {
    const h = harness({
      a: { available: 5_000n, cash: 0n },
      b: { available: 1_000n, cash: 4_000n },
      c: { available: 9_000n, cash: 0n },
    });
    await h.service.requestOnDemand('c'); // c already asked
    const monday = new Date('2026-11-15T23:00:00Z');
    expect(await h.service.prepareWeekly(monday)).toEqual({ created: 1 });
    expect(await h.service.prepareWeekly(monday)).toEqual({ created: 0 });
    const weekly = h.rows.filter((r) => r.kind === 'weekly');
    expect(weekly).toHaveLength(1);
    expect(weekly[0]).toMatchObject({ courierId: 'a', feePayer: 'djafat', requestedMinor: 5_000n });
    expect(weekly[0]!.periodStart!.toISOString()).toBe('2026-11-08T23:00:00.000Z'); // the week that ended
  });

  it('SPEC-014-02-SC04 — sent: cash owed settled then the rest paid, booked once; a second send is refused', async () => {
    const h = harness({ c1: { available: 12_000n, cash: 8_500n } });
    const p = await h.service.requestOnDemand('c1');
    const sent = await h.service.markSent(p.id, 'staff-1', {
      transactionRef: 'AM123',
      airtelFeeMinor: 100n,
    });
    expect(sent).toMatchObject({
      status: 'sent',
      received: { minor: '3400' },
      transactionRef: 'AM123',
    });
    expect(h.posted.map((g) => g.kind)).toEqual(['cash_reconciliation', 'payout']);
    const [settle, payout] = h.posted;
    expect(settle!.entries.map((e) => [e.accountRef, e.direction, e.amount.minor])).toEqual([
      ['COURIER_AVAILABLE:c1', 'debit', 8_500n],
      ['CASH_FLOAT:c1', 'credit', 8_500n],
    ]);
    expect(payout!.entries.map((e) => [e.accountRef, e.direction, e.amount.minor])).toEqual([
      ['COURIER_AVAILABLE:c1', 'debit', 3_500n],
      ['PSP_CLEARING', 'credit', 3_500n],
    ]);
    expect(payout!.idempotencyKey).toBe(`payout:${p.id}`);
    expect(h.events.emit).toHaveBeenCalledWith('courier.cash_remitted', { courierId: 'c1' });
    await expect(
      h.service.markSent(p.id, 'staff-1', { transactionRef: 'AM124', airtelFeeMinor: 0n }),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.posted).toHaveLength(2);
  });

  it('SPEC-014-02-SC04 — weekly sent: DJAFAT books the Airtel fee as an expense, the courier gets it all', async () => {
    const h = harness({ a: { available: 5_000n, cash: 0n } });
    await h.service.prepareWeekly(new Date('2026-11-15T23:00:00Z'));
    const id = h.rows[0]!.id;
    const sent = await h.service.markSent(id, 'staff-1', {
      transactionRef: 'AM9',
      airtelFeeMinor: 150n,
    });
    expect(sent.received).toEqual({ minor: '5000', currency: 'XAF' });
    expect(h.posted).toHaveLength(1);
    expect(h.posted[0]!.entries.map((e) => [e.accountRef, e.direction, e.amount.minor])).toEqual([
      ['COURIER_AVAILABLE:a', 'debit', 5_000n],
      ['PSP_FEE_EXPENSE', 'debit', 150n],
      ['PSP_CLEARING', 'credit', 5_150n],
    ]);
  });

  // FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-07 R6).
  it('SPEC-022-07-SC05 — staff send the earnings to the approved Mobile Money number; a courier created by the team keeps the account phone', async () => {
    const h = harness(
      { c1: { available: 5_000n, cash: 0n }, c2: { available: 4_000n, cash: 0n } },
      { c1: { provider: 'airtel', number: '+23566000001' } },
    );
    await h.service.requestOnDemand('c1');
    await h.service.requestOnDemand('c2');

    const list = await h.service.listForStaff('requested');

    expect(list.map((p) => [p.courier.id, p.courier.mobileMoney, p.courier.phone])).toEqual([
      ['c1', { provider: 'airtel', number: '+23566000001' }, '+23566000002'],
      ['c2', null, '+23566000002'],
    ]);
    expect(h.payoutAccounts.approvedPayoutAccounts).toHaveBeenCalledWith(['c1', 'c2']);
  });
});
