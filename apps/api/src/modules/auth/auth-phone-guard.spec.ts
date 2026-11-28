import { describe, expect, it } from 'vitest';
import {
  META,
  account,
  fakeAudit,
  fakeOtp,
  fakeSessions,
  fakeUsers,
  realAuth,
  type Account,
} from './account-test-support';

// FEAT-020 — docs/features/FEAT-020-compte-email-mot-de-passe (SPEC-020-06 R4-R6).
// The real AuthService; its collaborators are fakes with the real semantics.

const PHONE = '+23566123456';
const LOGIN = { ...META, countryId: null };

function build(holder: Account) {
  const otp = fakeOtp();
  const users = fakeUsers([holder]);
  const sessions = fakeSessions();
  const audit = fakeAudit();
  const auth = realAuth(otp, users, sessions, audit.service);
  return { auth, otp, users, sessions };
}

/** An account created by email (SPEC-020-03): email verified, password, number only typed. */
const emailAccount = (over: Partial<Account> = {}) =>
  account({ phone: PHONE, phoneVerifiedAt: null, passwordHash: 'scrypt$…', ...over });

describe('SPEC-020-06 — phone codes on an account created by email', () => {
  // SPEC-020-06-SC05 (v3): by WhatsApp, a message from that number answers « confirmed on
  // no account » and opens nothing (FEAT-023, tested in whatsapp-code.service.spec.ts).
  it('SPEC-020-06-SC05 — an SMS code on the unconfirmed number: 409 PHONE_NOT_CONFIRMED, no session', async () => {
    const { auth, otp, users, sessions } = build(emailAccount());

    await otp.requestCode({ channel: 'sms', target: PHONE }, 'login', null);
    await expect(
      auth.verifyOtpAndLogin(PHONE, otp.lastCode().code, 'login', LOGIN),
    ).rejects.toMatchObject({ status: 409, response: { code: 'PHONE_NOT_CONFIRMED' } });

    expect(sessions.rows).toHaveLength(0);
    expect(users.accounts[0]?.phoneVerifiedAt).toBeNull();
    expect(users.markPhoneVerified).not.toHaveBeenCalled();
  });

  it('SPEC-020-06-SC05 — a wrong code is still OTP_INVALID: the guard speaks only to the holder of the number', async () => {
    const { auth, otp } = build(emailAccount());
    await otp.requestCode({ channel: 'sms', target: PHONE }, 'login', null);
    await expect(auth.verifyOtpAndLogin(PHONE, '000000', 'login', LOGIN)).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
  });

  // SPEC-020-06-SC06
  it('SPEC-020-06-SC06 — once the number is confirmed, the SMS code opens that account', async () => {
    const { auth, otp, sessions } = build(emailAccount({ phoneVerifiedAt: new Date() }));
    await otp.requestCode({ channel: 'sms', target: PHONE }, 'login', null);
    const res = await auth.verifyOtpAndLogin(PHONE, otp.lastCode().code, 'login', LOGIN);
    expect(res.user).toMatchObject({ id: 'u-awa' });
    expect(sessions.rows).toEqual([expect.objectContaining({ userId: 'u-awa' })]);
  });

  // SPEC-020-06-SC07
  it('SPEC-020-06-SC07 — an account without email nor password (phone order, demo data) logs in as today', async () => {
    const { auth, otp, users } = build(
      account({ phone: PHONE, phoneVerifiedAt: null, email: null, emailVerifiedAt: null }),
    );
    await otp.requestCode({ channel: 'sms', target: PHONE }, 'login', null);
    const res = await auth.verifyOtpAndLogin(PHONE, otp.lastCode().code, 'login', LOGIN);
    expect(res.user).toMatchObject({ id: 'u-awa' });
    expect(users.accounts[0]?.phoneVerifiedAt).toBeInstanceOf(Date);
  });
});
