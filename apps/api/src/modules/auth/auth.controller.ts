import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuthService, type RequestMeta } from './auth.service';
import { CurrentActor } from './current-actor.decorator';
import { RequireAuth, RequireRole, RequireStepUp } from './decorators';
import {
  OtpRequestSchema,
  OtpVerifySchema,
  type OtpRequestInput,
  type OtpVerifyInput,
} from './dto/otp-request.schema';
import { RefreshSchema, type RefreshInput } from './dto/refresh.schema';
import {
  EmailRequestSchema,
  EmailVerifySchema,
  type EmailRequestInput,
  type EmailVerifyInput,
} from './dto/email.schema';
import { MfaVerifySchema, type MfaVerifyInput } from './dto/mfa-verify.schema';

function requestMeta(req: FastifyRequest): RequestMeta {
  const ua = req.headers['user-agent'];
  return { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua : null };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('otp/request')
  @HttpCode(202)
  async requestOtp(
    @Body(new ZodValidationPipe(OtpRequestSchema)) body: OtpRequestInput,
    @Req() req: FastifyRequest,
  ) {
    await this.auth.requestOtp(body.phone, body.purpose, requestMeta(req).ip);
    return { status: 'sent' };
  }

  /**
   * Email login, secondary channel (FEAT-007). Always 202: whether the
   * address belongs to an account is never revealed.
   */
  @Post('email/request')
  @HttpCode(202)
  async requestEmailLogin(
    @Body(new ZodValidationPipe(EmailRequestSchema)) body: EmailRequestInput,
    @Req() req: FastifyRequest,
  ) {
    await this.auth.requestEmailLogin(body.email, requestMeta(req).ip);
    return { status: 'sent' };
  }

  @Post('email/verify')
  @HttpCode(200)
  verifyEmailLogin(
    @Body(new ZodValidationPipe(EmailVerifySchema)) body: EmailVerifyInput,
    @Req() req: FastifyRequest,
  ) {
    return this.auth.verifyEmailAndLogin(body.email, body.code, requestMeta(req));
  }

  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body(new ZodValidationPipe(OtpVerifySchema)) body: OtpVerifyInput,
    @Req() req: FastifyRequest,
  ) {
    // Bloc 1 simplification: countryId isn't derived from the phone's dial
    // code yet (that's Bloc 2+ i18n/market-detection work) — new users are
    // created with countryId=null, exactly like Bloc 0.5's seeded fixtures.
    return this.auth.verifyOtpAndLogin(body.phone, body.code, body.purpose, {
      ...requestMeta(req),
      countryId: null,
    });
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(
    @Body(new ZodValidationPipe(RefreshSchema)) body: RefreshInput,
    @Req() req: FastifyRequest,
  ) {
    return this.auth.refresh(body.refresh, requestMeta(req));
  }

  @Post('logout')
  @HttpCode(204)
  @RequireAuth()
  async logout(
    @CurrentActor() actor: AuthenticatedActor,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.auth.logout(actor.sessionId, actor.userId, requestMeta(req));
  }

  @Post('logout-all')
  @HttpCode(204)
  @RequireAuth()
  async logoutAll(
    @CurrentActor() actor: AuthenticatedActor,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.auth.logoutAll(actor.userId, requestMeta(req));
  }

  /** TOTP enrollment — admin/super_admin only (docs/07 §"Auth"). */
  @Post('mfa/setup')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  mfaSetup(@CurrentActor() actor: AuthenticatedActor) {
    return this.auth.mfaSetup(actor.userId);
  }

  /** Confirms a pending enrollment OR opens the step-up window (docs/07 §"Auth", docs/19 §22). */
  @Post('mfa/verify')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  mfaVerify(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(MfaVerifySchema)) body: MfaVerifyInput,
  ) {
    return this.auth.mfaVerify(actor.userId, actor.sessionId, body.code);
  }

  @Post('mfa/disable')
  @HttpCode(204)
  @RequireAuth()
  @RequireStepUp()
  @RequireRole('admin', 'super_admin')
  async mfaDisable(@CurrentActor() actor: AuthenticatedActor): Promise<void> {
    await this.auth.mfaDisable(actor.userId);
  }
}
