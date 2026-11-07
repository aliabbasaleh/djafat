import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LAUNCH_MARKET } from '@djafat/config';
import { makePhoneInputSchema } from '@djafat/validation';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import { PaymentsService } from '../payments.service';
import {
  EARLY_SKEW_MS,
  NO_REF_WINDOW_MS,
  decideTransferMatch,
  normalizeTransactionRef,
  type PendingWalletPayment,
  type TransferClaim,
  type TransferReceipt,
} from '../transfer-matching';

const PhoneInput = makePhoneInputSchema(LAUNCH_MARKET);

export type ClaimOutcome = 'paid' | 'pending' | 'amount_mismatch';

export interface RecordReceiptInput {
  readonly providerCode: string;
  readonly transactionRef: string;
  readonly amount: { readonly minor: bigint; readonly currency: string };
  readonly senderPhone: string;
  readonly receivedAt: Date;
}

/** Thrown inside the match transaction to roll it back (payment no longer pending). */
class MatchAborted extends Error {}

interface PaymentRowLike {
  id: string;
  providerCode: string;
  status: string;
  amountMinor: bigint;
  currency: string;
  createdAt: Date;
  metadata: unknown;
}

/**
 * Transfers received on DJAFAT's merchant phone, and their matching to
 * pending wallet payments (FEAT-009, SPEC-009-03/04). Truth lives in
 * PostgreSQL: `(provider_code, transaction_ref)` and `payment_id` are unique,
 * and a match claims the receipt and succeeds the payment in ONE transaction
 * (`PaymentsService.succeedInTx` — the ledger is posted there, exactly once).
 */
@Injectable()
export class MobileMoneyReceiptsService {
  private readonly logger = new Logger(MobileMoneyReceiptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentProviderRegistry,
    private readonly payments: PaymentsService,
  ) {}

  /** Staff records a transfer, then an automatic match is attempted (SPEC-009-04 R4). */
  async recordReceipt(
    input: RecordReceiptInput,
    recordedBy: string,
  ): Promise<{
    receipt: TransferReceipt & { recordedBy: string | null; source: string };
    matchedPaymentId: string | null;
  }> {
    this.assertWalletProvider(input.providerCode);
    const transactionRef = normalizeTransactionRef(input.transactionRef);
    const sender = PhoneInput.safeParse(input.senderPhone);
    if (!transactionRef || !sender.success) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message: !transactionRef ? 'Invalid transaction number.' : 'Invalid sender phone.',
      });
    }
    if (input.receivedAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message: 'receivedAt is in the future.',
      });
    }

    let receipt;
    try {
      receipt = await this.prisma.mobileMoneyReceipt.create({
        data: {
          providerCode: input.providerCode,
          transactionRef,
          amountMinor: input.amount.minor,
          currency: input.amount.currency,
          senderPhone: sender.data,
          receivedAt: input.receivedAt,
          source: 'manual',
          recordedBy,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'RECEIPT_ALREADY_RECORDED',
          message: 'This transaction number is already recorded for this operator.',
        });
      }
      throw err;
    }

    const matchedPaymentId = await this.autoMatchReceipt(receipt);
    return { receipt, matchedPaymentId };
  }

  /** Customer gives the transaction number (or nothing): match if a recorded transfer fits. */
  async claim(paymentId: string, claim: TransferClaim): Promise<{ outcome: ClaimOutcome }> {
    const payment = await this.loadPayment(paymentId);
    if (payment.status === 'succeeded') return { outcome: 'paid' }; // idempotent answer
    this.assertMatchable(payment);

    const payerPhone = this.normalizePhone(claim.payerPhone);
    const transactionRef = claim.transactionRef ?? null;
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        metadata: {
          ...asRecord(payment.metadata),
          transferClaim: { transactionRef, payerPhone, at: new Date().toISOString() },
        } as Prisma.InputJsonValue,
      },
    });

    const receipts = await this.candidateReceipts(payment);
    const decision = decideTransferMatch(this.toPending(payment), receipts, {
      transactionRef,
      payerPhone,
    });
    if (decision.kind === 'amount_mismatch') return { outcome: 'amount_mismatch' };
    if (decision.kind !== 'match') return { outcome: 'pending' };
    return { outcome: (await this.match(decision.receiptId, payment.id)) ? 'paid' : 'pending' };
  }

  /** Staff matches by hand, with the same checks as the automatic path (SPEC-009-04). */
  async manualMatch(receiptId: string, paymentId: string): Promise<{ outcome: ClaimOutcome }> {
    const receipt = await this.prisma.mobileMoneyReceipt.findUnique({ where: { id: receiptId } });
    if (!receipt) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Receipt ${receiptId} not found.`,
      });
    }
    const payment = await this.loadPayment(paymentId);
    this.assertMatchable(payment);
    // Staff checked by hand: the payer phone may differ (paid from another phone).
    const decision = decideTransferMatch(
      this.toPending(payment),
      [receipt],
      { transactionRef: receipt.transactionRef },
      { checkSender: false },
    );
    if (decision.kind === 'amount_mismatch') return { outcome: 'amount_mismatch' };
    if (decision.kind !== 'match') {
      throw new ConflictException({
        code: 'PAYMENT_INVALID_STATE',
        message:
          'This transfer cannot be matched to this payment (operator, currency, date or already used).',
      });
    }
    return { outcome: (await this.match(receipt.id, payment.id)) ? 'paid' : 'pending' };
  }

  listUnmatched(): Promise<unknown[]> {
    return this.prisma.mobileMoneyReceipt.findMany({
      where: { status: 'unmatched' },
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Sens transfert → paiement: only when exactly ONE pending payment matches. */
  private async autoMatchReceipt(receipt: TransferReceipt): Promise<string | null> {
    const pending = await this.prisma.payment.findMany({
      where: {
        providerCode: receipt.providerCode,
        status: 'pending',
        amountMinor: receipt.amountMinor,
        currency: receipt.currency,
        createdAt: {
          gte: new Date(receipt.receivedAt.getTime() - NO_REF_WINDOW_MS),
          lte: new Date(receipt.receivedAt.getTime() + EARLY_SKEW_MS),
        },
      },
    });
    const matching = pending.filter((p) => {
      const claim = asRecord(asRecord(p.metadata)['transferClaim']);
      return (
        decideTransferMatch(this.toPending(p), [receipt], {
          transactionRef:
            typeof claim['transactionRef'] === 'string' ? claim['transactionRef'] : null,
          payerPhone: typeof claim['payerPhone'] === 'string' ? claim['payerPhone'] : null,
        }).kind === 'match'
      );
    });
    if (matching.length !== 1) {
      if (matching.length > 1) {
        this.logger.warn(
          `receipt ${receipt.id}: ${matching.length} pending payments fit — left for staff`,
        );
      }
      return null;
    }
    return (await this.match(receipt.id, matching[0]!.id)) ? matching[0]!.id : null;
  }

  /** One transaction: claim the receipt (conditional), then succeed the payment. */
  private async match(receiptId: string, paymentId: string): Promise<boolean> {
    let outcome: { paymentId: string; orderId: string } | null = null;
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.mobileMoneyReceipt.updateMany({
          where: { id: receiptId, status: 'unmatched' },
          data: { status: 'matched', paymentId, matchedAt: new Date() },
        });
        if (claimed.count !== 1) throw new MatchAborted('receipt already used');
        const succeeded = await this.payments.succeedInTx(tx, paymentId);
        if (!succeeded) throw new MatchAborted('payment no longer pending');
        return succeeded;
      });
    } catch (err) {
      if (err instanceof MatchAborted) {
        this.logger.warn(
          `match receipt ${receiptId} -> payment ${paymentId} aborted: ${err.message}`,
        );
        return false;
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return false; // another receipt already holds this payment (unique payment_id)
      }
      throw err;
    }
    this.payments.emitSucceeded(outcome);
    this.logger.log(`receipt ${receiptId} matched -> payment ${paymentId} succeeded`);
    return true;
  }

  private candidateReceipts(payment: PaymentRowLike): Promise<TransferReceipt[]> {
    return this.prisma.mobileMoneyReceipt.findMany({
      where: {
        providerCode: payment.providerCode,
        status: 'unmatched',
        currency: payment.currency,
        receivedAt: { gte: new Date(payment.createdAt.getTime() - EARLY_SKEW_MS) },
      },
    });
  }

  private async loadPayment(paymentId: string): Promise<PaymentRowLike> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Payment ${paymentId} not found.`,
      });
    }
    return payment;
  }

  private assertMatchable(payment: PaymentRowLike): void {
    const wallet =
      this.registry.has(payment.providerCode) &&
      this.registry.get(payment.providerCode).getCapabilities().matchedByTransferReceipt === true;
    if (!wallet || payment.status !== 'pending') {
      throw new ConflictException({
        code: 'PAYMENT_INVALID_STATE',
        message: 'Only a pending mobile money payment can be matched to a transfer.',
      });
    }
  }

  private assertWalletProvider(providerCode: string): void {
    if (
      !this.registry.has(providerCode) ||
      this.registry.get(providerCode).getCapabilities().matchedByTransferReceipt !== true
    ) {
      throw new NotFoundException({
        code: 'PROVIDER_UNAVAILABLE',
        message: `No merchant wallet "${providerCode}" is configured.`,
      });
    }
  }

  private toPending(p: PaymentRowLike): PendingWalletPayment {
    const stored = asRecord(p.metadata)['payerPhone'];
    return {
      id: p.id,
      providerCode: p.providerCode,
      amountMinor: p.amountMinor,
      currency: p.currency,
      createdAt: p.createdAt,
      payerPhone: typeof stored === 'string' ? this.normalizePhone(stored) : null,
    };
  }

  private normalizePhone(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const r = PhoneInput.safeParse(raw);
    return r.success ? r.data : null;
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
