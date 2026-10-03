import { describe, expect, it, vi } from 'vitest';
import { ConflictException, type HttpException } from '@nestjs/common';
import { totpCodeAt } from '@djafat/core';
import { MfaService } from './mfa.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AppConfigService } from '../../common/config/config.service';
import type { AuditService } from '../../common/audit/audit.service';
import type { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';
import type { PlatformService } from '../platform/platform.service';

const MFA_KEY_B64 = Buffer.alloc(32, 3).toString('base64');

function makePrismaStub(initial?: { secretEncrypted: string; enabled: boolean }) {
  let row = initial ? { userId: 'u1', ...initial, confirmedAt: null as Date | null } : null;
  return {
    mfaTotpSecret: {
      findUnique: vi.fn(async () => row),
      upsert: vi.fn(
        async ({
          create,
          update,
        }: {
          create: typeof row;
          update: Partial<NonNullable<typeof row>>;
        }) => {
          row = row ? ({ ...row, ...update } as typeof row) : (create as typeof row);
          return row;
        },
      ),
      update: vi.fn(async ({ data }: { data: Partial<NonNullable<typeof row>> }) => {
        row = { ...row!, ...data };
        return row;
      }),
      deleteMany: vi.fn(async () => {
        row = null;
        return { count: 1 };
      }),
    },
    __getRow: () => row,
  } as unknown as PrismaService & { __getRow: () => typeof row };
}

const configStub = { get: () => MFA_KEY_B64 } as unknown as AppConfigService;
const auditStub = () => ({ log: vi.fn().mockResolvedValue(undefined) }) as unknown as AuditService;

/** Allows by default — the brute-force throttle (docs/31 §5.2) is exercised explicitly below. */
const limiterStub = (allowed = true) =>
  ({
    consume: vi
      .fn()
      .mockResolvedValue({ allowed, remaining: allowed ? 4 : 0, resetAt: new Date() }),
  }) as unknown as RateLimiterService;

const platformStub = () =>
  ({
    getMfaVerifyRateLimitPerUser: vi.fn().mockResolvedValue({ limit: 5, windowSeconds: 300 }),
  }) as unknown as PlatformService;

describe('MfaService', () => {
  it('setup() generates a fresh secret and returns it in plaintext exactly once', async () => {
    const prisma = makePrismaStub();
    const audit = auditStub();
    const svc = new MfaService(prisma, configStub, audit, limiterStub(), platformStub());
    const result = await svc.setup('u1');
    expect(result.secretBase32).toMatch(/^[A-Z2-7]+$/); // base32
    expect(result.enrollmentUri).toContain('otpauth://totp/');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_MFA_ENROLLED' }),
    );
  });

  it('setup() persists the secret ENCRYPTED, never in plaintext', async () => {
    const prisma = makePrismaStub();
    const svc = new MfaService(prisma, configStub, auditStub(), limiterStub(), platformStub());
    const result = await svc.setup('u1');
    const stored = (
      prisma as unknown as { __getRow: () => { secretEncrypted: string } | null }
    ).__getRow();
    expect(stored!.secretEncrypted).not.toContain(result.secretBase32);
  });

  it('setup() REFUSES to overwrite an already-enabled MFA secret', async () => {
    const prisma = makePrismaStub({ secretEncrypted: 'irrelevant', enabled: true });
    const svc = new MfaService(prisma, configStub, auditStub(), limiterStub(), platformStub());
    await expect(svc.setup('u1')).rejects.toThrow(ConflictException);
  });

  it('verify() confirms a pending enrollment on the first correct code', async () => {
    const prisma = makePrismaStub();
    const audit = auditStub();
    const svc = new MfaService(prisma, configStub, audit, limiterStub(), platformStub());
    const { secretBase32 } = await svc.setup('u1');
    const code = await totpCodeAt(secretBase32, Date.now());

    const result = await svc.verify('u1', code);
    expect(result).toEqual({ justEnabled: true });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'AUTH_MFA_ENABLED' }));
  });

  it('verify() on an ALREADY-enabled account is a step-up check, not a re-confirmation', async () => {
    const prisma = makePrismaStub();
    const svc = new MfaService(prisma, configStub, auditStub(), limiterStub(), platformStub());
    const { secretBase32 } = await svc.setup('u1');
    await svc.verify('u1', await totpCodeAt(secretBase32, Date.now())); // confirms it

    const audit = auditStub();
    const svc2 = new MfaService(prisma, configStub, audit, limiterStub(), platformStub());
    const result = await svc2.verify('u1', await totpCodeAt(secretBase32, Date.now()));
    expect(result).toEqual({ justEnabled: false });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_STEP_UP_VERIFIED', stepUpVerified: true }),
    );
  });

  it('verify() REJECTS a wrong code (MFA_INVALID) and logs AUTH_MFA_FAILED', async () => {
    const prisma = makePrismaStub();
    const audit = auditStub();
    const svc = new MfaService(prisma, configStub, audit, limiterStub(), platformStub());
    await svc.setup('u1');
    try {
      await svc.verify('u1', '000000');
      expect.unreachable();
    } catch (e) {
      expect((e as HttpException).getResponse()).toMatchObject({ code: 'MFA_INVALID' });
    }
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'AUTH_MFA_FAILED' }));
  });

  it('verify() REJECTS when no enrollment exists at all', async () => {
    const prisma = makePrismaStub();
    const svc = new MfaService(prisma, configStub, auditStub(), limiterStub(), platformStub());
    await expect(svc.verify('u1', '123456')).rejects.toThrow(ConflictException);
  });

  it('disable() removes the secret and logs AUTH_MFA_DISABLED', async () => {
    const prisma = makePrismaStub({ secretEncrypted: 'x', enabled: true });
    const audit = auditStub();
    const svc = new MfaService(prisma, configStub, audit, limiterStub(), platformStub());
    expect(await svc.isEnabled('u1')).toBe(true);
    await svc.disable('u1');
    expect(await svc.isEnabled('u1')).toBe(false);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_MFA_DISABLED' }),
    );
  });

  it('isEnabled() is false when no row exists', async () => {
    const prisma = makePrismaStub();
    const svc = new MfaService(prisma, configStub, auditStub(), limiterStub(), platformStub());
    expect(await svc.isEnabled('u1')).toBe(false);
  });
});

/**
 * Brute-force throttle on step-up verification (docs/31 §5.2). Before this,
 * `/auth/mfa/verify` had NO rate limit at all: with a ±1-step TOTP window
 * (3 valid codes out of 10^6), an attacker holding a stolen admin session
 * could grind the second factor and then reach `grantRole`. The limiter is
 * the same first-line service `otp.service.ts` already uses.
 */
describe('MfaService.verify — brute-force throttle', () => {
  it('rejects with RATE_LIMITED (429) once the per-user limit is exhausted', async () => {
    const prisma = makePrismaStub({ secretEncrypted: 'x', enabled: true });
    const svc = new MfaService(prisma, configStub, auditStub(), limiterStub(false), platformStub());
    try {
      await svc.verify('u1', '123456');
      expect.unreachable();
    } catch (e) {
      expect((e as HttpException).getResponse()).toMatchObject({ code: 'RATE_LIMITED' });
      expect((e as HttpException).getStatus()).toBe(429);
    }
  });

  it('throttles BEFORE touching the secret — a rate-limited attempt never reaches TOTP comparison', async () => {
    const prisma = makePrismaStub({ secretEncrypted: 'x', enabled: true });
    const svc = new MfaService(prisma, configStub, auditStub(), limiterStub(false), platformStub());
    await expect(svc.verify('u1', '123456')).rejects.toThrow();
    // The secret row is never even read, so a throttled attacker learns nothing
    // and cannot use timing to probe enrollment state.
    expect(prisma.mfaTotpSecret.findUnique).not.toHaveBeenCalled();
  });

  it('audits the throttled attempt as AUTH_MFA_FAILED with reason=rate_limited — a burst IS the brute-force signal', async () => {
    const prisma = makePrismaStub({ secretEncrypted: 'x', enabled: true });
    const audit = auditStub();
    const svc = new MfaService(prisma, configStub, audit, limiterStub(false), platformStub());
    await expect(svc.verify('u1', '123456')).rejects.toThrow();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AUTH_MFA_FAILED',
        metadata: expect.objectContaining({ reason: 'rate_limited' }),
      }),
    );
  });

  it('keys the limit per USER, with the platform-configured limit/window', async () => {
    const prisma = makePrismaStub({ secretEncrypted: 'x', enabled: true });
    const limiter = limiterStub(true);
    const platform = platformStub();
    const svc = new MfaService(prisma, configStub, auditStub(), limiter, platform);
    await expect(svc.verify('u1', '000000')).rejects.toThrow(); // wrong code, but past the throttle
    expect(platform.getMfaVerifyRateLimitPerUser).toHaveBeenCalled();
    expect(limiter.consume).toHaveBeenCalledWith('mfa:verify:u1', 5, 300);
  });

  it('a Redis outage fails OPEN — documented residual risk, not an accident (docs/15 AD-08, docs/31 §5.2)', async () => {
    const prisma = makePrismaStub();
    // The real RateLimiterService swallows Redis errors and returns allowed:true;
    // this pins that MfaService does not add a second, stricter barrier on top.
    const limiter = {
      consume: vi.fn().mockResolvedValue({ allowed: true, remaining: 5, resetAt: new Date() }),
    } as unknown as RateLimiterService;
    const svc = new MfaService(prisma, configStub, auditStub(), limiter, platformStub());
    const { secretBase32 } = await svc.setup('u1');
    await expect(svc.verify('u1', await totpCodeAt(secretBase32, Date.now()))).resolves.toEqual({
      justEnabled: true,
    });
  });
});
