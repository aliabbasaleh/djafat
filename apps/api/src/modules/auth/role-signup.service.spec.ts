import { describe, expect, it, vi } from 'vitest';
import type { Role } from '@djafat/types';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../../common/audit/audit.service';
import type { UsersService } from '../users/users.service';
import type { RegistrationService, SignupPayload } from './registration.service';
import { RoleSignupService } from './role-signup.service';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-08).
// Expected outcomes are the spec's. The registration rules (age, neighbourhood)
// and the ports are RegistrationService's, tested in registration.service.spec.ts.

const META = { ip: '10.0.0.1', userAgent: 'test' };
const USER = {
  id: 'u-awa',
  email: 'awa@example.td',
  emailVerifiedAt: new Date('2026-11-01T10:00:00Z'),
  phone: '+23566123456',
  fullName: 'Awa Hassan',
};

function build(options: { roles?: Role[]; emailVerified?: boolean; provisioned?: boolean } = {}) {
  const roles = new Set<Role>(options.roles ?? ['customer']);
  const user = {
    ...USER,
    emailVerifiedAt: options.emailVerified === false ? null : USER.emailVerifiedAt,
  };
  const provisioned: Array<{ userId: string; signup: SignupPayload }> = [];
  const welcomes: Array<{ to: string; type: string }> = [];
  const locks: string[] = [];
  const tx = {
    $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      locks.push(String(values[0]));
      return Promise.resolve(1);
    }),
  };
  const prisma = {
    $transaction: vi.fn(async (work: (t: typeof tx) => Promise<void>) => {
      const before = new Set(roles);
      try {
        await work(tx);
      } catch (err) {
        roles.clear();
        for (const r of before) roles.add(r);
        throw err;
      }
    }),
  };
  const users = {
    getByIdOrThrow: vi.fn(() => Promise.resolve(user)),
    hasRoleWithin: vi.fn((_tx: unknown, _id: string, role: Role) =>
      Promise.resolve(roles.has(role)),
    ),
    getRoles: vi.fn(() => Promise.resolve([...roles])),
    toMeDto: vi.fn((u: typeof user, r: Role[]) => ({ id: u.id, email: u.email, roles: r })),
  };
  const registration = {
    checkSignup: vi.fn(() => Promise.resolve()),
    alreadyProvisioned: vi.fn(() => Promise.resolve(options.provisioned ?? false)),
    provisionSignup: vi.fn((_tx: unknown, userId: string, signup: SignupPayload) => {
      provisioned.push({ userId, signup });
      roles.add(signup.type === 'courier' ? 'courier' : 'restaurant_owner');
      return Promise.resolve();
    }),
    sendWelcome: vi.fn((to: string, signup: { type: string }) => {
      welcomes.push({ to, type: signup.type });
    }),
  };
  const audit = { log: vi.fn(() => Promise.resolve()) };
  const service = new RoleSignupService(
    prisma as unknown as PrismaService,
    users as unknown as UsersService,
    registration as unknown as RegistrationService,
    audit as unknown as AuditService,
  );
  return { service, roles, provisioned, welcomes, locks, registration, audit };
}

const COURIER = {
  vehicle: 'velo' as const,
  neighbourhoodId: '22222222-2222-4222-8222-222222222222',
  birthDate: '1996-03-01',
  acceptTerms: true as const,
};
const RESTAURANT = {
  restaurantName: 'Chez Fatimé',
  neighbourhoodOther: 'Klémat Nord',
  acceptTerms: true as const,
};

describe('SPEC-022-08 — add a role to one’s own account', () => {
  // SPEC-022-08-SC01
  it('SPEC-022-08-SC01 — a customer becomes a courier on the SAME account, with the welcome e-mail', async () => {
    const { service, roles, provisioned, welcomes, locks, registration, audit } = build();
    const me = await service.becomeCourier(USER.id, COURIER, META);

    expect(registration.checkSignup).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'courier', vehicle: 'velo' }),
    );
    expect(provisioned).toEqual([
      {
        userId: USER.id,
        signup: {
          type: 'courier',
          vehicle: 'velo',
          birthDate: '1996-03-01',
          neighbourhoodId: COURIER.neighbourhoodId,
          neighbourhoodOther: null,
          termsAcceptedAt: expect.any(String),
        },
      },
    ]);
    expect([...roles].sort()).toEqual(['courier', 'customer']);
    expect(me).toMatchObject({
      id: USER.id,
      roles: expect.arrayContaining(['customer', 'courier']),
    });
    expect(locks).toEqual([`role-signup:${USER.id}`]);
    expect(welcomes).toEqual([{ to: 'awa@example.td', type: 'courier' }]);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ROLE_SELF_SIGNUP', metadata: { accountType: 'courier' } }),
    );
  });

  // SPEC-022-08-SC01
  it('SPEC-022-08-SC01 — « Inscrire mon restaurant » gives the owner role and the restaurant to the same account', async () => {
    const { service, roles, provisioned, welcomes } = build();
    await service.registerRestaurant(USER.id, RESTAURANT, META);
    expect(provisioned[0]?.signup).toMatchObject({
      type: 'restaurant',
      restaurantName: 'Chez Fatimé',
      neighbourhoodId: null,
      neighbourhoodOther: 'Klémat Nord',
    });
    expect(roles.has('restaurant_owner')).toBe(true);
    expect(welcomes).toEqual([{ to: 'awa@example.td', type: 'restaurant' }]);
  });

  // SPEC-022-08-SC02
  it('SPEC-022-08-SC02 — e-mail not verified: 409 EMAIL_NOT_VERIFIED, nothing created', async () => {
    const { service, provisioned, welcomes } = build({ emailVerified: false });
    await expect(service.registerRestaurant(USER.id, RESTAURANT, META)).rejects.toMatchObject({
      status: 409,
      response: { code: 'EMAIL_NOT_VERIFIED', message: "Confirmez d'abord votre adresse e-mail." },
    });
    expect(provisioned).toHaveLength(0);
    expect(welcomes).toHaveLength(0);
  });

  // SPEC-022-08-SC03
  it('SPEC-022-08-SC03 — already a courier, already an owner: 409 ROLE_ALREADY_HELD both times, nothing created', async () => {
    const courier = build({ roles: ['customer', 'courier'] });
    await expect(courier.service.becomeCourier(USER.id, COURIER, META)).rejects.toMatchObject({
      status: 409,
      response: { code: 'ROLE_ALREADY_HELD' },
    });
    expect(courier.provisioned).toHaveLength(0);

    const owner = build({ roles: ['customer', 'restaurant_owner'] });
    await expect(owner.service.registerRestaurant(USER.id, RESTAURANT, META)).rejects.toMatchObject(
      {
        status: 409,
        response: { code: 'ROLE_ALREADY_HELD' },
      },
    );
    expect(owner.provisioned).toHaveLength(0);
    expect(owner.welcomes).toHaveLength(0);
  });

  it('SPEC-022-08 R3, R5 — role revoked but its courier row or restaurant left: 409, never a duplicate', async () => {
    const formerCourier = build({ roles: ['customer'], provisioned: true });
    await expect(formerCourier.service.becomeCourier(USER.id, COURIER, META)).rejects.toMatchObject(
      {
        status: 409,
        response: {
          code: 'ROLE_ALREADY_HELD',
          message: 'Ce compte a déjà été livreur : contactez DJAFAT pour reprendre.',
        },
      },
    );
    expect(formerCourier.provisioned).toHaveLength(0);
    const formerOwner = build({ roles: ['customer'], provisioned: true });
    await expect(
      formerOwner.service.registerRestaurant(USER.id, RESTAURANT, META),
    ).rejects.toMatchObject({ status: 409, response: { code: 'ROLE_ALREADY_HELD' } });
    expect(formerOwner.provisioned).toHaveLength(0);
  });

  it('SPEC-022-08 R2 — the sign-up rules refuse first (under 18): nothing created', async () => {
    const { service, registration, provisioned } = build();
    registration.checkSignup.mockRejectedValueOnce(
      Object.assign(new Error('underage'), { status: 422 }),
    );
    await expect(service.becomeCourier(USER.id, COURIER, META)).rejects.toMatchObject({
      status: 422,
    });
    expect(provisioned).toHaveLength(0);
  });
});
