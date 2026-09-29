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
import { RequireAuth, RequireOwnership, RequirePermission, RequireRole } from '../auth/decorators';
import { DeliveriesService } from './deliveries.service';
import { CancelDeliverySchema, type CancelDeliveryInput } from './dto/delivery-action.schema';
import { CreateDeliverySchema, type CreateDeliveryInput } from './dto/create-delivery.schema';

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
 * Customer/admin-facing delivery routes (docs/25 §45). Courier-facing
 * offer/pickup/deliver routes live in `courier-delivery.controller.ts`
 * (registered under `/couriers/me/*` and `/deliveries/:id/{accept,reject,
 * pickup,deliver}` — split by ACTOR, not by module folder, so the exact
 * mandated API surface is preserved regardless of internal file layout).
 */
@ApiTags('deliveries')
@Controller('deliveries')
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  /** Owner (the customer), or staff with `deliveries:read` (docs/19 §21, docs/25 §35). */
  @Get(':id')
  @RequireAuth()
  @RequireOwnership(
    DeliveriesService,
    (deliveries, req) => deliveries.getOwnerUserId((req.params as { id: string }).id),
    'deliveries:read',
  )
  get(@Param('id') id: string) {
    return this.deliveries.getByIdOrThrow(id);
  }

  /** Owner or admin — cancellation rules vary by current state (docs/25 §29, enforced by the state machine). */
  @Post(':id/cancel')
  @HttpCode(200)
  @RequireAuth()
  @RequireOwnership(
    DeliveriesService,
    (deliveries, req) => deliveries.getOwnerUserId((req.params as { id: string }).id),
    'deliveries:write',
  )
  async cancel(
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(CancelDeliverySchema)) body: CancelDeliveryInput,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return this.deliveries.cancel(id, actor.roles, actor.userId, body.reason, key);
  }

  /** Admin-only manual (re-)dispatch trigger (docs/25 §45 — the primary path is automatic on `order.ready`). */
  @Post()
  @HttpCode(202)
  @RequireAuth()
  @RequireRole('admin', 'super_admin', 'support')
  @RequirePermission('deliveries:write')
  create(@Body(new ZodValidationPipe(CreateDeliverySchema)) body: CreateDeliveryInput) {
    return this.deliveries.createAndDispatch(body.orderId);
  }
}
