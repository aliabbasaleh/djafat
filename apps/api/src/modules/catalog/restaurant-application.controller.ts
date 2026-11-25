import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { uploadedPhoto } from '../../infra/storage/photo-upload';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequireRole } from '../auth/decorators';
import {
  RestaurantLocationSchema,
  RestaurantPaperKindSchema,
  RestaurantPapersSchema,
  RestaurantPublicPhotoKindSchema,
  type RestaurantLocationInput,
  type RestaurantPaperKind,
  type RestaurantPapersInput,
  type RestaurantPublicPhotoKind,
} from './dto/restaurant-application.schema';
import { RestaurantApplicationService } from './restaurant-application.service';

/**
 * FEAT-022 (SPEC-022-05): the four steps of a restaurant that signed up, in
 * the restaurant console. Owner only: the staff never sees the papers nor the
 * Mobile Money number (« Autorisations »); the restaurant always comes from
 * the account's scope, never from the request.
 */
@ApiTags('restaurants')
@Controller('restaurants/me/application')
export class RestaurantApplicationController {
  constructor(private readonly applications: RestaurantApplicationService) {}

  @Get()
  @RequireAuth()
  @RequireRole('restaurant_owner')
  get(@CurrentActor() actor: AuthenticatedActor) {
    return this.applications.getMine(actor.userId);
  }

  @Put('location')
  @RequireAuth()
  @RequireRole('restaurant_owner')
  location(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(RestaurantLocationSchema)) body: RestaurantLocationInput,
  ) {
    return this.applications.updateLocation(actor.userId, body);
  }

  @Put('papers')
  @RequireAuth()
  @RequireRole('restaurant_owner')
  papers(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(RestaurantPapersSchema)) body: RestaurantPapersInput,
  ) {
    return this.applications.updatePapers(actor.userId, body);
  }

  /** One paper as the request's body (`image/jpeg`, `image/png`, `image/webp`), 5 MB at most (SPEC-022-04 R2). */
  @Post('files/:kind')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('restaurant_owner')
  upload(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('kind', new ZodValidationPipe(RestaurantPaperKindSchema)) kind: RestaurantPaperKind,
    @Req() req: FastifyRequest,
  ) {
    return this.applications.storePaper(actor.userId, kind, uploadedPhoto(req));
  }

  /** A 5-minute link to one of the restaurant's own papers (SPEC-022-04 R3). */
  @Get('files/:kind')
  @RequireAuth()
  @RequireRole('restaurant_owner')
  link(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('kind', new ZodValidationPipe(RestaurantPaperKindSchema)) kind: RestaurantPaperKind,
  ) {
    return this.applications.documentLink(actor.userId, kind);
  }

  @Post('submit')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('restaurant_owner')
  submit(@CurrentActor() actor: AuthenticatedActor) {
    return this.applications.submit(actor.userId);
  }
}

/**
 * FEAT-022 (SPEC-022-05 R1, R2, step 3 — the profile page): the logo and the
 * cover, uploaded instead of typed as addresses; public once stored
 * (SPEC-022-04 R4). Also for a restaurant created by the team.
 */
@ApiTags('restaurants')
@Controller('restaurants/me/photos')
export class RestaurantPhotosController {
  constructor(private readonly applications: RestaurantApplicationService) {}

  @Post(':kind')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('restaurant_owner')
  upload(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('kind', new ZodValidationPipe(RestaurantPublicPhotoKindSchema))
    kind: RestaurantPublicPhotoKind,
    @Req() req: FastifyRequest,
  ) {
    return this.applications.storePublicPhoto(actor.userId, kind, uploadedPhoto(req));
  }
}
