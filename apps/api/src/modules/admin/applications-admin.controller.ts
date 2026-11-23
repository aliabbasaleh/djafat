import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CourierDocumentKind } from '@djafat/core';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequireRole } from '../auth/decorators';
import { ApplicationsService } from './applications.service';
import {
  ApplicationIdSchema,
  ApplicationsQuerySchema,
  CourierDocumentKindParamSchema,
  RejectApplicationSchema,
  ReviewedApplicationTypeSchema,
  type ApplicationsQueryInput,
  type RejectApplicationInput,
} from './dto/applications.schema';

/**
 * FEAT-022 (SPEC-022-07): « Demandes à vérifier ». Only `admin` and
 * `super_admin` see the queue, open the photos and decide; `support` and
 * `finance` are refused (403). Deciding needs no step-up code (FEAT-022-Q11).
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
    @Param('type', new ZodValidationPipe(ReviewedApplicationTypeSchema)) _type: 'courier',
    @Param('id', new ZodValidationPipe(ApplicationIdSchema)) id: string,
  ) {
    return this.applications.courierDetail(id);
  }

  @Post(':type/:id/approve')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  approve(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('type', new ZodValidationPipe(ReviewedApplicationTypeSchema)) _type: 'courier',
    @Param('id', new ZodValidationPipe(ApplicationIdSchema)) id: string,
  ) {
    return this.applications.approveCourier(id, actor.userId);
  }

  @Post(':type/:id/reject')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  reject(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('type', new ZodValidationPipe(ReviewedApplicationTypeSchema)) _type: 'courier',
    @Param('id', new ZodValidationPipe(ApplicationIdSchema)) id: string,
    @Body(new ZodValidationPipe(RejectApplicationSchema)) body: RejectApplicationInput,
  ) {
    return this.applications.rejectCourier(id, actor.userId, body.reason);
  }

  /** SPEC-022-04 R3, SPEC-022-07-SC04: « voir la photo » — a 5-minute signed link. */
  @Get(':type/:id/files/:kind')
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  file(
    @Param('type', new ZodValidationPipe(ReviewedApplicationTypeSchema)) _type: 'courier',
    @Param('id', new ZodValidationPipe(ApplicationIdSchema)) id: string,
    @Param('kind', new ZodValidationPipe(CourierDocumentKindParamSchema)) kind: CourierDocumentKind,
  ) {
    return this.applications.courierFileLink(id, kind);
  }
}
