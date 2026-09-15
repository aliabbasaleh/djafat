import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { OrderAmountPort, OrderAccrualBreakdown, OrderPaymentContext } from '@djafat/types';
import { assertBalanced, money } from '@djafat/core';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaIdempotencyStore } from '../../common/idempotency/prisma-idempotency.store';
import type { LedgerService } from '../ledger/ledger.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { CashPaymentProvider } from './providers/cash/cash-payment.provider';
import { MockPaymentProvider } from './providers/mock/mock-payment.provider';
import { PaymentsService } from './payments.service';

export const ORDER_ID = 'order-1';
export const RESTAURANT_ID = 'restaurant-1';
export const COURIER_ID = 'courier-1';
export const CUSTOMER_ID = 'customer-1';

export interface PaymentRow {
  id: string;
  orderId: string;
  providerCode: string;
  methodCode: string;
  status: string;
  amountMinor: bigint;
  currency: string;
  pspFeeMinor: bigint;
  providerRef: string | null;
  idempotencyKey: string;
  attemptNo: number;
  metadata: unknown;
}
export interface RefundRow {
  id: string;
  paymentId: string;
  amountMinor: bigint;
  currency: string;
  reason: string;
  status: string;
  providerRef: string | null;
  idempotencyKey: string;
  entryGroup: string | null;
  requestedBy: string;
  attempts: number;
  lastError: string | null;
}
interface WebhookEventRow {
  id: string;
  providerCode: string;
  eventId: string;
  providerRef: string | null;
  payloadHash: string;
  signatureValid: boolean;
  status: string;
  error: string | null;
}
export interface LedgerGroupRow {
  kind: string;
  idempotencyKey: string;
  currency: string;
  entries: Array<{ accountRef: string; direction: 'debit' | 'credit'; amount: { minor: bigint } }>;
}
interface PaymentProviderConfigRow {
  id: string;
  providerCode: string;
  countryId: string | null;
  cityId: string | null;
  restaurantId: string | null;
  currency: string | null;
  minAmountMinor: bigint | null;
  maxAmountMinor: bigint | null;
  feeBps: number | null;
  enabled: boolean;
  priority: number;
  validFrom: Date;
  validTo: Date | null;
}

/**
 * A REAL concurrency harness, same discipline as `orders-checkout-race.spec.ts`
 * (docs/23 §1.1): `refunds_guard_over_refund` (migration 0021) is a Postgres
 * TRIGGER that locks the parent `payments` row (`FOR UPDATE`) before
 * recomputing the refunded total — this fake reproduces exactly that lock +
 * re-check contract with a per-payment-id async mutex, so a genuinely
 * concurrent `Promise.all([...])` proves the same race is closed, not merely
 * that requests happen to run one after another.
 */
export function makePaymentsRaceDb() {
  const payments: PaymentRow[] = [];
  const refunds: RefundRow[] = [];
  const webhookEvents: WebhookEventRow[] = [];
  const ledgerGroups: LedgerGroupRow[] = [];
  const outboxEvents: Array<{
    aggregate: string;
    aggregateId: string;
    eventType: string;
    payload: unknown;
  }> = [];
  const providerConfigs: PaymentProviderConfigRow[] = [];
  const idempotencyKeys = new Map<
    string,
    { fingerprint: string; response: unknown; status: 'reserved' | 'completed' }
  >();

  function rawText(strings: TemplateStringsArray): string {
    return strings.join('?');
  }

  // ── per-payment-id lock queue (simulates the trigger's `FOR UPDATE`) ─────
  const lockTail = new Map<string, Promise<void>>();
  async function acquirePaymentLock(paymentId: string): Promise<() => void> {
    const previous = lockTail.get(paymentId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    lockTail.set(
      paymentId,
      previous.then(() => mine),
    );
    await previous;
    return release;
  }

  function sumSucceededRefunds(paymentId: string, excludeId?: string): bigint {
    return refunds
      .filter((r) => r.paymentId === paymentId && r.status === 'succeeded' && r.id !== excludeId)
      .reduce((acc, r) => acc + r.amountMinor, 0n);
  }

  function sharedQueryRawHandler(
    text: string,
    values: unknown[],
  ): { handled: true; result: unknown[] } | { handled: false } {
    if (text.includes('SUM(amount_minor') && text.includes('FROM refunds')) {
      const [paymentId] = values as [string];
      return { handled: true, result: [{ total: sumSucceededRefunds(paymentId) }] };
    }
    return { handled: false };
  }

  function topLevelIdempotencyRaw() {
    const executeRaw = vi.fn(
      (strings: TemplateStringsArray, ...values: unknown[]): Promise<number> => {
        const text = rawText(strings);
        if (text.includes('INSERT INTO idempotency_keys')) {
          const [scope, key, fingerprint] = values as [string, string, string];
          const id = `${scope}::${key}`;
          if (idempotencyKeys.has(id)) return Promise.resolve(0);
          idempotencyKeys.set(id, { fingerprint, response: null, status: 'reserved' });
          return Promise.resolve(1);
        }
        if (text.includes('UPDATE idempotency_keys')) {
          const [response, scope, key] = values as [string, string, string];
          const row = idempotencyKeys.get(`${scope}::${key}`);
          if (row) {
            row.response = JSON.parse(response);
            row.status = 'completed';
          }
          return Promise.resolve(1);
        }
        if (text.includes('DELETE FROM idempotency_keys')) {
          const [scope, key] = values as [string, string];
          const id = `${scope}::${key}`;
          if (idempotencyKeys.get(id)?.status === 'reserved') idempotencyKeys.delete(id);
          return Promise.resolve(1);
        }
        return Promise.reject(new Error(`Unhandled top-level $executeRaw: ${text}`));
      },
    );
    return executeRaw;
  }

  const topLevelQueryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    await Promise.resolve(); // keep this genuinely async, matching Prisma's real $queryRaw
    const text = rawText(strings);
    if (text.includes('idempotency_keys') && text.includes('SELECT')) {
      const [scope, key] = values as [string, string];
      const row = idempotencyKeys.get(`${scope}::${key}`);
      return row
        ? [{ fingerprint: row.fingerprint, response: row.response, status: row.status }]
        : [];
    }
    if (text.includes('INSERT INTO webhook_events')) {
      const [providerCode, eventId, providerRef, payloadHash, signatureValid] = values as [
        string,
        string,
        string | null,
        string,
        boolean,
      ];
      if (webhookEvents.some((w) => w.providerCode === providerCode && w.eventId === eventId)) {
        return []; // ON CONFLICT DO NOTHING
      }
      const row: WebhookEventRow = {
        id: randomUUID(),
        providerCode,
        eventId,
        providerRef,
        payloadHash,
        signatureValid,
        status: 'received',
        error: null,
      };
      webhookEvents.push(row);
      return [{ id: row.id }];
    }
    const shared = sharedQueryRawHandler(text, values);
    if (shared.handled) return shared.result;
    throw new Error(`Unhandled top-level $queryRaw: ${text}`);
  });

  function makeClient(
    txQueryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>,
  ) {
    return {
      payment: {
        create: vi.fn((args: { data: Record<string, unknown> }) => {
          const row = {
            id: randomUUID(),
            status: 'pending',
            pspFeeMinor: 0n,
            providerRef: null,
            attemptNo: 1,
            metadata: null,
            ...args.data,
          } as PaymentRow;
          payments.push(row);
          return Promise.resolve(row);
        }),
        update: vi.fn((args: { where: { id: string }; data: Partial<PaymentRow> }) => {
          const row = payments.find((p) => p.id === args.where.id)!;
          Object.assign(row, args.data);
          return Promise.resolve(row);
        }),
        updateMany: vi.fn(
          (args: {
            where: { id: string; status?: { in: string[] } };
            data: Partial<PaymentRow>;
          }) => {
            const row = payments.find(
              (p) =>
                p.id === args.where.id &&
                (args.where.status ? args.where.status.in.includes(p.status) : true),
            );
            if (!row) return Promise.resolve({ count: 0 });
            Object.assign(row, args.data);
            return Promise.resolve({ count: 1 });
          },
        ),
        findUnique: vi.fn((args: { where: { id: string } }) =>
          Promise.resolve(payments.find((p) => p.id === args.where.id) ?? null),
        ),
        findUniqueOrThrow: vi.fn((args: { where: { id: string } }) => {
          const row = payments.find((p) => p.id === args.where.id);
          if (!row) throw new Error(`payment ${args.where.id} not found`);
          return Promise.resolve(row);
        }),
        findFirst: vi.fn((args: { where: { providerCode: string; providerRef: string | null } }) =>
          Promise.resolve(
            payments.find(
              (p) =>
                p.providerCode === args.where.providerCode &&
                p.providerRef === args.where.providerRef,
            ) ?? null,
          ),
        ),
      },
      refund: {
        create: vi.fn((args: { data: Record<string, unknown> }) => {
          const row = {
            id: randomUUID(),
            providerRef: null,
            entryGroup: null,
            attempts: 0,
            lastError: null,
            ...args.data,
          } as RefundRow;
          refunds.push(row);
          return Promise.resolve(row);
        }),
        update: vi.fn(
          (args: {
            where: { id: string };
            data: Omit<Partial<RefundRow>, 'attempts'> & { attempts?: { increment: number } };
          }) => {
            const row = refunds.find((r) => r.id === args.where.id)!;
            const { attempts, ...rest } = args.data;
            Object.assign(row, rest);
            if (attempts) row.attempts += attempts.increment;
            return Promise.resolve(row);
          },
        ),
        findUniqueOrThrow: vi.fn((args: { where: { id: string } }) => {
          const row = refunds.find((r) => r.id === args.where.id);
          if (!row) throw new Error(`refund ${args.where.id} not found`);
          return Promise.resolve(row);
        }),
      },
      webhookEvent: {
        update: vi.fn((args: { where: { id: string }; data: Partial<WebhookEventRow> }) => {
          const row = webhookEvents.find((w) => w.id === args.where.id)!;
          Object.assign(row, args.data);
          return Promise.resolve(row);
        }),
      },
      paymentProviderConfig: {
        findMany: vi.fn((args: { where: Record<string, unknown> }) => {
          // Minimal, deliberately permissive matcher — good enough for the fee-bps
          // resolution tests; the exhaustive geo-scoping logic is exercised by
          // reading `PaymentsService.resolveProviderFeeBps`'s own JS filter, not
          // re-implemented here.
          const where = args.where as { providerCode?: string; enabled?: boolean };
          return Promise.resolve(
            providerConfigs.filter(
              (c) =>
                (!where.providerCode || c.providerCode === where.providerCode) &&
                (where.enabled === undefined || c.enabled === where.enabled) &&
                c.feeBps !== null,
            ),
          );
        }),
      },
      paymentProviderRow: { findMany: vi.fn(() => Promise.resolve([])) },
      paymentMethod: { findMany: vi.fn(() => Promise.resolve([])) },
      outbox: {
        create: vi.fn((args: { data: Record<string, unknown> }) => {
          outboxEvents.push(args.data as never);
          return Promise.resolve(undefined);
        }),
      },
      $queryRaw: txQueryRaw,
    };
  }

  const baseClient = makeClient(topLevelQueryRaw);

  const store = {
    ...baseClient,
    $executeRaw: topLevelIdempotencyRaw(),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const releases: Array<() => void> = [];
      const txQueryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = rawText(strings);

        // markSucceeded — order_accrual path (not exercised by the refund race
        // tests, but present so other tests in this file can seed via it).
        if (text.includes('UPDATE payments') && text.includes("'succeeded'::payment_status")) {
          const [paymentId] = values as [string];
          // Faithful to the ACTUAL predicate text, not a hardcoded guess — a
          // fake that always allowed 'authorized' would pass even against the
          // pre-fix query ('pending' only) and prove nothing.
          const allowedStatuses = text.includes('authorized')
            ? ['pending', 'authorized']
            : ['pending'];
          const row = payments.find(
            (p) => p.id === paymentId && allowedStatuses.includes(p.status),
          );
          if (!row) return [];
          row.status = 'succeeded';
          return [
            {
              id: row.id,
              order_id: row.orderId,
              amount_minor: row.amountMinor,
              currency: row.currency,
              provider_code: row.providerCode,
            },
          ];
        }

        // transitionAndEmit — failed/cancelled/needs_review.
        if (text.includes('UPDATE payments') && text.includes('ANY(')) {
          const [toStatus, paymentId, fromStatuses] = values as [string, string, string[]];
          const row = payments.find((p) => p.id === paymentId && fromStatuses.includes(p.status));
          if (!row) return [];
          row.status = toStatus;
          return [{ id: row.id, order_id: row.orderId }];
        }

        // finalizeRefundSuccess — the guarded, race-critical UPDATE. Simulates
        // `refunds_guard_over_refund`: lock the parent payment FIRST, THEN
        // recompute the sum, so two concurrent callers for the SAME payment
        // genuinely serialize here instead of both reading a stale total.
        if (text.includes('UPDATE refunds') && text.includes("'succeeded'")) {
          const [refundId] = values as [string];
          const refund = refunds.find(
            (r) => r.id === refundId && ['pending', 'processing'].includes(r.status),
          );
          if (!refund) return [];

          const release = await acquirePaymentLock(refund.paymentId);
          releases.push(release);

          const payment = payments.find((p) => p.id === refund.paymentId);
          if (!payment) throw new Error(`Refund references unknown payment ${refund.paymentId}`);
          const alreadyRefunded = sumSucceededRefunds(refund.paymentId, refund.id);
          if (alreadyRefunded + refund.amountMinor > payment.amountMinor) {
            throw new Error(
              `Refund ${refund.id} would exceed payment ${refund.paymentId} amount: ` +
                `${alreadyRefunded} + ${refund.amountMinor} > ${payment.amountMinor}`,
            );
          }
          refund.status = 'succeeded';
          return [
            {
              id: refund.id,
              payment_id: refund.paymentId,
              amount_minor: refund.amountMinor,
              currency: refund.currency,
            },
          ];
        }

        const shared = sharedQueryRawHandler(text, values);
        if (shared.handled) return shared.result;
        throw new Error(`Unhandled tx $queryRaw: ${text}`);
      });
      const txClient = makeClient(txQueryRaw);
      try {
        return await fn(txClient);
      } finally {
        for (const release of releases) release();
      }
    }),
  };

  return {
    db: store as unknown as PrismaService,
    payments,
    refunds,
    webhookEvents,
    ledgerGroups,
    outboxEvents,
    providerConfigs,
    idempotencyKeys,
  };
}

export function fakeLedger(ledgerGroups: LedgerGroupRow[]): LedgerService {
  const posted = new Set<string>();
  return {
    postEntryGroupTx: vi.fn(
      async (
        _tx: unknown,
        input: {
          kind: string;
          idempotencyKey: string;
          currency: string;
          entries: LedgerGroupRow['entries'];
        },
      ) => {
        await Promise.resolve(); // keep this genuinely async, matching LedgerService's real signature
        assertBalanced(input.entries as never, input.currency); // never post an unbalanced group
        if (!posted.has(input.idempotencyKey)) {
          posted.add(input.idempotencyKey);
          ledgerGroups.push({
            kind: input.kind,
            idempotencyKey: input.idempotencyKey,
            currency: input.currency,
            entries: input.entries,
          });
        }
        return {
          id: randomUUID(),
          kind: input.kind,
          currency: input.currency,
          postedAt: new Date().toISOString(),
        };
      },
    ),
  } as unknown as LedgerService;
}

export function fakeOrderAmountPort(): OrderAmountPort {
  const context: OrderPaymentContext = {
    orderId: ORDER_ID,
    orderCode: 'DJ-0001',
    countryId: 'country-1',
    cityId: 'city-1',
    restaurantId: RESTAURANT_ID,
    currency: 'XAF',
  };
  const breakdown: OrderAccrualBreakdown = {
    restaurantId: RESTAURANT_ID,
    courierId: COURIER_ID,
    subtotal: money(8800n, 'XAF'),
    commission: money(2400n, 'XAF'),
    courierFee: money(1200n, 'XAF'),
  };
  return {
    getAuthoritativeAmount: vi.fn().mockResolvedValue(money(10000n, 'XAF')),
    getPaymentContext: vi.fn().mockResolvedValue(context),
    getAccrualBreakdown: vi.fn().mockResolvedValue(breakdown),
    getOwnerUserId: vi.fn().mockResolvedValue(CUSTOMER_ID),
  };
}

export function buildPaymentsService(
  db: PrismaService,
  ledgerGroups: LedgerGroupRow[],
): { payments: PaymentsService } {
  const registry = new PaymentProviderRegistry([
    new CashPaymentProvider(),
    new MockPaymentProvider(),
  ]);
  const idempotency = new IdempotencyService(new PrismaIdempotencyStore(db));
  const events = { emit: vi.fn(), emitAsync: vi.fn() } as unknown as EventEmitter2;
  const payments = new PaymentsService(
    db,
    new OutboxService(db),
    idempotency,
    registry,
    fakeLedger(ledgerGroups),
    events,
    fakeOrderAmountPort(),
  );
  return { payments };
}
