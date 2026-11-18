import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Payment, Refund } from '@prisma/client';
import type { OrderAmountPort, OrderCancellationFacts, OutboxEnvelope } from '@djafat/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ORDER_AMOUNT_PORT } from '../../common/ports/order-amount.port';
import { RELAYED_DOMAIN_EVENT } from '../../common/events/relayed-domain-event';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerReadService } from '../ledger/ledger-read.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentsService } from './payments.service';
import {
  automaticRefundReason,
  buildOrderReversalEntries,
  refundReversesAccrual,
} from './order-reversal-entries';

/** The idempotency key of the automatic refund an ended order's payment gets: at most one each. */
export const ORDER_ENDED_REFUND_KEY = 'order-ended';

/** A rejected order emits `order.cancelled` too (`OrdersService.eventNameFor`): one event for both. */
const ENDED_EVENT = 'order.cancelled';

/**
 * PAY-04 — the money of an order that ends without a delivery (rejected by
 * the restaurant, cancelled by the customer or staff, not confirmed in time,
 * or cancelled with its delivery).
 *
 * - An open payment (`pending`/`authorized`: cash due at the door, a transfer
 *   not received yet) is cancelled.
 * - A paid one gets one automatic refund of what is left to refund. If the
 *   order never reached the kitchen, its accrual is reversed in the same
 *   transaction: the restaurant and courier shares and DJAFAT's commission
 *   go back, and the customer is owed the amount (`order-reversal-entries.ts`).
 *   Later on, the documented rule stays: DJAFAT absorbs the refund.
 * - A provider that refunds by API gets the refund at once; a merchant wallet
 *   (Airtel, Tigo, Moov: refunded by hand) leaves it `pending` for operations,
 *   who send the money and record it (`PaymentsService.completeRefundByHand`).
 *
 * Two triggers, one idempotent path: the in-process `order.cancelled`
 * (emitted for a rejection too; fast, but lost if the process stops at the
 * wrong moment) and the same event relayed from the outbox through the durable stream
 * (`RELAYED_DOMAIN_EVENT`, at least once; the only trigger for the worker's
 * confirmation timeout, ORD-02). The payment row is locked while the refund
 * is created, so concurrent triggers produce one refund and one reversal.
 */
@Injectable()
export class OrderRefundsService {
  private readonly logger = new Logger(OrderRefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly ledgerRead: LedgerReadService,
    private readonly registry: PaymentProviderRegistry,
    private readonly payments: PaymentsService,
    @Inject(ORDER_AMOUNT_PORT) private readonly orders: OrderAmountPort,
  ) {}

  @OnEvent('order.cancelled')
  async onOrderCancelled(payload: { orderId: string }): Promise<void> {
    await this.settleQuietly(payload.orderId);
  }

  /** Durable path: an error propagates, so the stream entry stays pending and comes back. */
  @OnEvent(RELAYED_DOMAIN_EVENT)
  async onRelayedEvent(envelope: OutboxEnvelope): Promise<void> {
    if (envelope.eventType !== ENDED_EVENT) return;
    const orderId = (envelope.payload as { orderId?: unknown } | null)?.orderId;
    if (typeof orderId !== 'string') return;
    await this.settle(orderId);
  }

  /**
   * Settles the money of one ended order. Safe to call any number of times:
   * a second call finds the refund already there and only retries the
   * provider for one still `pending`.
   */
  async settle(orderId: string): Promise<void> {
    let facts: OrderCancellationFacts;
    try {
      facts = await this.orders.getCancellationFacts(orderId);
    } catch (err) {
      if (err instanceof NotFoundException) return; // not an order of ours: nothing to settle
      throw err;
    }
    if (facts.status !== 'cancelled' && facts.status !== 'rejected') return;

    const payments = await this.prisma.payment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    for (const payment of payments) {
      if (payment.status === 'pending' || payment.status === 'authorized') {
        await this.payments.cancelOpenPayment(payment.id);
      } else if (payment.status === 'succeeded' || payment.status === 'partially_refunded') {
        await this.refundPaidPayment(payment, facts);
      }
    }
  }

  private async settleQuietly(orderId: string): Promise<void> {
    try {
      await this.settle(orderId);
    } catch (err) {
      // The relayed copy of the same event retries it.
      this.logger.error(
        `settling ended order ${orderId} failed, left to the durable retry: ${String(err)}`,
      );
    }
  }

  private async refundPaidPayment(payment: Payment, facts: OrderCancellationFacts): Promise<void> {
    const refund = await this.createRefundOnce(payment, facts);
    if (!refund || refund.status !== 'pending') return;

    const capabilities = this.registry.has(payment.providerCode)
      ? this.registry.get(payment.providerCode).getCapabilities()
      : null;
    const whole = refund.amountMinor === payment.amountMinor;
    if (capabilities?.refund && (whole || capabilities.partialRefund)) {
      await this.payments.sendRefundToProvider(refund.id);
    } else {
      this.logger.warn(
        `refund ${refund.id} (order ${facts.orderCode}, ${payment.providerCode}) is to be sent by hand`,
      );
    }
  }

  /**
   * One transaction, under a lock on the payment row: the refund for what is
   * left to refund and, when the order never reached the kitchen, the
   * reversal of its accrual. Returns the existing refund when it was already
   * created, null when nothing is left to refund.
   */
  private async createRefundOnce(
    payment: Payment,
    facts: OrderCancellationFacts,
  ): Promise<Refund | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
      const existing = await tx.refund.findUnique({
        where: {
          paymentId_idempotencyKey: {
            paymentId: payment.id,
            idempotencyKey: ORDER_ENDED_REFUND_KEY,
          },
        },
      });
      if (existing) return existing;

      const prior = await tx.$queryRaw<Array<{ total: bigint; count: bigint }>>`
        SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total, COUNT(*)::bigint AS count
        FROM refunds
        WHERE payment_id = ${payment.id}::uuid AND status IN ('pending', 'processing', 'succeeded')
      `;
      const remaining = payment.amountMinor - (prior[0]?.total ?? 0n);
      if (remaining <= 0n) return null;

      let reverses = refundReversesAccrual({
        facts,
        providerCode: payment.providerCode,
        priorRefunds: Number(prior[0]?.count ?? 0n),
      });
      if (reverses) {
        const accrual = await this.ledgerRead.getEntryGroupEntriesTx(tx, `payment:${payment.id}`);
        if (accrual.length === 0) {
          // A succeeded payment always has its accrual (same transaction as the
          // status); without it there is nothing to reverse, so DJAFAT absorbs.
          this.logger.error(`payment ${payment.id} has no order_accrual group: refund absorbed`);
          reverses = false;
        } else {
          await this.ledger.postEntryGroupTx(tx, {
            kind: 'adjustment',
            idempotencyKey: `order-reversal:${payment.id}`,
            currency: payment.currency,
            entries: buildOrderReversalEntries(accrual),
            refs: { orderId: payment.orderId, paymentId: payment.id },
            memo: `Order ${facts.orderCode} ended before preparation (${facts.status})`,
            createdBy: 'payments',
          });
        }
      }

      return tx.refund.create({
        data: {
          paymentId: payment.id,
          amountMinor: remaining,
          currency: payment.currency,
          reason: automaticRefundReason(facts),
          status: 'pending',
          idempotencyKey: ORDER_ENDED_REFUND_KEY,
          requestedBy: null,
          compensatesAccrual: reverses,
        },
      });
    });
  }
}
