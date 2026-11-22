import { beforeAll, describe, expect, it } from 'vitest';
import { EmailChangeService } from './email-change.service';
import { PasswordService } from './password.service';
import { hashPassword } from './password-hash.util';
import {
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

// FEAT-020 — docs/features/FEAT-020-compte-email-mot-de-passe (SPEC-020-12, review #6, FEAT-020-Q28).

const PASSWORD = 'kissar-boulou-27';
const META = { ip: '10.0.0.1', userAgent: 'vitest' };
let HASH = '';
beforeAll(async () => {
  HASH = await hashPassword(PASSWORD);
});

function build(initial: Account[]) {
  const otp = fakeOtp();
  const users = fakeUsers(initial);
  const sessions = fakeSessions();
  const devices = fakeDevices();
  const notices = fakeNotices();
  const audit = fakeAudit();
  const auth = realAuth(otp, users, sessions, audit.service);
  const passwords = new PasswordService(
    fakeChallenges().prisma,
    asOtp(otp),
    asUsers(users),
    auth,
    asSessions(sessions),
    asDevices(devices),
    notices,
    fakePlatform(),
    fakeRateLimiter().service,
    fakeConfig(),
    audit.service,
  );
  const service = new EmailChangeService(
    asUsers(users),
    auth,
    passwords,
    asDevices(devices),
    notices,
    audit.service,
  );
  return { service, otp, users, devices, notices, audit };
}

const NEW = 'awa.hassan@gmail.com';

describe('SPEC-020-12 — changing the e-mail of an account with a password', () => {
  // SPEC-020-12-SC01
  it('SPEC-020-12-SC01 — no or wrong current password: 403 CURRENT_PASSWORD_INCORRECT, no code sent', async () => {
    const { service, otp } = build([account({ passwordHash: HASH })]);
    for (const currentPassword of [undefined, 'pas-le-bon-99']) {
      await expect(
        service.request('u-awa', { email: NEW, currentPassword }, META.ip),
      ).rejects.toMatchObject({ response: { code: 'CURRENT_PASSWORD_INCORRECT' } });
    }
    expect(otp.sent).toHaveLength(0);
  });

  // SPEC-020-12-SC02
  it('SPEC-020-12-SC02 — the right current password: a verify_email code goes to the new address', async () => {
    const { service, otp } = build([account({ passwordHash: HASH })]);
    await service.request('u-awa', { email: NEW, currentPassword: PASSWORD }, META.ip);
    expect(otp.sent).toHaveLength(1);
    expect(otp.sent[0]).toMatchObject({
      to: { channel: 'email', target: NEW },
      purpose: 'verify_email',
    });
  });

  // SPEC-020-12-SC03
  it('SPEC-020-12-SC03 — an account without a password adds its e-mail as before (FEAT-007), nothing asked', async () => {
    const { service, otp } = build([account({ email: null, emailVerifiedAt: null })]);
    await service.request('u-awa', { email: NEW }, META.ip);
    expect(otp.sent).toHaveLength(1);
  });

  // SPEC-020-12-SC04
  it('SPEC-020-12-SC04 — replacing a verified address: the old one is alerted, devices forgotten, audited', async () => {
    const { service, otp, devices, notices, audit } = build([account({ passwordHash: HASH })]);
    await service.request('u-awa', { email: NEW, currentPassword: PASSWORD }, META.ip);
    const code = otp.sent[0]?.code ?? '';

    const me = await service.confirm('u-awa', { email: NEW, code }, META);

    expect(me.email).toBe(NEW);
    expect(devices.revokeAll).toHaveBeenCalledWith('u-awa', 'email_changed');
    expect(notices.sent).toEqual([
      expect.objectContaining({ kind: 'email_changed', to: 'awa@example.td' }),
    ]);
    const notice = notices.sent[0];
    expect(notice?.kind === 'email_changed' ? notice.newAddress : '').not.toContain('hassan');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_EMAIL_CHANGED' }),
    );
  });

  // SPEC-020-12-SC04
  it('SPEC-020-12-SC04 — a first address (none verified before): no alert, no device forgotten', async () => {
    const { service, otp, devices, notices } = build([
      account({ email: null, emailVerifiedAt: null }),
    ]);
    await service.request('u-awa', { email: NEW }, META.ip);
    await service.confirm('u-awa', { email: NEW, code: otp.sent[0]?.code ?? '' }, META);
    expect(devices.revokeAll).not.toHaveBeenCalled();
    expect(notices.sent).toHaveLength(0);
  });

  // SPEC-020-12-SC05
  it('SPEC-020-12-SC05 — ten wrong passwords lock it like a password change: 423 after', async () => {
    const { service } = build([account({ passwordHash: HASH })]);
    for (let i = 0; i < 10; i += 1) {
      await expect(
        service.request('u-awa', { email: NEW, currentPassword: 'faux-mot-de-passe' }, META.ip),
      ).rejects.toMatchObject({ response: { code: 'CURRENT_PASSWORD_INCORRECT' } });
    }
    await expect(
      service.request('u-awa', { email: NEW, currentPassword: PASSWORD }, META.ip),
    ).rejects.toMatchObject({ response: { code: 'OTP_LOCKED' } });
  });

  // SPEC-020-12-SC07
  it('SPEC-020-12-SC07 — a code another account asked for never confirms the address here: 401, e-mail unchanged', async () => {
    const { service, otp, users, notices } = build([
      account({ passwordHash: HASH }),
      account({ id: 'u-pirate', phone: '+23566000077', email: 'pirate@example.td' }),
    ]);
    // The attacker asks a code for their own address from their own account (no password there)…
    await service.request('u-pirate', { email: NEW }, META.ip);
    const code = otp.sent[0]?.code ?? '';
    // …then tries it with the victim's stolen session.
    await expect(service.confirm('u-awa', { email: NEW, code }, META)).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
    expect(users.accounts.find((a) => a.id === 'u-awa')?.email).toBe('awa@example.td');
    expect(notices.sent).toHaveLength(0);
  });
});
