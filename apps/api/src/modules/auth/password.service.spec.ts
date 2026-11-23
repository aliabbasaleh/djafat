import { vi, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from './password.service';
import { hashPassword, verifyPassword } from './password-hash.util';
import { ResetPasswordSchema } from './dto/password.schema';
import {
  META,
  account,
  asDevices,
  asOtp,
  asSessions,
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

// Real scrypt (N=2^15) on purpose: on the Windows CI runner, ten verifications take longer than
// vitest's 5 s default (PR #27, « local setup on Windows »). A longer limit, not a weaker test.
vi.setConfig({ testTimeout: 30_000 });

// FEAT-020 — docs/features/FEAT-020-compte-email-mot-de-passe (SPEC-020-04, SPEC-020-05).
// Expected outcomes are the specs'; collaborators are in-memory fakes with the
// real semantics (account-test-support.ts), real scrypt, the real AuthService.

const EMAIL = 'awa@example.td';
const PASSWORD = 'kissar-boulou-27';
let HASH = '';
beforeAll(async () => {
  HASH = await hashPassword(PASSWORD);
});

function build(initial: Account[] = [account({ passwordHash: HASH })], config = fakeConfig()) {
  const otp = fakeOtp();
  const users = fakeUsers(initial);
  const sessions = fakeSessions();
  const devices = fakeDevices();
  const notices = fakeNotices();
  const audit = fakeAudit();
  const challenges = fakeChallenges();
  const limiter = fakeRateLimiter();
  const auth = realAuth(otp, users, sessions, audit.service);
  const service = new PasswordService(
    challenges.prisma,
    asOtp(otp),
    asUsers(users),
    auth,
    asSessions(sessions),
    asDevices(devices),
    notices,
    fakePlatform(),
    limiter.service,
    config,
    audit.service,
  );
  return { service, otp, users, sessions, devices, notices, audit, challenges, limiter };
}

const actions = (audit: ReturnType<typeof fakeAudit>) =>
  audit.log.mock.calls.map((c) => (c[0] as { action: string }).action);

describe('SPEC-020-04 — log in with email and password, a code on a new device', () => {
  // SPEC-020-04-SC01
  it('SPEC-020-04-SC01 — a remembered device signs in directly, no code sent', async () => {
    const t = build();
    const { token } = await t.devices.trust('u-awa');
    const res = await t.service.login(
      { email: EMAIL, password: PASSWORD, deviceToken: token },
      META,
    );
    expect(res).toMatchObject({
      status: 'signed_in',
      access: expect.any(String),
      user: { id: 'u-awa' },
    });
    expect(t.otp.sent).toHaveLength(0);
  });

  // SPEC-020-04-SC02
  it('SPEC-020-04-SC02 — a new device: code_required, masked destination, a bound login_device code by email', async () => {
    const t = build();
    const res = await t.service.login({ email: EMAIL, password: PASSWORD }, META);
    expect(res).toMatchObject({
      status: 'code_required',
      sentTo: { channel: 'email', destination: 'a***@example.td' },
      channels: [
        { id: 'email', available: true },
        { id: 'sms', available: false },
        { id: 'whatsapp', available: false },
      ],
    });
    if (res.status !== 'code_required') throw new Error('expected a challenge');
    expect(t.otp.sent).toEqual([
      expect.objectContaining({
        to: { channel: 'email', target: EMAIL },
        purpose: 'login_device',
        context: res.challengeId,
      }),
    ]);
  });

  // SPEC-020-04-SC03
  it('SPEC-020-04-SC03 — the right code opens the session and remembers the device; the next login is direct', async () => {
    const t = build();
    const first = await t.service.login({ email: EMAIL, password: PASSWORD }, META);
    if (first.status !== 'code_required') throw new Error('expected a challenge');
    const res = await t.service.verifyChallenge(
      {
        challengeId: first.challengeId,
        channel: 'email',
        code: t.otp.lastCode().code,
        rememberDevice: true,
      },
      META,
    );
    expect(res).toMatchObject({ access: expect.any(String), deviceToken: expect.any(String) });
    const again = await t.service.login(
      { email: EMAIL, password: PASSWORD, deviceToken: res.deviceToken },
      META,
    );
    expect(again.status).toBe('signed_in');
  });

  // SPEC-020-04-SC04
  it('SPEC-020-04-SC04 — without « Se souvenir de cet appareil » no device token is returned', async () => {
    const t = build();
    const first = await t.service.login({ email: EMAIL, password: PASSWORD }, META);
    if (first.status !== 'code_required') throw new Error('expected a challenge');
    const res = await t.service.verifyChallenge(
      {
        challengeId: first.challengeId,
        channel: 'email',
        code: t.otp.lastCode().code,
        rememberDevice: false,
      },
      META,
    );
    expect(res.access).toEqual(expect.any(String));
    expect(res).not.toHaveProperty('deviceToken');
    expect(t.devices.rows).toHaveLength(0);
  });

  // SPEC-020-04-SC05
  it('SPEC-020-04-SC05 — unknown email, account without password, wrong password: one answer, a failure counted, audited', async () => {
    const t = build([
      account({ id: 'u-awa', passwordHash: HASH }),
      account({
        id: 'u-moussa',
        email: 'moussa@example.td',
        phone: '+23566000098',
        passwordHash: null,
      }),
    ]);
    const cases = [
      { email: 'nobody@example.td', password: PASSWORD },
      { email: 'moussa@example.td', password: PASSWORD },
      { email: EMAIL, password: 'kissar-boulou-28' },
    ];
    for (const input of cases) {
      await expect(t.service.login(input, META)).rejects.toMatchObject({
        status: 401,
        response: { code: 'INVALID_CREDENTIALS', message: 'E-mail ou mot de passe incorrect.' },
      });
      expect(t.otp.registerFailedAttempt).toHaveBeenLastCalledWith(input.email);
    }
    expect(actions(t.audit).filter((a) => a === 'AUTH_LOGIN_FAILURE')).toHaveLength(3);
    expect(JSON.stringify(t.audit.log.mock.calls)).not.toContain('nobody@example.td');
    expect(t.otp.sent).toHaveLength(0);
  });

  // SPEC-020-04-SC06
  it('SPEC-020-04-SC06 — after 10 failures the address is locked, even with the right password, until the lock ends', async () => {
    const t = build();
    for (let i = 0; i < 10; i += 1) {
      await t.service
        .login({ email: EMAIL, password: 'wrong-password-1' }, META)
        .catch(() => undefined);
    }
    await expect(t.service.login({ email: EMAIL, password: PASSWORD }, META)).rejects.toMatchObject(
      {
        status: 423,
        response: { code: 'OTP_LOCKED' },
      },
    );
    t.otp.failures.clear(); // the lock's 15 minutes are over
    await expect(
      t.service.login({ email: EMAIL, password: PASSWORD }, META),
    ).resolves.toMatchObject({
      status: 'code_required',
    });
  });

  it('SPEC-020-04-SC06 — the network budget is charged on every attempt (429 once spent)', async () => {
    const t = build();
    const blocked = build(undefined, fakeConfig());
    blocked.limiter.consume.mockResolvedValue({ allowed: false, remaining: 0 });
    await expect(
      blocked.service.login({ email: EMAIL, password: PASSWORD }, META),
    ).rejects.toMatchObject({
      status: 429,
      response: { code: 'RATE_LIMITED' },
    });
    await t.service.login({ email: EMAIL, password: PASSWORD }, META);
    expect(t.limiter.consume).toHaveBeenCalledWith(`pwd:ip:${META.ip}`, 50, 900);
  });

  // SPEC-020-04-SC07
  it('SPEC-020-04-SC07 — an expired, revoked or other account’s device token asks the code', async () => {
    const t = build([
      account({ id: 'u-awa', passwordHash: HASH }),
      account({ id: 'u-bob', email: 'bob@example.td', phone: '+23566000098', passwordHash: HASH }),
    ]);
    const expired = await t.devices.trust('u-awa');
    const row = t.devices.rows[0];
    if (row) row.expired = true;
    const revoked = await t.devices.trust('u-awa');
    await t.devices.revokeAll('u-awa', 'password_changed');
    const other = await t.devices.trust('u-bob');
    for (const token of [expired.token, revoked.token, other.token]) {
      const res = await t.service.login(
        { email: EMAIL, password: PASSWORD, deviceToken: token },
        META,
      );
      expect(res.status, token).toBe('code_required');
    }
  });

  // SPEC-020-04-SC08
  it('SPEC-020-04-SC08 — a suspended account with the right password: 403 ACCOUNT_INACTIVE, no code', async () => {
    const t = build([account({ passwordHash: HASH, status: 'suspended' })]);
    await expect(t.service.login({ email: EMAIL, password: PASSWORD }, META)).rejects.toMatchObject(
      {
        status: 403,
        response: { code: 'ACCOUNT_INACTIVE' },
      },
    );
    expect(t.otp.sent).toHaveLength(0);
  });

  // SPEC-020-04-SC09
  it('SPEC-020-04-SC09 — a code verifies only its own login, once', async () => {
    const t = build();
    const c1 = await t.service.login({ email: EMAIL, password: PASSWORD }, META);
    const c2 = await t.service.login({ email: EMAIL, password: PASSWORD }, META);
    if (c1.status !== 'code_required' || c2.status !== 'code_required')
      throw new Error('challenges');
    const code1 = t.otp.lastCode({ context: c1.challengeId }).code;
    const verify = (challengeId: string) =>
      t.service.verifyChallenge(
        { challengeId, channel: 'email', code: code1, rememberDevice: false },
        META,
      );

    await expect(verify(c2.challengeId)).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
    await expect(verify(c1.challengeId)).resolves.toMatchObject({ access: expect.any(String) });
    await expect(verify(c1.challengeId)).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
  });

  // SPEC-020-04-SC02
  it('SPEC-020-04-SC02 — SMS and WhatsApp on, number NOT confirmed: they are still not offered (review #10)', async () => {
    const channelsOn = fakeConfig({
      SMS_PROVIDER: 'http',
      WHATSAPP_BUSINESS_NUMBER: '+23560000001',
    });
    const t = build(
      [account({ passwordHash: HASH, phone: '+23566123456', phoneVerifiedAt: null })],
      channelsOn,
    );
    const res = await t.service.login({ email: EMAIL, password: PASSWORD }, META);
    if (res.status !== 'code_required') throw new Error('expected a challenge');
    expect(res.channels).toEqual([
      expect.objectContaining({ id: 'email', available: true }),
      expect.objectContaining({ id: 'sms', available: false }),
      expect.objectContaining({ id: 'whatsapp', available: false }),
    ]);
  });

  // SPEC-020-04-SC10
  it('SPEC-020-04-SC10 — with a confirmed number and SMS on, the code can go by SMS; otherwise 409 PHONE_NOT_CONFIRMED', async () => {
    const smsOn = fakeConfig({ SMS_PROVIDER: 'http' });
    const t = build(
      [account({ passwordHash: HASH, phone: '+23566123456', phoneVerifiedAt: new Date() })],
      smsOn,
    );
    const res = await t.service.login({ email: EMAIL, password: PASSWORD }, META);
    if (res.status !== 'code_required') throw new Error('expected a challenge');
    expect(res.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'sms', available: true, destination: '+235 •• •• 34 56' }),
      ]),
    );
    await t.service.sendChallengeCode({ challengeId: res.challengeId, channel: 'sms' }, META.ip);
    const sms = t.otp.lastCode();
    expect(sms).toMatchObject({
      to: { channel: 'sms', target: '+23566123456' },
      purpose: 'login_device',
      context: res.challengeId,
    });
    await expect(
      t.service.verifyChallenge(
        { challengeId: res.challengeId, channel: 'sms', code: sms.code, rememberDevice: false },
        META,
      ),
    ).resolves.toMatchObject({ access: expect.any(String) });

    const u = build([account({ passwordHash: HASH, phoneVerifiedAt: null })], smsOn);
    const pending = await u.service.login({ email: EMAIL, password: PASSWORD }, META);
    if (pending.status !== 'code_required') throw new Error('expected a challenge');
    await expect(
      u.service.sendChallengeCode({ challengeId: pending.challengeId, channel: 'sms' }, META.ip),
    ).rejects.toMatchObject({ status: 409, response: { code: 'PHONE_NOT_CONFIRMED' } });
  });

  it('SPEC-020-04-SC10 — WhatsApp verifies with the code DJAFAT replied to the confirmed number', async () => {
    const t = build(
      [account({ passwordHash: HASH, phone: '+23566123456', phoneVerifiedAt: new Date() })],
      fakeConfig({ WHATSAPP_PROVIDER: 'cloud' }),
    );
    const res = await t.service.login({ email: EMAIL, password: PASSWORD }, META);
    if (res.status !== 'code_required') throw new Error('expected a challenge');
    expect(res.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'whatsapp',
          available: true,
          link: expect.stringContaining('wa.me'),
        }),
      ]),
    );
    // The inbound webhook replied to « Code DJAFAT » with a login code (FEAT-008).
    await t.otp.requestCode({ channel: 'whatsapp', target: '+23566123456' }, 'login', null);
    await expect(
      t.service.verifyChallenge(
        {
          challengeId: res.challengeId,
          channel: 'whatsapp',
          code: t.otp.lastCode().code,
          rememberDevice: false,
        },
        META,
      ),
    ).resolves.toMatchObject({ access: expect.any(String) });
  });
});

describe('SPEC-020-05 — forgot password, set or change it', () => {
  // SPEC-020-05-SC01
  it('SPEC-020-05-SC01 — a reset code goes only to a verified address; both answers are the same', async () => {
    const t = build();
    await expect(t.service.forgot(EMAIL, META.ip)).resolves.toBeUndefined();
    await expect(t.service.forgot('nobody@example.td', META.ip)).resolves.toBeUndefined();
    expect(t.otp.sent).toEqual([
      expect.objectContaining({
        to: { channel: 'email', target: EMAIL },
        purpose: 'reset_password',
      }),
    ]);
    expect(t.otp.consumeIpBudget).toHaveBeenCalledTimes(2);
  });

  // SPEC-020-05-SC02
  it('SPEC-020-05-SC02 — a reset replaces the password, revokes every session and device, signs in, warns, audits', async () => {
    const t = build();
    await t.sessions.createSession({ userId: 'u-awa' });
    await t.sessions.createSession({ userId: 'u-awa' });
    await t.devices.trust('u-awa');
    await t.service.forgot(EMAIL, META.ip);

    const res = await t.service.reset(
      { email: EMAIL, code: t.otp.lastCode().code, password: 'nouveau-Mot-2027' },
      META,
    );
    const hash = t.users.accounts[0]?.passwordHash ?? '';
    expect(await verifyPassword(PASSWORD, hash)).toBe(false);
    expect(await verifyPassword('nouveau-Mot-2027', hash)).toBe(true);
    expect(t.sessions.rows.slice(0, 2).map((r) => r.revoked)).toEqual([
      'password_reset',
      'password_reset',
    ]);
    expect(t.devices.rows[0]?.revoked).toBe('password_reset');
    expect(res).toMatchObject({ access: expect.any(String), deviceToken: expect.any(String) });
    expect(t.notices.sent).toEqual([
      expect.objectContaining({ kind: 'password_changed', to: EMAIL }),
    ]);
    expect(actions(t.audit)).toContain('AUTH_PASSWORD_RESET');
  });

  // SPEC-020-05-SC03
  it('SPEC-020-05-SC03 — a wrong code: OTP_INVALID, the password does not change', async () => {
    const t = build();
    await t.service.forgot(EMAIL, META.ip);
    await expect(
      t.service.reset({ email: EMAIL, code: '000000', password: 'nouveau-Mot-2027' }, META),
    ).rejects.toMatchObject({ response: { code: 'OTP_INVALID' } });
    expect(t.users.accounts[0]?.passwordHash).toBe(HASH);
  });

  // SPEC-020-05-SC04
  it('SPEC-020-05-SC04 — « motdepasse » is refused before the code is read; the same code still works after', async () => {
    const t = build();
    await t.service.forgot(EMAIL, META.ip);
    const code = t.otp.lastCode().code;
    const weak = ResetPasswordSchema.safeParse({ email: EMAIL, code, password: 'motdepasse' });
    expect(weak.success).toBe(false);
    if (!weak.success) expect(weak.error.issues[0]?.path).toEqual(['password']);
    await expect(
      t.service.reset({ email: EMAIL, code, password: 'nouveau-Mot-2027' }, META),
    ).resolves.toMatchObject({ access: expect.any(String) });
  });

  // SPEC-020-05-SC05
  it('SPEC-020-05-SC05 — a change keeps the current session, revokes the others, warns, audits', async () => {
    const t = build();
    const s1 = await t.sessions.createSession({ userId: 'u-awa' });
    await t.sessions.createSession({ userId: 'u-awa' });
    await t.service.changePassword(
      { userId: 'u-awa', sessionId: s1.sessionId },
      { currentPassword: PASSWORD, newPassword: 'nouveau-Mot-2027' },
      META,
    );
    expect(t.sessions.rows.map((r) => r.revoked)).toEqual([null, 'password_changed']);
    expect(await verifyPassword('nouveau-Mot-2027', t.users.accounts[0]?.passwordHash ?? '')).toBe(
      true,
    );
    expect(t.notices.sent).toEqual([
      expect.objectContaining({ kind: 'password_changed', to: EMAIL }),
    ]);
    expect(t.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_PASSWORD_CHANGED', metadata: { first: false } }),
    );
  });

  // SPEC-020-05-SC06
  it('SPEC-020-05-SC06 — a wrong current password: 403 CURRENT_PASSWORD_INCORRECT, nothing changes, a failure counted', async () => {
    const t = build();
    await expect(
      t.service.changePassword(
        { userId: 'u-awa', sessionId: 'sess-x' },
        { currentPassword: 'not-my-password', newPassword: 'nouveau-Mot-2027' },
        META,
      ),
    ).rejects.toMatchObject({ status: 403, response: { code: 'CURRENT_PASSWORD_INCORRECT' } });
    expect(t.users.accounts[0]?.passwordHash).toBe(HASH);
    expect(t.otp.registerFailedAttempt).toHaveBeenCalledWith(EMAIL);
  });

  // SPEC-020-05-SC07
  it('SPEC-020-05-SC07 — a WhatsApp account sets a first password with a verified email; without one, 409 EMAIL_REQUIRED', async () => {
    const withEmail = build([account({ passwordHash: null, phoneVerifiedAt: new Date() })]);
    await withEmail.service.changePassword(
      { userId: 'u-awa', sessionId: 'sess-x' },
      { newPassword: 'nouveau-Mot-2027' },
      META,
    );
    expect(withEmail.users.accounts[0]?.passwordHash?.startsWith('scrypt$')).toBe(true);
    expect(withEmail.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_PASSWORD_CHANGED', metadata: { first: true } }),
    );

    const noEmail = build([
      account({
        passwordHash: null,
        email: null,
        emailVerifiedAt: null,
        phoneVerifiedAt: new Date(),
      }),
    ]);
    await expect(
      noEmail.service.changePassword(
        { userId: 'u-awa', sessionId: 'sess-x' },
        { newPassword: 'nouveau-Mot-2027' },
        META,
      ),
    ).rejects.toMatchObject({ status: 409, response: { code: 'EMAIL_REQUIRED' } });
  });

  it('SPEC-020-05-SC07 — the personal rule applies with the account’s own name, email and number', async () => {
    const t = build();
    await expect(
      t.service.changePassword(
        { userId: 'u-awa', sessionId: 'sess-x' },
        { currentPassword: PASSWORD, newPassword: 'AwaHassan-1990' },
        META,
      ),
    ).rejects.toMatchObject({ issues: [expect.objectContaining({ path: 'newPassword' })] });
  });
});

// Review FEAT-020 #4 — SPEC-020-05 R1 (v2): nothing tells a known address from an unknown one.
describe('SPEC-020-05 R1 — « Mot de passe oublié ? » behaves the same for any address', () => {
  // SPEC-020-05-SC09
  it('SPEC-020-05-SC09 — known and unknown: three requests pass, the fourth is refused, for both; a code only for the known one', async () => {
    const { service, otp } = build([account({ email: 'awa@example.td' })]);
    for (const email of ['awa@example.td', 'personne@example.td']) {
      for (let i = 0; i < 3; i += 1)
        await expect(service.forgot(email, META.ip)).resolves.toBeUndefined();
      await expect(service.forgot(email, META.ip)).rejects.toMatchObject({
        response: { code: 'RATE_LIMITED' },
      });
    }
    expect(otp.sent.map((s) => s.to.target)).toEqual([
      'awa@example.td',
      'awa@example.td',
      'awa@example.td',
    ]);
  });

  // SPEC-020-05-SC09
  it('SPEC-020-05-SC09 — known and unknown, both locked: the same 423', async () => {
    const { service, otp } = build([account({ email: 'awa@example.td' })]);
    for (const email of ['awa@example.td', 'personne@example.td']) {
      otp.failures.set(email, 10);
      await expect(service.forgot(email, META.ip)).rejects.toMatchObject({
        response: { code: 'OTP_LOCKED' },
      });
    }
    expect(otp.sent).toHaveLength(0);
  });
});
