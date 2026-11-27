import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { CourierDocumentKind } from '@djafat/core';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { uploadedPhoto } from '../../infra/storage/photo-upload';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequireRole } from '../auth/decorators';
import { CourierApplicationService } from './courier-application.service';
import {
  CourierDocumentKindSchema,
  UpdateCourierApplicationSchema,
  type UpdateCourierApplicationInput,
} from './dto/courier-application.schema';

/**
 * FEAT-022 (SPEC-022-06): « Avant votre première course » — the courier's own
 * application. Identity always comes from the token: a courier never reaches
 * another courier's application or photos (SPEC-022-04-SC01).
 */
@ApiTags('couriers')
@Controller('couriers/me/application')
export class CourierApplicationController {
  constructor(private readonly applications: CourierApplicationService) {}

  @Get()
  @RequireAuth()
  @RequireRole('courier')
  get(@CurrentActor() actor: AuthenticatedActor) {
    return this.applications.getMine(actor.userId);
  }

  @Put()
  @RequireAuth()
  @RequireRole('courier')
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(UpdateCourierApplicationSchema))
    body: UpdateCourierApplicationInput,
  ) {
    return this.applications.updateMine(actor.userId, body);
  }

  /** One photo as the request's body (`image/jpeg`, `image/png`, `image/webp`), 5 MB at most (SPEC-022-04 R2). */
  @Post('files/:kind')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('courier')
  upload(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('kind', new ZodValidationPipe(CourierDocumentKindSchema)) kind: CourierDocumentKind,
    @Req() req: FastifyRequest,
  ) {
    return this.applications.storeDocument(actor.userId, kind, uploadedPhoto(req));
  }

  /** A 5-minute link to one of the courier's own photos (SPEC-022-04 R3). */
  @Get('files/:kind')
  @RequireAuth()
  @RequireRole('courier')
  link(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('kind', new ZodValidationPipe(CourierDocumentKindSchema)) kind: CourierDocumentKind,
  ) {
    return this.applications.documentLink(actor.userId, kind);
  }

  @Post('submit')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('courier')
  submit(@CurrentActor() actor: AuthenticatedActor) {
    return this.applications.submit(actor.userId);
  }
}
