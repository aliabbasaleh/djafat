import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { OrderAmountPort } from '@djafat/types';
import { ORDER_AMOUNT_PORT } from '../../common/ports/order-amount.port';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { RequireAuth, RequireOwnership, RequireRole } from '../auth/decorators';
import { PaymentsService } from './payments.service';
import { CreatePaymentSchema, type CreatePaymentInput } from './dto/create-payment.schema';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Owner of the ORDER being paid, or staff with `payments:read` — resolved via `OrderAmountPort`, never a direct `orders` import (docs/18 AD-09, docs/19 §21). */
  @Post()
  @HttpCode(201)
  @RequireAuth()
  @RequireRole('customer')
  @RequireOwnership<OrderAmountPort>(
    ORDER_AMOUNT_PORT,
    (orderAmount, req) => orderAmount.getOwnerUserId((req.body as { orderId: string }).orderId),
    'payments:read',
  )
  async create(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(CreatePaymentSchema)) body: CreatePaymentInput,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key header is required.',
      });
    }
    const { status, payment } = await this.payments.createPayment(body, idempotencyKey);
    return { status, payment };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.payments.getPayment(id);
  }

  /**
   * Signed webhook receiver (docs/08 §8.6). The raw body is preserved by a
   * custom Fastify content-type parser (`main.ts`) so the HMAC is verified
   * against the exact bytes sent, not a re-serialised object. Provider-to-
   * server, never a user — deliberately no `@RequireAuth()` here.
   */
  @Post('webhook/:provider')
  @HttpCode(200)
  webhook(@Param('provider') provider: string, @Req() req: FastifyRequest) {
    const rawBody = (req as FastifyRequest & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    return this.payments.handleWebhook(provider, {
      headers: req.headers as Record<string, string | string[] | undefined>,
      rawBody,
    });
  }
}
