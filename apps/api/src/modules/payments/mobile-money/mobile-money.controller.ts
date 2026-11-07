import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { toMoneyJson } from '../../../common/money/money.mapper';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { RequireAuth, RequireOwnership, RequireRole } from '../../auth/decorators';
import { PaymentsService } from '../payments.service';
import { MobileMoneyReceiptsService } from './mobile-money-receipts.service';
import {
  ManualMatchSchema,
  RecordReceiptSchema,
  TransferClaimSchema,
  type ManualMatchBody,
  type RecordReceiptBody,
  type TransferClaimBody,
} from '../dto/mobile-money.schema';

const STAFF = ['admin', 'super_admin', 'finance', 'support'] as const; // FEAT-009-Q07

/**
 * Mobile money paid to DJAFAT's merchant number, without an operator API
 * (FEAT-009). Staff record what the merchant phone received; the customer
 * gives the transaction number; a match succeeds the payment.
 */
@ApiTags('payments')
@Controller('payments')
export class MobileMoneyController {
  constructor(
    private readonly receipts: MobileMoneyReceiptsService,
    private readonly payments: PaymentsService,
  ) {}

  @Post('mobile-money/receipts')
  @HttpCode(201)
  @RequireAuth()
  @RequireRole(...STAFF)
  async record(
    @Body(new ZodValidationPipe(RecordReceiptSchema)) body: RecordReceiptBody,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    const { receipt, matchedPaymentId } = await this.receipts.recordReceipt(body, actor.userId);
    return { receipt: toReceiptDto(receipt), matchedPaymentId };
  }

  @Get('mobile-money/receipts')
  @RequireAuth()
  @RequireRole(...STAFF)
  async listUnmatched() {
    const rows = (await this.receipts.listUnmatched()) as ReceiptLike[];
    return { receipts: rows.map(toReceiptDto) };
  }

  @Post('mobile-money/receipts/:id/match')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole(...STAFF)
  async match(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ManualMatchSchema)) body: ManualMatchBody,
  ) {
    const { outcome } = await this.receipts.manualMatch(id, body.paymentId);
    return { outcome, payment: await this.payments.getPayment(body.paymentId) };
  }

  /** Owner of the payment's order only. */
  @Post(':id/mobile-money/claim')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('customer')
  @RequireOwnership(PaymentsService, (payments, req) =>
    payments.getOwnerUserId((req.params as { id: string }).id),
  )
  async claim(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TransferClaimSchema)) body: TransferClaimBody,
  ) {
    const { outcome } = await this.receipts.claim(id, {
      transactionRef: body.transactionRef ?? null,
      payerPhone: body.payerPhone ?? null,
    });
    return { outcome, payment: await this.payments.getPayment(id) };
  }
}

interface ReceiptLike {
  id: string;
  providerCode: string;
  transactionRef: string;
  amountMinor: bigint;
  currency: string;
  senderPhone: string;
  receivedAt: Date;
  status: string;
  paymentId?: string | null;
}

function toReceiptDto(r: ReceiptLike) {
  return {
    id: r.id,
    providerCode: r.providerCode,
    transactionRef: r.transactionRef,
    amount: toMoneyJson(r.amountMinor, r.currency),
    senderPhone: r.senderPhone,
    receivedAt: r.receivedAt.toISOString(),
    status: r.status,
    paymentId: r.paymentId ?? null,
  };
}
