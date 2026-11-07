import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { UsersService } from '../users/users.service';
import { CurrentActor } from './current-actor.decorator';
import { RequireAuth } from './decorators';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import {
  EmailRequestSchema,
  EmailVerifySchema,
  type EmailRequestInput,
  type EmailVerifyInput,
} from './dto/email.schema';

/**
 * `GET /v1/me` (docs/07 §"Auth") — lives in `auth`, not `users`: `users`
 * never imports `auth`'s guards (that would make the two modules mutually
 * dependent). `auth` already legitimately imports `UsersModule`.
 */
@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequireAuth()
  async getMe(@CurrentActor() actor: AuthenticatedActor) {
    const user = await this.users.getByIdOrThrow(actor.userId);
    return this.users.toMeDto(user, actor.roles);
  }

  /** Add (or change) the account's email: sends a verification code to it (FEAT-007). */
  @Post('email')
  @HttpCode(202)
  @RequireAuth()
  async requestEmailVerification(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(EmailRequestSchema)) body: EmailRequestInput,
    @Req() req: FastifyRequest,
  ) {
    await this.auth.requestEmailVerification(actor.userId, body.email, req.ip ?? null);
    return { status: 'sent' };
  }

  /** Confirm the code: the address becomes this account's verified email. */
  @Post('email/verify')
  @HttpCode(200)
  @RequireAuth()
  confirmEmailVerification(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(EmailVerifySchema)) body: EmailVerifyInput,
    @Req() req: FastifyRequest,
  ) {
    return this.auth.confirmEmailVerification(actor.userId, body.email, body.code, req.ip ?? null);
  }
}
