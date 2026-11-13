import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import type { OtpService } from './otp.service';
import type { UserRecord, UsersService } from '../users/users.service';
import type { SessionService } from './session.service';
import type { TokenService } from './token.service';
import type { MfaService } from './mfa.service';
import type { AuditService } from '../../common/audit/audit.service';

// FEAT-008 — docs/features/FEAT-008-whatsapp-login (SPEC-008-03).

const META = { ip: '10.0.0.1', userAgent: 'test', countryId: null };
const PHONE = '+23566123456'; // fictitious

function user(over: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'u-moussa',
    phone: PHONE,
    phoneVerifiedAt: null,
    email: null,
    fullName: null,
    countryId: null,
    locale: 'fr',
    status: 'active',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    ...over,
  };
}

function build(opts: { otpValid?: boolean; status?: UserRecord['status'] } = {}) {
  const otp = {
    verifyCode: vi.fn(async () => {
      if (opts.otpValid === false) {
        throw new UnauthorizedException({
          code: 'OTP_INVALID',
          message: 'Invalid or expired code.',
        });
      }
    }),
  } as unknown as OtpService;
  const account = user({ status: opts.status ?? 'active' });
  const users = {
    findOrCreateByPhone: vi.fn(async () => ({ userId: account.id, isNew: true })),
    markPhoneVerified: vi.fn(async () => undefined),
    getByIdOrThrow: vi.fn(async () => account),
    getRoles: vi.fn(async () => ['customer']),
    updateLastSeen: vi.fn(async () => undefined),
    toMeDto: vi.fn((u: UserRecord, roles: readonly string[]) => ({
      id: u.id,
      phone: u.phone,
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
  return { auth, otp, users, sessions };
}

describe('SPEC-008-03 — log in with the code received on WhatsApp', () => {
  // SPEC-008-03-SC01
  it('SPEC-008-03-SC01 — a valid code is checked on the whatsapp channel; the account is found or created, verified, and a session opened', async () => {
    const { auth, otp, users, sessions } = build();
    const result = await auth.verifyWhatsappAndLogin(PHONE, '482913', META);
    expect(otp.verifyCode).toHaveBeenCalledWith(
      { channel: 'whatsapp', target: PHONE },
      '482913',
      'login',
      META.ip,
    );
    expect(users.findOrCreateByPhone).toHaveBeenCalledWith(PHONE, null);
    expect(users.markPhoneVerified).toHaveBeenCalledWith('u-moussa');
    expect(sessions.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-moussa' }),
    );
    expect(result).toMatchObject({
      access: 'access-1',
      refresh: 'refresh-1',
      user: { id: 'u-moussa' },
    });
  });

  // SPEC-008-03-SC02
  it('SPEC-008-03-SC02 — a wrong code is refused with OTP_INVALID and no session', async () => {
    const { auth, users, sessions } = build({ otpValid: false });
    await expect(auth.verifyWhatsappAndLogin(PHONE, '000000', META)).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
    expect(users.findOrCreateByPhone).not.toHaveBeenCalled();
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  // SPEC-008-03-SC03
  it('SPEC-008-03-SC03 — an inactive account is refused with ACCOUNT_INACTIVE and no session', async () => {
    const { auth, sessions } = build({ status: 'suspended' });
    await expect(auth.verifyWhatsappAndLogin(PHONE, '482913', META)).rejects.toMatchObject({
      response: { code: 'ACCOUNT_INACTIVE' },
    });
    expect(sessions.createSession).not.toHaveBeenCalled();
  });
});
