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
import { RequireAuth, RequirePermission, RequireRole } from '../auth/decorators';
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

  /**
   * Tenant-scoped (BUG-10.1-AUTH): the owning customer, the courier currently
   * assigned, or staff-tier with `deliveries:read`. Was
   * `@RequireOwnership(..., 'deliveries:read')`, whose override bypassed
   * ownership for every holder of `deliveries:read` — `courier` included, so
   * any courier could read any other courier's delivery.
   */
  @Get(':id')
  @RequireAuth()
  get(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string) {
    return this.deliveries.getByIdFor(actor, id);
  }

  /**
   * The owning CUSTOMER's own live delivery code — the one the courier asks
   * them for at handover (pilot fix, docs/36: the code was generated and
   * hashed but reached nobody, so the lifecycle could never be completed).
   *
   * `@RequireRole('customer')` is the coarse gate; the real decision is
   * ownership, enforced in the service, which refuses the assigned courier,
   * the restaurant and staff-tier alike with the SAME 404 as an unknown id.
   */
  @Get(':id/code')
  @RequireAuth()
  @RequireRole('customer')
  getCode(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string) {
    return this.deliveries.getDeliveryCodeFor(actor, id);
  }

  /**
   * Tenant-scoped (BUG-10.1.3): the customer who owns the order behind this
   * delivery, or staff-tier with `deliveries:write`. Cancellation rules per
   * state still come from the state machine (docs/25 §29).
   *
   * Was `@RequireOwnership(..., 'deliveries:write')`, whose override bypassed
   * ownership for every holder of that permission — `courier` included. A
   * courier-only actor was stopped downstream (no `courier` role on any
   * `-> cancelled` transition), but a `courier + customer` actor — i.e. EVERY
   * real courier, since `customer` is granted at account creation — passed via
   * the customer branch of the role union and could cancel a stranger's
   * delivery. The decision now lives in `DeliveriesService.cancel`.
   */
  @Post(':id/cancel')
  @HttpCode(200)
  @RequireAuth()
  async cancel(
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(CancelDeliverySchema)) body: CancelDeliveryInput,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return this.deliveries.cancel(actor, id, body.reason, key);
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
