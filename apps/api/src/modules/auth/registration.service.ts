import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { UsersService } from '../users/users.service';
import { ACCOUNT_NOTICE_PORT, type AccountNoticePort } from './account-notice.port';
import { AuthService, type LoginResultDto, type RequestMeta } from './auth.service';
import { emailDeliveryFailed, emailUnavailable } from './email-delivery-errors';
import { OtpService } from './otp.service';
import { hashPassword } from './password-hash.util';
import { TrustedDeviceService } from './trusted-device.service';

/** A pending registration lives 30 minutes; each of its codes, `otp_ttl_seconds`. */
const REGISTRATION_TTL_MS = 30 * 60 * 1000;

export interface RegistrationInput {
  readonly fullName: string;
  /** E.164, normalised by the schema (FEAT-005). */
  readonly phone: string;
  /** Lower-cased by the schema (FEAT-007). */
  readonly email: string;
  readonly password: string;
}

/** A login result plus the token of the device just remembered (SPEC-020-04 R9). */
export interface SignedInWithDeviceDto extends LoginResultDto {
  readonly deviceToken?: string;
  readonly deviceTokenExpiresAt?: string;
}

/** What `auth_challenges.payload` holds for a registration — a hash, never a password. */
const RegistrationPayload = z.object({
  fullName: z.string(),
  phone: z.string(),
  passwordHash: z.string(),
});

const otpInvalid = () =>
  new UnauthorizedException({ code: 'OTP_INVALID', message: 'Invalid or expired code.' });

/** What a used address's pending registration holds: nothing that could create an account (R13). */
const DECOY_PAYLOAD = { decoy: true } as const;

function isDecoy(payload: unknown): boolean {
  return typeof payload === 'object' && payload !== null && 'decoy' in payload;
}

/**
 * Create an account with a name, a phone, an email and a password, confirmed
 * by a code sent to the email (FEAT-020, SPEC-020-03). Nothing is written to
 * `users` before the right code: until then the registration waits in
 * `auth_challenges`, and its code is bound to it (`context`), so two pending
 * registrations for one address can never complete each other.
 */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly devices: TrustedDeviceService,
    @Inject(ACCOUNT_NOTICE_PORT) private readonly notices: AccountNoticePort,
    private readonly audit: AuditService,
  ) {}

  async request(
    input: RegistrationInput,
    ip: string | null,
  ): Promise<{ registrationId: string; expiresAt: string }> {
    // R10: charged first, so even a 409 costs from the network's budget.
    if (ip) await this.otp.consumeIpBudget(ip);

    // R2 (FEAT-020-Q06): one account per number, said openly.
    if (await this.users.findByPhone(input.phone)) {
      throw new ConflictException({
        code: 'PHONE_ALREADY_USED',
        message:
          "Ce numéro a déjà un compte. Connectez-vous avec ce numéro ou avec l'e-mail de ce compte.",
      });
    }

    await this.purgeExpired();
    const expiresAt = new Date(Date.now() + REGISTRATION_TTL_MS);
    const target = { channel: 'email' as const, target: input.email };

    // R3, R13 (FEAT-020-Q16, review #3): an address already used gets a notice
    // instead of a code, and nothing tells it from a free one — not the answer,
    // not a lock (checked first for both), not the time (both hash and store a
    // pending registration), not what follows (`resend` and `verify` take the
    // same path on the decoy row, which has no code and can never complete).
    await this.otp.assertNotLocked(input.email);
    const passwordHash = await hashPassword(input.password);
    const taken = (await this.users.findByEmail(input.email)) !== null;
    const row = await this.prisma.authChallenge.create({
      data: {
        kind: 'registration',
        email: input.email,
        payload: taken
          ? DECOY_PAYLOAD
          : { fullName: input.fullName, phone: input.phone, passwordHash },
        expiresAt,
      },
      select: { id: true },
    });
    if (taken) await this.sendAlreadyRegistered(target);
    else await this.otp.requestCode(target, 'register', ip, { context: row.id, ipCharged: true });
    return { registrationId: row.id, expiresAt: expiresAt.toISOString() };
  }

  async verify(
    registrationId: string,
    code: string,
    meta: RequestMeta,
  ): Promise<SignedInWithDeviceDto> {
    const row = await this.pending(registrationId);
    if (!row) throw otpInvalid(); // R6: unknown, expired, consumed — one answer

    await this.otp.verifyCode({ channel: 'email', target: row.email }, code, 'register', meta.ip, {
      context: row.id,
    }); // throws OTP_INVALID / OTP_LOCKED — a decoy has no code, so it always stops here
    if (isDecoy(row.payload)) throw otpInvalid();

    const payload = RegistrationPayload.parse(row.payload);
    // R5, R8 (review #7): the account, its role and the consumed registration
    // in ONE transaction; a number or address taken meanwhile -> 409.
    const { userId } = await this.users.createRegisteredCustomer(
      { ...payload, email: row.email },
      async (tx) => {
        const claimed = await tx.authChallenge.updateMany({
          where: { id: row.id, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        if (claimed.count !== 1) throw otpInvalid();
      },
    );
    await this.audit.log({
      actorUserId: userId,
      action: 'AUTH_REGISTERED',
      entityType: 'user',
      entityId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const session = await this.auth.openSession(userId, meta);
    // The code proved the mailbox on this device: it is remembered (FEAT-020-VIS03).
    const device = await this.devices.trust(userId, meta);
    return {
      ...session,
      deviceToken: device.token,
      deviceTokenExpiresAt: device.expiresAt.toISOString(),
    };
  }

  /** R9: a new code for the same registration; only the latest is valid. Unknown -> nothing. */
  async resend(registrationId: string, ip: string | null): Promise<void> {
    const row = await this.pending(registrationId);
    if (!row) return;
    const target = { channel: 'email' as const, target: row.email };
    if (isDecoy(row.payload)) {
      // R13: the same budgets, lock and outcome as the code below.
      if (ip) await this.otp.consumeIpBudget(ip);
      await this.sendAlreadyRegistered(target);
      return;
    }
    await this.otp.requestCode(target, 'register', ip, { context: row.id });
  }

  /** R3, R13: the decoy's "send" — same budget and lock as a code, same 503 when it cannot leave. */
  private async sendAlreadyRegistered(target: { channel: 'email'; target: string }): Promise<void> {
    await this.otp.consumeTargetBudget(target);
    await this.otp.assertNotLocked(target.target);
    const outcome = await this.notices.send({ kind: 'already_registered', to: target.target });
    if (outcome === 'failed') throw emailDeliveryFailed();
    if (outcome === 'unavailable') throw emailUnavailable();
  }

  private pending(id: string) {
    return this.prisma.authChallenge.findFirst({
      where: { id, kind: 'registration', consumedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  /** R11 (FEAT-020-Q15): a hash, a name and a number have no use once expired. */
  private async purgeExpired(): Promise<void> {
    await this.prisma.authChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}
