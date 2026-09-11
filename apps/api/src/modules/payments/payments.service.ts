import { createHash } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import type { MoneyJson, OrderAmountPort, RawWebhookRequest } from '@djafat/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { toMoneyJson } from '../../common/money/money.mapper';
import { ORDER_AMOUNT_PORT } from '../../common/ports/order-amount.port';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { buildOrderAccrualEntries } from './accrual-entries';
import type { CreatePaymentInput } from './dto/create-payment.schema';

export interface PaymentDto {
  id: string;
  orderId: string;
  providerCode: string;
  methodCode: string;
  status: string;
  amount: MoneyJson;
  providerRef: string | null;
  attemptNo: number;
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

    const payment = await this.prisma.payment.create({
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

    const provider = this.registry.get(input.providerCode);
    const result = await provider.initiate({
      paymentId: payment.id,
      amount,
      orderCode: context.orderCode,
      idempotencyKey,
      ...(input.payerPhone !== undefined ? { payerPhone: input.payerPhone } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    });

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
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed' } });
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
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'needs_review' },
      });
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { status: 'failed', error: 'amount mismatch', processedAt: new Date() },
      });
      this.logger.error(
        `Amount mismatch on payment ${payment.id} — flagged needs_review, no credit.`,
      );
      return { status: 'needs_review' };
    }

    if (parsed.status === 'succeeded') {
      await this.markSucceeded(payment.id);
    } else if (parsed.status === 'failed') {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: 'pending' },
        data: { status: 'failed' },
      });
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
   */
  async markSucceeded(paymentId: string): Promise<void> {
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
        WHERE id = ${paymentId}::uuid AND status = 'pending'::payment_status
        RETURNING id, order_id, amount_minor, currency, provider_code
      `;
      if (!rows[0]) return null; // already succeeded/failed elsewhere — idempotent no-op

      const payment = rows[0];
      const breakdown = await this.orderAmount.getAccrualBreakdown(payment.order_id);
      if (!breakdown.courierId) {
        throw new ConflictException({
          code: 'VALIDATION_ERROR',
          message: `Order ${payment.order_id} has no courier resolved — cannot post order_accrual (docs/18 §4).`,
        });
      }

      // Pure, unit-tested elsewhere (accrual-entries.spec.ts) — see docs/18 §13.
      const entries = buildOrderAccrualEntries(
        {
          amountMinor: payment.amount_minor,
          currency: payment.currency,
          providerCode: payment.provider_code,
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

  async getPayment(id: string): Promise<PaymentDto> {
    const p = await this.prisma.payment.findUnique({ where: { id } });
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND', message: `Payment ${id} not found.` });
    return this.toDto(p);
  }

  private toDto(p: {
    id: string;
    orderId: string;
    providerCode: string;
    methodCode: string;
    status: string;
    amountMinor: bigint;
    currency: string;
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
      providerRef: p.providerRef,
      attemptNo: p.attemptNo,
    };
  }
}
