import { Body, Controller, Get, HttpCode, Patch, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { UsersService } from '../users/users.service';
import { CurrentActor } from './current-actor.decorator';
import { RequireAuth } from './decorators';
import { AuthService } from './auth.service';
import { UpdateMeSchema, type UpdateMeInput } from './dto/update-me.schema';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import {
  EmailRequestSchema,
  EmailVerifySchema,
  type EmailRequestInput,
  type EmailVerifyInput,
} from './dto/email.schema';
import { ChangePasswordSchema, type ChangePasswordInput } from './dto/password.schema';
import {
  PhoneRequestSchema,
  PhoneVerifySchema,
  type PhoneRequestInput,
  type PhoneVerifyInput,
} from './dto/phone-link.schema';
import type { RequestMeta } from './auth.service';
import { EmailChangeService } from './email-change.service';
import { PasswordService } from './password.service';
import { PhoneLinkService } from './phone-link.service';
import { ReqMeta } from './request-meta.decorator';
import {
  CourierRoleSignupSchema,
  RestaurantRoleSignupSchema,
  type CourierRoleSignupInput,
  type RestaurantRoleSignupInput,
} from './dto/register.schema';
import { RoleSignupService } from './role-signup.service';
import { PhoneWhatsappSchema, type PhoneWhatsappInput } from './dto/whatsapp.schema';
import { WhatsappCodeService } from './whatsapp-code.service';

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
    private readonly passwords: PasswordService,
    private readonly emailChange: EmailChangeService,
    private readonly phones: PhoneLinkService,
    private readonly roleSignup: RoleSignupService,
    private readonly whatsapp: WhatsappCodeService,
  ) {}

  @Get()
  @RequireAuth()
  async getMe(@CurrentActor() actor: AuthenticatedActor) {
    const user = await this.users.getByIdOrThrow(actor.userId);
    // The database's roles, not the token's (15 min): a role just added shows at once (SPEC-022-08 R3).
    return this.users.toMeDto(user, await this.users.getRoles(actor.userId));
  }

  /** "Mon profil": set the name shown to the courier and the restaurant. */
  @Patch()
  @RequireAuth()
  async updateMe(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(UpdateMeSchema)) body: UpdateMeInput,
  ) {
    const user = await this.users.updateFullName(actor.userId, body.fullName);
    return this.users.toMeDto(user, await this.users.getRoles(actor.userId));
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
    await this.emailChange.request(actor.userId, body, req.ip ?? null);
    return { status: 'sent' };
  }

  /** Confirm the code: the address becomes this account's verified email. */
  @Post('email/verify')
  @HttpCode(200)
  @RequireAuth()
  confirmEmailVerification(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(EmailVerifySchema)) body: EmailVerifyInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.emailChange.confirm(actor.userId, body, meta);
  }

  /**
   * FEAT-020 (SPEC-020-05 R4-R7): set a first password (an account created by
   * WhatsApp or SMS, with a verified email) or change it (the current one is
   * asked). The other sessions are logged out; this one stays.
   */
  @Put('password')
  @HttpCode(204)
  @RequireAuth()
  async changePassword(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(ChangePasswordSchema)) body: ChangePasswordInput,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.passwords.changePassword(
      { userId: actor.userId, sessionId: actor.sessionId },
      body,
      meta,
    );
  }

  /** FEAT-020 (SPEC-020-06 R1): a code by SMS to confirm the account's own number. */
  @Post('phone/request')
  @HttpCode(202)
  @RequireAuth()
  async requestPhoneCode(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(PhoneRequestSchema)) _body: PhoneRequestInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.phones.request(actor.userId, meta.ip);
    return { status: 'sent' };
  }

  /** FEAT-020 (SPEC-020-06 R2): the SMS code — the number is confirmed. */
  @Post('phone/verify')
  @HttpCode(200)
  @RequireAuth()
  async verifyPhone(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(PhoneVerifySchema)) body: PhoneVerifyInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    const user = await this.phones.verify(actor.userId, body.code, meta);
    return this.users.toMeDto(user, await this.users.getRoles(actor.userId));
  }

  /**
   * FEAT-023 (SPEC-023-01 R8, SPEC-023-06): a code to SEND from the account's
   * number on WhatsApp; the screen then waits on `POST /auth/whatsapp/status`.
   */
  @Post('phone/whatsapp')
  @HttpCode(201)
  @RequireAuth()
  startPhoneWhatsapp(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(PhoneWhatsappSchema)) _body: PhoneWhatsappInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.whatsapp.startPhoneConfirmation(actor.userId, meta);
  }

  /** FEAT-022 (SPEC-022-08): « Devenir livreur » — the same account becomes a courier. */
  @Post('roles/courier')
  @HttpCode(201)
  @RequireAuth()
  becomeCourier(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(CourierRoleSignupSchema)) body: CourierRoleSignupInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.roleSignup.becomeCourier(actor.userId, body, meta);
  }

  /** FEAT-022 (SPEC-022-08): « Inscrire mon restaurant » — the same account owns a restaurant. */
  @Post('roles/restaurant')
  @HttpCode(201)
  @RequireAuth()
  registerRestaurant(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(RestaurantRoleSignupSchema)) body: RestaurantRoleSignupInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.roleSignup.registerRestaurant(actor.userId, body, meta);
  }
}
