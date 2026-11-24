import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { LAUNCH_MARKET } from '@djafat/config';
import {
  FieldValidationError,
  PASSWORD_REJECTION_MESSAGES,
  evaluatePassword,
  phoneKind,
} from '@djafat/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppConfigService } from '../../common/config/config.service';
import { AuditService } from '../../common/audit/audit.service';
import { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';
import { PlatformService } from '../platform/platform.service';
import { UsersService, type UserRecord } from '../users/users.service';
import { ACCOUNT_NOTICE_PORT, type AccountNoticePort } from './account-notice.port';
import { listAuthMethods } from './auth-methods';
import { AuthService, type LoginResultDto, type RequestMeta } from './auth.service';
import { maskEmail, maskPhone } from './masking';
import { OtpService } from './otp.service';
import { hashPassword, verifyPassword } from './password-hash.util';
import type { SignedInWithDeviceDto } from './registration.service';
import { SessionService } from './session.service';
import { TrustedDeviceService } from './trusted-device.service';

/** A password login waits 10 minutes for its new device's code. */
const LOGIN_CHALLENGE_TTL_MS = 10 * 60 * 1000;

/** One way to receive the new device's code (FEAT-020-Q05: off channels are listed, unavailable). */
export interface CodeChannelDto {
  readonly id: 'email' | 'sms' | 'whatsapp';
  readonly available: boolean;
  /** Masked destination, when the channel is usable for this account. */
  readonly destination?: string;
  /** WhatsApp: DJAFAT's chat with « Code DJAFAT » pre-filled (FEAT-008). */
  readonly link?: string;
}

export type PasswordLoginResultDto =
  | ({ readonly status: 'signed_in' } & LoginResultDto)
  | {
      readonly status: 'code_required';
      readonly challengeId: string;
      readonly expiresAt: string;
      readonly sentTo: { readonly channel: 'email'; readonly destination: string };
      readonly channels: readonly CodeChannelDto[];
    };

const invalidCredentials = () =>
  new UnauthorizedException({
    code: 'INVALID_CREDENTIALS',
    message: 'E-mail ou mot de passe incorrect.',
  });
const otpInvalid = () =>
  new UnauthorizedException({ code: 'OTP_INVALID', message: 'Invalid or expired code.' });
const phoneNotConfirmed = () =>
  new ConflictException({
    code: 'PHONE_NOT_CONFIRMED',
    message: "Ce numéro n'est pas encore confirmé : recevez le code par e-mail.",
  });

/**
 * Passwords of customer accounts (FEAT-020): logging in, with a code on a
 * device that is not remembered (SPEC-020-04), forgetting, setting and
 * changing one (SPEC-020-05). Every code goes through `OtpService` (hash,
 * expiry, attempts, lock, budgets, audit); every session through
 * `AuthService.openSession`. A password attempt counts on the same durable
 * lock as the address's codes (FEAT-020-Q17).
 */
@Injectable()
export class PasswordService {
  /** Verified against when the account has no hash, so every failure costs the same time. */
  private readonly timingHash = hashPassword('no-account-timing-equaliser');

  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly devices: TrustedDeviceService,
    @Inject(ACCOUNT_NOTICE_PORT) private readonly notices: AccountNoticePort,
    private readonly platform: PlatformService,
    private readonly rateLimiter: RateLimiterService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  // ── SPEC-020-04 — login ────────────────────────────────────────────────

  async login(
    input: { email: string; password: string; deviceToken?: string | undefined },
    meta: RequestMeta,
  ): Promise<PasswordLoginResultDto> {
    await this.consumeNetworkBudget(meta.ip); // R2
    await this.otp.assertNotLocked(input.email); // R2: 423 even with the right password

    const owner = await this.users.findByVerifiedEmail(input.email);
    const hash = owner ? await this.users.getPasswordHash(owner.id) : null;
    const valid = await verifyPassword(input.password, hash ?? (await this.timingHash));
    if (!owner || !hash || !valid) return this.badCredentials(input.email, owner, meta); // R1
    await this.otp.clearLock(input.email);

    await this.auth.assertCanSignIn(owner.id, meta); // R3: before any code is sent

    if (await this.devices.isTrusted(owner.id, input.deviceToken)) {
      return { status: 'signed_in', ...(await this.auth.openSession(owner.id, meta)) }; // R4
    }

    // R5: the new device's code goes to the verified address at once (FEAT-020-Q19).
    await this.purgeExpired();
    const expiresAt = new Date(Date.now() + LOGIN_CHALLENGE_TTL_MS);
    const challenge = await this.prisma.authChallenge.create({
      data: { kind: 'password_login', userId: owner.id, email: input.email, expiresAt },
      select: { id: true },
    });
    await this.otp.requestCode({ channel: 'email', target: input.email }, 'login_device', meta.ip, {
      context: challenge.id,
    });
    return {
      status: 'code_required',
      challengeId: challenge.id,
      expiresAt: expiresAt.toISOString(),
      sentTo: { channel: 'email', destination: maskEmail(input.email) },
      channels: this.channelsFor(owner, input.email),
    };
  }

  /** R7: a new code for the pending login, by email or by SMS to the CONFIRMED number. */
  async sendChallengeCode(
    input: { challengeId: string; channel: 'email' | 'sms' },
    ip: string | null,
  ): Promise<void> {
    const challenge = await this.pendingLogin(input.challengeId);
    if (!challenge?.userId) throw otpInvalid();
    if (input.channel === 'email') {
      await this.otp.requestCode(
        { channel: 'email', target: challenge.email },
        'login_device',
        ip,
        {
          context: challenge.id,
        },
      );
      return;
    }
    const user = await this.users.getByIdOrThrow(challenge.userId);
    if (!user.phoneVerifiedAt) throw phoneNotConfirmed();
    await this.otp.requestCode({ channel: 'sms', target: user.phone }, 'login_device', ip, {
      context: challenge.id,
    }); // SMS switched off -> 503 SMS_UNAVAILABLE
  }

  /** R8, R9: the right code consumes the pending login (once), opens the session, may remember the device. */
  async verifyChallenge(
    input: {
      challengeId: string;
      channel: 'email' | 'sms' | 'whatsapp';
      code: string;
      rememberDevice: boolean;
    },
    meta: RequestMeta,
  ): Promise<SignedInWithDeviceDto> {
    const challenge = await this.pendingLogin(input.challengeId);
    if (!challenge?.userId) throw otpInvalid();
    const user = await this.users.getByIdOrThrow(challenge.userId);

    if (input.channel === 'email') {
      await this.otp.verifyCode(
        { channel: 'email', target: challenge.email },
        input.code,
        'login_device',
        meta.ip,
        { context: challenge.id },
      );
    } else {
      if (!user.phoneVerifiedAt) throw phoneNotConfirmed();
      if (input.channel === 'sms') {
        await this.otp.verifyCode(
          { channel: 'sms', target: user.phone },
          input.code,
          'login_device',
          meta.ip,
          { context: challenge.id },
        );
      } else {
        // DJAFAT cannot write first on WhatsApp: the code is the one it replied
        // to « Code DJAFAT » sent from the confirmed number (FEAT-008).
        await this.otp.verifyCode(
          { channel: 'whatsapp', target: user.phone },
          input.code,
          'login',
          meta.ip,
        );
      }
    }

    const consumed = await this.prisma.authChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) throw otpInvalid(); // a concurrent verify won

    const session = await this.auth.openSession(user.id, meta);
    if (!input.rememberDevice) return session;
    const device = await this.devices.trust(user.id, meta);
    return {
      ...session,
      deviceToken: device.token,
      deviceTokenExpiresAt: device.expiresAt.toISOString(),
    };
  }

  // ── SPEC-020-05 — forgot, reset, change ─────────────────────────────────

  /** R1: always resolves; a code only for an address verified on an account. */
  async forgot(email: string, ip: string | null): Promise<void> {
    if (ip) await this.otp.consumeIpBudget(ip); // charged for unknown addresses too
    const owner = await this.users.findByVerifiedEmail(email);
    // R1 (review #4): the same budgets, lock, answer and time for any address.
    await this.otp.requestCodeIfOwned(
      { channel: 'email', target: email },
      'reset_password',
      ip,
      owner !== null,
      { ipCharged: true },
    );
  }

  /** R2, R3 — the new password already passed the schema (before the code was read). */
  async reset(
    input: { email: string; code: string; password: string },
    meta: RequestMeta,
  ): Promise<SignedInWithDeviceDto> {
    await this.otp.verifyCode(
      { channel: 'email', target: input.email },
      input.code,
      'reset_password',
      meta.ip,
    ); // throws OTP_INVALID / OTP_LOCKED
    const owner = await this.users.findByVerifiedEmail(input.email);
    if (!owner) throw otpInvalid();

    await this.users.setPasswordHash(owner.id, await hashPassword(input.password));
    await this.sessions.revokeAllForUser(owner.id, 'password_reset');
    await this.devices.revokeAll(owner.id, 'password_reset');
    await this.notices.send({ kind: 'password_changed', to: input.email, at: new Date() });
    await this.audit.log({
      actorUserId: owner.id,
      action: 'AUTH_PASSWORD_RESET',
      entityType: 'user',
      entityId: owner.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    // FEAT-020-Q22: the code proved the mailbox on this device, as a code login would.
    const session = await this.auth.openSession(owner.id, meta);
    const device = await this.devices.trust(owner.id, meta);
    return {
      ...session,
      deviceToken: device.token,
      deviceTokenExpiresAt: device.expiresAt.toISOString(),
    };
  }

  /** R4 to R7 — « Mon profil ». The identity comes from the access token, never the body. */
  /**
   * The current password of a signed-in account (password change, and e-mail
   * change since review #6), under the account's lock — 10 failures, 15 min.
   * 403 `CURRENT_PASSWORD_INCORRECT`, not 401: the SDK must not take it for an
   * expired session. Resolves `false` when the account has no password.
   */
  async assertCurrentPassword(
    user: UserRecord,
    currentPassword: string | undefined,
  ): Promise<boolean> {
    const hash = await this.users.getPasswordHash(user.id);
    if (!hash) return false;
    const lockTarget = user.email && user.emailVerifiedAt ? user.email : user.id;
    await this.otp.assertNotLocked(lockTarget);
    const valid = currentPassword ? await verifyPassword(currentPassword, hash) : false;
    if (!valid) {
      await this.otp.registerFailedAttempt(lockTarget);
      throw new ForbiddenException({
        code: 'CURRENT_PASSWORD_INCORRECT',
        message: 'Mot de passe actuel incorrect.',
      });
    }
    await this.otp.clearLock(lockTarget);
    return true;
  }

  async changePassword(
    actor: { userId: string; sessionId: string },
    input: { currentPassword?: string | undefined; newPassword: string },
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.users.getByIdOrThrow(actor.userId);
    const verifiedEmail = user.email && user.emailVerifiedAt ? user.email : null;
    const hadPassword = await this.assertCurrentPassword(user, input.currentPassword);
    if (!hadPassword && !verifiedEmail) {
      throw new ConflictException({
        code: 'EMAIL_REQUIRED',
        message: "Ajoutez d'abord votre adresse e-mail.",
      });
    }

    const verdict = evaluatePassword(input.newPassword, {
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
    });
    if (!verdict.ok) {
      throw new FieldValidationError([
        { path: 'newPassword', message: PASSWORD_REJECTION_MESSAGES[verdict.reason] },
      ]); // 422 VALIDATION_ERROR on the field
    }

    await this.users.setPasswordHash(user.id, await hashPassword(input.newPassword));
    await this.sessions.revokeAllForUserExcept(user.id, actor.sessionId, 'password_changed');
    await this.devices.revokeAll(user.id, 'password_changed');
    if (verifiedEmail) {
      await this.notices.send({ kind: 'password_changed', to: verifiedEmail, at: new Date() });
    }
    await this.audit.log({
      actorUserId: user.id,
      action: 'AUTH_PASSWORD_CHANGED',
      entityType: 'user',
      entityId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { first: !hadPassword },
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async badCredentials(
    email: string,
    owner: UserRecord | null,
    meta: RequestMeta,
  ): Promise<never> {
    await this.otp.registerFailedAttempt(email);
    await this.audit.log({
      actorUserId: owner?.id ?? null,
      action: 'AUTH_LOGIN_FAILURE',
      entityType: owner ? 'user' : 'email',
      entityId: owner?.id ?? null,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { reason: 'bad_credentials', method: 'password' },
    });
    throw invalidCredentials();
  }

  private async consumeNetworkBudget(ip: string | null): Promise<void> {
    if (!ip) return;
    const limit = await this.platform.getPasswordLoginRateLimitPerIp();
    const r = await this.rateLimiter.consume(`pwd:ip:${ip}`, limit.limit, limit.windowSeconds);
    if (!r.allowed) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Trop de tentatives depuis ce réseau. Réessayez dans quelques minutes.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * R6: email always; SMS and WhatsApp to the confirmed number, when the
   * deployment has them — SMS only to a Chad mobile (FEAT-024).
   */
  private channelsFor(user: UserRecord, email: string): CodeChannelDto[] {
    const methods = listAuthMethods({
      NODE_ENV: this.config.get('NODE_ENV'),
      SMS_PROVIDER: this.config.get('SMS_PROVIDER'),
      EMAIL_PROVIDER: this.config.get('EMAIL_PROVIDER'),
      WHATSAPP_PROVIDER: this.config.get('WHATSAPP_PROVIDER'),
      WHATSAPP_BUSINESS_NUMBER: this.config.get('WHATSAPP_BUSINESS_NUMBER'),
    });
    const phoneConfirmed = Boolean(user.phoneVerifiedAt);
    const phone = phoneConfirmed ? { destination: maskPhone(user.phone) } : {};
    const sms = methods.find((m) => m.id === 'sms');
    const whatsapp = methods.find((m) => m.id === 'whatsapp');
    // FEAT-024 (SPEC-024-01 R6): no SMS to a number that is not a Chad mobile.
    const smsUsable =
      phoneConfirmed &&
      Boolean(sms?.available) &&
      phoneKind(user.phone, LAUNCH_MARKET) === 'mobile';
    const whatsappUsable = phoneConfirmed && Boolean(whatsapp?.available);
    return [
      { id: 'email', available: true, destination: maskEmail(email) },
      { id: 'sms', available: smsUsable, ...(smsUsable ? phone : {}) },
      {
        id: 'whatsapp',
        available: whatsappUsable,
        ...(whatsappUsable ? { ...phone, ...(whatsapp?.link ? { link: whatsapp.link } : {}) } : {}),
      },
    ];
  }

  private pendingLogin(id: string) {
    return this.prisma.authChallenge.findFirst({
      where: { id, kind: 'password_login', consumedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  /** FEAT-020-Q15. */
  private async purgeExpired(): Promise<void> {
    await this.prisma.authChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}
