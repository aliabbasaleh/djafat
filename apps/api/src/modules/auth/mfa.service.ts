import { randomBytes } from 'node:crypto';
import { ConflictException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { generateTotpSecretBase32, buildTotpEnrollmentUri, verifyTotp } from '@djafat/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppConfigService } from '../../common/config/config.service';
import { AuditService } from '../../common/audit/audit.service';
import { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';
import { PlatformService } from '../platform/platform.service';
import { decryptMfaSecret, encryptMfaSecret } from './crypto.util';

const TOTP_ISSUER = 'DJAFAT';

export interface SetupResult {
  /** Plaintext — returned exactly once, at enrollment time, never persisted or logged. */
  readonly secretBase32: string;
  readonly enrollmentUri: string;
}

/**
 * TOTP MFA for admin/super_admin (docs/05 §5.4, docs/19 §22-§23). ONE
 * endpoint (`POST /v1/auth/mfa/verify`, docs/07) does double duty, matching
 * the already-documented API surface: it CONFIRMS a pending enrollment the
 * first time it succeeds, and opens the step-up window every time after —
 * both are "prove you hold the TOTP secret right now", just at different
 * account lifecycle points.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly rateLimiter: RateLimiterService,
    private readonly platform: PlatformService,
  ) {}

  async isEnabled(userId: string): Promise<boolean> {
    const row = await this.prisma.mfaTotpSecret.findUnique({ where: { userId } });
    return row?.enabled ?? false;
  }

  /**
   * First-time enrollment only. Re-enrollment (changing device) must go
   * through `disable()` first — `disable` is step-up-gated at the guard
   * level, so a hijacked-but-not-yet-step-up session can never silently
   * swap out an admin's active MFA secret (docs/19 §22 dette).
   */
  async setup(userId: string): Promise<SetupResult> {
    const existing = await this.prisma.mfaTotpSecret.findUnique({ where: { userId } });
    if (existing?.enabled) {
      throw new ConflictException({
        code: 'VALIDATION_ERROR',
        message:
          'MFA is already enabled for this account. Disable it (step-up required) before re-enrolling.',
      });
    }

    const secretBase32 = generateTotpSecretBase32(randomBytes(20));
    const secretEncrypted = encryptMfaSecret(secretBase32, this.config.get('MFA_ENCRYPTION_KEY'));

    await this.prisma.mfaTotpSecret.upsert({
      where: { userId },
      create: { userId, secretEncrypted, enabled: false },
      update: { secretEncrypted, enabled: false, confirmedAt: null },
    });

    await this.audit.log({
      actorUserId: userId,
      action: 'AUTH_MFA_ENROLLED',
      entityType: 'user',
      entityId: userId,
    });

    return {
      secretBase32,
      enrollmentUri: buildTotpEnrollmentUri({
        secretBase32,
        accountLabel: userId,
        issuer: TOTP_ISSUER,
      }),
    };
  }

  /**
   * Verifies `code` against the user's TOTP secret. Confirms a pending
   * enrollment on first success; on an already-enabled account, this IS the
   * step-up check (docs/19 §23) — caller marks the session accordingly.
   */
  async verify(userId: string, code: string): Promise<{ justEnabled: boolean }> {
    await this.assertNotRateLimited(userId);

    const row = await this.prisma.mfaTotpSecret.findUnique({ where: { userId } });
    if (!row) {
      throw new ConflictException({
        code: 'VALIDATION_ERROR',
        message: 'No MFA enrollment in progress — call /auth/mfa/setup first.',
      });
    }

    const secret = decryptMfaSecret(row.secretEncrypted, this.config.get('MFA_ENCRYPTION_KEY'));
    const result = await verifyTotp(secret, code);

    if (!result.valid) {
      await this.audit.log({
        actorUserId: userId,
        action: 'AUTH_MFA_FAILED',
        entityType: 'user',
        entityId: userId,
      });
      throw new ConflictException({ code: 'MFA_INVALID', message: 'Invalid MFA code.' });
    }

    if (!row.enabled) {
      await this.prisma.mfaTotpSecret.update({
        where: { userId },
        data: { enabled: true, confirmedAt: new Date() },
      });
      await this.audit.log({
        actorUserId: userId,
        action: 'AUTH_MFA_ENABLED',
        entityType: 'user',
        entityId: userId,
      });
      return { justEnabled: true };
    }

    await this.audit.log({
      actorUserId: userId,
      action: 'AUTH_STEP_UP_VERIFIED',
      entityType: 'user',
      entityId: userId,
      stepUpVerified: true,
    });
    return { justEnabled: false };
  }

  /**
   * Throttles step-up verification per USER (docs/31 §5.2). Keyed by userId,
   * not phone/IP: this route is already authenticated, so the attacker a
   * step-up is defending against is one holding a valid session — their
   * userId is the only stable identifier, and an IP key would be trivially
   * rotated.
   *
   * Reuses the EXISTING first-line limiter (`otp.service.ts`'s precedent) and
   * a `platform_settings` default, so the threshold is tunable at runtime with
   * no deploy and no migration. One architectural caveat, deliberately
   * recorded rather than hidden: `RateLimiterService.consume` fails OPEN on a
   * Redis outage (docs/15 AD-08 — Redis is never the durable barrier). For
   * OTP that is safe because `phone_auth_locks` (Postgres) sits behind it;
   * here there is NO durable layer yet, so a Redis outage restores the
   * un-throttled state. Adding one would mean an additive migration on
   * `mfa_totp_secrets`, which cannot be verified in an environment without
   * Postgres — see docs/31 §5.2 for the residual risk.
   */
  private async assertNotRateLimited(userId: string): Promise<void> {
    const { limit, windowSeconds } = await this.platform.getMfaVerifyRateLimitPerUser();
    const result = await this.rateLimiter.consume(`mfa:verify:${userId}`, limit, windowSeconds);
    if (result.allowed) return;

    // Audited with the SAME action as a wrong code, distinguished by `reason`:
    // a burst of these IS the brute-force signal, and reusing the existing
    // action keeps `AuditAction` (and the audit consumers) unchanged.
    await this.audit.log({
      actorUserId: userId,
      action: 'AUTH_MFA_FAILED',
      entityType: 'user',
      entityId: userId,
      metadata: { reason: 'rate_limited', limit, windowSeconds },
    });
    throw new HttpException(
      {
        code: 'RATE_LIMITED',
        message: 'Too many MFA attempts. Try again later.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** Step-up gated at the controller (`@RequireStepUp()`) — see class doc. */
  async disable(userId: string): Promise<void> {
    await this.prisma.mfaTotpSecret.deleteMany({ where: { userId } });
    await this.audit.log({
      actorUserId: userId,
      action: 'AUTH_MFA_DISABLED',
      entityType: 'user',
      entityId: userId,
    });
  }
}
