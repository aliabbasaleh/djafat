import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppConfigService } from '../../common/config/config.service';
import { AuditService } from '../../common/audit/audit.service';
import { PlatformService } from '../platform/platform.service';
import { UsersService, type UserRecord } from '../users/users.service';
import { ACCOUNT_NOTICE_PORT, type AccountNoticePort } from './account-notice.port';
import { authMethodsFrom } from './auth-methods';
import { AuthService, phoneMayOpen, type RequestMeta } from './auth.service';
import {
  generateOtpCode,
  generateRefreshToken,
  hashOtpCode,
  hashWhatsappToken,
} from './crypto.util';
import { deviceLabel } from './device-label';
import { OtpService } from './otp.service';
import { pendingPasswordLoginWhere } from './password.service';
import type { SignedInWithDeviceDto } from './registration.service';
import { TrustedDeviceService } from './trusted-device.service';
import { whatsappLink, whatsappMessageText, type WhatsappCodePurpose } from './whatsapp-message';

/** What a screen needs to show the code (SPEC-023-01). `token` is given once, never stored in clear. */
export interface WhatsappCodeDto {
  readonly token: string;
  readonly code: string;
  readonly text: string;
  readonly link: string;
  /** DJAFAT's WhatsApp number, E.164 — to send the message from another device. */
  readonly number: string;
  readonly expiresAt: string;
}

/** Where a code stands, for the screen holding its token (SPEC-023-03). */
export type WhatsappStatusDto =
  | { readonly status: 'waiting'; readonly expiresAt: string }
  | { readonly status: 'expired' }
  | ({ readonly status: 'signed_in' } & SignedInWithDeviceDto)
  | { readonly status: 'not_confirmed'; readonly phone: string }
  | { readonly status: 'wrong_number' }
  | { readonly status: 'confirmed' };

/** What became of a received code message (SPEC-023-02): for the webhook's log, never for Meta. */
export type WhatsappReceipt = 'matched' | 'not_confirmed' | 'wrong_number' | 'no_code' | 'locked';

type Outcome = 'matched' | 'not_confirmed' | 'wrong_number';

/** SPEC-023-01 R2: draws against codes already waiting, before giving up (one million codes). */
const MAX_DRAWS = 5;
/**
 * A code's validity is for its MESSAGE; once the message is in, the screen may
 * still read the outcome for a while (a phone back from WhatsApp late). Rows
 * are deleted this long after their expiry (SPEC-023-01 R9).
 */
const KEEP_AFTER_EXPIRY_MS = 10 * 60 * 1000;

/**
 * SPEC-023-02 R5 (v2), review #1: the lock of a WhatsApp sender is its own
 * (`auth_target_locks` under `whatsapp:<number>`), never the number's code
 * lock — Meta signs the sender, so only messages really sent from that number
 * can lock it; wrong codes typed on `POST /auth/otp/verify` by a stranger lock
 * the SMS codes, not WhatsApp.
 */
export function whatsappLockKey(phone: string): string {
  return `whatsapp:${phone}`;
}

const whatsappUnavailable = () =>
  new ServiceUnavailableException({
    code: 'WHATSAPP_UNAVAILABLE',
    message: "WhatsApp n'est pas disponible pour le moment.",
  });
const otpInvalid = () =>
  new UnauthorizedException({ code: 'OTP_INVALID', message: 'Invalid or expired code.' });
const phoneNotConfirmed = () =>
  new ConflictException({
    code: 'PHONE_NOT_CONFIRMED',
    message: "Ce numéro n'est pas encore confirmé : recevez le code par e-mail.",
  });
const phoneAlreadyConfirmed = () =>
  new ConflictException({
    code: 'PHONE_ALREADY_CONFIRMED',
    message: 'Votre numéro est déjà confirmé.',
  });

/**
 * Free WhatsApp login (FEAT-023): the screen shows a code, the customer SENDS
 * it to DJAFAT's number, the webhook notes who sent it, and only the screen
 * holding the token learns the outcome. DJAFAT never sends a WhatsApp message
 * — Meta bills messages from businesses only (SPEC-023-02 R8). Budgets and the
 * durable lock are `OtpService`'s; every session opens through
 * `AuthService.openSession`.
 */
@Injectable()
export class WhatsappCodeService {
  private readonly logger = new Logger(WhatsappCodeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly devices: TrustedDeviceService,
    private readonly platform: PlatformService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    @Inject(ACCOUNT_NOTICE_PORT) private readonly notices: AccountNoticePort,
  ) {}

  // ── SPEC-023-01 — the code to send ──────────────────────────────────────

  /** A login code, or (with `challengeId`) the code of a password login on a new device. */
  async startLogin(
    input: { challengeId?: string | undefined },
    meta: RequestMeta,
  ): Promise<WhatsappCodeDto> {
    const number = this.businessNumber(); // R1
    if (meta.ip) await this.otp.consumeIpBudget(meta.ip); // R6
    if (!input.challengeId) return this.create('login', null, null, number);

    // R7: a pending password login whose account has a confirmed number.
    const challenge = await this.prisma.authChallenge.findFirst({
      where: pendingPasswordLoginWhere(input.challengeId),
    });
    if (!challenge?.userId) throw otpInvalid();
    const user = await this.users.getByIdOrThrow(challenge.userId);
    if (!user.phoneVerifiedAt) throw phoneNotConfirmed();
    await this.otp.consumePhoneBudget(user.phone); // R6
    await this.otp.assertNotLocked(whatsappLockKey(user.phone));
    return this.create('login_device', user.id, challenge.id, number, challenge.expiresAt);
  }

  /** R8: a signed-in account confirms its own number. */
  async startPhoneConfirmation(userId: string, meta: RequestMeta): Promise<WhatsappCodeDto> {
    const number = this.businessNumber(); // R1
    const user = await this.users.getByIdOrThrow(userId);
    if (user.phoneVerifiedAt) throw phoneAlreadyConfirmed();
    if (meta.ip) await this.otp.consumeIpBudget(meta.ip); // R6
    await this.otp.consumePhoneBudget(user.phone);
    await this.otp.assertNotLocked(whatsappLockKey(user.phone));
    return this.create('verify_phone', user.id, null, number);
  }

  // ── SPEC-023-02 — a message carrying a code arrives ─────────────────────

  /**
   * `from` is the sender's number (E.164, already read like any number) and
   * `code` the six digits of its message. Nothing is ever sent back (R8).
   */
  async receive(message: { from: string; code: string }): Promise<WhatsappReceipt> {
    const { from: phone } = message;
    if (await this.isLocked(phone)) return 'locked'; // R5
    const codeHash = hashOtpCode(message.code, this.config.get('OTP_HASH_SECRET'));
    const waiting = await this.prisma.whatsappCode.findFirst({
      where: { codeHash, receivedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!waiting) return this.alreadyReceived(codeHash, phone); // R5, R6

    const purpose = waiting.purpose as WhatsappCodePurpose;
    const { outcome, userId } = await this.verdict(purpose, waiting.userId, phone); // R6
    // R6: the first message wins — a conditional update, never a read-then-write.
    const claimed = await this.prisma.whatsappCode.updateMany({
      where: { id: waiting.id, receivedAt: null },
      data: {
        receivedAt: new Date(),
        senderPhone: phone,
        outcome,
        matchedUserId: outcome === 'matched' ? userId : null,
      },
    });
    if (claimed.count === 0) return this.unknownCode(phone);

    if (outcome === 'matched' && userId) {
      if (purpose === 'verify_phone') {
        await this.users.markPhoneVerified(userId);
        await this.audit.log({
          actorUserId: userId,
          action: 'AUTH_PHONE_VERIFIED',
          entityType: 'user',
          entityId: userId,
          metadata: { channel: 'whatsapp' },
        });
      }
      await this.otp.clearLock(whatsappLockKey(phone)); // R7
      await this.audit.log({
        action: 'AUTH_OTP_VERIFIED',
        entityType: 'phone',
        metadata: { channel: 'whatsapp', purpose },
      });
    }
    return outcome;
  }

  // ── SPEC-023-03 — the screen asks where its code stands ─────────────────

  async status(
    input: { token: string; rememberDevice: boolean },
    meta: RequestMeta,
  ): Promise<WhatsappStatusDto> {
    const tokenHash = hashWhatsappToken(input.token, this.config.get('OTP_HASH_SECRET'));
    const row = await this.prisma.whatsappCode.findUnique({ where: { tokenHash } });
    if (!row || row.consumedAt) return { status: 'expired' }; // R1
    if (!row.receivedAt) {
      return row.expiresAt > new Date()
        ? { status: 'waiting', expiresAt: row.expiresAt.toISOString() } // R2
        : { status: 'expired' };
    }
    // R1 (v2), review #3: a message that came in is read soon after, never hours later.
    if (Date.now() > row.expiresAt.getTime() + KEEP_AFTER_EXPIRY_MS) return { status: 'expired' };
    // R3: each outcome is given once, to one caller.
    const taken = await this.prisma.whatsappCode.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (taken.count === 0) return { status: 'expired' };

    if (row.outcome === 'not_confirmed' && row.senderPhone) {
      return { status: 'not_confirmed', phone: row.senderPhone }; // R7
    }
    if (row.outcome !== 'matched' || !row.matchedUserId) return { status: 'wrong_number' }; // R8
    if (row.purpose === 'verify_phone') {
      // R6 (v2), review #2: confirmed for sure before saying so (idempotent).
      await this.users.markPhoneVerified(row.matchedUserId);
      return { status: 'confirmed' };
    }
    if (row.purpose === 'login') {
      return { status: 'signed_in', ...(await this.signIn(row.matchedUserId, meta, false)) }; // R4
    }
    // R5: the pending password login is consumed once; expired or used → expired.
    const consumed = row.challengeId
      ? await this.prisma.authChallenge.updateMany({
          where: pendingPasswordLoginWhere(row.challengeId),
          data: { consumedAt: new Date() },
        })
      : { count: 0 };
    if (consumed.count === 0) return { status: 'expired' };
    return {
      status: 'signed_in',
      ...(await this.signIn(row.matchedUserId, meta, input.rememberDevice)),
    };
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** SPEC-023-01 R1: DJAFAT's number when WhatsApp is in service here; 503 otherwise. */
  private businessNumber(): string {
    const methods = authMethodsFrom((key) => this.config.get(key));
    const number = this.config.get('WHATSAPP_BUSINESS_NUMBER');
    const available = methods.some((m) => m.id === 'whatsapp' && m.available);
    if (!available || !number) throw whatsappUnavailable();
    return number;
  }

  private async create(
    purpose: WhatsappCodePurpose,
    userId: string | null,
    challengeId: string | null,
    number: string,
    notAfter?: Date,
  ): Promise<WhatsappCodeDto> {
    await this.prisma.whatsappCode.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - KEEP_AFTER_EXPIRY_MS) } },
    }); // R9
    const ttlSeconds = await this.platform.getOtpTtlSeconds();
    const byTtl = new Date(Date.now() + ttlSeconds * 1000);
    const expiresAt = notAfter && notAfter < byTtl ? notAfter : byTtl; // R2
    const secret = this.config.get('OTP_HASH_SECRET');
    const token = generateRefreshToken(); // R5: 32 random bytes
    for (let draw = 0; draw < MAX_DRAWS; draw += 1) {
      const code = generateOtpCode();
      try {
        await this.prisma.whatsappCode.create({
          data: {
            purpose,
            codeHash: hashOtpCode(code, secret),
            tokenHash: hashWhatsappToken(token, secret),
            userId,
            challengeId,
            expiresAt,
          },
        });
      } catch (err) {
        // R2: another waiting code has these digits (`whatsapp_codes_waiting_code_uk`).
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
      await this.audit.log({
        ...(userId ? { actorUserId: userId } : {}),
        action: 'AUTH_OTP_REQUESTED',
        entityType: 'phone',
        metadata: { channel: 'whatsapp', purpose },
      }); // R9: no code, no token
      const text = whatsappMessageText(code, purpose);
      return {
        token,
        code,
        text,
        link: whatsappLink(number, text),
        number,
        expiresAt: expiresAt.toISOString(),
      };
    }
    this.logger.error('WhatsApp code: no free code after several draws');
    throw whatsappUnavailable();
  }

  /** SPEC-023-02 R6: what the message means for the screen that showed this code. */
  private async verdict(
    purpose: WhatsappCodePurpose,
    ownerId: string | null,
    phone: string,
  ): Promise<{ outcome: Outcome; userId: string | null }> {
    if (purpose === 'login') {
      // The rule of an SMS code (SPEC-020-06 R4); a message never creates an account.
      const user = await this.users.findByPhone(phone);
      return user && phoneMayOpen(user)
        ? { outcome: 'matched', userId: user.id }
        : { outcome: 'not_confirmed', userId: null };
    }
    const owner: UserRecord | null = ownerId ? await this.users.getById(ownerId) : null;
    const fromOwner =
      owner !== null &&
      owner.phone === phone &&
      (purpose === 'verify_phone' || owner.phoneVerifiedAt !== null);
    return fromOwner
      ? { outcome: 'matched', userId: owner.id }
      : { outcome: 'wrong_number', userId: null };
  }

  /**
   * R6 (v2), review #2: the same sender's message again — Meta's redelivery
   * after a half-done first attempt — gives the same outcome and finishes its
   * effect, without counting a failure. Any other code nobody waits for is R5.
   */
  private async alreadyReceived(codeHash: string, phone: string): Promise<WhatsappReceipt> {
    const mine = await this.prisma.whatsappCode.findFirst({
      where: {
        codeHash,
        senderPhone: phone,
        receivedAt: { not: null },
        expiresAt: { gt: new Date(Date.now() - KEEP_AFTER_EXPIRY_MS) },
      },
      orderBy: { receivedAt: 'desc' },
    });
    if (!mine?.outcome) return this.unknownCode(phone);
    if (mine.outcome === 'matched' && mine.purpose === 'verify_phone' && mine.matchedUserId) {
      await this.users.markPhoneVerified(mine.matchedUserId);
    }
    return mine.outcome as Outcome;
  }

  /** R5: a code nobody waits for counts as a failure on the sender's own WhatsApp lock. */
  private async unknownCode(phone: string): Promise<WhatsappReceipt> {
    await this.otp.registerFailedAttempt(whatsappLockKey(phone));
    await this.audit.log({
      action: 'AUTH_OTP_FAILED',
      entityType: 'phone',
      metadata: { channel: 'whatsapp' },
    });
    return 'no_code';
  }

  /** R5: a locked sender is ignored; any other error is not swallowed. */
  private async isLocked(phone: string): Promise<boolean> {
    try {
      await this.otp.assertNotLocked(whatsappLockKey(phone));
      return false;
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === 423) return true;
      throw err;
    }
  }

  /**
   * SPEC-023-03 R4, R5 and SPEC-023-04: the session (shared gate: 403
   * `ACCOUNT_INACTIVE`), the number confirmed by the message, the device
   * remembered on request, then the alert e-mail — best effort, in the
   * background, so a slow mail server never delays nor undoes the login.
   */
  private async signIn(
    userId: string,
    meta: RequestMeta,
    remember: boolean,
  ): Promise<SignedInWithDeviceDto> {
    // The message proved the number, as an SMS code does (`verifyOtpAndLogin`): confirmed
    // first, so the session's profile already says so.
    await this.users.markPhoneVerified(userId);
    const session = await this.auth.openSession(userId, meta);
    const device = remember ? await this.devices.trust(userId, meta) : null;
    void this.alert(userId, meta).catch((err: unknown) => {
      const reason = err instanceof Error ? err.name : 'error';
      this.logger.warn(`WhatsApp login alert not sent: ${reason}`);
    });
    return device
      ? {
          ...session,
          deviceToken: device.token,
          deviceTokenExpiresAt: device.expiresAt.toISOString(),
        }
      : session;
  }

  /** SPEC-023-04 R1-R2: to the verified address only; none, no e-mail. */
  private async alert(userId: string, meta: RequestMeta): Promise<void> {
    const user = await this.users.getById(userId);
    if (!user?.email || !user.emailVerifiedAt) return;
    await this.notices.send({
      kind: 'whatsapp_login',
      to: user.email,
      at: new Date(),
      device: deviceLabel(meta.userAgent),
    });
  }
}
