import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequireRole } from '../auth/decorators';
import { CouriersService } from './couriers.service';
import {
  SetCourierStatusSchema,
  UpdateLocationSchema,
  type SetCourierStatusInput,
  type UpdateLocationInput,
} from './dto/update-location.schema';

/**
 * Courier's own profile: availability + last-known position (docs/25 §45).
 * Every route resolves identity from the authenticated actor's token — a
 * courier can only ever act on THEIR OWN profile (docs/25 §46: never a
 * client-supplied `courierId`).
 */
@ApiTags('couriers')
@Controller('couriers/me')
export class CouriersController {
  constructor(private readonly couriers: CouriersService) {}

  @Get()
  @RequireAuth()
  @RequireRole('courier')
  get(@CurrentActor() actor: AuthenticatedActor) {
    return this.couriers.getProfile(actor.userId);
  }

  @Post('status')
  @RequireAuth()
  @RequireRole('courier')
  async setStatus(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(SetCourierStatusSchema)) body: SetCourierStatusInput,
  ) {
    return this.couriers.setStatus(actor.userId, body.status);
  }

  @Post('location')
  @RequireAuth()
  @RequireRole('courier')
  async updateLocation(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(UpdateLocationSchema)) points: UpdateLocationInput,
  ) {
    // Apply in order — only the LAST point's validity determines the
    // response, but every point is validated (a bad point mid-batch throws).
    for (const point of points) {
      await this.couriers.updateLocation(actor.userId, point);
    }
    return { status: 'ok', pointsAccepted: points.length };
  }
}
