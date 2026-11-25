import { describe, expect, it, vi } from 'vitest';
import { RegistrationService } from './registration.service';
import type {
  CourierSignupRecord,
  RestaurantSignupRecord,
} from '../../common/ports/account-onboarding.port';
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

/** FEAT-022: the courier and restaurant ports, and the neighbourhood list (one active id). */
function fakeOnboarding(options: { failRestaurant?: boolean } = {}) {
  const couriers: Array<{ userId: string; signup: CourierSignupRecord }> = [];
  const restaurants: Array<{ userId: string; signup: RestaurantSignupRecord }> = [];
  return {
    couriers,
    restaurants,
    courierPort: {
      hasCourier: vi.fn(async (_tx: unknown, userId: string) =>
        couriers.some((c) => c.userId === userId),
      ),
      provisionCourier: vi.fn(async (_tx: unknown, userId: string, signup: CourierSignupRecord) => {
        couriers.push({ userId, signup });
      }),
    },
    restaurantPort: {
      ownsRestaurant: vi.fn(async (_tx: unknown, userId: string) =>
        restaurants.some((r) => r.userId === userId),
      ),
      provisionRestaurant: vi.fn(
        async (_tx: unknown, userId: string, signup: RestaurantSignupRecord) => {
          if (options.failRestaurant) throw new Error('restaurant could not be created');
          restaurants.push({ userId, signup });
          return { restaurantId: 'r-new' };
        },
      ),
    },
    neighbourhoods: {
      findActive: vi.fn(async (id: string) => (id === MOURSAL ? { id, name: 'Moursal' } : null)),
    },
  };
}

const MOURSAL = '11111111-1111-4111-8111-111111111111';

function build(initial: Account[] = [], onboardingOptions: { failRestaurant?: boolean } = {}) {
  const otp = fakeOtp();
  const challenges = fakeChallenges();
  const users = fakeUsers(initial, { tx: challenges.prisma });
  const sessions = fakeSessions();
  const devices = fakeDevices();
  const notices = fakeNotices();
  const audit = fakeAudit();
  const auth = realAuth(otp, users, sessions, audit.service);
  const onboarding = fakeOnboarding(onboardingOptions);
  const service = new RegistrationService(
    challenges.prisma,
    asOtp(otp),
    asUsers(users),
    auth,
    asDevices(devices),
    notices,
    audit.service,
    onboarding.courierPort,
    onboarding.restaurantPort,
    onboarding.neighbourhoods as never,
  );
  return { service, otp, users, sessions, devices, notices, audit, challenges, onboarding };
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

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-02, 03, 08).

/** A birth date `years` years before today in N'Djamena (UTC+1), shifted by `days`. */
function birthDate(years: number, days = 0): string {
  const now = new Date(Date.now() + 60 * 60 * 1000);
  const d = new Date(
    Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() + days),
  );
  return d.toISOString().slice(0, 10);
}

const COURIER = {
  ...INPUT,
  signup: {
    type: 'courier' as const,
    vehicle: 'moto' as const,
    neighbourhoodId: MOURSAL,
    neighbourhoodOther: null,
    birthDate: birthDate(25),
  },
};
const RESTAURANT = {
  ...INPUT,
  signup: {
    type: 'restaurant' as const,
    restaurantName: 'Chez Fatimé',
    neighbourhoodId: null,
    neighbourhoodOther: 'Klémat Nord',
  },
};

describe('SPEC-022-02 — sign up as a courier', () => {
  // SPEC-022-02-SC01
  it('SPEC-022-02-SC01 — the right code creates the account, the courier « to complete » and its role, in one transaction', async () => {
    const { service, otp, users, onboarding, challenges, audit } = build();
    const { registrationId } = await service.request(COURIER, META.ip);
    const stored = challenges.rows[0]?.payload as { signup: Record<string, unknown> };
    expect(stored.signup).toMatchObject({
      type: 'courier',
      vehicle: 'moto',
      neighbourhoodId: MOURSAL,
    });
    expect(JSON.stringify(stored)).not.toContain(INPUT.password);

    const res = await service.verify(registrationId, otp.lastCode().code, META);
    const userId = users.accounts[0]?.id;
    expect(res.user.id).toBe(userId);
    expect(onboarding.couriers).toEqual([
      {
        userId,
        signup: {
          vehicle: 'moto',
          birthDate: COURIER.signup.birthDate,
          neighbourhoodId: MOURSAL,
          neighbourhoodOther: null,
          termsAcceptedAt: expect.any(Date),
        },
      },
    ]);
    expect(users.grants).toEqual([{ userId, role: 'courier', restaurantId: null }]);
    const registered = audit.log.mock.calls
      .map((c) => c[0] as { action: string; metadata?: unknown })
      .find((e) => e.action === 'AUTH_REGISTERED');
    expect(registered?.metadata).toEqual({ accountType: 'courier' });
  });

  // SPEC-022-02-SC02
  it('SPEC-022-02-SC02 — under 18 is refused with 422 UNDERAGE before anything is stored or sent; 18 exactly passes', async () => {
    const { service, otp, challenges } = build();
    const young = { ...COURIER, signup: { ...COURIER.signup, birthDate: birthDate(18, 1) } };
    await expect(service.request(young, META.ip)).rejects.toMatchObject({
      status: 422,
      response: {
        code: 'UNDERAGE',
        message: 'Il faut avoir au moins 18 ans pour livrer avec DJAFAT.',
      },
    });
    expect(challenges.rows).toHaveLength(0);
    expect(otp.sent).toHaveLength(0);

    const eighteen = { ...COURIER, signup: { ...COURIER.signup, birthDate: birthDate(18) } };
    await expect(service.request(eighteen, META.ip)).resolves.toMatchObject({
      registrationId: expect.any(String),
    });
  });

  // SPEC-022-02-SC05
  it('SPEC-022-02-SC05 — no code, or a wrong one: no account, no courier, no role', async () => {
    const { service, users, onboarding } = build();
    const { registrationId } = await service.request(COURIER, META.ip);
    expect(onboarding.couriers).toHaveLength(0);
    await expect(service.verify(registrationId, '000000', META)).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
    expect(users.accounts).toHaveLength(0);
    expect(onboarding.couriers).toHaveLength(0);
    expect(users.grants).toHaveLength(0);
  });

  it('refuses a neighbourhood that is not in the list (422 NEIGHBOURHOOD_UNKNOWN)', async () => {
    const { service, challenges } = build();
    const unknown = {
      ...COURIER,
      signup: { ...COURIER.signup, neighbourhoodId: '22222222-2222-4222-8222-222222222222' },
    };
    await expect(service.request(unknown, META.ip)).rejects.toMatchObject({
      status: 422,
      response: { code: 'NEIGHBOURHOOD_UNKNOWN' },
    });
    expect(challenges.rows).toHaveLength(0);
  });
});

describe('SPEC-022-02 R8, SPEC-022-03 R6 — « Bienvenue sur DJAFAT » (FEAT-022-Q13)', () => {
  // SPEC-022-02-SC07
  it('SPEC-022-02-SC07 — the courier gets the welcome after the right code; an e-mail that fails undoes nothing', async () => {
    const { service, otp, notices } = build();
    const { registrationId } = await service.request(COURIER, META.ip);
    await service.verify(registrationId, otp.lastCode().code, META);
    await vi.waitFor(() =>
      expect(notices.sent).toContainEqual({
        kind: 'welcome',
        to: 'awa@example.td',
        applicant: { type: 'courier' },
      }),
    );

    const failing = build();
    vi.mocked(failing.notices.send).mockRejectedValue(new Error('smtp down'));
    const pending = await failing.service.request(COURIER, META.ip);
    await expect(
      failing.service.verify(pending.registrationId, failing.otp.lastCode().code, META),
    ).resolves.toMatchObject({ access: expect.any(String) });
    expect(failing.users.accounts).toHaveLength(1);
  });

  // SPEC-022-03-SC06
  it('SPEC-022-03-SC06 — the restaurant owner gets the welcome naming the restaurant; a customer gets none', async () => {
    const { service, otp, notices } = build();
    const { registrationId } = await service.request(RESTAURANT, META.ip);
    await service.verify(registrationId, otp.lastCode().code, META);
    await vi.waitFor(() =>
      expect(notices.sent).toContainEqual({
        kind: 'welcome',
        to: 'awa@example.td',
        applicant: { type: 'restaurant', restaurantName: 'Chez Fatimé' },
      }),
    );

    const customer = build();
    const res = await customer.service.request(INPUT, META.ip);
    await customer.service.verify(res.registrationId, customer.otp.lastCode().code, META);
    expect(customer.notices.sent.filter((n) => n.kind === 'welcome')).toHaveLength(0);
  });
});

describe('SPEC-022-03 — sign up a restaurant', () => {
  // SPEC-022-03-SC01
  it('SPEC-022-03-SC01 — the right code creates the account, the draft restaurant and the owner role limited to it', async () => {
    const { service, otp, users, onboarding } = build();
    const { registrationId } = await service.request(RESTAURANT, META.ip);
    await service.verify(registrationId, otp.lastCode().code, META);
    const userId = users.accounts[0]?.id;
    expect(onboarding.restaurants).toEqual([
      {
        userId,
        signup: {
          restaurantName: 'Chez Fatimé',
          neighbourhoodId: null,
          neighbourhoodOther: 'Klémat Nord',
          termsAcceptedAt: expect.any(Date),
        },
      },
    ]);
    expect(users.grants).toEqual([{ userId, role: 'restaurant_owner', restaurantId: 'r-new' }]);
  });

  // SPEC-022-03-SC03
  it('SPEC-022-03-SC03 — sent but never confirmed: no account, no restaurant, no role; a failure creating it undoes the account', async () => {
    const pending = build();
    await pending.service.request(RESTAURANT, META.ip);
    expect(pending.users.accounts).toHaveLength(0);
    expect(pending.onboarding.restaurants).toHaveLength(0);

    const failing = build([], { failRestaurant: true });
    const { registrationId } = await failing.service.request(RESTAURANT, META.ip);
    await expect(
      failing.service.verify(registrationId, failing.otp.lastCode().code, META),
    ).rejects.toThrow('restaurant could not be created');
    expect(failing.users.accounts).toHaveLength(0);
    expect(failing.users.grants).toHaveLength(0);
  });
});

describe('SPEC-022-08 — never a second account', () => {
  // SPEC-022-08-SC04
  it('SPEC-022-08-SC04 — a used address: FEAT-020’s answer, no code, nothing created; a used number: 409 PHONE_ALREADY_USED', async () => {
    const existing = account({ email: 'awa@example.td', phone: '+23566999999' });
    const { service, otp, notices, users, onboarding } = build([existing]);
    const res = await service.request(COURIER, META.ip);
    expect(res.registrationId).toEqual(expect.any(String));
    expect(otp.sent).toHaveLength(0);
    expect(notices.sent.map((n) => n.kind)).toEqual(['already_registered']);
    await expect(service.verify(res.registrationId, '123456', META)).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
    expect(onboarding.couriers).toHaveLength(0);
    expect(users.accounts).toHaveLength(1);

    const samePhone = { ...COURIER, email: 'autre@example.td', phone: '+23566999999' };
    await expect(service.request(samePhone, META.ip)).rejects.toMatchObject({
      status: 409,
      response: { code: 'PHONE_ALREADY_USED' },
    });
  });
});
