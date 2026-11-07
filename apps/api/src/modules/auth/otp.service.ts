import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { OtpDeliveryPort } from '@djafat/types';
import { evaluateOtpAttempt } from '@djafat/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppConfigService } from '../../common/config/config.service';
import { AuditService } from '../../common/audit/audit.service';
import { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';
import { PlatformService } from '../platform/platform.service';
import { generateOtpCode, hashOtpCode, timingSafeEqualHex } from './crypto.util';
import { OTP_DELIVERY_PORT, OTP_EMAIL_DELIVERY_PORT } from './otp-delivery.token';

export type OtpPurpose = 'login' | 'register' | 'change_phone' | 'verify_email';

/**
 * Where a code goes (FEAT-007). `target` is an E.164 phone for `sms` and a
 * lower-cased email for `email`. One store, one lock table, one security
 * logic for both channels (migration 0030).
 */
export interface OtpTarget {
  readonly channel: 'sms' | 'email';
  readonly target: string;
}

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
  ) {}

  /** SMS code to a phone (unchanged contract). */
  requestOtp(phone: string, purpose: OtpPurpose, ip: string | null): Promise<void> {
    return this.requestCode({ channel: 'sms', target: phone }, purpose, ip);
  }

  /** SMS code check (unchanged contract). */
  verifyOtp(phone: string, code: string, purpose: OtpPurpose, ip: string | null): Promise<void> {
    return this.verifyCode({ channel: 'sms', target: phone }, code, purpose, ip);
  }

  async requestCode(to: OtpTarget, purpose: OtpPurpose, ip: string | null): Promise<void> {
    if (ip) {
      const ipLimit = await this.platform.getOtpRateLimitPerIp();
      const r = await this.rateLimiter.consume(
        `otp:ip:${ip}`,
        ipLimit.limit,
        ipLimit.windowSeconds,
      );
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
    // Same per-target budget for both channels (setting historically named "per phone").
    const phoneLimit = await this.platform.getOtpRateLimitPerPhone();
    const pr = await this.rateLimiter.consume(
      `otp:${to.channel === 'sms' ? 'phone' : 'email'}:${to.target}`,
      phoneLimit.limit,
      phoneLimit.windowSeconds,
    );
    if (!pr.allowed) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message:
            to.channel === 'sms'
              ? 'Too many codes requested for this number. Try again later.'
              : 'Too many codes requested for this address. Try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.assertNotLocked(to.target);

    const code = generateOtpCode();
    const codeHash = hashOtpCode(code, this.config.get('OTP_HASH_SECRET'));
    const ttlSeconds = await this.platform.getOtpTtlSeconds();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.prisma.otpCode.create({
      data: { target: to.target, channel: to.channel, codeHash, purpose, expiresAt },
    });
    const transport = to.channel === 'sms' ? this.delivery : this.emailDelivery;
    await transport.send({ to: to.target, code, ttlSeconds, locale: 'fr' });

    await this.audit.log({
      action: 'AUTH_OTP_REQUESTED',
      entityType: to.channel === 'sms' ? 'phone' : 'email',
      ip,
      metadata: { purpose }, // phone is the actor here but has no user id yet — kept out of metadata too (not a secret, but unnecessary to duplicate; entityId is reserved for uuids)
    });
  }

  /** Throws on any failure (never reveals WHY — wrong code, expired, exhausted, and "no challenge at all" are indistinguishable). */
  async verifyCode(
    to: OtpTarget,
    code: string,
    purpose: OtpPurpose,
    ip: string | null,
  ): Promise<void> {
    await this.assertNotLocked(to.target);

    const maxAttempts = await this.platform.getOtpMaxAttempts();
    const secret = this.config.get('OTP_HASH_SECRET');

    const matched = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<OtpCodeRow[]>`
        SELECT id, code_hash, attempts, expires_at FROM otp_codes
        WHERE channel = ${to.channel} AND target = ${to.target} AND purpose = ${purpose}
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
        entityType: to.channel === 'sms' ? 'phone' : 'email',
        ip,
        metadata: { purpose },
      });
      throw new UnauthorizedException({ code: 'OTP_INVALID', message: 'Invalid or expired code.' });
    }

    await this.clearLock(to.target);
    await this.audit.log({
      action: 'AUTH_OTP_VERIFIED',
      entityType: to.channel === 'sms' ? 'phone' : 'email',
      ip,
      metadata: { purpose },
    });
  }

  private async assertNotLocked(target: string): Promise<void> {
    const lock = await this.prisma.authTargetLock.findUnique({ where: { target } });
    if (lock?.lockedUntil && lock.lockedUntil.getTime() > Date.now()) {
      await this.audit.log({ action: 'AUTH_OTP_LOCKED', entityType: 'phone', metadata: {} });
      throw new HttpException(
        { code: 'OTP_LOCKED', message: 'Too many failed attempts. Try again later.' },
        423, // WebDAV "Locked" — not in @nestjs/common's HttpStatus enum
      );
    }
  }

  private async registerFailedAttempt(target: string): Promise<void> {
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

  private async clearLock(target: string): Promise<void> {
    await this.prisma.authTargetLock.updateMany({
      where: { target },
      data: { failedCount: 0, lockedUntil: null },
    });
  }
}
