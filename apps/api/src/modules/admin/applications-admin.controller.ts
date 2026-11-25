import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequireRole, RequireStepUp } from '../auth/decorators';
import { ApplicationsService } from './applications.service';
import {
  ApplicationFileKindSchema,
  ApplicationIdSchema,
  ApplicationTypeSchema,
  ApplicationsQuerySchema,
  RejectApplicationSchema,
  type ApplicationFileKindInput,
  type ApplicationTypeInput,
  type ApplicationsQueryInput,
  type RejectApplicationInput,
} from './dto/applications.schema';

/**
 * FEAT-022 (SPEC-022-07): « Demandes à vérifier ». Only `admin` and
 * `super_admin` see the queue, open the photos and decide; `support` and
 * `finance` are refused (403). Deciding an application needs no step-up code;
 * accepting a change after the approval (a new Mobile Money number, a new
 * paper) does (FEAT-022-Q11).
 */
@ApiTags('admin')
@Controller('admin/applications')
export class ApplicationsAdminController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  queue(@Query(new ZodValidationPipe(ApplicationsQuerySchema)) query: ApplicationsQueryInput) {
    return this.applications.queue(query.type);
  }

  @Get(':type/:id')
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  detail(
    @Param('type', new ZodValidationPipe(ApplicationTypeSchema)) type: ApplicationTypeInput,
    @Param('id', new ZodValidationPipe(ApplicationIdSchema)) id: string,
  ) {
    return type === 'restaurant'
      ? this.applications.restaurantDetail(id)
      : this.applications.courierDetail(id);
  }

  @Post(':type/:id/approve')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  approve(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('type', new ZodValidationPipe(ApplicationTypeSchema)) type: ApplicationTypeInput,
    @Param('id', new ZodValidationPipe(ApplicationIdSchema)) id: string,
  ) {
    return type === 'restaurant'
      ? this.applications.approveRestaurant(id, actor.userId)
      : this.applications.approveCourier(id, actor.userId);
  }

  @Post(':type/:id/reject')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  reject(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('type', new ZodValidationPipe(ApplicationTypeSchema)) type: ApplicationTypeInput,
    @Param('id', new ZodValidationPipe(ApplicationIdSchema)) id: string,
    @Body(new ZodValidationPipe(RejectApplicationSchema)) body: RejectApplicationInput,
  ) {
    return type === 'restaurant'
      ? this.applications.rejectRestaurant(id, actor.userId, body.reason)
      : this.applications.rejectCourier(id, actor.userId, body.reason);
  }

  /** SPEC-022-04 R3, SPEC-022-07-SC04: « voir la photo » — a 5-minute signed link. */
  @Get(':type/:id/files/:kind')
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  file(
    @Param('type', new ZodValidationPipe(ApplicationTypeSchema)) type: ApplicationTypeInput,
    @Param('id', new ZodValidationPipe(ApplicationIdSchema)) id: string,
    @Param('kind', new ZodValidationPipe(ApplicationFileKindSchema)) kind: ApplicationFileKindInput,
  ) {
    return type === 'restaurant'
      ? this.applications.restaurantFileLink(id, kind)
      : this.applications.courierFileLink(id, kind);
  }

  /** SPEC-022-07 R6: the new paper of a change waiting for a decision. */
  @Get(':type/:id/changes/:changeId/file')
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  changeFile(
    @Param('type', new ZodValidationPipe(ApplicationTypeSchema)) type: ApplicationTypeInput,
    @Param('id', new ZodValidationPipe(ApplicationIdSchema)) id: string,
    @Param('changeId', new ZodValidationPipe(ApplicationIdSchema)) changeId: string,
  ) {
    return this.applications.changeFileLink(type, id, changeId);
  }

  /** R6, FEAT-022-Q11: accepting a change moves where the money goes — step-up code first. */
  @Post(':type/:id/changes/:changeId/approve')
  @HttpCode(200)
  @RequireAuth()
  @RequireStepUp()
  @RequireRole('admin', 'super_admin')
  approveChange(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('type', new ZodValidationPipe(ApplicationTypeSchema)) type: ApplicationTypeInput,
    @Param('id', new ZodValidationPipe(ApplicationIdSchema)) id: string,
    @Param('changeId', new ZodValidationPipe(ApplicationIdSchema)) changeId: string,
  ) {
    return this.applications.decideChange(type, id, changeId, actor.userId, {
      status: 'approved',
    });
  }

  /** R6: refused with a reason — the approved value stays. */
  @Post(':type/:id/changes/:changeId/reject')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  rejectChange(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('type', new ZodValidationPipe(ApplicationTypeSchema)) type: ApplicationTypeInput,
    @Param('id', new ZodValidationPipe(ApplicationIdSchema)) id: string,
    @Param('changeId', new ZodValidationPipe(ApplicationIdSchema)) changeId: string,
    @Body(new ZodValidationPipe(RejectApplicationSchema)) body: RejectApplicationInput,
  ) {
    return this.applications.decideChange(type, id, changeId, actor.userId, {
      status: 'rejected',
      reason: body.reason,
    });
  }
}
