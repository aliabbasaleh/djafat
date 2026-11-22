import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { RequestMeta } from './auth.service';
import {
  RegisterResendSchema,
  RegisterSchema,
  RegisterVerifySchema,
  type RegisterInput,
  type RegisterResendInput,
  type RegisterVerifyInput,
} from './dto/register.schema';
import { RegistrationService } from './registration.service';
import { ReqMeta } from './request-meta.decorator';

/**
 * Create an account (FEAT-020, SPEC-020-03): public routes, limited by the
 * code budgets. Nothing is created before the email code.
 */
@ApiTags('auth')
@Controller('auth/register')
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  /** 202 `{ registrationId, expiresAt }` — the same answer whether the address has an account or not. */
  @Post()
  @HttpCode(202)
  register(
    @Body(new ZodValidationPipe(RegisterSchema)) body: RegisterInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.registration.request(body, meta.ip);
  }

  /** The right code: the account, a session and the remembered device's token. */
  @Post('verify')
  @HttpCode(200)
  verify(
    @Body(new ZodValidationPipe(RegisterVerifySchema)) body: RegisterVerifyInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.registration.verify(body.registrationId, body.code, meta);
  }

  @Post('resend')
  @HttpCode(202)
  async resend(
    @Body(new ZodValidationPipe(RegisterResendSchema)) body: RegisterResendInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.registration.resend(body.registrationId, meta.ip);
    return { status: 'sent' };
  }
}
