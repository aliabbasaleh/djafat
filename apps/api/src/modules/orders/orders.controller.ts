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
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { OrdersService } from './orders.service';
import { CreateOrderSchema, type CreateOrderInput } from './dto/create-order.schema';

/**
 * Bloc 0.5 orchestration endpoints. `confirm`/`ready` stand in for the
 * restaurant dashboard (Bloc 10) and have NO auth yet — see docs/18 §3, §8.
 */
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(CreateOrderSchema)) body: CreateOrderInput,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key header is required.',
      });
    }
    const { status, order } = await this.orders.createOrder(body, idempotencyKey);
    return { status, order };
  }

  @Get(':id')
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
