import { describe, expect, it } from 'vitest';

import type { LedgerEntryInput, OrderAccrualBreakdown } from '@djafat/types';
import { money } from '@djafat/core';
import { buildOrderAccrualEntries } from '../payments/accrual-entries';
import { buildRefundEntries } from '../payments/refund-entries';
import { buildCourierFeeReclassificationEntries } from './courier-fee-reclassification';
import { buildFundsAvailableEntries } from './release-entries';
import {
  buildDeliveriesServices,
  makeDeliveriesRaceDb,
  seedAssignedOffer,
  seedDeliveryCode,
  seedOnlineCourier,
  type LedgerGroupRow,
} from './deliveries-test-support';

/**
 * Bloc 6.1 §3-§4 — full audit of the courier's money as it crosses three
 * accounts, and of the reassignment policy that protects it.
 *
 * The reference order (docs/08 §8.9): 10 000 XAF total, 8 800 subtotal,
 * 2 400 commission, 1 200 courier fee, 1.5% PSP fee. XAF has exponent 0 —
 * every figure below is whole francs, never centimes.
 *
 * The journey:
 *   payment succeeds  →  COURIER_FEE_POOL          +1 200   (no courier yet)
 *   offer accepted    →  COURIER_PAYABLE:<id>      +1 200   (pool -1 200)
 *   delivery done     →  COURIER_AVAILABLE:<id>    +1 200   (payable -1 200)
 *
 * Every hop is a pure reclassification. The tests below assert that as a
 * property of the whole book, not just of one builder: after any sequence of
 * operations, total debits equal total credits, and the courier's three
 * accounts sum to exactly one courier fee — never two, never zero.
 */

const BREAKDOWN: OrderAccrualBreakdown = {
  restaurantId: 'restaurant-1',
  subtotal: money(8800n, 'XAF'),
  commission: money(2400n, 'XAF'),
  courierFee: money(1200n, 'XAF'),
};
const TOTAL_MINOR = 10_000n;
const FEE_BPS = 150; // 1.5%

// ── a tiny double-entry book over whatever the code under test posts ───────

type Book = Map<string, bigint>;

function post(book: Book, entries: readonly LedgerEntryInput[]): void {
  for (const e of entries) {
    const signed = e.direction === 'debit' ? e.amount.minor : -e.amount.minor;
    book.set(e.accountRef, (book.get(e.accountRef) ?? 0n) + signed);
  }
}

function postGroups(book: Book, groups: readonly LedgerGroupRow[]): void {
  for (const g of groups) post(book, g.entries as unknown as readonly LedgerEntryInput[]);
}

function balanceOf(book: Book, accountRef: string): bigint {
  return book.get(accountRef) ?? 0n;
}

/**
 * The invariant that matters most: across the WHOLE book, debits and credits
 * cancel. Because a debit is stored positive and a credit negative, that is
 * simply "every balance sums to zero". Any operation that created or destroyed
 * money would leave a residue here.
 */
function assertBookBalances(book: Book): void {
  const residue = [...book.values()].reduce((sum, v) => sum + v, 0n);
  expect(residue).toBe(0n);
}

/** What the courier is owed, wherever it currently sits. */
function courierHoldings(book: Book, courierId: string): bigint {
  return (
    -balanceOf(book, 'COURIER_FEE_POOL') -
    balanceOf(book, `COURIER_PAYABLE:${courierId}`) -
    balanceOf(book, `COURIER_AVAILABLE:${courierId}`)
  );
}

function accrualForPrepaid(courierId: string | null): LedgerEntryInput[] {
  return buildOrderAccrualEntries(
    {
      amountMinor: TOTAL_MINOR,
      currency: 'XAF',
      providerCode: 'mock_psp',
      feeBps: FEE_BPS,
      courierId,
    },
    BREAKDOWN,
  ).entries;
}

describe('the courier fee crosses three accounts and is never duplicated (mandate §3)', () => {
  it('payment success with no courier yet credits the un-owned pool, and the book balances', () => {
    const book: Book = new Map();
    post(book, accrualForPrepaid(null));

    expect(-balanceOf(book, 'COURIER_FEE_POOL')).toBe(1200n);
    assertBookBalances(book);
  });

  it('acceptance moves the fee out of the pool and into this courier’s payable — pool returns to zero', () => {
    const book: Book = new Map();
    post(book, accrualForPrepaid(null));
    post(book, buildCourierFeeReclassificationEntries('courier-A', BREAKDOWN.courierFee));

    expect(balanceOf(book, 'COURIER_FEE_POOL')).toBe(0n); // fully drained
    expect(-balanceOf(book, 'COURIER_PAYABLE:courier-A')).toBe(1200n);
    expect(courierHoldings(book, 'courier-A')).toBe(1200n); // still exactly one fee
    assertBookBalances(book);
  });

  it('delivery completion moves payable to available — still exactly one fee, never two', () => {
    const book: Book = new Map();
    post(book, accrualForPrepaid(null));
    post(book, buildCourierFeeReclassificationEntries('courier-A', BREAKDOWN.courierFee));
    post(book, buildFundsAvailableEntries({ courierId: 'courier-A' }, BREAKDOWN));

    expect(balanceOf(book, 'COURIER_FEE_POOL')).toBe(0n);
    expect(balanceOf(book, 'COURIER_PAYABLE:courier-A')).toBe(0n);
    expect(-balanceOf(book, 'COURIER_AVAILABLE:courier-A')).toBe(1200n);
    expect(courierHoldings(book, 'courier-A')).toBe(1200n);
    assertBookBalances(book);
  });

  it('a CASH order never touches the pool — the courier is known when it succeeds', () => {
    const book: Book = new Map();
    const entries = buildOrderAccrualEntries(
      {
        amountMinor: TOTAL_MINOR,
        currency: 'XAF',
        providerCode: 'cash',
        feeBps: 0,
        courierId: 'courier-A',
      },
      BREAKDOWN,
    ).entries;
    post(book, entries);

    expect(book.has('COURIER_FEE_POOL')).toBe(false); // never involved
    expect(-balanceOf(book, 'COURIER_PAYABLE:courier-A')).toBe(1200n);
    expect(balanceOf(book, 'CASH_FLOAT:courier-A')).toBe(10_000n); // courier holds the cash
    assertBookBalances(book);
  });

  it('a cash accrual with no resolved courier is refused outright rather than pooled', () => {
    expect(() =>
      buildOrderAccrualEntries(
        {
          amountMinor: TOTAL_MINOR,
          currency: 'XAF',
          providerCode: 'cash',
          feeBps: 0,
          courierId: null,
        },
        BREAKDOWN,
      ),
    ).toThrow(/cash order_accrual/i);
  });

  it('no single operation ever creates money — every builder is individually balanced', () => {
    const operations: Array<[string, LedgerEntryInput[]]> = [
      ['accrual (pooled)', accrualForPrepaid(null)],
      ['accrual (courier known)', accrualForPrepaid('courier-A')],
      [
        'reclassification',
        buildCourierFeeReclassificationEntries('courier-A', BREAKDOWN.courierFee),
      ],
      ['funds available', buildFundsAvailableEntries({ courierId: 'courier-A' }, BREAKDOWN)],
    ];

    for (const [label, entries] of operations) {
      const debits = entries
        .filter((e) => e.direction === 'debit')
        .reduce((s, e) => s + e.amount.minor, 0n);
      const credits = entries
        .filter((e) => e.direction === 'credit')
        .reduce((s, e) => s + e.amount.minor, 0n);
      expect(debits, `${label} must balance`).toBe(credits);
      expect(
        entries.every((e) => e.amount.minor > 0n),
        `${label} has no zero-amount leg`,
      ).toBe(true);
    }
  });
});

describe('repetition and replay never duplicate the fee (mandate §3)', () => {
  it('a webhook replayed twice posts the accrual once — the ledger dedupes on the idempotency key', async () => {
    const { ledgerGroups } = makeDeliveriesRaceDb();
    const ledger = (await import('./deliveries-test-support')).fakeLedger(ledgerGroups);

    const entries = accrualForPrepaid(null);
    for (let i = 0; i < 3; i += 1) {
      await ledger.postEntryGroupTx(
        {} as never,
        {
          kind: 'order_accrual',
          idempotencyKey: 'payment:pay-1:accrual',
          currency: 'XAF',
          entries,
          refs: { orderId: 'order-1' },
          createdBy: 'payments',
        } as never,
      );
    }

    expect(ledgerGroups).toHaveLength(1);
    const book: Book = new Map();
    postGroups(book, ledgerGroups);
    expect(-balanceOf(book, 'COURIER_FEE_POOL')).toBe(1200n); // one fee, not three
    assertBookBalances(book);
  });

  it('accepting twice reclassifies once — the second accept is an idempotent replay', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.acceptOffer(delivery.id, 'courier-A', 'accept-key-1');
    await expect(
      service.acceptOffer(delivery.id, 'courier-A', 'accept-key-1'),
    ).resolves.toMatchObject({ status: 'replayed' });

    const reclassifications = ledgerGroups.filter((g) =>
      g.idempotencyKey.startsWith('courier-accrual:'),
    );
    expect(reclassifications).toHaveLength(1);
  });

  it('two couriers cannot each drain the pool — the delivery-scoped key admits one reclassification', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    seedOnlineCourier(couriers, 'courier-B');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const results = await Promise.allSettled([
      service.acceptOffer(delivery.id, 'courier-A', 'k-a'),
      service.acceptOffer(delivery.id, 'courier-B', 'k-b'),
    ]);

    // B was never offered this delivery, so their accept is refused cleanly.
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');

    const book: Book = new Map();
    post(book, accrualForPrepaid(null));
    postGroups(book, ledgerGroups);

    expect(balanceOf(book, 'COURIER_FEE_POOL')).toBe(0n); // drained exactly once
    expect(-balanceOf(book, 'COURIER_PAYABLE:courier-A')).toBe(1200n);
    expect(balanceOf(book, 'COURIER_PAYABLE:courier-B')).toBe(0n); // never credited
    assertBookBalances(book);
  });

  it('confirming delivery twice posts funds_available once', async () => {
    const { db, deliveries, offers, couriers, proofs, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A', {
      status: 'on_the_way',
    });
    seedDeliveryCode(proofs, delivery.id, '1234');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.confirmDelivered(delivery.id, 'courier-A', '1234', 'k1');
    await service.confirmDelivered(delivery.id, 'courier-A', '1234', 'k1'); // same key

    expect(ledgerGroups.filter((g) => g.kind === 'funds_available')).toHaveLength(1);
  });

  it('a cash order is never reclassified — nothing was ever pooled for it', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    // `courierFeeInPool: false` is how `orders` reports a cash order (no
    // `awaiting_payment` history row) — the guard that stops `deliveries`
    // debiting OTHER orders' pooled money.
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups, {
      courierFeeInPool: false,
    });

    await service.acceptOffer(delivery.id, 'courier-A', 'k1');

    expect(
      ledgerGroups.filter((g) => g.idempotencyKey.startsWith('courier-accrual:')),
    ).toHaveLength(0);
  });
});

describe('reassignment policy (mandate §4)', () => {
  // The policy, stated once and pinned by the tests below:
  //
  //   Reassignment is only ever possible BEFORE acceptance. A courier who
  //   rejects, or whose offer expires, has had no money moved on their behalf,
  //   so the next courier's acceptance is the FIRST and ONLY reclassification.
  //
  //   After acceptance the delivery can no longer return to `searching_courier`
  //   — the state machine has no such edge. Cancelling or failing it is
  //   terminal. That is what makes the delivery-scoped idempotency key
  //   (`courier-accrual:<deliveryId>`) safe: it can never silently suppress a
  //   second courier's credit, because a second courier can never accept.

  it('a rejected offer moves NO money at all, so the next courier gets the whole fee', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    seedOnlineCourier(couriers, 'courier-B', 200);
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.rejectOffer(delivery.id, 'courier-A', 'reject-1');
    expect(ledgerGroups).toHaveLength(0); // A cost nothing

    // The rejection immediately re-dispatched to B, who now accepts.
    expect(delivery.courierId).toBe('courier-B');
    await service.acceptOffer(delivery.id, 'courier-B', 'accept-b');

    const book: Book = new Map();
    post(book, accrualForPrepaid(null));
    postGroups(book, ledgerGroups);

    expect(balanceOf(book, 'COURIER_FEE_POOL')).toBe(0n);
    expect(balanceOf(book, 'COURIER_PAYABLE:courier-A')).toBe(0n); // A never credited
    expect(-balanceOf(book, 'COURIER_PAYABLE:courier-B')).toBe(1200n); // B gets it all
    assertBookBalances(book);
  });

  it('the pool is debited exactly once across a full reject-then-accept-then-deliver run', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    seedOnlineCourier(couriers, 'courier-B', 200);
    const { deliveries: service, emitted } = buildDeliveriesServices(db, ledgerGroups);

    await service.rejectOffer(delivery.id, 'courier-A', 'reject-1');
    await service.acceptOffer(delivery.id, 'courier-B', 'accept-b');
    await service.markPickedUp(delivery.id, 'courier-B', 'pickup-b');

    // Pickup issues the real code and hands it to the customer — use THAT,
    // not a seeded fixture, so this exercises the production path end to end.
    const issued = emitted.find((e) => e.name === 'delivery.code_issued');
    expect(issued).toBeDefined();
    await service.confirmDelivered(
      delivery.id,
      'courier-B',
      issued!.payload['code'] as string,
      'deliver-b',
    );

    const book: Book = new Map();
    post(book, accrualForPrepaid(null));
    postGroups(book, ledgerGroups);

    expect(balanceOf(book, 'COURIER_FEE_POOL')).toBe(0n);
    expect(courierHoldings(book, 'courier-B')).toBe(1200n);
    expect(-balanceOf(book, 'COURIER_AVAILABLE:courier-B')).toBe(1200n);
    expect(balanceOf(book, 'COURIER_PAYABLE:courier-A')).toBe(0n);
    assertBookBalances(book);
  });

  it('after ACCEPTANCE a delivery can never return to searching — so POOL->A->B is unreachable', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.acceptOffer(delivery.id, 'courier-A', 'k1');
    expect(delivery.status).toBe('courier_accepted');

    // There is no transition back to the pool. A rejection now is refused,
    // and the delivery keeps its courier — which is exactly what makes the
    // delivery-scoped reclassification key safe (see the policy note above).
    await expect(service.rejectOffer(delivery.id, 'courier-A', 'k2')).rejects.toBeTruthy();
    expect(delivery.courierId).toBe('courier-A');
  });

  it('cancelling AFTER acceptance leaves the fee with the courier — no silent claw-back', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.acceptOffer(delivery.id, 'courier-A', 'k1');
    await service.cancel(
      { userId: 'admin-1', roles: ['admin'], permissions: ['deliveries:write'] },
      delivery.id,
      'customer changed mind',
      'k2',
    );

    expect(delivery.status).toBe('cancelled');

    const book: Book = new Map();
    post(book, accrualForPrepaid(null));
    postGroups(book, ledgerGroups);

    // The courier did real work before the cancellation. Reversing their fee
    // is an ops/compensation decision (docs/25 §11), never an automatic side
    // effect of cancelling — but the book still balances either way.
    expect(-balanceOf(book, 'COURIER_PAYABLE:courier-A')).toBe(1200n);
    expect(balanceOf(book, 'COURIER_FEE_POOL')).toBe(0n);
    assertBookBalances(book);
  });

  it('a FAILED delivery never posts funds_available — the fee stays payable, not available', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A', {
      status: 'on_the_way',
    });
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.reportFailed(
      { userId: 'courier-A', roles: ['courier'], permissions: ['deliveries:write'] },
      delivery.id,
      'customer unreachable',
      'k1',
    );

    expect(delivery.status).toBe('failed');
    expect(ledgerGroups.filter((g) => g.kind === 'funds_available')).toHaveLength(0);
    // And the courier is released for their next job.
    expect(couriers.find((c) => c.userId === 'courier-A')!.status).toBe('online');
  });

  it('cancelling BEFORE acceptance releases the courier and moves no money', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, 'courier-A');
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await service.cancel(
      { userId: 'customer-1', roles: ['customer'], permissions: [] },
      delivery.id,
      'changed mind',
      'k1',
    );

    expect(ledgerGroups).toHaveLength(0);
    const courier = couriers.find((c) => c.userId === 'courier-A')!;
    expect(courier.status).toBe('online');
    expect(courier.activeDeliveryId).toBeNull();
  });
});

describe('a refund never reaches into the courier’s money (mandate §3)', () => {
  // The documented policy (docs/08 §8.8): DJAFAT absorbs a refund out of
  // recognised revenue. It deliberately does NOT claw back the restaurant's or
  // courier's share — who ultimately bears a refund is an unsettled business
  // question, not something the ledger decides silently. These tests pin that
  // down as behaviour, so a future "helpful" change that starts debiting the
  // pool or a courier's payable fails loudly.

  it('is balanced on its own and moves only revenue and the PSP clearing account', () => {
    const entries = buildRefundEntries({ providerCode: 'mock_psp' }, money(TOTAL_MINOR, 'XAF'));

    const touched = entries.map((e) => e.accountRef).sort();
    expect(touched).toEqual(['DJAFAT_REVENUE', 'PSP_CLEARING']);

    const book: Book = new Map();
    post(book, entries);
    assertBookBalances(book);
  });

  it('leaves the pooled courier fee exactly where it was', () => {
    const book: Book = new Map();
    post(book, accrualForPrepaid(null));
    post(book, buildRefundEntries({ providerCode: 'mock_psp' }, money(TOTAL_MINOR, 'XAF')));

    expect(-balanceOf(book, 'COURIER_FEE_POOL')).toBe(1200n); // untouched
    assertBookBalances(book);
  });

  it('leaves an already-reclassified courier payable exactly where it was', () => {
    const book: Book = new Map();
    post(book, accrualForPrepaid(null));
    post(book, buildCourierFeeReclassificationEntries('courier-A', BREAKDOWN.courierFee));
    post(book, buildRefundEntries({ providerCode: 'mock_psp' }, money(TOTAL_MINOR, 'XAF')));

    expect(courierHoldings(book, 'courier-A')).toBe(1200n);
    expect(-balanceOf(book, 'COURIER_PAYABLE:courier-A')).toBe(1200n);
    assertBookBalances(book);
  });

  it('a cash refund becomes an owed liability rather than a PSP push-back', () => {
    const entries = buildRefundEntries({ providerCode: 'cash' }, money(TOTAL_MINOR, 'XAF'));
    expect(entries.map((e) => e.accountRef).sort()).toEqual(['DJAFAT_REVENUE', 'REFUNDS_PAYABLE']);

    const book: Book = new Map();
    post(book, entries);
    assertBookBalances(book);
  });
});
