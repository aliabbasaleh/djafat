import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { RequestMeta } from './auth.service';
import {
  ChallengeSendSchema,
  ChallengeVerifySchema,
  ForgotPasswordSchema,
  PasswordLoginSchema,
  ResetPasswordSchema,
  type ChallengeSendInput,
  type ChallengeVerifyInput,
  type ForgotPasswordInput,
  type PasswordLoginInput,
  type ResetPasswordInput,
} from './dto/password.schema';
import { PasswordService } from './password.service';
import { ReqMeta } from './request-meta.decorator';

/**
 * Log in with an email and a password, the new device's code, and the
 * forgotten password (FEAT-020, SPEC-020-04, SPEC-020-05). Public routes,
 * limited per network and per address.
 */
@ApiTags('auth')
@Controller('auth/password')
export class PasswordController {
  constructor(private readonly passwords: PasswordService) {}

  /** 200 `{ status: 'signed_in', … }` or `{ status: 'code_required', challengeId, … }`. */
  @Post('login')
  @HttpCode(200)
  login(
    @Body(new ZodValidationPipe(PasswordLoginSchema)) body: PasswordLoginInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.passwords.login(body, meta);
  }

  @Post('challenge/send')
  @HttpCode(202)
  async send(
    @Body(new ZodValidationPipe(ChallengeSendSchema)) body: ChallengeSendInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.passwords.sendChallengeCode(body, meta.ip);
    return { status: 'sent' };
  }

  @Post('challenge/verify')
  @HttpCode(200)
  verify(
    @Body(new ZodValidationPipe(ChallengeVerifySchema)) body: ChallengeVerifyInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.passwords.verifyChallenge(body, meta);
  }

  /** Always 202: whether the address has an account is never revealed. */
  @Post('forgot')
  @HttpCode(202)
  async forgot(
    @Body(new ZodValidationPipe(ForgotPasswordSchema)) body: ForgotPasswordInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.passwords.forgot(body.email, meta.ip);
    return { status: 'sent' };
  }

  @Post('reset')
  @HttpCode(200)
  reset(
    @Body(new ZodValidationPipe(ResetPasswordSchema)) body: ResetPasswordInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.passwords.reset(body, meta);
  }
}
