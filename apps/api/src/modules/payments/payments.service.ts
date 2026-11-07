import { createHash } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import type { MoneyJson, OrderAmountPort, RawWebhookRequest } from '@djafat/types';
import { assertPositive, money } from '@djafat/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { toMoneyJson } from '../../common/money/money.mapper';
import { ORDER_AMOUNT_PORT } from '../../common/ports/order-amount.port';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { buildOrderAccrualEntries, MOCK_PSP_FEE_BPS } from './accrual-entries';
import { buildRefundEntries } from './refund-entries';
import type { CreatePaymentInput } from './dto/create-payment.schema';
import type { RefundPaymentInput } from './dto/refund-payment.schema';

export interface PaymentDto {
  id: string;
  orderId: string;
  providerCode: string;
  methodCode: string;
  status: string;
  amount: MoneyJson;
  pspFee: MoneyJson;
  providerRef: string | null;
  attemptNo: number;
}

export interface RefundDto {
  id: string;
  paymentId: string;
  amount: MoneyJson;
  reason: string;
  status: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly idempotency: IdempotencyService,
    private readonly registry: PaymentProviderRegistry,
    private readonly ledger: LedgerService,
    private readonly events: EventEmitter2,
    @Inject(ORDER_AMOUNT_PORT) private readonly orderAmount: OrderAmountPort,
  ) {}

  // ── creation ────────────────────────────────────────────────────────────

  async createPayment(
    input: CreatePaymentInput,
    idempotencyKey: string,
  ): Promise<{ status: 'created' | 'replayed'; payment: PaymentDto }> {
    const run = await this.idempotency.run('payments', idempotencyKey, input, () =>
      this.doCreatePayment(input, idempotencyKey),
    );
    return { status: run.status, payment: run.response };
  }

  private async doCreatePayment(
    input: CreatePaymentInput,
    idempotencyKey: string,
  ): Promise<PaymentDto> {
    // Server-authoritative: the client never supplies an amount (docs/08 §8.4).
    const context = await this.orderAmount.getPaymentContext(input.orderId); // throws if not awaiting_payment
    const amount = await this.orderAmount.getAuthoritativeAmount(input.orderId);

    if (!this.registry.has(input.providerCode)) {
      throw new NotFoundException({
        code: 'PROVIDER_UNAVAILABLE',
        message: `Payment provider "${input.providerCode}" is not registered.`,
      });
    }
    if (!this.registry.supportsAmount(input.providerCode, amount)) {
      throw new ConflictException({
        code: 'PAYMENT_METHOD_UNAVAILABLE',
        message: `Provider "${input.providerCode}" cannot process ${amount.currency}.`,
      });
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          orderId: input.orderId,
          providerCode: input.providerCode,
          methodCode: input.methodCode,
          status: 'pending',
          amountMinor: amount.minor,
          currency: amount.currency,
          idempotencyKey,
          ...(input.metadata !== undefined
            ? { metadata: input.metadata as Prisma.InputJsonValue }
            : {}),
        },
      });
      await this.outbox.enqueue(tx, {
        aggregate: 'payment',
        aggregateId: created.id,
        eventType: 'payment.created',
        payload: { paymentId: created.id, orderId: created.orderId },
      });
      return created;
    });

    const provider = this.registry.get(input.providerCode);
    let result;
    try {
      result = await provider.initiate({
        paymentId: payment.id,
        amount,
        orderCode: context.orderCode,
        idempotencyKey,
        ...(input.payerPhone !== undefined ? { payerPhone: input.payerPhone } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      });
    } catch (err) {
      this.logger.error(`provider.initiate threw for payment ${payment.id}: ${String(err)}`);
      await this.markFailed(payment.id, 'provider.initiate threw');
      throw new ConflictException({
        code: 'PAYMENT_PROVIDER_ERROR',
        message: `Provider "${input.providerCode}" failed to initiate the payment.`,
      });
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        providerRef: result.providerRef,
        status: result.status === 'succeeded' ? 'pending' : result.status,
      },
    });

    // Synchronous providers (cash, mock-by-default) resolve immediately; the
    // SAME transactional path as the webhook handles it (docs/18 §11).
    if (result.status === 'succeeded') {
      await this.markSucceeded(payment.id);
    } else if (result.status === 'failed') {
      await this.markFailed(payment.id, 'provider rejected at initiate');
    }

    // FEAT-009 (SPEC-009-01): money collected at delivery must not gate the
    // order — otherwise it never leaves awaiting_payment and expires. `orders`
    // reacts to this event (DAG: it never imports `payments`).
    if (result.status === 'pending' && provider.getCapabilities().collectedOnDelivery === true) {
      this.events.emit('payment.on_delivery', { orderId: payment.orderId, paymentId: payment.id });
    }

    const final = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    return this.toDto(final);
  }

  // ── webhook ─────────────────────────────────────────────────────────────

  async handleWebhook(
    providerCode: string,
    rawReq: RawWebhookRequest,
  ): Promise<{ status: string }> {
    if (!this.registry.has(providerCode)) {
      throw new NotFoundException({
        code: 'PROVIDER_UNAVAILABLE',
        message: `Unknown provider ${providerCode}.`,
      });
    }
    const provider = this.registry.get(providerCode);
    const parsed = await provider.verifyAndParseWebhook(rawReq);

    const bodyText =
      typeof rawReq.rawBody === 'string'
        ? rawReq.rawBody
        : Buffer.from(rawReq.rawBody).toString('utf8');
    const payloadHash = createHash('sha256').update(bodyText).digest('hex');

    // Durable idempotency (docs/08 §8.6): a replayed/duplicated webhook is a no-op.
    const inserted = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO webhook_events (provider_code, event_id, provider_ref, payload_hash, signature_valid, status)
      VALUES (${providerCode}, ${parsed.eventId}, ${parsed.providerRef || null}, ${payloadHash}, ${parsed.signatureValid}, 'received')
      ON CONFLICT (provider_code, event_id) DO NOTHING
      RETURNING id
    `;
    if (!inserted[0]) {
      this.logger.debug(`Duplicate webhook ignored (${providerCode}/${parsed.eventId})`);
      return { status: 'duplicate' };
    }
    const webhookEventId = inserted[0].id;

    if (!parsed.signatureValid) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { status: 'ignored' },
      });
      this.logger.warn(`Invalid webhook signature (${providerCode}/${parsed.eventId})`);
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Invalid webhook signature.',
      });
    }

    const payment = await this.prisma.payment.findFirst({
      where: { providerCode, providerRef: parsed.providerRef },
    });
    if (!payment) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: {
          status: 'failed',
          error: `No payment found for providerRef ${parsed.providerRef}`,
          processedAt: new Date(),
        },
      });
      return { status: 'unmatched' };
    }

    // Recoupe le montant annoncé par le webhook avec celui de la commande — un
    // écart ne crédite JAMAIS automatiquement (docs/08 §8.7).
    if (
      parsed.amount &&
      (parsed.amount.minor !== payment.amountMinor || parsed.amount.currency !== payment.currency)
    ) {
      await this.markNeedsReview(payment.id, 'amount/currency mismatch vs webhook');
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { status: 'failed', error: 'amount mismatch', processedAt: new Date() },
      });
      this.logger.error(
        `Amount mismatch on payment ${payment.id} — flagged needs_review, no credit.`,
      );
      return { status: 'needs_review' };
    }

    // Out-of-order / late webhook safety: `markSucceeded`/`markFailed` only
    // transition FROM 'pending' (conditional UPDATE) — a webhook arriving
    // after the payment already resolved (succeeded, cancelled, refunded,
    // needs_review...) is a safe no-op, never a regression (docs/08 §8.3).
    if (parsed.status === 'succeeded') {
      await this.markSucceeded(payment.id);
    } else if (parsed.status === 'failed') {
      await this.markFailed(payment.id, 'webhook reported failed');
    }

    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: 'processed', processedAt: new Date() },
    });
    return { status: 'ok' };
  }

  // ── the atomic core (docs/18 §11) ─────────────────────────────────────────

  /**
   * Marks a payment succeeded, posts `order_accrual`, and enqueues the
   * `payment.succeeded` outbox event — ALL in one PostgreSQL transaction, so
   * "payment succeeded" can never be observed without a balanced ledger entry
   * (docs/18 §11). Idempotent: a second call (retry, duplicate webhook, or the
   * synchronous + webhook paths both firing) is a safe no-op.
   *
   * `resolvedCourierId` (Bloc 6, docs/25 §12, §28): set ONLY by the
   * `delivery.delivered` reaction below, for cash — a courier is guaranteed
   * assigned by then (they physically collected the cash). Every other
   * caller (synchronous prepaid confirm, webhook) omits it: a courier is
   * essentially never known that early, so the courier's share is credited
   * to `COURIER_FEE_POOL` and reclassified once `deliveries` assigns one.
   */
  async markSucceeded(paymentId: string, resolvedCourierId?: string): Promise<void> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          order_id: string;
          amount_minor: bigint;
          currency: string;
          provider_code: string;
        }>
      >`
        UPDATE payments SET status = 'succeeded'::payment_status
        WHERE id = ${paymentId}::uuid
          AND status = ANY(ARRAY['pending', 'authorized']::payment_status[])
        RETURNING id, order_id, amount_minor, currency, provider_code
      `;
      // 'authorized' matters once a capture-capable provider is activated
      // (docs/08 §8.3: AUTHORIZED --capture()--> SUCCESS) — without it here, a
      // final-success webhook for such a payment would silently no-op instead
      // of completing it. No current provider sets capabilities.capture, so
      // this path is latent today, not exercised by mock/cash.
      if (!rows[0]) return null; // already succeeded/failed elsewhere — idempotent no-op

      const payment = rows[0];
      const breakdown = await this.orderAmount.getAccrualBreakdown(payment.order_id);
      const feeBps = await this.resolveProviderFeeBps(
        payment.provider_code,
        breakdown.restaurantId,
      );

      // Pure, unit-tested elsewhere (accrual-entries.spec.ts) — see docs/18 §13.
      const { entries, pspFee } = buildOrderAccrualEntries(
        {
          amountMinor: payment.amount_minor,
          currency: payment.currency,
          providerCode: payment.provider_code,
          feeBps,
          courierId: resolvedCourierId ?? null,
        },
        breakdown,
      );

      await this.ledger.postEntryGroupTx(tx, {
        kind: 'order_accrual',
        idempotencyKey: `payment:${payment.id}`,
        currency: payment.currency,
        entries,
        refs: { orderId: payment.order_id, paymentId: payment.id },
        createdBy: 'payments',
      });

      await tx.payment.update({
        where: { id: payment.id },
        data: { pspFeeMinor: pspFee.minor },
      });

      await this.outbox.enqueue(tx, {
        aggregate: 'payment',
        aggregateId: payment.id,
        eventType: 'payment.succeeded',
        payload: { paymentId: payment.id, orderId: payment.order_id },
      });

      return { paymentId: payment.id, orderId: payment.order_id };
    });

    if (!outcome) return;

    // Fast, same-process reaction — fired AFTER commit (docs/05 §5.4).
    this.events.emit('payment.succeeded', {
      paymentId: outcome.paymentId,
      orderId: outcome.orderId,
    });
    this.events.emit('payment.updated', {
      orderId: outcome.orderId,
      paymentId: outcome.paymentId,
      status: 'succeeded',
    });
    this.logger.log(`payment ${outcome.paymentId} succeeded (order ${outcome.orderId})`);
  }

  /**
   * Cash completion (Bloc 6, docs/25 §18, §28): a cash-on-delivery payment
   * stays `pending` until the courier actually collects it at delivery —
   * nothing else in this codebase ever resolves it. `deliveries` never
   * writes to `payments` directly (DAG); it emits `delivery.delivered` (with
   * `courierId`) and this reacts, the exact pattern `orders` already uses
   * for `payment.succeeded`. A no-op for a prepaid order (no matching
   * pending cash payment) and idempotent on replay (`markSucceeded` itself
   * is idempotent).
   */
  @OnEvent('delivery.delivered')
  async onDeliveryDelivered(payload: { orderId: string; courierId: string }): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { orderId: payload.orderId, providerCode: 'cash', status: 'pending' },
    });
    if (!payment) return;
    await this.markSucceeded(payment.id, payload.courierId);
  }

  /** Idempotent: only transitions FROM pending/authorized — a no-op once the payment already resolved. */
  private async markFailed(paymentId: string, reason: string): Promise<void> {
    const outcome = await this.transitionAndEmit(
      paymentId,
      'failed',
      ['pending', 'authorized'],
      'payment.failed',
      { reason },
    );
    if (outcome) this.logger.log(`payment ${outcome.paymentId} failed (${reason})`);
  }

  /** Idempotent: only transitions FROM pending/authorized. Ops must resolve manually (docs/08 §8.3). */
  private async markNeedsReview(paymentId: string, reason: string): Promise<void> {
    const outcome = await this.transitionAndEmit(
      paymentId,
      'needs_review',
      ['pending', 'authorized'],
      'payment.needs_review',
      { reason },
    );
    if (outcome) this.logger.warn(`payment ${outcome.paymentId} needs_review (${reason})`);
  }

  /** Idempotent: only transitions FROM pending/authorized (docs/08 §8.7). */
  private async markCancelled(paymentId: string): Promise<void> {
    const outcome = await this.transitionAndEmit(
      paymentId,
      'cancelled',
      ['pending', 'authorized'],
      'payment.cancelled',
      {},
    );
    if (outcome) this.logger.log(`payment ${outcome.paymentId} cancelled`);
  }

  /**
   * Shared shape for the non-ledger-posting transitions (failed/cancelled/
   * needs_review): one conditional UPDATE + one transactional outbox event.
   * `markSucceeded` stays separate because it ALSO posts ledger entries.
   */
  private async transitionAndEmit(
    paymentId: string,
    toStatus: 'failed' | 'cancelled' | 'needs_review',
    fromStatuses: readonly string[],
    eventType: 'payment.failed' | 'payment.cancelled' | 'payment.needs_review',
    extraPayload: Record<string, unknown>,
  ): Promise<{ paymentId: string; orderId: string } | null> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; order_id: string }>>`
        UPDATE payments SET status = ${toStatus}::payment_status
        WHERE id = ${paymentId}::uuid AND status = ANY(${fromStatuses}::payment_status[])
        RETURNING id, order_id
      `;
      if (!rows[0]) return null;
      await this.outbox.enqueue(tx, {
        aggregate: 'payment',
        aggregateId: rows[0].id,
        eventType,
        payload: { paymentId: rows[0].id, orderId: rows[0].order_id, ...extraPayload },
      });
      return { paymentId: rows[0].id, orderId: rows[0].order_id };
    });

    if (!outcome) return null;
    this.events.emit('payment.updated', {
      orderId: outcome.orderId,
      paymentId: outcome.paymentId,
      status: toStatus,
    });
    return outcome;
  }

  /**
   * `payment_provider_configs.fee_bps` (Bloc 5 — replaces the Bloc 0.5
   * hardcoded `MOCK_PSP_FEE_BPS`). Resolution: the most specific ENABLED,
   * currently-valid row wins (restaurant-scoped > global); cash never has a
   * PSP fee; falls back to the seeded MVP default if nothing matches.
   */
  private async resolveProviderFeeBps(providerCode: string, restaurantId: string): Promise<number> {
    if (providerCode === 'cash') return 0;
    const now = new Date();
    const configs = await this.prisma.paymentProviderConfig.findMany({
      where: {
        providerCode,
        enabled: true,
        feeBps: { not: null },
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
        AND: [{ OR: [{ restaurantId }, { restaurantId: null }] }],
      },
    });
    if (configs.length === 0) return MOCK_PSP_FEE_BPS;

    configs.sort(
      (a, b) => (b.restaurantId ? 1 : 0) - (a.restaurantId ? 1 : 0) || b.priority - a.priority,
    );
    return configs[0]!.feeBps!;
  }

  // ── cancel (docs/08 §8.7) ──────────────────────────────────────────────────

  async cancelPayment(
    id: string,
    idempotencyKey: string,
  ): Promise<{ status: 'created' | 'replayed'; payment: PaymentDto }> {
    const run = await this.idempotency.run('payments:cancel', idempotencyKey, { id }, () =>
      this.doCancelPayment(id),
    );
    return { status: run.status, payment: run.response };
  }

  private async doCancelPayment(id: string): Promise<PaymentDto> {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Payment ${id} not found.` });
    }
    if (['succeeded', 'refunded', 'partially_refunded'].includes(payment.status)) {
      throw new ConflictException({
        code: 'PAYMENT_ALREADY_COMPLETED',
        message: `Payment ${id} already completed (status=${payment.status}) — use refund instead.`,
      });
    }
    if (!['pending', 'authorized'].includes(payment.status)) {
      throw new ConflictException({
        code: 'PAYMENT_INVALID_STATE',
        message: `Payment ${id} cannot be cancelled from status ${payment.status}.`,
      });
    }

    const provider = this.registry.get(payment.providerCode);
    if (provider.getCapabilities().cancel && payment.providerRef) {
      try {
        await provider.cancel({ providerRef: payment.providerRef, idempotencyKey: id });
      } catch (err) {
        // Provider-side cancel failing doesn't block the internal cancel —
        // if the PSP still finalizes the payment afterwards, the (now
        // terminal) 'cancelled' status safely no-ops any late webhook.
        this.logger.warn(`provider.cancel failed for payment ${id}: ${String(err)}`);
      }
    }

    await this.markCancelled(id);
    return this.getPayment(id);
  }

  // ── refund (docs/08 §8.8, docs/15 C10) ─────────────────────────────────────

  async refundPayment(
    id: string,
    input: RefundPaymentInput,
    idempotencyKey: string,
    requestedBy: string,
  ): Promise<{ status: 'created' | 'replayed'; refund: RefundDto; payment: PaymentDto }> {
    const run = await this.idempotency.run('payments:refund', idempotencyKey, { id, input }, () =>
      this.doRefundPayment(id, input, idempotencyKey, requestedBy),
    );
    return { status: run.status, ...run.response };
  }

  private async doRefundPayment(
    id: string,
    input: RefundPaymentInput,
    idempotencyKey: string,
    requestedBy: string,
  ): Promise<{ refund: RefundDto; payment: PaymentDto }> {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Payment ${id} not found.` });
    }
    if (!['succeeded', 'partially_refunded'].includes(payment.status)) {
      throw new ConflictException({
        code: 'PAYMENT_INVALID_STATE',
        message: `Payment ${id} cannot be refunded from status ${payment.status}.`,
      });
    }
    if (input.amount.currency !== payment.currency) {
      throw new ConflictException({
        code: 'CURRENCY_MISMATCH',
        message: `Refund currency ${input.amount.currency} does not match payment currency ${payment.currency}.`,
      });
    }

    const requested = money(input.amount.minor, input.amount.currency);
    assertPositive(requested);

    const priorRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COALESCE(SUM(amount_minor), 0) AS total FROM refunds
      WHERE payment_id = ${id}::uuid AND status = 'succeeded'
    `;
    const remaining = payment.amountMinor - priorRows[0]!.total;
    if (requested.minor > remaining) {
      throw new ConflictException({
        code: 'REFUND_EXCEEDS_PAYMENT',
        message: `Refund of ${requested.minor} exceeds the refundable remainder (${remaining}) on payment ${id}.`,
      });
    }

    const provider = this.registry.get(payment.providerCode);
    const caps = provider.getCapabilities();
    if (!caps.refund) {
      throw new ConflictException({
        code: 'PAYMENT_METHOD_UNAVAILABLE',
        message: `Provider "${payment.providerCode}" does not support refunds.`,
      });
    }
    if (requested.minor < remaining && !caps.partialRefund) {
      throw new ConflictException({
        code: 'PAYMENT_METHOD_UNAVAILABLE',
        message: `Provider "${payment.providerCode}" does not support partial refunds.`,
      });
    }

    const refund = await this.prisma.refund.create({
      data: {
        paymentId: id,
        amountMinor: requested.minor,
        currency: requested.currency,
        reason: input.reason,
        status: 'pending',
        idempotencyKey,
        requestedBy,
      },
    });

    let result;
    try {
      result = await provider.refund({
        providerRef: payment.providerRef ?? '',
        amount: requested,
        idempotencyKey,
      });
    } catch (err) {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: { status: 'failed', lastError: String(err), attempts: { increment: 1 } },
      });
      this.logger.error(`provider.refund threw for refund ${refund.id}: ${String(err)}`);
      throw new ConflictException({
        code: 'PAYMENT_PROVIDER_ERROR',
        message: `Provider "${payment.providerCode}" failed to process the refund.`,
      });
    }

    if (result.status === 'succeeded') {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: { providerRef: result.providerRef, status: 'processing' },
      });
      try {
        await this.finalizeRefundSuccess(refund.id);
      } catch (err) {
        // The app-level `remaining` check above is best-effort — the
        // `refunds_guard_over_refund` DB trigger (migration 0021) is the
        // race-proof backstop. A genuinely concurrent refund that lost the
        // race trips it HERE, inside `finalizeRefundSuccess`'s transaction —
        // translate the raw trigger exception into the same clean 409 the
        // pre-check gives the common (non-racing) case, instead of leaking a
        // raw Postgres error, and mark the refund `failed` rather than
        // leaving it stuck `processing`.
        const message = err instanceof Error ? err.message : String(err);
        await this.prisma.refund
          .update({
            where: { id: refund.id },
            data: { status: 'failed', lastError: message, attempts: { increment: 1 } },
          })
          .catch(() => undefined);
        if (message.includes('would exceed payment')) {
          throw new ConflictException({
            code: 'REFUND_EXCEEDS_PAYMENT',
            message: `Refund ${refund.id} lost a concurrent race and would exceed the payment amount.`,
          });
        }
        throw err;
      }
    } else if (result.status === 'failed') {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: { providerRef: result.providerRef, status: 'failed' },
      });
      throw new ConflictException({
        code: 'PAYMENT_PROVIDER_ERROR',
        message: `Provider "${payment.providerCode}" rejected the refund.`,
      });
    } else {
      // Async provider — not exercised by the current mock/cash providers
      // (both resolve synchronously). Confirmation via a refund webhook is
      // deferred until a real async-refund PSP is activated (docs/24 debt).
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: { providerRef: result.providerRef, status: 'processing' },
      });
    }

    const finalRefund = await this.prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    const finalPayment = await this.prisma.payment.findUniqueOrThrow({ where: { id } });
    return { refund: this.refundToDto(finalRefund), payment: this.toDto(finalPayment) };
  }

  /**
   * Marks a refund succeeded, posts the `refund` ledger entries, reclassifies
   * `payments.status` to `refunded`/`partially_refunded`, and enqueues the
   * `payment.refunded` outbox event — ALL in one transaction, mirroring
   * `markSucceeded`. The `refunds_guard_over_refund` DB trigger (migration
   * `0021`) is the race-proof backstop: it locks the parent `payments` row
   * before recomputing the refunded total, so two concurrent refunds on the
   * same payment can never both pass (the Bloc 4 lesson — docs/23 §1.1).
   */
  private async finalizeRefundSuccess(refundId: string): Promise<void> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; payment_id: string; amount_minor: bigint; currency: string }>
      >`
        UPDATE refunds SET status = 'succeeded'
        WHERE id = ${refundId}::uuid AND status IN ('pending', 'processing')
        RETURNING id, payment_id, amount_minor, currency
      `;
      if (!rows[0]) return null; // already resolved — idempotent no-op
      const refund = rows[0];

      const payment = await tx.payment.findUniqueOrThrow({ where: { id: refund.payment_id } });

      const sumRows = await tx.$queryRaw<Array<{ total: bigint }>>`
        SELECT COALESCE(SUM(amount_minor), 0) AS total FROM refunds
        WHERE payment_id = ${refund.payment_id}::uuid AND status = 'succeeded'
      `;
      const totalRefunded = sumRows[0]!.total;
      const newStatus = totalRefunded >= payment.amountMinor ? 'refunded' : 'partially_refunded';

      const entries = buildRefundEntries(
        { providerCode: payment.providerCode },
        money(refund.amount_minor, refund.currency),
      );
      const posted = await this.ledger.postEntryGroupTx(tx, {
        kind: 'refund',
        idempotencyKey: `refund:${refund.id}`,
        currency: refund.currency,
        entries,
        refs: { orderId: payment.orderId, paymentId: payment.id },
        createdBy: 'payments',
      });

      await tx.refund.update({ where: { id: refund.id }, data: { entryGroup: posted.id } });
      await tx.payment.updateMany({
        where: { id: payment.id, status: { in: ['succeeded', 'partially_refunded'] } },
        data: { status: newStatus },
      });
      await this.outbox.enqueue(tx, {
        aggregate: 'payment',
        aggregateId: payment.id,
        eventType: 'payment.refunded',
        payload: { paymentId: payment.id, orderId: payment.orderId, refundId: refund.id },
      });

      return { paymentId: payment.id, orderId: payment.orderId, refundId: refund.id, newStatus };
    });

    if (!outcome) return;
    this.events.emit('payment.updated', {
      orderId: outcome.orderId,
      paymentId: outcome.paymentId,
      status: outcome.newStatus,
    });
    this.logger.log(
      `refund ${outcome.refundId} succeeded on payment ${outcome.paymentId} -> ${outcome.newStatus}`,
    );
  }

  // ── config discovery (docs/08 §8.4 step 2, docs/15 AD-04) ─────────────────

  /**
   * `GET /v1/config/payment-methods`. A provider is usable only if BOTH (a)
   * its class is registered in `PaymentProviderRegistry` AND (b) a
   * `payment_provider_configs` row enables it for this context (docs/15
   * AD-03) — never a hardcoded list. Most-specific config wins when several
   * rows match (restaurant > city > currency > global), mirroring
   * `PricingService.resolveCommissionBps`.
   */
  async listAvailablePaymentMethods(params: {
    cityId?: string;
    restaurantId?: string;
    amountMinor?: bigint;
    currency?: string;
  }): Promise<
    Array<{ providerCode: string; methodCode: string; displayName: string; capabilities: unknown }>
  > {
    const now = new Date();
    // `{ field: undefined }` is dropped by Prisma (matches everything) — build
    // each scope filter explicitly instead of interpolating a possibly-undefined
    // param into the OR, or an unset restaurantId/cityId/currency would match
    // every row instead of only the global (null) ones.
    const configs = await this.prisma.paymentProviderConfig.findMany({
      where: {
        enabled: true,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
        AND: [
          params.restaurantId
            ? { OR: [{ restaurantId: params.restaurantId }, { restaurantId: null }] }
            : { restaurantId: null },
          params.cityId ? { OR: [{ cityId: params.cityId }, { cityId: null }] } : { cityId: null },
          params.currency
            ? { OR: [{ currency: params.currency }, { currency: null }] }
            : { currency: null },
        ],
      },
    });

    const eligible = configs.filter((c) => {
      if (params.amountMinor === undefined) return true;
      if (c.minAmountMinor !== null && params.amountMinor < c.minAmountMinor) return false;
      if (c.maxAmountMinor !== null && params.amountMinor > c.maxAmountMinor) return false;
      return true;
    });

    const specificity = (c: { restaurantId: string | null; cityId: string | null }) =>
      (c.restaurantId ? 2 : 0) + (c.cityId ? 1 : 0);
    const bestByProvider = new Map<string, (typeof eligible)[number]>();
    for (const c of eligible) {
      const existing = bestByProvider.get(c.providerCode);
      if (!existing || specificity(c) > specificity(existing)) {
        bestByProvider.set(c.providerCode, c);
      }
    }

    const [providerRows, methodRows] = await Promise.all([
      this.prisma.paymentProviderRow.findMany({ where: { active: true } }),
      this.prisma.paymentMethod.findMany({ where: { active: true } }),
    ]);
    const methodByCode = new Map(methodRows.map((m) => [m.code, m]));

    const result: Array<{
      providerCode: string;
      methodCode: string;
      displayName: string;
      capabilities: unknown;
    }> = [];
    for (const providerCode of bestByProvider.keys()) {
      if (!this.registry.has(providerCode)) continue; // registered as a class? (AD-03 rule a)
      const row = providerRows.find((p) => p.code === providerCode);
      if (!row || !methodByCode.has(row.methodCode)) continue;
      result.push({
        providerCode,
        methodCode: row.methodCode,
        displayName: row.displayName,
        capabilities: this.registry.get(providerCode).getCapabilities(),
      });
    }
    return result;
  }

  // ── reads ───────────────────────────────────────────────────────────────

  async getPayment(id: string): Promise<PaymentDto> {
    const p = await this.prisma.payment.findUnique({ where: { id } });
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND', message: `Payment ${id} not found.` });
    return this.toDto(p);
  }

  /** For `@RequireOwnership(...)` (docs/19 §21, closes D-15) — throws NotFound itself, never a sentinel. */
  async getOwnerUserId(paymentId: string): Promise<string> {
    const p = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { orderId: true },
    });
    if (!p) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Payment ${paymentId} not found.`,
      });
    }
    return this.orderAmount.getOwnerUserId(p.orderId);
  }

  private toDto(p: {
    id: string;
    orderId: string;
    providerCode: string;
    methodCode: string;
    status: string;
    amountMinor: bigint;
    currency: string;
    pspFeeMinor: bigint;
    providerRef: string | null;
    attemptNo: number;
  }): PaymentDto {
    return {
      id: p.id,
      orderId: p.orderId,
      providerCode: p.providerCode,
      methodCode: p.methodCode,
      status: p.status,
      amount: toMoneyJson(p.amountMinor, p.currency),
      pspFee: toMoneyJson(p.pspFeeMinor, p.currency),
      providerRef: p.providerRef,
      attemptNo: p.attemptNo,
    };
  }

  private refundToDto(r: {
    id: string;
    paymentId: string;
    amountMinor: bigint;
    currency: string;
    reason: string;
    status: string;
  }): RefundDto {
    return {
      id: r.id,
      paymentId: r.paymentId,
      amount: toMoneyJson(r.amountMinor, r.currency),
      reason: r.reason,
      status: r.status,
    };
  }
}
