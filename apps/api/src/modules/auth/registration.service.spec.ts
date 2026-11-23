import { describe, expect, it, vi } from 'vitest';
import { RegistrationService } from './registration.service';
import { verifyPassword } from './password-hash.util';
import {
  META,
  account,
  asDevices,
  asOtp,
  asUsers,
  fakeAudit,
  fakeChallenges,
  fakeDevices,
  fakeNotices,
  fakeOtp,
  fakeSessions,
  fakeUsers,
  realAuth,
  type Account,
} from './account-test-support';

// Real scrypt (N=2^15) on purpose: on the Windows CI runner, ten verifications take longer than
// vitest's 5 s default (PR #27, « local setup on Windows »). A longer limit, not a weaker test.
vi.setConfig({ testTimeout: 30_000 });

// FEAT-020 — docs/features/FEAT-020-compte-email-mot-de-passe (SPEC-020-03).
// Expected outcomes are the spec's; collaborators are in-memory fakes with
// the real semantics (account-test-support.ts), and the real AuthService.

const INPUT = {
  fullName: 'Awa Hassan',
  phone: '+23566123456', // « 66 12 34 56 », already normalised by the schema (FEAT-005)
  email: 'awa@example.td', // « Awa@Example.td », already normalised by the schema
  password: 'kissar-boulou-27',
};

function build(initial: Account[] = []) {
  const otp = fakeOtp();
  const challenges = fakeChallenges();
  const users = fakeUsers(initial, { tx: challenges.prisma });
  const sessions = fakeSessions();
  const devices = fakeDevices();
  const notices = fakeNotices();
  const audit = fakeAudit();
  const auth = realAuth(otp, users, sessions, audit.service);
  const service = new RegistrationService(
    challenges.prisma,
    asOtp(otp),
    asUsers(users),
    auth,
    asDevices(devices),
    notices,
    audit.service,
  );
  return { service, otp, users, sessions, devices, notices, audit, challenges };
}

describe('SPEC-020-03 — create an account confirmed by an email code', () => {
  // SPEC-020-03-SC01
  it('SPEC-020-03-SC01 — a request stores a pending registration (a hash, never the password) and sends a bound register code', async () => {
    const { service, otp, challenges, users } = build();
    const res = await service.request(INPUT, META.ip);

    expect(res.registrationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(challenges.rows).toHaveLength(1);
    const row = challenges.rows[0];
    expect(row).toMatchObject({ kind: 'registration', email: 'awa@example.td' });
    const payload = row?.payload as { fullName: string; phone: string; passwordHash: string };
    expect(payload.fullName).toBe('Awa Hassan');
    expect(payload.phone).toBe('+23566123456');
    expect(payload.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(JSON.stringify(row)).not.toContain(INPUT.password);
    expect(await verifyPassword(INPUT.password, payload.passwordHash)).toBe(true);

    expect(otp.sent).toHaveLength(1);
    expect(otp.sent[0]).toMatchObject({
      to: { channel: 'email', target: 'awa@example.td' },
      purpose: 'register',
      context: res.registrationId,
    });
    expect(users.accounts).toHaveLength(0); // nothing in users before the code
  });

  // SPEC-020-03-SC02
  it('SPEC-020-03-SC02 — the right code creates the customer account, opens the session, remembers the device, audits', async () => {
    const { service, otp, users, devices, audit } = build();
    const { registrationId } = await service.request(INPUT, META.ip);
    const res = await service.verify(registrationId, otp.lastCode().code, META);

    expect(users.accounts).toHaveLength(1);
    const created = users.accounts[0];
    expect(created).toMatchObject({
      email: 'awa@example.td',
      phone: '+23566123456',
      fullName: 'Awa Hassan',
      phoneVerifiedAt: null,
      status: 'active',
    });
    expect(created?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(created?.passwordHash?.startsWith('scrypt$')).toBe(true);

    expect(res).toMatchObject({
      access: expect.any(String),
      refresh: expect.any(String),
      user: { id: created?.id, emailVerified: true, phoneVerified: false, hasPassword: true },
      deviceToken: devices.rows[0]?.token,
    });
    expect(res.deviceTokenExpiresAt).toEqual(expect.any(String));
    const registered = audit.log.mock.calls
      .map((c) => c[0] as { action: string; metadata?: unknown })
      .find((e) => e.action === 'AUTH_REGISTERED');
    expect(registered).toBeDefined();
    expect(JSON.stringify(registered)).not.toContain('awa@example.td');
    expect(JSON.stringify(registered)).not.toContain('66123456');
  });

  // SPEC-020-03-SC03
  it('SPEC-020-03-SC03 — a wrong code is refused with OTP_INVALID and no account exists', async () => {
    const { service, users } = build();
    const { registrationId } = await service.request(INPUT, META.ip);
    await expect(service.verify(registrationId, '000000', META)).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
    expect(users.accounts).toHaveLength(0);
  });

  // SPEC-020-03-SC04
  it('SPEC-020-03-SC04 — an address already used: same answer, a decoy registration without data, no code, the "already registered" notice', async () => {
    const { service, otp, challenges, notices } = build([account({ email: 'awa@example.td' })]);
    const res = await service.request({ ...INPUT, phone: '+23566999999' }, META.ip);

    expect(Object.keys(res).sort()).toEqual(['expiresAt', 'registrationId']);
    expect(res.registrationId).toMatch(/^[0-9a-f-]{36}$/);
    // R3 (v2, review #3): a pending row like a real one, but holding nothing — no
    // name, no number, no password hash — and no code: it can never complete.
    expect(challenges.rows).toHaveLength(1);
    expect(challenges.rows[0]).toMatchObject({ id: res.registrationId, email: 'awa@example.td' });
    expect(challenges.rows[0]?.payload).toEqual({ decoy: true });
    expect(otp.sent).toHaveLength(0);
    expect(otp.consumeTargetBudget).toHaveBeenCalledWith({
      channel: 'email',
      target: 'awa@example.td',
    });
    expect(notices.sent).toEqual([{ kind: 'already_registered', to: 'awa@example.td' }]);
    await expect(service.verify(res.registrationId, '100000', META)).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
  });

  // SPEC-020-03-SC05
  it('SPEC-020-03-SC05 — a phone number already used is refused with PHONE_ALREADY_USED; nothing sent or stored', async () => {
    const { service, otp, challenges, notices } = build([
      account({ id: 'u-other', phone: '+23566123456', email: null }),
    ]);
    await expect(service.request(INPUT, META.ip)).rejects.toMatchObject({
      response: { code: 'PHONE_ALREADY_USED' },
    });
    expect(challenges.rows).toHaveLength(0);
    expect(otp.sent).toHaveLength(0);
    expect(notices.sent).toHaveLength(0);
    // R10: the network budget is charged even when the answer is 409.
    expect(otp.consumeIpBudget).toHaveBeenCalledWith(META.ip);
  });

  // SPEC-020-03-SC06
  it('SPEC-020-03-SC06 — a code completes only its own registration', async () => {
    const { service, otp } = build();
    const a = await service.request({ ...INPUT, phone: '+23566111111' }, META.ip);
    const codeA = otp.lastCode({ context: a.registrationId }).code;
    const b = await service.request({ ...INPUT, phone: '+23566222222' }, META.ip);
    const codeB = otp.lastCode({ context: b.registrationId }).code;

    await expect(service.verify(b.registrationId, codeA, META)).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
    await expect(service.verify(b.registrationId, codeB, META)).resolves.toMatchObject({
      user: { phone: '+23566222222' },
    });
    await expect(service.verify(a.registrationId, codeA, META)).rejects.toMatchObject({
      response: { code: 'EMAIL_ALREADY_USED' },
    });
  });

  // SPEC-020-03-SC07
  it('SPEC-020-03-SC07 — a registration older than 30 minutes is refused and creates nothing', async () => {
    const { service, otp, challenges, users } = build();
    const { registrationId } = await service.request(INPUT, META.ip);
    const row = challenges.rows[0];
    if (row) row.expiresAt = new Date(Date.now() - 1000);
    await expect(service.verify(registrationId, otp.lastCode().code, META)).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
    expect(users.accounts).toHaveLength(0);
    const created = challenges.rows[0]?.expiresAt;
    expect(created).toBeDefined();
  });

  it('SPEC-020-03-SC07 — a request lives 30 minutes, and purges expired registrations first (FEAT-020-Q15)', async () => {
    const { service, challenges } = build();
    const before = Date.now();
    const first = await service.request({ ...INPUT, phone: '+23566111111' }, META.ip);
    const expires = new Date(first.expiresAt).getTime();
    expect(expires - before).toBeGreaterThanOrEqual(30 * 60 * 1000 - 1000);
    expect(expires - before).toBeLessThanOrEqual(30 * 60 * 1000 + 1000);
    const row = challenges.rows[0];
    if (row) row.expiresAt = new Date(Date.now() - 1000);
    await service.request({ ...INPUT, phone: '+23566222222' }, META.ip);
    expect(challenges.rows.map((r) => (r.payload as { phone: string }).phone)).toEqual([
      '+23566222222',
    ]);
  });

  // SPEC-020-03-SC08
  it('SPEC-020-03-SC08 — resend: a new bound code, the old one stops working; an unknown id sends nothing', async () => {
    const { service, otp } = build();
    const { registrationId } = await service.request(INPUT, META.ip);
    const oldCode = otp.lastCode().code;
    await service.resend(registrationId, META.ip);
    const newCode = otp.lastCode().code;
    expect(otp.sent).toHaveLength(2);
    expect(otp.sent[1]).toMatchObject({ purpose: 'register', context: registrationId });
    expect(newCode).not.toBe(oldCode);

    await expect(service.verify(registrationId, oldCode, META)).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
    await expect(service.verify(registrationId, newCode, META)).resolves.toMatchObject({
      user: { emailVerified: true },
    });

    await service.resend('00000000-0000-4000-8000-999999999999', META.ip);
    expect(otp.sent).toHaveLength(2);
  });
});

// Review FEAT-020 #3 — SPEC-020-03 R13: nothing tells a used address from a free one.
describe('SPEC-020-03 R13 — a used address and a free one behave the same', () => {
  const FREE = { ...INPUT, email: 'nouveau@example.td', phone: '+23566111111' };
  const TAKEN = { ...INPUT, email: 'awa@example.td', phone: '+23566222222' };

  // SPEC-020-03-SC11
  it('SPEC-020-03-SC11 — both addresses locked: the same 423 OTP_LOCKED, nothing stored or sent', async () => {
    const { service, otp, challenges, notices } = build([account({ email: 'awa@example.td' })]);
    for (const email of [FREE.email, TAKEN.email]) otp.failures.set(email, 10);

    await expect(service.request(FREE, META.ip)).rejects.toMatchObject({
      response: { code: 'OTP_LOCKED' },
    });
    await expect(service.request(TAKEN, META.ip)).rejects.toMatchObject({
      response: { code: 'OTP_LOCKED' },
    });
    expect(challenges.rows).toHaveLength(0);
    expect(otp.sent).toHaveLength(0);
    expect(notices.sent).toHaveLength(0);
  });

  // SPEC-020-03-SC12
  it('SPEC-020-03-SC12 — the same budget: a request and two resends pass, the third resend is refused, for both', async () => {
    const { service } = build([account({ email: 'awa@example.td' })]);
    for (const input of [FREE, TAKEN]) {
      const { registrationId } = await service.request(input, META.ip);
      await service.resend(registrationId, META.ip);
      await service.resend(registrationId, META.ip);
      await expect(service.resend(registrationId, META.ip)).rejects.toMatchObject({
        response: { code: 'RATE_LIMITED' },
      });
    }
  });

  // SPEC-020-03-SC13
  it('SPEC-020-03-SC13 — wrong codes count the same: after 10, both registrations answer 423', async () => {
    const { service, otp } = build([account({ email: 'awa@example.td' })]);
    for (const input of [FREE, TAKEN]) {
      const { registrationId } = await service.request(input, META.ip);
      for (let i = 0; i < 10; i += 1) {
        await expect(service.verify(registrationId, '000000', META)).rejects.toMatchObject({
          response: { code: 'OTP_INVALID' },
        });
      }
      await expect(service.verify(registrationId, '000000', META)).rejects.toMatchObject({
        response: { code: 'OTP_LOCKED' },
      });
      expect(otp.failures.get(input.email)).toBe(10);
    }
  });

  // SPEC-020-03-SC13
  it('SPEC-020-03-SC13 — a notice that cannot leave fails like a code: 503 for the used address', async () => {
    const { service, notices } = build([account({ email: 'awa@example.td' })]);
    vi.mocked(notices.send).mockResolvedValueOnce('failed');
    await expect(service.request(TAKEN, META.ip)).rejects.toMatchObject({
      response: { code: 'OTP_DELIVERY_FAILED' },
    });
    vi.mocked(notices.send).mockResolvedValueOnce('unavailable');
    await expect(service.request(TAKEN, META.ip)).rejects.toMatchObject({
      response: { code: 'EMAIL_UNAVAILABLE' },
    });
  });
});
