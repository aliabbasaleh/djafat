import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppConfigService } from '../../common/config/config.service';
import { AuditService } from '../../common/audit/audit.service';
import { PlatformService } from '../platform/platform.service';
import { generateDeviceToken, hashDeviceToken } from './crypto.util';
import type { RequestMeta } from './auth.service';

/** A device token is 43 base64url characters; anything far longer is not one. */
const MAX_TOKEN_LENGTH = 200;
/** What `label` keeps of the user agent (shown later in a "my devices" list). */
const MAX_LABEL_LENGTH = 200;

/**
 * Devices a customer chose to remember (FEAT-020, SPEC-020-04 R9): on them a
 * password login skips the email code for `trusted_device_ttl_seconds`. The
 * random token goes to the device once; only its HMAC is stored, like a
 * refresh token (docs/19 §14).
 */
@Injectable()
export class TrustedDeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly platform: PlatformService,
    private readonly audit: AuditService,
  ) {}

  async trust(userId: string, meta: RequestMeta): Promise<{ token: string; expiresAt: Date }> {
    const token = generateDeviceToken();
    const ttlSeconds = await this.platform.getTrustedDeviceTtlSeconds();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const row = await this.prisma.trustedDevice.create({
      data: {
        userId,
        tokenHash: this.hash(token),
        label: meta.userAgent ? meta.userAgent.slice(0, MAX_LABEL_LENGTH) : null,
        expiresAt,
      },
      select: { id: true },
    });
    await this.audit.log({
      actorUserId: userId,
      action: 'AUTH_DEVICE_TRUSTED',
      entityType: 'trusted_device',
      entityId: row.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { token, expiresAt };
  }

  /** A live remembered device of THIS account (not expired, not revoked); marks its last use. */
  async isTrusted(userId: string, token: string | null | undefined): Promise<boolean> {
    if (!token || token.length > MAX_TOKEN_LENGTH) return false;
    const now = new Date();
    const result = await this.prisma.trustedDevice.updateMany({
      where: { tokenHash: this.hash(token), userId, revokedAt: null, expiresAt: { gt: now } },
      data: { lastUsedAt: now },
    });
    return result.count > 0;
  }

  /** Password changed or reset (SPEC-020-05 R3, R7): every remembered device asks the code again. */
  async revokeAll(userId: string, reason: string): Promise<number> {
    const result = await this.prisma.trustedDevice.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  private hash(token: string): string {
    return hashDeviceToken(token, this.config.get('REFRESH_TOKEN_HASH_SECRET'));
  }
}
