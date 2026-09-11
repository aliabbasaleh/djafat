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
import { DeliveriesService } from './deliveries.service';
import { AssignDeliverySchema, type AssignDeliveryInput } from './dto/assign-delivery.schema';

/**
 * Bloc 0.5 orchestration endpoints — stand in for the courier app (Bloc 11).
 * No auth yet (docs/18 §3, §8): the "courier" actor is asserted by the
 * system on behalf of the single seeded test courier.
 */
@ApiTags('deliveries')
@Controller('deliveries')
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  @Post()
  @HttpCode(201)
  async assign(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(AssignDeliverySchema)) body: AssignDeliveryInput,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key header is required.',
      });
    }
    return this.deliveries.assign(body.orderId, idempotencyKey);
  }

  @Get(':orderId')
  get(@Param('orderId') orderId: string) {
    return this.deliveries.getByOrderIdOrThrow(orderId);
  }

  @Post(':orderId/picked-up')
  async pickedUp(
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key header is required.',
      });
    }
    return this.deliveries.markPickedUp(orderId, idempotencyKey);
  }

  @Post(':orderId/delivered')
  async delivered(
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key header is required.',
      });
    }
    return this.deliveries.markDelivered(orderId, idempotencyKey);
  }
}
