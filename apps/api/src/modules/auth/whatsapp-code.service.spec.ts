import { HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  account,
  asDevices,
  asOtp,
  asUsers,
  fakeAudit,
  fakeChallenges,
  fakeConfig,
  fakeDevices,
  fakeNotices,
  fakeOtp,
  fakePlatform,
  fakeRateLimiter,
  fakeSessions,
  fakeUsers,
  realAuth,
  type Account,
} from './account-test-support';
import type * as CryptoUtil from './crypto.util';
import { generateOtpCode, hashOtpCode, hashWhatsappToken } from './crypto.util';
import { hashPassword } from './password-hash.util';
import { PasswordService } from './password.service';
import { accountNoticeMessage } from './providers/account-notice-text';
import { WhatsappCodeService } from './whatsapp-code.service';
import { fakeWhatsappCodes, prismaWith } from './whatsapp-test-support';

// FEAT-023 — docs/features/FEAT-023-whatsapp-gratuit (SPEC-023-01 to 04).
// Numbers are fictitious.

vi.mock('./crypto.util', async (importOriginal) => {
  const actual = await importOriginal<typeof CryptoUtil>();
  return { ...actual, generateOtpCode: vi.fn(actual.generateOtpCode) };
});

const SECRET = 'otp-hash-secret-for-tests';
const BUSINESS = '+23566868973';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const SCREEN = { ip: '10.0.0.9', userAgent: ANDROID_CHROME };
const LOGIN_TEXT = (code: string) =>
  `Je me connecte à DJAFAT : ${code} (n'envoyez ce code que pour vous connecter vous-même)`;

/** A number confirmed long ago, an e-mail verified: the usual customer since FEAT-020. */
const confirmed = (over: Partial<Account> = {}) =>
  account({ phoneVerifiedAt: new Date('2026-11-20T10:00:00Z'), ...over });

function build(opts: { accounts?: Account[]; config?: Record<string, unknown> } = {}) {
  const otp = fakeOtp();
  const users = fakeUsers(opts.accounts ?? []);
  const sessions = fakeSessions();
  const audit = fakeAudit();
  const auth = realAuth(otp, users, sessions, audit.service);
  const devices = fakeDevices();
  const notices = fakeNotices();
  const challenges = fakeChallenges();
  const codes = fakeWhatsappCodes();
  const prisma = prismaWith({
    authChallenge: (challenges.prisma as unknown as { authChallenge: unknown }).authChallenge,
    whatsappCode: codes.whatsappCode,
  });
  const config = fakeConfig({
    WHATSAPP_PROVIDER: 'cloud',
    WHATSAPP_BUSINESS_NUMBER: BUSINESS,
    OTP_HASH_SECRET: SECRET,
    ...opts.config,
  });
  const service = new WhatsappCodeService(
    prisma,
    asOtp(otp),
    asUsers(users),
    auth,
    asDevices(devices),
    fakePlatform(),
    config,
    audit.service,
    notices,
  );
  /** A password login waiting for its new device's code (SPEC-020-04 R5). */
  const pendingLogin = async (userId: string, expiresAt = new Date(Date.now() + 10 * 60_000)) =>
    (
      await (
        challenges.prisma as unknown as {
          authChallenge: {
            create: (a: { data: Record<string, unknown> }) => Promise<{ id: string }>;
          };
        }
      ).authChallenge.create({
        data: { kind: 'password_login', userId, email: 'awa@example.td', expiresAt },
      })
    ).id;
  return {
    service,
    otp,
    users,
    sessions,
    audit,
    devices,
    notices,
    challenges,
    codes,
    config,
    pendingLogin,
  };
}

/** The alert e-mail leaves in the background: let it run. */
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

afterEach(() => {
  vi.useRealTimers();
});

describe('SPEC-023-01 — the code to send on WhatsApp', () => {
  // SPEC-023-01-SC01
  it('SPEC-023-01-SC01 — a login code: the message with the warning, the wa.me link, 5 minutes, a token; nothing in clear', async () => {
    const { service, codes } = build();
    const before = Date.now();
    const out = await service.startLogin({}, SCREEN);

    expect(out.code).toMatch(/^\d{6}$/);
    expect(out.text).toBe(LOGIN_TEXT(out.code));
    expect(out.link).toBe(`https://wa.me/23566868973?text=${encodeURIComponent(out.text)}`);
    expect(out.number).toBe(BUSINESS);
    const validity = Date.parse(out.expiresAt) - before;
    expect(validity).toBeGreaterThan(299_000);
    expect(validity).toBeLessThanOrEqual(301_000);
    expect(out.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(codes.rows).toHaveLength(1);
    const row = codes.rows[0]!;
    expect(row.purpose).toBe('login');
    expect(row.codeHash).toBe(hashOtpCode(out.code, SECRET));
    expect(row.tokenHash).toBe(hashWhatsappToken(out.token, SECRET));
    expect(Object.values(row)).not.toContain(out.code);
    expect(Object.values(row)).not.toContain(out.token);
  });

  // SPEC-023-01-SC02
  it('SPEC-023-01-SC02 — WhatsApp off (no number, or the mock in production): 503 WHATSAPP_UNAVAILABLE, nothing created', async () => {
    for (const config of [
      { WHATSAPP_BUSINESS_NUMBER: undefined },
      { WHATSAPP_PROVIDER: 'mock', NODE_ENV: 'production' },
    ]) {
      const t = build({ config, accounts: [account()] });
      await expect(t.service.startLogin({}, SCREEN)).rejects.toMatchObject({
        status: 503,
        response: { code: 'WHATSAPP_UNAVAILABLE' },
      });
      await expect(t.service.startPhoneConfirmation('u-awa', SCREEN)).rejects.toMatchObject({
        status: 503,
        response: { code: 'WHATSAPP_UNAVAILABLE' },
      });
      expect(t.codes.rows).toHaveLength(0);
      expect(t.otp.consumeIpBudget).not.toHaveBeenCalled();
    }
  });

  // SPEC-023-01-SC03
  it('SPEC-023-01-SC03 — the same draw as a waiting code: another code is drawn, the two codes differ', async () => {
    const { service, codes } = build();
    vi.mocked(generateOtpCode)
      .mockReturnValueOnce('111111')
      .mockReturnValueOnce('111111')
      .mockReturnValueOnce('222222');
    const first = await service.startLogin({}, SCREEN);
    const second = await service.startLogin({}, SCREEN);
    expect(first.code).toBe('111111');
    expect(second.code).toBe('222222');
    expect(codes.whatsappCode.create).toHaveBeenCalledTimes(3);
    expect(codes.rows).toHaveLength(2);
  });

  // SPEC-023-01-SC04
  it('SPEC-023-01-SC04 — a new device: the login message, valid as long as the pending login; 401 and 409 otherwise', async () => {
    const t = build({
      accounts: [
        confirmed(),
        account({ id: 'u-ali', phone: '+23566000088', email: 'ali@example.td' }),
      ],
    });
    const expiresAt = new Date(Date.now() + 2 * 60_000);
    const challengeId = await t.pendingLogin('u-awa', expiresAt);
    const out = await t.service.startLogin({ challengeId }, SCREEN);
    expect(out.text).toBe(LOGIN_TEXT(out.code));
    expect(out.expiresAt).toBe(expiresAt.toISOString());
    expect(t.codes.rows[0]).toMatchObject({
      purpose: 'login_device',
      userId: 'u-awa',
      challengeId,
    });

    await expect(
      t.service.startLogin({ challengeId: '00000000-0000-4000-8000-999999999999' }, SCREEN),
    ).rejects.toMatchObject({ status: 401, response: { code: 'OTP_INVALID' } });
    const unconfirmed = await t.pendingLogin('u-ali');
    await expect(t.service.startLogin({ challengeId: unconfirmed }, SCREEN)).rejects.toMatchObject({
      status: 409,
      response: { code: 'PHONE_NOT_CONFIRMED' },
    });
  });

  // SPEC-023-01-SC05
  it('SPEC-023-01-SC05 — confirming a number: the confirmation message; already confirmed: 409 PHONE_ALREADY_CONFIRMED', async () => {
    const t = build({ accounts: [account(), confirmed({ id: 'u-ali', phone: '+23566000088' })] });
    const out = await t.service.startPhoneConfirmation('u-awa', SCREEN);
    expect(out.text).toBe(
      `Je confirme mon numéro sur DJAFAT : ${out.code} (n'envoyez ce code que pour votre propre compte)`,
    );
    expect(t.codes.rows[0]).toMatchObject({ purpose: 'verify_phone', userId: 'u-awa' });
    expect(t.otp.consumePhoneBudget).toHaveBeenCalledWith('+23566000099');

    await expect(t.service.startPhoneConfirmation('u-ali', SCREEN)).rejects.toMatchObject({
      status: 409,
      response: { code: 'PHONE_ALREADY_CONFIRMED' },
    });
  });

  // SPEC-023-01-SC06
  it('SPEC-023-01-SC06 — the network budget spent: 429 RATE_LIMITED, nothing created', async () => {
    const t = build();
    t.otp.consumeIpBudget.mockRejectedValueOnce(
      new HttpException({ code: 'RATE_LIMITED', message: 'Too many requests' }, 429),
    );
    await expect(t.service.startLogin({}, SCREEN)).rejects.toMatchObject({
      status: 429,
      response: { code: 'RATE_LIMITED' },
    });
    expect(t.codes.rows).toHaveLength(0);
  });
});

describe('SPEC-023-02 — the customer’s message arrives', () => {
  // SPEC-023-02-SC01
  it('SPEC-023-02-SC01 — a login code from the confirmed number: kept for the screen with its sender', async () => {
    const t = build({ accounts: [confirmed({ phone: '+23566123456' })] });
    const { code } = await t.service.startLogin({}, SCREEN);
    await expect(t.service.receive({ from: '+23566123456', code })).resolves.toBe('matched');
    expect(t.codes.rows[0]).toMatchObject({
      senderPhone: '+23566123456',
      outcome: 'matched',
      matchedUserId: 'u-awa',
    });
    expect(t.codes.rows[0]!.receivedAt).toBeInstanceOf(Date);
  });

  // SPEC-023-02-SC02 — also SPEC-024-01 R7: WhatsApp has no country rule.
  it('SPEC-023-02-SC02 — SPEC-024-01 R7 — a confirmed foreign number logs in by WhatsApp', async () => {
    const t = build({ accounts: [confirmed({ phone: '+33612345678' })] });
    const { code } = await t.service.startLogin({}, SCREEN);
    await expect(t.service.receive({ from: '+33612345678', code })).resolves.toBe('matched');
    expect(t.codes.rows[0]).toMatchObject({ outcome: 'matched', matchedUserId: 'u-awa' });
  });

  // SPEC-023-02-SC03
  it('SPEC-023-02-SC03 — a number on no account, or typed on an e-mail account: « confirmed on no account », the same answer, no account created', async () => {
    const t = build({ accounts: [account({ phone: '+23566000099' })] }); // e-mail account, number typed only
    const first = await t.service.startLogin({}, SCREEN);
    const second = await t.service.startLogin({}, SCREEN);
    await expect(t.service.receive({ from: '+23599000000', code: first.code })).resolves.toBe(
      'not_confirmed',
    );
    await expect(t.service.receive({ from: '+23566000099', code: second.code })).resolves.toBe(
      'not_confirmed',
    );
    const [a, b] = t.codes.rows;
    expect([a?.outcome, a?.matchedUserId, b?.outcome, b?.matchedUserId]).toEqual([
      'not_confirmed',
      null,
      'not_confirmed',
      null,
    ]);
    expect(t.users.accounts).toHaveLength(1);
    expect(t.users.findOrCreateByPhone).not.toHaveBeenCalled();
  });

  // SPEC-023-02-SC04
  it('SPEC-023-02-SC04 — codes nobody waits for: one failure each, then the sender is locked and even a good code is ignored', async () => {
    const t = build({ accounts: [confirmed({ phone: '+23566123456' })] });
    for (let i = 0; i < 10; i += 1) {
      await expect(
        t.service.receive({ from: '+23566123456', code: String(900_000 + i) }),
      ).resolves.toBe('no_code');
    }
    expect(t.otp.registerFailedAttempt).toHaveBeenCalledTimes(10);
    expect(t.otp.registerFailedAttempt).toHaveBeenCalledWith('whatsapp:+23566123456');
    const { code } = await t.service.startLogin({}, SCREEN);
    await expect(t.service.receive({ from: '+23566123456', code })).resolves.toBe('locked');
    expect(t.codes.rows[0]!.receivedAt).toBeNull();
  });

  // SPEC-023-02-SC08 (v2), review #1: the WhatsApp lock is the sender's own.
  it('SPEC-023-02-SC08 — a number locked by wrong SMS codes typed by a stranger still logs in by WhatsApp', async () => {
    const t = build({ accounts: [confirmed({ phone: '+23566123456' })] });
    for (let i = 0; i < 10; i += 1) await t.otp.registerFailedAttempt('+23566123456'); // POST /auth/otp/verify
    await expect(t.otp.assertNotLocked('+23566123456')).rejects.toMatchObject({ status: 423 });
    const { code } = await t.service.startLogin({}, SCREEN);
    await expect(t.service.receive({ from: '+23566123456', code })).resolves.toBe('matched');
  });

  // SPEC-023-02-SC09 (v2), review #2: Meta's redelivery after a half-done first attempt.
  it('SPEC-023-02-SC09 — the same sender’s message again finishes the confirmation, without a failure', async () => {
    const t = build({ accounts: [account({ phone: '+33612345678' })] });
    const { code } = await t.service.startPhoneConfirmation('u-awa', SCREEN);
    t.users.markPhoneVerified.mockRejectedValueOnce(new Error('database down'));
    await expect(t.service.receive({ from: '+33612345678', code })).rejects.toThrow(
      'database down',
    );
    expect(t.users.accounts[0]!.phoneVerifiedAt).toBeNull();
    await expect(t.service.receive({ from: '+33612345678', code })).resolves.toBe('matched');
    expect(t.users.accounts[0]!.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(t.otp.registerFailedAttempt).not.toHaveBeenCalled();
  });

  // SPEC-023-02-SC05
  it('SPEC-023-02-SC05 — a code is taken once: a second message with it changes nothing and counts as a failure', async () => {
    const t = build({ accounts: [confirmed({ phone: '+23566123456' })] });
    const { code } = await t.service.startLogin({}, SCREEN);
    await t.service.receive({ from: '+23566123456', code });
    await expect(t.service.receive({ from: '+23599887766', code })).resolves.toBe('no_code');
    expect(t.codes.rows[0]).toMatchObject({ senderPhone: '+23566123456', outcome: 'matched' });
    expect(t.otp.registerFailedAttempt).toHaveBeenCalledWith('whatsapp:+23599887766'); // R5 v2
  });

  // SPEC-023-02-SC07
  it('SPEC-023-02-SC07 — a confirmation or a new device from another number: « another number », no failure; from the right one, confirmed on arrival', async () => {
    const t = build({
      accounts: [
        account({ phone: '+33612345678' }),
        confirmed({ id: 'u-ali', phone: '+23566123456', email: 'ali@example.td' }),
      ],
    });
    const confirm = await t.service.startPhoneConfirmation('u-awa', SCREEN);
    await expect(t.service.receive({ from: '+23566111111', code: confirm.code })).resolves.toBe(
      'wrong_number',
    );
    const challengeId = await t.pendingLogin('u-ali');
    const device = await t.service.startLogin({ challengeId }, SCREEN);
    await expect(t.service.receive({ from: '+23566111111', code: device.code })).resolves.toBe(
      'wrong_number',
    );
    expect(t.otp.registerFailedAttempt).not.toHaveBeenCalled();
    expect(t.users.accounts[0]!.phoneVerifiedAt).toBeNull();

    const again = await t.service.startPhoneConfirmation('u-awa', SCREEN);
    await expect(t.service.receive({ from: '+33612345678', code: again.code })).resolves.toBe(
      'matched',
    );
    expect(t.users.accounts[0]!.phoneVerifiedAt).toBeInstanceOf(Date); // before any screen asks
    const device2 = await t.service.startLogin({ challengeId }, SCREEN);
    await expect(t.service.receive({ from: '+23566123456', code: device2.code })).resolves.toBe(
      'matched',
    );
  });
});

describe('SPEC-023-03 — the screen waits, then logs in', () => {
  // SPEC-023-03-SC01
  it('SPEC-023-03-SC01 — waiting, then the session once (the number now confirmed), then expired', async () => {
    // Created by SMS: no e-mail, no password — the number is all it has.
    const t = build({
      accounts: [account({ phone: '+23566123456', email: null, emailVerifiedAt: null })],
    });
    const { token, code, expiresAt } = await t.service.startLogin({}, SCREEN);
    await expect(t.service.status({ token, rememberDevice: false }, SCREEN)).resolves.toEqual({
      status: 'waiting',
      expiresAt,
    });
    await t.service.receive({ from: '+23566123456', code });
    const signedIn = await t.service.status({ token, rememberDevice: false }, SCREEN);
    expect(signedIn).toMatchObject({
      status: 'signed_in',
      access: expect.any(String),
      refresh: expect.any(String),
      user: { id: 'u-awa', phoneVerified: true },
    });
    expect(signedIn).not.toHaveProperty('deviceToken'); // a code alone remembers no device
    expect(t.users.accounts[0]!.phoneVerifiedAt).toBeInstanceOf(Date);
    await expect(t.service.status({ token, rememberDevice: false }, SCREEN)).resolves.toEqual({
      status: 'expired',
    });
    expect(t.sessions.rows).toHaveLength(1);
  });

  // SPEC-023-03-SC02
  it('SPEC-023-03-SC02 — an invented token learns nothing; the right one still gets the session', async () => {
    const t = build({ accounts: [confirmed({ phone: '+23566123456' })] });
    const { token, code } = await t.service.startLogin({}, SCREEN);
    await t.service.receive({ from: '+23566123456', code });
    await expect(
      t.service.status({ token: 'Q'.repeat(43), rememberDevice: false }, SCREEN),
    ).resolves.toEqual({ status: 'expired' });
    expect(t.sessions.rows).toHaveLength(0);
    await expect(t.service.status({ token, rememberDevice: false }, SCREEN)).resolves.toMatchObject(
      { status: 'signed_in' },
    );
  });

  // SPEC-023-03-SC03
  it('SPEC-023-03-SC03 — confirmed on no account: the sender’s number, no session, then expired', async () => {
    const t = build();
    const { token, code } = await t.service.startLogin({}, SCREEN);
    await t.service.receive({ from: '+33612345678', code });
    await expect(t.service.status({ token, rememberDevice: false }, SCREEN)).resolves.toEqual({
      status: 'not_confirmed',
      phone: '+33612345678',
    });
    expect(t.sessions.rows).toHaveLength(0);
    await expect(t.service.status({ token, rememberDevice: false }, SCREEN)).resolves.toEqual({
      status: 'expired',
    });
  });

  // SPEC-023-03-SC04
  it('SPEC-023-03-SC04 — a new device: the session and a device token, the pending login consumed; expired meanwhile: expired', async () => {
    const t = build({ accounts: [confirmed({ phone: '+23566123456' })] });
    const challengeId = await t.pendingLogin('u-awa');
    const { token, code } = await t.service.startLogin({ challengeId }, SCREEN);
    await t.service.receive({ from: '+23566123456', code });
    await expect(t.service.status({ token, rememberDevice: true }, SCREEN)).resolves.toMatchObject({
      status: 'signed_in',
      deviceToken: 'device-1',
      user: { id: 'u-awa' },
    });
    expect(t.challenges.rows[0]!.consumedAt).toBeInstanceOf(Date);

    const late = await t.pendingLogin('u-awa');
    const second = await t.service.startLogin({ challengeId: late }, SCREEN);
    await t.service.receive({ from: '+23566123456', code: second.code });
    t.challenges.rows[1]!.expiresAt = new Date(Date.now() - 1000);
    await expect(
      t.service.status({ token: second.token, rememberDevice: true }, SCREEN),
    ).resolves.toEqual({ status: 'expired' });
    expect(t.sessions.rows).toHaveLength(1);
  });

  // SPEC-023-03-SC05
  it('SPEC-023-03-SC05 — a confirmation: « confirmed », and the profile says so', async () => {
    const t = build({ accounts: [account({ phone: '+33612345678' })] });
    const { token, code } = await t.service.startPhoneConfirmation('u-awa', SCREEN);
    await t.service.receive({ from: '+33612345678', code });
    await expect(t.service.status({ token, rememberDevice: false }, SCREEN)).resolves.toEqual({
      status: 'confirmed',
    });
    const me = t.users.toMeDto(await t.users.getByIdOrThrow('u-awa'), ['customer']);
    expect(me.phoneVerified).toBe(true);
    expect(t.sessions.rows).toHaveLength(0);
  });

  // R6 (v2), review round 2: the confirmation is done again before « confirmed » is said.
  it('SPEC-023-03-SC05 — the confirmation failed when the message came in: done when the screen asks, then « confirmed »', async () => {
    const t = build({ accounts: [account({ phone: '+33612345678' })] });
    const { token, code } = await t.service.startPhoneConfirmation('u-awa', SCREEN);
    t.users.markPhoneVerified.mockRejectedValueOnce(new Error('database down'));
    await expect(t.service.receive({ from: '+33612345678', code })).rejects.toThrow(
      'database down',
    );
    expect(t.codes.rows[0]).toMatchObject({ outcome: 'matched', matchedUserId: 'u-awa' });
    expect(t.users.accounts[0]!.phoneVerifiedAt).toBeNull();
    await expect(t.service.status({ token, rememberDevice: false }, SCREEN)).resolves.toEqual({
      status: 'confirmed',
    });
    const me = t.users.toMeDto(await t.users.getByIdOrThrow('u-awa'), ['customer']);
    expect(me.phoneVerified).toBe(true);
  });

  // SPEC-023-03-SC06
  it('SPEC-023-03-SC06 — a suspended account: 403 ACCOUNT_INACTIVE, no session, then expired', async () => {
    const t = build({ accounts: [confirmed({ phone: '+23566123456', status: 'suspended' })] });
    const { token, code } = await t.service.startLogin({}, SCREEN);
    await t.service.receive({ from: '+23566123456', code });
    await expect(t.service.status({ token, rememberDevice: false }, SCREEN)).rejects.toMatchObject({
      status: 403,
      response: { code: 'ACCOUNT_INACTIVE' },
    });
    expect(t.sessions.rows).toHaveLength(0);
    await expect(t.service.status({ token, rememberDevice: false }, SCREEN)).resolves.toEqual({
      status: 'expired',
    });
  });

  // SPEC-023-03-SC08 (v2), review #3
  it('SPEC-023-03-SC08 — a message that came in is not read hours later: expired, no session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T10:00:00Z'));
    const t = build({ accounts: [confirmed({ phone: '+23566123456' })] });
    const { token, code } = await t.service.startLogin({}, SCREEN);
    await t.service.receive({ from: '+23566123456', code });
    vi.setSystemTime(new Date('2026-11-25T10:15:01Z')); // validity 5 min + 10 min kept
    await expect(t.service.status({ token, rememberDevice: false }, SCREEN)).resolves.toEqual({
      status: 'expired',
    });
    expect(t.sessions.rows).toHaveLength(0);
  });

  // SPEC-023-03-SC07
  it('SPEC-023-03-SC07 — a code whose validity passed without a message: expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T10:00:00Z'));
    const t = build();
    const { token } = await t.service.startLogin({}, SCREEN);
    vi.setSystemTime(new Date('2026-11-25T10:05:01Z'));
    await expect(t.service.status({ token, rememberDevice: false }, SCREEN)).resolves.toEqual({
      status: 'expired',
    });
  });
});

describe('SPEC-023-04 — « Nouvelle connexion par WhatsApp »', () => {
  // SPEC-023-04-SC01
  it('SPEC-023-04-SC01 — a WhatsApp login e-mails the verified address, with the time and the device', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T14:05:00Z'));
    const t = build({ accounts: [confirmed({ phone: '+23566123456', email: 'awa@example.com' })] });
    const { token, code } = await t.service.startLogin({}, SCREEN);
    await t.service.receive({ from: '+23566123456', code });
    await t.service.status({ token, rememberDevice: false }, SCREEN);
    await flush();

    expect(t.notices.sent).toEqual([
      {
        kind: 'whatsapp_login',
        to: 'awa@example.com',
        at: new Date('2026-11-25T14:05:00Z'),
        device: 'Chrome sur Android',
      },
    ]);
    const mail = accountNoticeMessage(t.notices.sent[0]!);
    expect(mail.subject).toBe('Nouvelle connexion par WhatsApp');
    expect(mail.text).toContain('le 25 novembre 2026 à 15:05');
    expect(mail.text).toContain('Chrome sur Android');
    expect(mail.text).not.toContain(code);
    expect(mail.text).not.toContain(SCREEN.ip);
    expect(mail.text).not.toMatch(/https?:/);
  });

  // SPEC-023-04-SC02
  it('SPEC-023-04-SC02 — no verified address: no e-mail, the session is given', async () => {
    const t = build({
      accounts: [account({ phone: '+23566123456', email: null, emailVerifiedAt: null })],
    });
    const { token, code } = await t.service.startLogin({}, SCREEN);
    await t.service.receive({ from: '+23566123456', code });
    await expect(t.service.status({ token, rememberDevice: false }, SCREEN)).resolves.toMatchObject(
      { status: 'signed_in' },
    );
    await flush();
    expect(t.notices.sent).toHaveLength(0);
  });

  // SPEC-023-04-SC03
  it('SPEC-023-04-SC03 — the e-mail cannot leave: the session stays', async () => {
    const t = build({ accounts: [confirmed({ phone: '+23566123456' })] });
    vi.mocked(t.notices.send).mockRejectedValueOnce(new Error('smtp down'));
    const { token, code } = await t.service.startLogin({}, SCREEN);
    await t.service.receive({ from: '+23566123456', code });
    await expect(t.service.status({ token, rememberDevice: false }, SCREEN)).resolves.toMatchObject(
      { status: 'signed_in', user: { id: 'u-awa' } },
    );
    await flush();
  });

  // SPEC-023-04-SC05
  it(
    'SPEC-023-04-SC05 — a password login or a number confirmed by WhatsApp sends no such e-mail',
    { timeout: 20_000 },
    async () => {
      const t = build({ accounts: [account({ phone: '+33612345678' })] });
      const { token, code } = await t.service.startPhoneConfirmation('u-awa', SCREEN);
      await t.service.receive({ from: '+33612345678', code });
      await t.service.status({ token, rememberDevice: false }, SCREEN);

      const passwords = new PasswordService(
        t.challenges.prisma,
        asOtp(t.otp),
        asUsers(t.users),
        realAuth(t.otp, t.users, t.sessions, t.audit.service),
        t.sessions as never,
        asDevices(t.devices),
        t.notices,
        fakePlatform(),
        fakeRateLimiter().service,
        t.config,
        t.audit.service,
      );
      // A real password login on a remembered device: signed in at once (SPEC-020-04 R4).
      t.users.accounts[0]!.passwordHash = await hashPassword('Baobab-Moursal-77');
      t.devices.rows.push({ token: 'device-known', userId: 'u-awa', revoked: null });
      await expect(
        passwords.login(
          { email: 'awa@example.td', password: 'Baobab-Moursal-77', deviceToken: 'device-known' },
          SCREEN,
        ),
      ).resolves.toMatchObject({ status: 'signed_in' });
      await flush();
      expect(t.notices.sent.filter((n) => n.kind === 'whatsapp_login')).toHaveLength(0);
    },
  );
});
