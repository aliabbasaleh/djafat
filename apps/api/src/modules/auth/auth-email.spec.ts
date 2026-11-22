import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import type { OtpService, OtpTarget } from './otp.service';
import type { UserRecord, UsersService } from '../users/users.service';
import type { SessionService } from './session.service';
import type { TokenService } from './token.service';
import type { MfaService } from './mfa.service';
import type { AuditService } from '../../common/audit/audit.service';
import { EmailInputSchema } from './dto/email.schema';

// FEAT-007 — docs/features/FEAT-007-email-login (SPEC-007-02, SPEC-007-03).
// Expected outcomes are the specs'; the collaborators are fakes.

const META = { ip: '10.0.0.1', userAgent: 'test', countryId: null };

function user(over: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'u-awa',
    phone: '+23566000099',
    phoneVerifiedAt: new Date(),
    email: 'awa@example.td',
    fullName: 'Awa',
    countryId: null,
    locale: 'fr',
    status: 'active',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    ...over,
  };
}

function build(
  opts: { verifiedOwner?: UserRecord | null; otpValid?: boolean; emailTaken?: boolean } = {},
) {
  const requested: Array<{ target: OtpTarget; purpose: string }> = [];
  const charged: OtpTarget[] = [];
  const otp = {
    requestCode: vi.fn(async (target: OtpTarget, purpose: string) => {
      requested.push({ target, purpose });
    }),
    // FEAT-020 AC08 (review #4): the budget is charged for any address, a code only for an owner.
    requestCodeIfOwned: vi.fn(
      async (target: OtpTarget, purpose: string, _ip: string | null, owned: boolean) => {
        charged.push(target);
        if (owned) requested.push({ target, purpose });
      },
    ),
    verifyCode: vi.fn(async () => {
      if (opts.otpValid === false) {
        throw new UnauthorizedException({
          code: 'OTP_INVALID',
          message: 'Invalid or expired code.',
        });
      }
    }),
  } as unknown as OtpService;
  const saved: Array<{ userId: string; email: string }> = [];
  const owner = opts.verifiedOwner === undefined ? user() : opts.verifiedOwner;
  const users = {
    findByVerifiedEmail: vi.fn(async (email: string) =>
      owner && owner.email === email ? owner : null,
    ),
    setVerifiedEmail: vi.fn(async (userId: string, email: string) => {
      if (opts.emailTaken) {
        throw new ConflictException({ code: 'EMAIL_ALREADY_USED', message: 'taken' });
      }
      saved.push({ userId, email });
      return user({ id: userId, email });
    }),
    // Fresh read by id: consistent with the account found by email (status included).
    getByIdOrThrow: vi.fn(async (id: string) => (owner && owner.id === id ? owner : user({ id }))),
    getRoles: vi.fn(async () => ['customer']),
    updateLastSeen: vi.fn(async () => undefined),
    toMeDto: vi.fn((u: UserRecord, roles: readonly string[]) => ({
      id: u.id,
      email: u.email,
      roles,
    })),
  } as unknown as UsersService;
  const sessions = {
    createSession: vi.fn(async () => ({
      sessionId: 'sess-1',
      refreshToken: 'refresh-1',
      expiresAt: new Date('2026-12-01T00:00:00Z'),
    })),
  } as unknown as SessionService;
  const tokens = {
    signAccessToken: vi.fn(() => ({
      token: 'access-1',
      expiresAt: new Date('2026-11-07T01:00:00Z'),
    })),
  } as unknown as TokenService;
  const audit = { log: vi.fn(async () => undefined) } as unknown as AuditService;
  const auth = new AuthService(otp, users, sessions, tokens, {} as MfaService, audit);
  return { auth, requested, charged, saved, sessions, audit };
}

describe('SPEC-007-02 — add and verify an email on one’s account', () => {
  // SPEC-007-02-SC01
  it('SPEC-007-02-SC01 — the request normalises the address and asks a verify_email code for it', async () => {
    const parsed = EmailInputSchema.parse('  Awa@Example.TD ');
    expect(parsed).toBe('awa@example.td');
    const { auth, requested } = build();
    await auth.requestEmailVerification('u-awa', '  Awa@Example.TD ', META.ip);
    expect(requested).toEqual([
      { target: { channel: 'email', target: 'awa@example.td' }, purpose: 'verify_email' },
    ]);
  });

  // SPEC-007-02-SC02
  it('SPEC-007-02-SC02 — a valid code stores the address as verified on the account', async () => {
    const { auth, saved } = build();
    const me = await auth.confirmEmailVerification('u-awa', 'awa@example.td', '123456', META.ip);
    expect(saved).toEqual([{ userId: 'u-awa', email: 'awa@example.td' }]);
    expect(me).toMatchObject({ id: 'u-awa', email: 'awa@example.td' });
  });

  // SPEC-007-02-SC03
  it('SPEC-007-02-SC03 — a wrong code is refused with OTP_INVALID and nothing is stored', async () => {
    const { auth, saved } = build({ otpValid: false });
    await expect(
      auth.confirmEmailVerification('u-awa', 'awa@example.td', '000000', META.ip),
    ).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
    expect(saved).toEqual([]);
  });

  // SPEC-007-02-SC04
  it('SPEC-007-02-SC04 — an address already used by another account is refused with EMAIL_ALREADY_USED', async () => {
    const { auth } = build({ emailTaken: true });
    await expect(
      auth.confirmEmailVerification('u-other', 'awa@example.td', '123456', META.ip),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'EMAIL_ALREADY_USED' },
    });
  });

  it('rejects an invalid address at the schema level', () => {
    for (const bad of ['', 'awa', 'awa@', '@example.td', `${'a'.repeat(250)}@x.td`]) {
      expect(EmailInputSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('SPEC-007-03 — log in with a code received by email', () => {
  // SPEC-007-03-SC01
  it('SPEC-007-03-SC01 — a verified address gets a login code (address normalised)', async () => {
    const { auth, requested } = build();
    await auth.requestEmailLogin('AWA@example.td', META.ip);
    expect(requested).toEqual([
      { target: { channel: 'email', target: 'awa@example.td' }, purpose: 'login' },
    ]);
  });

  // SPEC-007-03-SC02
  it('SPEC-007-03-SC02 — unknown or unverified address: succeeds silently, no code requested', async () => {
    const unknown = build({ verifiedOwner: null });
    await expect(
      unknown.auth.requestEmailLogin('nobody@example.td', META.ip),
    ).resolves.toBeUndefined();
    expect(unknown.requested).toEqual([]);
    // FEAT-020 AC08: the same budget as a known address — nothing tells them apart.
    expect(unknown.charged).toEqual([{ channel: 'email', target: 'nobody@example.td' }]);
  });

  // SPEC-007-03-SC03
  it('SPEC-007-03-SC03 — a valid code opens a session on the owning account', async () => {
    const { auth, sessions, audit } = build();
    const result = await auth.verifyEmailAndLogin('awa@example.td', '123456', META);
    expect(sessions.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-awa' }),
    );
    expect(result).toMatchObject({
      access: 'access-1',
      refresh: 'refresh-1',
      user: { id: 'u-awa' },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_LOGIN_SUCCESS' }),
    );
  });

  // SPEC-007-03-SC04
  it('SPEC-007-03-SC04 — an inactive account is refused with ACCOUNT_INACTIVE and no session', async () => {
    const { auth, sessions } = build({ verifiedOwner: user({ status: 'suspended' }) });
    await expect(auth.verifyEmailAndLogin('awa@example.td', '123456', META)).rejects.toMatchObject({
      response: { code: 'ACCOUNT_INACTIVE' },
    });
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  // SPEC-007-03-SC05
  it('SPEC-007-03-SC05 — wrong code, or valid code for an address no longer verified anywhere: OTP_INVALID, no session', async () => {
    const wrong = build({ otpValid: false });
    await expect(
      wrong.auth.verifyEmailAndLogin('awa@example.td', '000000', META),
    ).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
    expect(wrong.sessions.createSession).not.toHaveBeenCalled();

    const orphan = build({ verifiedOwner: null });
    await expect(
      orphan.auth.verifyEmailAndLogin('awa@example.td', '123456', META),
    ).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
    expect(orphan.sessions.createSession).not.toHaveBeenCalled();
  });
});
