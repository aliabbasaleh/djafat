import {
  ConflictException,
  Inject,
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
  DELIVERY_TRACKING_PORT,
  type DeliveryTrackingPort,
} from '../../../common/ports/delivery-tracking.port';
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
  orderId: string;
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
    @Inject(DELIVERY_TRACKING_PORT) private readonly tracking: DeliveryTrackingPort,
  ) {}

  /** Staff records a transfer, then an automatic match is attempted (SPEC-009-04 R4). */
  async recordReceipt(
    input: RecordReceiptInput,
    recordedBy: string | null,
    /** FEAT-016: `sms_forwarder` when a merchant phone forwarded the operator's SMS. */
    source: 'manual' | 'sms_forwarder' = 'manual',
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
          source,
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
  /**
   * FEAT-012 — the operator types the transaction number the caller read out
   * on the phone. Same check as the customer's own claim (number, amount, and
   * the sender is the payer's phone recorded on the payment).
   */
  async claimForOrder(
    orderId: string,
    transactionRef: string,
  ): Promise<{ paymentId: string; outcome: ClaimOutcome }> {
    const rows = await this.prisma.payment.findMany({
      where: { orderId, status: { in: ['pending', 'succeeded'] } },
      orderBy: { createdAt: 'desc' },
    });
    const wallet = rows.find(
      (p) =>
        this.registry.has(p.providerCode) &&
        this.registry.get(p.providerCode).getCapabilities().matchedByTransferReceipt === true,
    );
    if (!wallet) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'This order has no mobile money payment to confirm.',
      });
    }
    const { outcome } = await this.claim(wallet.id, { transactionRef, payerPhone: null });
    return { paymentId: wallet.id, outcome };
  }

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

  /**
   * Airtel / Tigo paid AT THE DOOR: an order placed "pay on delivery" is
   * settled by a transfer to DJAFAT's merchant number, the customer giving the
   * transaction number in the app. Same proof as a prepaid transfer (a
   * recorded receipt), then the payment becomes a wallet payment: no cash ever
   * sits with the courier, who is still paid his fee.
   */
  /**
   * Wallets the customer may pay at the door with, and what to send where.
   * Only for a pending pay-on-delivery payment (else an empty list).
   */
  async doorOptions(
    paymentId: string,
  ): Promise<Array<{ providerCode: string; instructions: string | null }>> {
    const payment = await this.loadPayment(paymentId);
    if (payment.status !== 'pending' || !this.isCollectedOnDelivery(payment.providerCode))
      return [];
    const wallets = this.registry
      .list()
      .filter((p) => p.capabilities.matchedByTransferReceipt === true);
    return Promise.all(
      wallets.map(async ({ code }) => {
        // initiate() of a merchant wallet is pure: it only words the instructions.
        const r = await this.registry.get(code).initiate({
          paymentId: payment.id,
          amount: { minor: payment.amountMinor, currency: payment.currency },
          orderCode: payment.orderId,
          idempotencyKey: `door:${payment.id}:${code}`,
        });
        return { providerCode: code, instructions: r.action?.instructions ?? null };
      }),
    );
  }

  /**
   * The order's pay-on-delivery payment, as the customer's door panel needs it:
   * its id, whether it is already settled by transfer, and the wallets offered.
   */
  async doorForOrder(orderId: string): Promise<{
    paymentId: string | null;
    paidByTransfer: boolean;
    wallets: Array<{ providerCode: string; instructions: string | null }>;
  }> {
    const rows = await this.prisma.payment.findMany({
      where: { orderId, status: { in: ['pending', 'succeeded'] } },
      orderBy: { createdAt: 'desc' },
    });
    const settled = rows.find(
      (p) => p.status === 'succeeded' && typeof asRecord(p.metadata)['doorWallet'] === 'string',
    );
    if (settled) return { paymentId: settled.id, paidByTransfer: true, wallets: [] };
    const door = rows.find(
      (p) => p.status === 'pending' && this.isCollectedOnDelivery(p.providerCode),
    );
    if (!door) return { paymentId: null, paidByTransfer: false, wallets: [] };
    return { paymentId: door.id, paidByTransfer: false, wallets: await this.doorOptions(door.id) };
  }

  private isCollectedOnDelivery(providerCode: string): boolean {
    return (
      this.registry.has(providerCode) &&
      this.registry.get(providerCode).getCapabilities().collectedOnDelivery === true
    );
  }

  async settleAtDoor(
    paymentId: string,
    input: { providerCode: string; transactionRef?: string | null; payerPhone?: string | null },
  ): Promise<{ outcome: ClaimOutcome }> {
    const payment = await this.loadPayment(paymentId);
    // Idempotent answer when this very door payment already went through.
    const settledHere =
      payment.status === 'succeeded' &&
      asRecord(payment.metadata)['doorWallet'] === input.providerCode;
    if (settledHere) return { outcome: 'paid' };
    if (!this.isCollectedOnDelivery(payment.providerCode) || payment.status !== 'pending') {
      throw new ConflictException({
        code: 'PAYMENT_INVALID_STATE',
        message: 'Only a pending pay-on-delivery payment can be settled at the door.',
      });
    }
    this.assertWalletProvider(input.providerCode);
    if (!(await this.tracking.getAssignedCourierUserIdByOrder(payment.orderId))) {
      throw new ConflictException({
        code: 'PAYMENT_INVALID_STATE',
        message: 'No courier is on this order yet: pay at the door once the courier is there.',
      });
    }
    const payerPhone = this.normalizePhone(input.payerPhone);
    const transactionRef = input.transactionRef ?? null;
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        metadata: {
          ...asRecord(payment.metadata),
          doorWallet: input.providerCode,
          transferClaim: { transactionRef, payerPhone, at: new Date().toISOString() },
        } as Prisma.InputJsonValue,
      },
    });
    const asWallet = { ...payment, providerCode: input.providerCode };
    const decision = decideTransferMatch(
      this.toPending(asWallet),
      await this.candidateReceipts(asWallet),
      { transactionRef, payerPhone },
    );
    if (decision.kind === 'amount_mismatch') return { outcome: 'amount_mismatch' };
    if (decision.kind !== 'match') return { outcome: 'pending' };
    const paid = await this.match(decision.receiptId, payment.id, {
      fromProvider: payment.providerCode,
      toProvider: input.providerCode,
      orderId: payment.orderId,
    });
    return { outcome: paid ? 'paid' : 'pending' };
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
    // Door payments: "pay on delivery" orders whose customer said they paid by transfer.
    const doorRows = await this.prisma.payment.findMany({
      where: {
        status: 'pending',
        amountMinor: receipt.amountMinor,
        currency: receipt.currency,
        metadata: { path: ['doorWallet'], equals: receipt.providerCode },
      },
    });
    const candidates = [
      ...pending.map((p) => ({ row: p, from: null as string | null })),
      ...doorRows.map((p) => ({
        row: { ...p, providerCode: receipt.providerCode },
        from: p.providerCode as string | null,
      })),
    ];
    const matching = candidates.filter(({ row: p }) => {
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
    const hit = matching[0]!;
    const doorCtx =
      hit.from !== null
        ? { fromProvider: hit.from, toProvider: receipt.providerCode, orderId: hit.row.orderId }
        : undefined;
    try {
      return (await this.match(receipt.id, hit.row.id, doorCtx)) ? hit.row.id : null;
    } catch (err) {
      // A door payment without a courier yet stays pending; the receipt stays unmatched.
      if (doorCtx && err instanceof ConflictException) return null;
      throw err;
    }
  }

  /** One transaction: claim the receipt (conditional), then succeed the payment. */
  private async match(
    receiptId: string,
    paymentId: string,
    door?: { fromProvider: string; toProvider: string; orderId: string },
  ): Promise<boolean> {
    let outcome: { paymentId: string; orderId: string } | null = null;
    // At the door the courier is known: credit his fee directly (a pay-on-delivery
    // order never pooled it), and never count this money as cash he holds.
    const courierId = door
      ? await this.tracking.getAssignedCourierUserIdByOrder(door.orderId)
      : null;
    if (door && !courierId) {
      throw new ConflictException({
        code: 'PAYMENT_INVALID_STATE',
        message: 'No courier is on this order yet: pay at the door once the courier is there.',
      });
    }
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.mobileMoneyReceipt.updateMany({
          where: { id: receiptId, status: 'unmatched' },
          data: { status: 'matched', paymentId, matchedAt: new Date() },
        });
        if (claimed.count !== 1) throw new MatchAborted('receipt already used');
        if (door) {
          const switched = await tx.payment.updateMany({
            where: { id: paymentId, status: 'pending', providerCode: door.fromProvider },
            data: { providerCode: door.toProvider, methodCode: 'mobile_money' },
          });
          if (switched.count !== 1) throw new MatchAborted('payment no longer pending on delivery');
        }
        const succeeded = await this.payments.succeedInTx(tx, paymentId, courierId ?? undefined);
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
