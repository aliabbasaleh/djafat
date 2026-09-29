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
import { DeliveriesService } from './deliveries.service';
import { ConfirmDeliveredSchema, type ConfirmDeliveredInput } from './dto/delivery-action.schema';

function requireIdempotencyKey(idempotencyKey: string | undefined): string {
  if (!idempotencyKey) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Idempotency-Key header is required.',
    });
  }
  return idempotencyKey;
}

/**
 * Courier-facing delivery routes (docs/25 §45-46). Every route resolves the
 * ASSIGNED courier from the authenticated actor — never a client-supplied
 * `courierId` (docs/25 §14, §35, §46 IDOR). Split from `DeliveriesController`
 * by actor, not by folder — both live in the `deliveries` module and share
 * `DeliveriesService`.
 */
@ApiTags('deliveries')
@Controller()
export class CourierDeliveryController {
  constructor(private readonly deliveries: DeliveriesService) {}

  @Post('deliveries/:id/accept')
  @HttpCode(200)
  @RequireAuth()
  @RequireOwnership(DeliveriesService, (deliveries, req) =>
    deliveries.getActiveOfferCourierUserId((req.params as { id: string }).id),
  )
  async accept(
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return this.deliveries.acceptOffer(id, actor.userId, key);
  }

  @Post('deliveries/:id/reject')
  @HttpCode(200)
  @RequireAuth()
  @RequireOwnership(DeliveriesService, (deliveries, req) =>
    deliveries.getActiveOfferCourierUserId((req.params as { id: string }).id),
  )
  async reject(
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return this.deliveries.rejectOffer(id, actor.userId, key);
  }

  @Post('deliveries/:id/pickup')
  @HttpCode(200)
  @RequireAuth()
  @RequireOwnership(DeliveriesService, (deliveries, req) =>
    deliveries.getAssignedCourierUserId((req.params as { id: string }).id),
  )
  async pickup(
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return this.deliveries.markPickedUp(id, actor.userId, key);
  }

  @Post('deliveries/:id/deliver')
  @HttpCode(200)
  @RequireAuth()
  @RequireOwnership(DeliveriesService, (deliveries, req) =>
    deliveries.getAssignedCourierUserId((req.params as { id: string }).id),
  )
  async deliver(
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(ConfirmDeliveredSchema)) body: ConfirmDeliveredInput,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return this.deliveries.confirmDelivered(id, actor.userId, body.proofCode, key);
  }

  @Post('deliveries/:id/fail')
  @HttpCode(200)
  @RequireAuth()
  @RequireOwnership(
    DeliveriesService,
    (deliveries, req) => deliveries.getAssignedCourierUserId((req.params as { id: string }).id),
    'deliveries:write',
  )
  async fail(
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: { reason: string },
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return this.deliveries.reportFailed(id, actor.roles, actor.userId, body.reason, key);
  }

  @Get('couriers/me/offers')
  @RequireAuth()
  @RequireRole('courier')
  myOffers(@CurrentActor() actor: AuthenticatedActor) {
    return this.deliveries.listOffersForCourier(actor.userId);
  }

  @Get('couriers/me/deliveries')
  @RequireAuth()
  @RequireRole('courier')
  myDeliveries(@CurrentActor() actor: AuthenticatedActor) {
    return this.deliveries.listActiveForCourier(actor.userId);
  }
}
