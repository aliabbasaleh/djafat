import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RestaurantsManagementService } from './restaurants-management.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../../common/audit/audit.service';
import type { UsersService } from '../users/users.service';
import type { RestaurantAvailabilityService } from './restaurant-availability.service';

function prismaStub(
  restaurant: { status: string; ownerUserId: string | null } | null,
  // FEAT-022: a restaurant's application; none = created by the team (as before FEAT-022).
  application: { status: string } | null = null,
) {
  const state = restaurant ? { ...restaurant, id: 'r1', slug: 'r1-slug', name: 'R1' } : null;
  const client: Record<string, unknown> = {
    restaurantApplication: { findUnique: vi.fn().mockResolvedValue(application) },
    restaurant: {
      findUnique: vi.fn().mockResolvedValue(state),
      findUniqueOrThrow: vi.fn().mockResolvedValue(state),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state!, data);
        return Promise.resolve(state);
      }),
      create: vi.fn(),
    },
    city: { findUnique: vi.fn() },
    // FEAT-022 (part 3 review, #5): the application's lock, then the same client.
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  client['$transaction'] = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(client));
  return client as unknown as PrismaService;
}

const auditStub = () => ({ log: vi.fn().mockResolvedValue(undefined) }) as unknown as AuditService;

const availabilityStub = (status: 'OPEN' | 'CLOSED' | 'PAUSED' | 'UNAVAILABLE' = 'OPEN') =>
  ({
    computeForRestaurant: vi.fn().mockResolvedValue(status),
  }) as unknown as RestaurantAvailabilityService;

/**
 * Bloc 9.1 (docs/31 §restaurant-ownership) — `isMemberOfRestaurant` is a
 * controllable boolean here, never a real `user_roles` lookup. Tests that
 * care about the EXACT (userId, restaurantId) pair pass `membersOf` to
 * assert the stub is actually consulted with the right arguments, not just
 * stubbed to always succeed.
 */
function usersStub(
  membersOf: Set<string> = new Set(['owner-1:r1']),
  restaurantScope: string | null = null,
  // FEAT-022 (review of part 3, R3-1): the restaurant the account owns by its role.
  ownedScope: string | null = null,
) {
  return {
    isMemberOfRestaurant: vi.fn((userId: string, restaurantId: string) =>
      Promise.resolve(membersOf.has(`${userId}:${restaurantId}`)),
    ),
    getRestaurantScope: vi.fn().mockResolvedValue(restaurantScope),
    getOwnedRestaurantScope: vi.fn().mockResolvedValue(ownedScope),
  } as unknown as UsersService;
}

describe('RestaurantsManagementService.assertCanManage (Bloc 9.1, docs/31 §restaurant-ownership)', () => {
  it('a member of the restaurant (via user_roles, regardless of ownerUserId) is allowed', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: 'someone-else' });
    const users = usersStub(new Set(['staff-1:r1']));
    const svc = new RestaurantsManagementService(prisma, auditStub(), users, availabilityStub());

    await expect(svc.assertCanManage('staff-1', 'r1', false)).resolves.toMatchObject({
      status: 'active',
    });
    expect(users.isMemberOfRestaurant).toHaveBeenCalledWith('staff-1', 'r1');
  });

  it('a NON-member is rejected — even if they ARE Restaurant.ownerUserId (no silent divergence between ownership and role)', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' });
    const users = usersStub(new Set()); // owner-1 holds NO role grant for r1
    const svc = new RestaurantsManagementService(prisma, auditStub(), users, availabilityStub());

    await expect(svc.assertCanManage('owner-1', 'r1', false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('a member of a DIFFERENT restaurant is rejected — cross-restaurant access stays closed', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: null });
    const users = usersStub(new Set(['staff-of-b:restaurant-b']));
    const svc = new RestaurantsManagementService(prisma, auditStub(), users, availabilityStub());

    await expect(svc.assertCanManage('staff-of-b', 'r1', false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('admin tier bypasses membership entirely — never even calls isMemberOfRestaurant', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: null });
    const users = usersStub(new Set());
    const svc = new RestaurantsManagementService(prisma, auditStub(), users, availabilityStub());

    await expect(svc.assertCanManage('admin-1', 'r1', true)).resolves.toMatchObject({
      status: 'active',
    });
    expect(users.isMemberOfRestaurant).not.toHaveBeenCalled();
  });

  it('throws NotFound for a non-existent restaurant before even checking membership', async () => {
    const prisma = prismaStub(null);
    const users = usersStub();
    const svc = new RestaurantsManagementService(prisma, auditStub(), users, availabilityStub());

    await expect(svc.assertCanManage('anyone', 'missing', false)).rejects.toThrow(
      NotFoundException,
    );
    expect(users.isMemberOfRestaurant).not.toHaveBeenCalled();
  });
});

describe('update — status transition rules (docs/20 §6, §35)', () => {
  it('a restaurant_staff member (isAdminTier=false) MAY set draft/active/paused for their OWN restaurant', async () => {
    const prisma = prismaStub({ status: 'draft', ownerUserId: 'someone-else' });
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(new Set(['staff-1:r1'])),
      availabilityStub(),
    );
    const result = await svc.update('staff-1', 'r1', { status: 'active' }, false);
    expect(result.status).toBe('active');
  });

  it('a non-member is rejected BEFORE the status-transition rule is even evaluated', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' });
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(new Set()),
      availabilityStub(),
    );
    await expect(svc.update('owner-1', 'r1', { status: 'active' }, false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('a member (isAdminTier=false) may NOT set suspended', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' });
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(new Set(['owner-1:r1'])),
      availabilityStub(),
    );
    await expect(svc.update('owner-1', 'r1', { status: 'suspended' }, false)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('a member (isAdminTier=false) may NOT set closed', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' });
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(new Set(['owner-1:r1'])),
      availabilityStub(),
    );
    await expect(svc.update('owner-1', 'r1', { status: 'closed' }, false)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('admin tier (isAdminTier=true) MAY set suspended, without needing a role grant at all', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' });
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(new Set()),
      availabilityStub(),
    );
    const result = await svc.update('admin-1', 'r1', { status: 'suspended' }, true);
    expect(result.status).toBe('suspended');
  });

  it('non-status updates (e.g. renaming) never require admin tier — a plain member suffices', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' });
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(new Set(['owner-1:r1'])),
      availabilityStub(),
    );
    await expect(svc.update('owner-1', 'r1', { name: 'New Name' }, false)).resolves.toBeDefined();
  });

  it('throws NotFound when the restaurant does not exist', async () => {
    const prisma = prismaStub(null);
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(),
      availabilityStub(),
    );
    await expect(svc.update('owner-1', 'missing', { name: 'X' }, false)).rejects.toThrow(
      NotFoundException,
    );
  });
});

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (review of parts 1-2, finding 1).
describe('update — a restaurant that signed up opens only once DJAFAT approved it (SPEC-022-03 R3)', () => {
  it.each(['active', 'paused'] as const)(
    'SPEC-022-03-SC02 — its owner cannot set %s while the application is not approved (409), nothing changes',
    async (status) => {
      for (const pending of ['to_complete', 'pending_review', 'rejected']) {
        const prisma = prismaStub({ status: 'draft', ownerUserId: 'owner-1' }, { status: pending });
        const svc = new RestaurantsManagementService(
          prisma,
          auditStub(),
          usersStub(new Set(['owner-1:r1'])),
          availabilityStub(),
        );
        await expect(svc.update('owner-1', 'r1', { status }, false)).rejects.toMatchObject({
          response: { code: 'RESTAURANT_NOT_APPROVED' },
        });
        expect(prisma.restaurant.update).not.toHaveBeenCalled();
      }
    },
  );

  it('once approved, its owner pauses and reopens it as any restaurant', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' }, { status: 'approved' });
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(new Set(['owner-1:r1'])),
      availabilityStub(),
    );
    expect((await svc.update('owner-1', 'r1', { status: 'paused' }, false)).status).toBe('paused');
    expect((await svc.update('owner-1', 'r1', { status: 'active' }, false)).status).toBe('active');
  });

  it('its owner can still rename it and keep it as a draft before the approval', async () => {
    const prisma = prismaStub(
      { status: 'draft', ownerUserId: 'owner-1' },
      { status: 'to_complete' },
    );
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(new Set(['owner-1:r1'])),
      availabilityStub(),
    );
    await expect(
      svc.update('owner-1', 'r1', { name: 'Chez Fatimé', status: 'draft' }, false),
    ).resolves.toMatchObject({ name: 'Chez Fatimé', status: 'draft' });
  });
});

// FEAT-022 part 3 — SPEC-022-05 R5.
describe('update — while DJAFAT checks the application, steps 1 and 3 do not change (SPEC-022-05 R5)', () => {
  it.each([{ addressText: 'Avenue Mobutu, Moursal' }])(
    'SPEC-022-05 R5 — the owner cannot change %o (409 APPLICATION_LOCKED), nothing changes',
    async (input) => {
      const prisma = prismaStub(
        { status: 'pending_review', ownerUserId: 'owner-1' },
        { status: 'pending_review' },
      );
      const svc = new RestaurantsManagementService(
        prisma,
        auditStub(),
        usersStub(new Set(['owner-1:r1'])),
        availabilityStub(),
      );
      await expect(svc.update('owner-1', 'r1', input, false)).rejects.toMatchObject({
        status: 409,
        response: { code: 'APPLICATION_LOCKED' },
      });
      expect(prisma.restaurant.update).not.toHaveBeenCalled();
    },
  );

  it('the description still changes; rejected, the address changes again; the team is never locked', async () => {
    const pending = prismaStub(
      { status: 'pending_review', ownerUserId: 'owner-1' },
      { status: 'pending_review' },
    );
    const owner = new RestaurantsManagementService(
      pending,
      auditStub(),
      usersStub(new Set(['owner-1:r1'])),
      availabilityStub(),
    );
    await expect(
      owner.update('owner-1', 'r1', { description: 'Grillades et jus frais' }, false),
    ).resolves.toBeDefined();
    await expect(
      owner.update('admin-1', 'r1', { addressText: 'Avenue Mobutu' }, true),
    ).resolves.toBeDefined();

    const rejected = prismaStub(
      { status: 'draft', ownerUserId: 'owner-1' },
      { status: 'rejected' },
    );
    const corrected = new RestaurantsManagementService(
      rejected,
      auditStub(),
      usersStub(new Set(['owner-1:r1'])),
      availabilityStub(),
    );
    await expect(
      corrected.update('owner-1', 'r1', { addressText: 'Avenue Mobutu' }, false),
    ).resolves.toBeDefined();
  });
});

// FEAT-022 part 3 review, round 2 (R2-1) — SPEC-022-05 R5.
describe('update — during the review the status follows the application (SPEC-022-05 R5)', () => {
  it('the owner cannot set « draft » while DJAFAT checks the application (409 APPLICATION_LOCKED), nothing changes', async () => {
    const prisma = prismaStub(
      { status: 'pending_review', ownerUserId: 'owner-1' },
      { status: 'pending_review' },
    );
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(new Set(['owner-1:r1'])),
      availabilityStub(),
    );
    await expect(svc.update('owner-1', 'r1', { status: 'draft' }, false)).rejects.toMatchObject({
      status: 409,
      response: { code: 'APPLICATION_LOCKED' },
    });
    expect(prisma.restaurant.update).not.toHaveBeenCalled();
  });
});

// FEAT-022 part 3 review, round 2 (R2-2) — FEAT-022-Q06, Q20.
describe('create — an owner has one restaurant, and types no photo address', () => {
  function createStub(owned: number) {
    const created: unknown[] = [];
    const client: Record<string, unknown> = {
      city: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'city-1',
          countryId: 'td',
          country: { currency: 'XAF' },
        }),
      },
      restaurant: {
        findUnique: vi.fn().mockResolvedValue(null), // the slug is free
        count: vi.fn().mockResolvedValue(owned),
        create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ id: 'r-new', ...data });
        }),
      },
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    client['$transaction'] = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(client));
    return { prisma: client as unknown as PrismaService, created };
  }
  const input = { cityId: 'city-1', name: 'Chez Halimé' };

  it('a first restaurant is created (draft); a second one is refused (409 ROLE_ALREADY_HELD)', async () => {
    const first = createStub(0);
    const svc = new RestaurantsManagementService(
      first.prisma,
      auditStub(),
      usersStub(),
      availabilityStub(),
    );
    await expect(svc.create('owner-1', input)).resolves.toMatchObject({ status: 'draft' });

    const second = createStub(1);
    const again = new RestaurantsManagementService(
      second.prisma,
      auditStub(),
      usersStub(),
      availabilityStub(),
    );
    await expect(again.create('owner-1', input)).rejects.toMatchObject({
      status: 409,
      response: { code: 'ROLE_ALREADY_HELD' },
    });
    expect(second.created).toEqual([]);
  });

  it('review note R3-1 — the owner of a restaurant created by the team (owner by role only) creates no second one', async () => {
    const stub = createStub(0); // `ownerUserId` names the admin who created it
    const svc = new RestaurantsManagementService(
      stub.prisma,
      auditStub(),
      usersStub(new Set(), null, 'r-team'),
      availabilityStub(),
    );
    await expect(svc.create('owner-1', input)).rejects.toMatchObject({
      status: 409,
      response: { code: 'ROLE_ALREADY_HELD' },
    });
    expect(stub.created).toEqual([]);
  });

  it('an owner sending a logo address is refused (403); the team creates without limit', async () => {
    const stub = createStub(3);
    const svc = new RestaurantsManagementService(
      stub.prisma,
      auditStub(),
      usersStub(),
      availabilityStub(),
    );
    await expect(
      svc.create('owner-1', { ...input, logoUrl: 'https://cdn.example.com/logo.png' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      svc.create('admin-1', { ...input, logoUrl: 'https://cdn.example.com/logo.png' }, true),
    ).resolves.toMatchObject({ id: 'r-new' });
  });
});

// FEAT-022 part 3 review, #1 — SPEC-022-05 R1 v2, FEAT-022-Q20.
describe('update — an owner never types the logo or cover address (FEAT-022-Q20)', () => {
  it.each([
    { logoUrl: 'http://api.test/v1/files/public-00000000-0000-4000-8000-0000000000ff.jpg' },
    { coverUrl: 'https://cdn.example.com/cover.png' },
  ])(
    'an owner sending %o is refused (403), whatever the application’s state; nothing changes',
    async (input) => {
      for (const application of [null, { status: 'to_complete' }, { status: 'approved' }]) {
        const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' }, application);
        const svc = new RestaurantsManagementService(
          prisma,
          auditStub(),
          usersStub(new Set(['owner-1:r1'])),
          availabilityStub(),
        );
        await expect(svc.update('owner-1', 'r1', input, false)).rejects.toMatchObject({
          status: 403,
          response: { code: 'FORBIDDEN' },
        });
        expect(prisma.restaurant.update).not.toHaveBeenCalled();
      }
    },
  );

  it('the team still sets a logo address (admin tier)', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' });
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(new Set()),
      availabilityStub(),
    );
    await expect(
      svc.update('admin-1', 'r1', { logoUrl: 'https://cdn.example.com/logo.png' }, true),
    ).resolves.toBeDefined();
    expect(prisma.restaurant.update).toHaveBeenCalled();
  });
});

describe('listForAdmin (Bloc 9, docs/30 §admin-api)', () => {
  function listPrismaStub(
    rows: Array<{
      id: string;
      slug: string;
      name: string;
      status: string;
      ownerUserId: string | null;
    }>,
  ) {
    return {
      restaurant: {
        findMany: vi.fn(
          (args: {
            where: { status?: string; name?: { contains: string } };
            skip: number;
            take: number;
          }) => {
            let matches = rows;
            if (args.where.status) matches = matches.filter((r) => r.status === args.where.status);
            if (args.where.name?.contains) {
              const term = args.where.name.contains.toLowerCase();
              matches = matches.filter((r) => r.name.toLowerCase().includes(term));
            }
            return Promise.resolve(matches.slice(args.skip, args.skip + args.take));
          },
        ),
        count: vi.fn((args: { where: { status?: string; name?: { contains: string } } }) => {
          let matches = rows;
          if (args.where.status) matches = matches.filter((r) => r.status === args.where.status);
          if (args.where.name?.contains) {
            const term = args.where.name.contains.toLowerCase();
            matches = matches.filter((r) => r.name.toLowerCase().includes(term));
          }
          return Promise.resolve(matches.length);
        }),
      },
    } as unknown as PrismaService;
  }

  it('lists every status, not just the public ones — the whole point of an admin view', async () => {
    const prisma = listPrismaStub([
      { id: 'r1', slug: 'r1', name: 'Active One', status: 'active', ownerUserId: 'u1' },
      { id: 'r2', slug: 'r2', name: 'Paused One', status: 'paused', ownerUserId: 'u2' },
      { id: 'r3', slug: 'r3', name: 'Suspended One', status: 'suspended', ownerUserId: null },
    ]);
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(),
      availabilityStub(),
    );
    const result = await svc.listForAdmin(undefined, undefined, 1, 20);
    expect(result.total).toBe(3);
    expect(result.items.map((r) => r.status)).toEqual(
      expect.arrayContaining(['active', 'paused', 'suspended']),
    );
  });

  it('filters by status', async () => {
    const prisma = listPrismaStub([
      { id: 'r1', slug: 'r1', name: 'A', status: 'active', ownerUserId: null },
      { id: 'r2', slug: 'r2', name: 'B', status: 'suspended', ownerUserId: null },
    ]);
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(),
      availabilityStub(),
    );
    const result = await svc.listForAdmin(undefined, 'suspended', 1, 20);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.status).toBe('suspended');
  });

  it('paginates', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`,
      slug: `r${i}`,
      name: `R${i}`,
      status: 'active',
      ownerUserId: null,
    }));
    const prisma = listPrismaStub(rows);
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(),
      availabilityStub(),
    );
    const result = await svc.listForAdmin(undefined, undefined, 1, 2);
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(5);
  });
});

describe('getMine / replaceHours (Bloc 10, docs/33 §profile, §hours)', () => {
  function profilePrismaStub(
    restaurant: {
      id: string;
      slug: string;
      name: string;
      description: string | null;
      phone: string | null;
      addressText: string | null;
      logoUrl: string | null;
      coverUrl: string | null;
      currency: string;
      status: string;
      prepTimeMin: number;
      minOrderMinor: bigint;
      city: { timezone: string };
      hours: Array<{ weekday: number; opensMinutes: number; closesMinutes: number }>;
    } | null,
    // FEAT-022: the restaurant's application; none = created by the team (as before FEAT-022).
    application: { status: string } | null = null,
  ) {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const client: Record<string, unknown> = {
      restaurant: { findUniqueOrThrow: vi.fn().mockResolvedValue(restaurant) },
      restaurantApplication: { findUnique: vi.fn().mockResolvedValue(application) },
      restaurantHours: { deleteMany, createMany },
      // FEAT-022 (part 3 review, #5): one interactive transaction under the application's lock.
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    client['$transaction'] = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(client));
    return {
      prisma: client as unknown as PrismaService,
      deleteMany,
      createMany,
    };
  }

  it('getMine resolves the caller’s OWN scope — never a client-supplied restaurantId', async () => {
    const { prisma } = profilePrismaStub({
      id: 'r1',
      slug: 'r1-slug',
      name: 'R1',
      description: null,
      phone: null,
      addressText: null,
      logoUrl: null,
      coverUrl: null,
      currency: 'XAF',
      status: 'active',
      prepTimeMin: 20,
      minOrderMinor: 1000n,
      city: { timezone: 'Africa/Ndjamena' },
      hours: [{ weekday: 1, opensMinutes: 480, closesMinutes: 1320 }],
    });
    const users = usersStub(new Set(), 'r1');
    const availability = availabilityStub('OPEN');
    const svc = new RestaurantsManagementService(prisma, auditStub(), users, availability);

    const profile = await svc.getMine('owner-1');
    expect(users.getRestaurantScope).toHaveBeenCalledWith('owner-1');
    expect(profile).toMatchObject({
      id: 'r1',
      availability: 'OPEN',
      cityTimezone: 'Africa/Ndjamena',
      hours: [{ weekday: 1, opensMinutes: 480, closesMinutes: 1320 }],
    });
    expect(availability.computeForRestaurant).toHaveBeenCalledWith('r1');
  });

  it('getMine refuses an actor with no restaurant scope at all', async () => {
    const { prisma } = profilePrismaStub(null);
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(new Set(), null),
      availabilityStub(),
    );
    await expect(svc.getMine('nobody')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('replaceHours deletes then recreates the week for the caller’s OWN restaurant, in one transaction', async () => {
    const { prisma, deleteMany, createMany } = profilePrismaStub(null);
    const users = usersStub(new Set(), 'r1');
    const svc = new RestaurantsManagementService(prisma, auditStub(), users, availabilityStub());

    const hours = [
      { weekday: 1, opensMinutes: 480, closesMinutes: 1320 },
      { weekday: 2, opensMinutes: 480, closesMinutes: 1320 },
    ];
    const result = await svc.replaceHours('owner-1', { hours });
    expect(result).toEqual(hours);
    expect(deleteMany).toHaveBeenCalledWith({ where: { restaurantId: 'r1' } });
    expect(createMany).toHaveBeenCalledWith({
      data: hours.map((h) => ({ restaurantId: 'r1', ...h })),
    });
  });

  // FEAT-022 — SPEC-022-05 R5 (part 3)
  it('SPEC-022-05 R5 — while DJAFAT checks the application, the hours do not change (409 APPLICATION_LOCKED)', async () => {
    const { prisma, deleteMany } = profilePrismaStub(null, { status: 'pending_review' });
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(new Set(), 'r1'),
      availabilityStub(),
    );
    await expect(
      svc.replaceHours('owner-1', {
        hours: [{ weekday: 1, opensMinutes: 480, closesMinutes: 1320 }],
      }),
    ).rejects.toMatchObject({ status: 409, response: { code: 'APPLICATION_LOCKED' } });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('replaceHours refuses an actor with no restaurant scope', async () => {
    const { prisma } = profilePrismaStub(null);
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(new Set(), null),
      availabilityStub(),
    );
    await expect(svc.replaceHours('nobody', { hours: [] })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
