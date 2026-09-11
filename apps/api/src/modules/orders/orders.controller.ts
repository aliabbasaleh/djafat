import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequireOwnership, RequireRole } from '../auth/decorators';
import { OrdersService } from './orders.service';
import { CreateOrderSchema, type CreateOrderInput } from './dto/create-order.schema';

/**
 * `create`/`get` are real customer-facing endpoints, closing docs/18 §7
 * dette S-01 (customerId used to be client-supplied). `confirm`/`ready`
 * remain the Bloc 0.5 restaurant stand-in with NO auth (docs/18 §3, §8;
 * docs/19 §10 dette D-10 — real restaurant-staff scoping is Bloc 10).
 */
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(201)
  @RequireAuth()
  @RequireRole('customer')
  async create(
    @CurrentActor() actor: AuthenticatedActor,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(CreateOrderSchema)) body: CreateOrderInput,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key header is required.',
      });
    }
    const { status, order } = await this.orders.createOrder(actor.userId, body, idempotencyKey);
    return { status, order };
  }

  /** Owner (the customer) or staff with `orders:read` (support/finance/admin) — never a stranger who just knows the id (docs/19 §21). */
  @Get(':id')
  @RequireAuth()
  @RequireOwnership(
    OrdersService,
    (orders, req) => orders.getOwnerUserId((req.params as { id: string }).id),
    'orders:read',
  )
  get(@Param('id') id: string) {
    return this.orders.getOrder(id);
  }

  /** Stand-in for the restaurant accepting the order (Bloc 10). */
  @Post(':id/confirm')
  confirm(@Param('id') id: string) {
    return this.orders.confirmOrder(id);
  }

  /** Stand-in for the restaurant marking preparation done (Bloc 10). */
  @Post(':id/ready')
  ready(@Param('id') id: string) {
    return this.orders.markReady(id);
  }
}
