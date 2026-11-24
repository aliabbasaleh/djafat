import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { OtpDeliveryPort, OtpDeliveryPurpose } from '@djafat/types';
import { LAUNCH_MARKET } from '@djafat/config';
import {
  PHONE_INPUT_MESSAGES,
  evaluateOtpAttempt,
  phoneKind,
  smsForeignMessage,
} from '@djafat/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppConfigService } from '../../common/config/config.service';
import { AuditService } from '../../common/audit/audit.service';
import { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';
import { PlatformService } from '../platform/platform.service';
import { authMethodsFrom } from './auth-methods';
import { generateOtpCode, hashOtpCode, timingSafeEqualHex } from './crypto.util';
import { smsUnavailable } from './providers/disabled-sms-otp-delivery.provider';
import {
  OTP_DELIVERY_PORT,
  OTP_EMAIL_DELIVERY_PORT,
  OTP_WHATSAPP_DELIVERY_PORT,
} from './otp-delivery.token';

/** `@djafat/types` `OtpDeliveryPurpose` — one list for the DB CHECK, the transports and this service. */
export type OtpPurpose = OtpDeliveryPurpose;

/**
 * FEAT-020 (SPEC-020-03 R7): a code can be bound to the request that asked it
 * — a pending registration, a password login, an account. A bound code
 * verifies only with the same `context`; an unbound one (the default, every
 * flow before FEAT-020) only without one.
 */
export interface OtpRequestOptions {
  readonly context?: string;
  /** The caller already charged this request's network budget (`consumeIpBudget`). */
  readonly ipCharged?: boolean;
  /** The caller already charged this target's budget (`consumeTargetBudget`). */
  readonly targetCharged?: boolean;
}

/**
 * Where a code goes (FEAT-007, FEAT-008). `target` is an E.164 phone for
 * `sms` and `whatsapp`, and a lower-cased email for `email`. One store, one
 * lock table, one security logic for every channel (migrations 0030, 0031).
 * A phone's SMS and WhatsApp codes share its lock and request budget, but a
 * code only verifies on the channel it was sent on.
 */
export interface OtpTarget {
  readonly channel: 'sms' | 'email' | 'whatsapp';
  readonly target: string;
}

/** Audit entity / rate-limit family: a phone, whatever the channel, or an email. */
const targetKind = (to: OtpTarget): 'phone' | 'email' =>
  to.channel === 'email' ? 'email' : 'phone';

interface OtpCodeRow {
  id: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
}

/**
 * Request/verify OTP challenges (docs/19 §7-§11, docs/05 §5.4). The durable
 * brute-force barrier is `auth_target_locks` (Postgres); Redis rate limiting
 * is first-line/best-effort on top (docs/15 AD-08 — Redis is never the sole
 * barrier for anything security-critical).
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly rateLimiter: RateLimiterService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    @Inject(OTP_DELIVERY_PORT) private readonly delivery: OtpDeliveryPort,
    @Inject(OTP_EMAIL_DELIVERY_PORT) private readonly emailDelivery: OtpDeliveryPort,
    @Inject(OTP_WHATSAPP_DELIVERY_PORT) private readonly whatsappDelivery: OtpDeliveryPort,
  ) {}

  /** SMS code to a phone (unchanged contract). */
  requestOtp(phone: string, purpose: OtpPurpose, ip: string | null): Promise<void> {
    return this.requestCode({ channel: 'sms', target: phone }, purpose, ip);
  }

  /** SMS code check (unchanged contract). */
  verifyOtp(phone: string, code: string, purpose: OtpPurpose, ip: string | null): Promise<void> {
    return this.verifyCode({ channel: 'sms', target: phone }, code, purpose, ip);
  }

  /**
   * FEAT-020 (review #3, #4; SPEC-020-03 R14, SPEC-020-05 R1, AC08): a code to an
   * address that may or may not belong to an account. Both cases spend the same
   * budgets and meet the same lock first; the code itself then leaves in the
   * background and a delivery failure is only logged — so neither the answer,
   * a 429 or 423, a 503 nor the response time tells whether the address has an
   * account. The log line names the channel, never the address.
   */
  async requestCodeIfOwned(
    to: OtpTarget,
    purpose: OtpPurpose,
    ip: string | null,
    owned: boolean,
    options: Pick<OtpRequestOptions, 'ipCharged'> = {},
  ): Promise<void> {
    if (ip && !options.ipCharged) await this.consumeIpBudget(ip);
    await this.consumeTargetBudget(to);
    await this.assertNotLocked(to.target);
    if (!owned) return;
    void this.requestCode(to, purpose, ip, { ipCharged: true, targetCharged: true }).catch(
      (err: unknown) => {
        const reason = err instanceof Error ? err.message : 'unknown error';
        this.logger.warn(`Code "${purpose}" not sent by ${to.channel}: ${reason}`);
      },
    );
  }

  async requestCode(
    to: OtpTarget,
    purpose: OtpPurpose,
    ip: string | null,
    options: OtpRequestOptions = {},
  ): Promise<void> {
    // FEAT-024 (SPEC-024-01 R1-R4): an SMS code goes to a Chad mobile only. A
    // foreign number or a fixed line is refused first — before the switched-off
    // check, any budget or write: nothing leaves, nothing is counted.
    if (to.channel === 'sms') this.assertSmsReachable(to.target);
    // FEAT-008 (SPEC-008-01-SC05): a switched-off SMS channel is refused BEFORE any
    // budget or write — otherwise SMS requests for someone's number would burn the
    // per-number budget their WhatsApp codes share.
    if (to.channel === 'sms' && this.config.get('SMS_PROVIDER') === 'disabled') {
      throw smsUnavailable();
    }
    if (ip && !options.ipCharged) await this.consumeIpBudget(ip);
    if (!options.targetCharged) await this.consumeTargetBudget(to);

    await this.assertNotLocked(to.target);

    const code = generateOtpCode();
    const codeHash = hashOtpCode(code, this.config.get('OTP_HASH_SECRET'));
    const ttlSeconds = await this.platform.getOtpTtlSeconds();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.prisma.otpCode.create({
      data: {
        target: to.target,
        channel: to.channel,
        codeHash,
        purpose,
        expiresAt,
        context: options.context ?? null,
      },
    });
    const transport = {
      sms: this.delivery,
      email: this.emailDelivery,
      whatsapp: this.whatsappDelivery,
    }[to.channel];
    await transport.send({ to: to.target, code, ttlSeconds, locale: 'fr', purpose });

    await this.audit.log({
      action: 'AUTH_OTP_REQUESTED',
      entityType: targetKind(to),
      ip,
      metadata: { purpose }, // phone is the actor here but has no user id yet — kept out of metadata too (not a secret, but unnecessary to duplicate; entityId is reserved for uuids)
    });
  }

  /**
   * SPEC-024-01 R2, R3: no SMS to a foreign number (WhatsApp, when the
   * deployment has it, or the e-mail instead) nor to a fixed line.
   */
  private assertSmsReachable(phone: string): void {
    const kind = phoneKind(phone, LAUNCH_MARKET);
    if (kind === 'mobile') return;
    const [code, message] =
      kind === 'fixed'
        ? (['PHONE_FIXED_LINE', PHONE_INPUT_MESSAGES.fixed] as const)
        : (['SMS_FOREIGN_NUMBER', smsForeignMessage(this.whatsappAvailable())] as const);
    throw new UnprocessableEntityException({
      code,
      message,
      details: [{ path: 'phone', message }],
    });
  }

  private whatsappAvailable(): boolean {
    return authMethodsFrom((key) => this.config.get(key)).some(
      (method) => method.id === 'whatsapp' && method.available,
    );
  }

  /** Codes requested from this network (`otp_rate_limit_per_ip`): 429 `RATE_LIMITED` once spent. */
  async consumeIpBudget(ip: string): Promise<void> {
    const ipLimit = await this.platform.getOtpRateLimitPerIp();
    const r = await this.rateLimiter.consume(`otp:ip:${ip}`, ipLimit.limit, ipLimit.windowSeconds);
    if (!r.allowed) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Too many requests from this network. Try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Messages sent to this phone or address (setting historically named "per
   * phone"): 429 once spent. FEAT-020 charges it for an account notice too, so
   * nobody can flood a mailbox through the registration form.
   */
  async consumeTargetBudget(to: OtpTarget): Promise<void> {
    const phoneLimit = await this.platform.getOtpRateLimitPerPhone();
    const pr = await this.rateLimiter.consume(
      `otp:${targetKind(to)}:${to.target}`,
      phoneLimit.limit,
      phoneLimit.windowSeconds,
    );
    if (!pr.allowed) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message:
            targetKind(to) === 'phone'
              ? 'Too many codes requested for this number. Try again later.'
              : 'Too many codes requested for this address. Try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Throws on any failure (never reveals WHY — wrong code, expired, exhausted, and "no challenge at all" are indistinguishable). */
  async verifyCode(
    to: OtpTarget,
    code: string,
    purpose: OtpPurpose,
    ip: string | null,
    options: Pick<OtpRequestOptions, 'context'> = {},
  ): Promise<void> {
    const context = options.context ?? null;
    await this.assertNotLocked(to.target);

    const maxAttempts = await this.platform.getOtpMaxAttempts();
    const secret = this.config.get('OTP_HASH_SECRET');

    const matched = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<OtpCodeRow[]>`
        SELECT id, code_hash, attempts, expires_at FROM otp_codes
        WHERE channel = ${to.channel} AND target = ${to.target} AND purpose = ${purpose}
          AND context IS NOT DISTINCT FROM ${context}::text
          AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE
      `;
      const row = rows[0];
      const candidateHash = hashOtpCode(code, secret);
      const hashesEqual = row ? timingSafeEqualHex(candidateHash, row.code_hash) : false;

      // Pure, unit-tested elsewhere (otp-policy.spec.ts) — see docs/19 §7, §11.
      const outcome = evaluateOtpAttempt(
        row ? { codeHash: row.code_hash, attempts: row.attempts, expiresAt: row.expires_at } : null,
        hashesEqual,
        maxAttempts,
        Date.now(),
      );

      if (outcome.kind === 'wrong_code' && row) {
        await tx.$executeRaw`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ${row.id}::uuid`;
      }
      if (outcome.kind === 'match' && row) {
        await tx.$executeRaw`UPDATE otp_codes SET consumed_at = now() WHERE id = ${row.id}::uuid`;
      }
      return outcome.kind === 'match';
    });

    if (!matched) {
      await this.registerFailedAttempt(to.target);
      await this.audit.log({
        action: 'AUTH_OTP_FAILED',
        entityType: targetKind(to),
        ip,
        metadata: { purpose },
      });
      throw new UnauthorizedException({ code: 'OTP_INVALID', message: 'Invalid or expired code.' });
    }

    await this.clearLock(to.target);
    await this.audit.log({
      action: 'AUTH_OTP_VERIFIED',
      entityType: targetKind(to),
      ip,
      metadata: { purpose },
    });
  }

  /**
   * The durable lock of a phone or address (`auth_target_locks`). Public since
   * FEAT-020: password attempts count on the same lock (SPEC-020-04 R2).
   */
  async assertNotLocked(target: string): Promise<void> {
    const lock = await this.prisma.authTargetLock.findUnique({ where: { target } });
    if (lock?.lockedUntil && lock.lockedUntil.getTime() > Date.now()) {
      await this.audit.log({ action: 'AUTH_OTP_LOCKED', entityType: 'phone', metadata: {} });
      throw new HttpException(
        { code: 'OTP_LOCKED', message: 'Too many failed attempts. Try again later.' },
        423, // WebDAV "Locked" — not in @nestjs/common's HttpStatus enum
      );
    }
  }

  async registerFailedAttempt(target: string): Promise<void> {
    const threshold = await this.platform.getPhoneLockThreshold();
    const durationSeconds = await this.platform.getPhoneLockDurationSeconds();
    const row = await this.prisma.authTargetLock.upsert({
      where: { target },
      create: { target, failedCount: 1 },
      update: { failedCount: { increment: 1 } },
    });
    if (row.failedCount >= threshold) {
      await this.prisma.authTargetLock.update({
        where: { target },
        data: { lockedUntil: new Date(Date.now() + durationSeconds * 1000) },
      });
      this.logger.warn(`OTP target lock engaged after ${row.failedCount} failed attempts`);
    }
  }

  async clearLock(target: string): Promise<void> {
    await this.prisma.authTargetLock.updateMany({
      where: { target },
      data: { failedCount: 0, lockedUntil: null },
    });
  }
}
