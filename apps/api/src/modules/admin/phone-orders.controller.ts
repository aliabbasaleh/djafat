import { BadRequestException, Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequireRole } from '../auth/decorators';
import { PhoneOrdersService } from './phone-orders.service';
import { PhoneOrderSchema, type PhoneOrderBody } from './dto/phone-order.schema';

/** The DJAFAT national number: an operator orders for a customer who called (FEAT-011). */
@ApiTags('admin')
@Controller('admin/phone-orders')
export class PhoneOrdersController {
  constructor(private readonly phoneOrders: PhoneOrdersService) {}

  @Post()
  @HttpCode(201)
  @RequireAuth()
  @RequireRole('admin', 'super_admin', 'support')
  place(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(PhoneOrderSchema)) body: PhoneOrderBody,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key header is required.',
      });
    }
    return this.phoneOrders.place(
      body,
      { userId: actor.userId, role: actor.roles.join(',') },
      idempotencyKey,
    );
  }
}
