import { describe, expect, it, vi } from 'vitest';
import { TrustedDeviceService } from './trusted-device.service';
import { hashDeviceToken } from './crypto.util';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AppConfigService } from '../../common/config/config.service';
import type { PlatformService } from '../platform/platform.service';
import type { AuditService } from '../../common/audit/audit.service';

// FEAT-020 — docs/features/FEAT-020-compte-email-mot-de-passe (SPEC-020-04 R9).
// Expected outcomes are the spec's; Prisma is an in-memory fake.

const SECRET = 'test-refresh-hash-secret'.padEnd(32, '-');
const META = { ip: '10.0.0.1', userAgent: 'Mozilla/5.0 (Android 14)' };
const DAY = 24 * 3600 * 1000;

interface Row {
  id: string;
  userId: string;
  tokenHash: string;
  label: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  lastUsedAt: Date | null;
}

type Where = Partial<{
  tokenHash: string;
  userId: string;
  revokedAt: null;
  expiresAt: { gt: Date };
}>;

function matches(row: Row, where: Where): boolean {
  if (where.tokenHash !== undefined && row.tokenHash !== where.tokenHash) return false;
  if (where.userId !== undefined && row.userId !== where.userId) return false;
  if (where.revokedAt === null && row.revokedAt !== null) return false;
  if (where.expiresAt && !(row.expiresAt.getTime() > where.expiresAt.gt.getTime())) return false;
  return true;
}

function build() {
  const rows: Row[] = [];
  const prisma = {
    trustedDevice: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<Row, 'id' | 'revokedAt' | 'revokedReason' | 'lastUsedAt'>;
        }) => {
          const row: Row = {
            id: `dev-${rows.length + 1}`,
            revokedAt: null,
            revokedReason: null,
            lastUsedAt: null,
            ...data,
          };
          rows.push(row);
          return { id: row.id };
        },
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<Row> }) => {
        const hit = rows.filter((r) => matches(r, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      }),
    },
  } as unknown as PrismaService;
  const config = {
    get: (k: string) => (k === 'REFRESH_TOKEN_HASH_SECRET' ? SECRET : undefined),
  } as unknown as AppConfigService;
  const platform = {
    getTrustedDeviceTtlSeconds: vi.fn(async () => 30 * 24 * 3600),
  } as unknown as PlatformService;
  const audit = { log: vi.fn(async () => undefined) } as unknown as AuditService;
  return { devices: new TrustedDeviceService(prisma, config, platform, audit), rows, audit };
}

describe('SPEC-020-04 — remembered devices', () => {
  // SPEC-020-04-SC03
  it('SPEC-020-04-SC03 — trusting a device returns a token valid 30 days, stores only its HMAC, and audits', async () => {
    const { devices, rows, audit } = build();
    const before = Date.now();
    const { token, expiresAt } = await devices.trust('u-awa', META);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(30 * DAY - 1000);
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(30 * DAY + 1000);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(hashDeviceToken(token, SECRET));
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'u-awa',
        action: 'AUTH_DEVICE_TRUSTED',
        entityType: 'trusted_device',
      }),
    );
    expect(await devices.isTrusted('u-awa', token)).toBe(true);
    expect(rows[0]?.lastUsedAt).toBeInstanceOf(Date);
  });

  // SPEC-020-04-SC07
  it('SPEC-020-04-SC07 — an expired, a revoked, another account’s or a malformed token is not trusted', async () => {
    const { devices, rows } = build();
    const expired = await devices.trust('u-awa', META);
    if (rows[0]) rows[0].expiresAt = new Date(Date.now() - 1000);
    const revoked = await devices.trust('u-awa', META);
    await devices.revokeAll('u-awa', 'password_changed');
    const other = await devices.trust('u-bob', META);

    expect(await devices.isTrusted('u-awa', expired.token)).toBe(false);
    expect(await devices.isTrusted('u-awa', revoked.token)).toBe(false);
    expect(await devices.isTrusted('u-awa', other.token)).toBe(false);
    expect(await devices.isTrusted('u-awa', undefined)).toBe(false);
    expect(await devices.isTrusted('u-awa', 'x'.repeat(500))).toBe(false);
    // The other account's device is still trusted for its own account.
    expect(await devices.isTrusted('u-bob', other.token)).toBe(true);
  });
});
