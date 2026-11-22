import { describe, expect, it } from 'vitest';
import { PhoneLinkService } from './phone-link.service';
import {
  META,
  account,
  asOtp,
  asUsers,
  fakeAudit,
  fakeOtp,
  fakeUsers,
} from './account-test-support';

// FEAT-020 — docs/features/FEAT-020-compte-email-mot-de-passe (SPEC-020-06 R1-R3).

const PHONE = '+23566123456';

function build() {
  const otp = fakeOtp();
  const users = fakeUsers([
    account({ id: 'u-a', phone: PHONE, phoneVerifiedAt: null }),
    account({ id: 'u-b', phone: '+23566654321', email: 'bob@example.td', phoneVerifiedAt: null }),
  ]);
  const audit = fakeAudit();
  const service = new PhoneLinkService(asOtp(otp), asUsers(users), audit.service);
  return { service, otp, users, audit };
}

describe('SPEC-020-06 — confirm one’s number from « Mon profil »', () => {
  // SPEC-020-06-SC01
  it('SPEC-020-06-SC01 — by SMS: a verify_phone code bound to the account goes to its number', async () => {
    const { service, otp } = build();
    await service.request('u-a', META.ip);
    expect(otp.sent).toEqual([
      expect.objectContaining({
        to: { channel: 'sms', target: PHONE },
        purpose: 'verify_phone',
        context: 'u-a',
      }),
    ]);
  });

  // SPEC-020-06-SC02
  it('SPEC-020-06-SC02 — the right SMS code confirms the number and audits; a wrong code is OTP_INVALID', async () => {
    const { service, otp, users, audit } = build();
    await service.request('u-a', META.ip);
    const user = await service.verify('u-a', 'sms', otp.lastCode().code, META);
    expect(user.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(users.accounts[0]?.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_PHONE_VERIFIED', entityId: 'u-a' }),
    );

    await service.request('u-b', META.ip);
    await expect(service.verify('u-b', 'sms', '000000', META)).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
  });

  // SPEC-020-06-SC03
  it('SPEC-020-06-SC03 — by WhatsApp: the code DJAFAT replied to « Code DJAFAT » confirms the number', async () => {
    const { service, otp } = build();
    // The inbound webhook replied with a login code to the customer's own message (FEAT-008).
    await otp.requestCode({ channel: 'whatsapp', target: PHONE }, 'login', null);
    const user = await service.verify('u-a', 'whatsapp', otp.lastCode().code, META);
    expect(user.phoneVerifiedAt).toBeInstanceOf(Date);
  });

  // SPEC-020-06-SC04
  it('SPEC-020-06-SC04 — a code bound to another account does not verify this one', async () => {
    const { service, otp, users } = build();
    await service.request('u-a', META.ip);
    await expect(service.verify('u-b', 'sms', otp.lastCode().code, META)).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
    expect(users.accounts[1]?.phoneVerifiedAt).toBeNull();
  });

  it('SPEC-020-06-SC01 — a number already confirmed: nothing is sent', async () => {
    const { service, otp, users } = build();
    const a = users.accounts[0];
    if (a) a.phoneVerifiedAt = new Date();
    await service.request('u-a', META.ip);
    expect(otp.sent).toHaveLength(0);
  });
});
