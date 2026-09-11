import { describe, expect, it, vi } from 'vitest';
import { ConflictException, type HttpException } from '@nestjs/common';
import { totpCodeAt } from '@djafat/core';
import { MfaService } from './mfa.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AppConfigService } from '../../common/config/config.service';
import type { AuditService } from '../../common/audit/audit.service';

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

describe('MfaService', () => {
  it('setup() generates a fresh secret and returns it in plaintext exactly once', async () => {
    const prisma = makePrismaStub();
    const audit = auditStub();
    const svc = new MfaService(prisma, configStub, audit);
    const result = await svc.setup('u1');
    expect(result.secretBase32).toMatch(/^[A-Z2-7]+$/); // base32
    expect(result.enrollmentUri).toContain('otpauth://totp/');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_MFA_ENROLLED' }),
    );
  });

  it('setup() persists the secret ENCRYPTED, never in plaintext', async () => {
    const prisma = makePrismaStub();
    const svc = new MfaService(prisma, configStub, auditStub());
    const result = await svc.setup('u1');
    const stored = (
      prisma as unknown as { __getRow: () => { secretEncrypted: string } | null }
    ).__getRow();
    expect(stored!.secretEncrypted).not.toContain(result.secretBase32);
  });

  it('setup() REFUSES to overwrite an already-enabled MFA secret', async () => {
    const prisma = makePrismaStub({ secretEncrypted: 'irrelevant', enabled: true });
    const svc = new MfaService(prisma, configStub, auditStub());
    await expect(svc.setup('u1')).rejects.toThrow(ConflictException);
  });

  it('verify() confirms a pending enrollment on the first correct code', async () => {
    const prisma = makePrismaStub();
    const audit = auditStub();
    const svc = new MfaService(prisma, configStub, audit);
    const { secretBase32 } = await svc.setup('u1');
    const code = await totpCodeAt(secretBase32, Date.now());

    const result = await svc.verify('u1', code);
    expect(result).toEqual({ justEnabled: true });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'AUTH_MFA_ENABLED' }));
  });

  it('verify() on an ALREADY-enabled account is a step-up check, not a re-confirmation', async () => {
    const prisma = makePrismaStub();
    const svc = new MfaService(prisma, configStub, auditStub());
    const { secretBase32 } = await svc.setup('u1');
    await svc.verify('u1', await totpCodeAt(secretBase32, Date.now())); // confirms it

    const audit = auditStub();
    const svc2 = new MfaService(prisma, configStub, audit);
    const result = await svc2.verify('u1', await totpCodeAt(secretBase32, Date.now()));
    expect(result).toEqual({ justEnabled: false });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_STEP_UP_VERIFIED', stepUpVerified: true }),
    );
  });

  it('verify() REJECTS a wrong code (MFA_INVALID) and logs AUTH_MFA_FAILED', async () => {
    const prisma = makePrismaStub();
    const audit = auditStub();
    const svc = new MfaService(prisma, configStub, audit);
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
    const svc = new MfaService(prisma, configStub, auditStub());
    await expect(svc.verify('u1', '123456')).rejects.toThrow(ConflictException);
  });

  it('disable() removes the secret and logs AUTH_MFA_DISABLED', async () => {
    const prisma = makePrismaStub({ secretEncrypted: 'x', enabled: true });
    const audit = auditStub();
    const svc = new MfaService(prisma, configStub, audit);
    expect(await svc.isEnabled('u1')).toBe(true);
    await svc.disable('u1');
    expect(await svc.isEnabled('u1')).toBe(false);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_MFA_DISABLED' }),
    );
  });

  it('isEnabled() is false when no row exists', async () => {
    const prisma = makePrismaStub();
    const svc = new MfaService(prisma, configStub, auditStub());
    expect(await svc.isEnabled('u1')).toBe(false);
  });
});
