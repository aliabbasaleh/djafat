import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RestaurantsManagementService } from './restaurants-management.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../../common/audit/audit.service';
import type { UsersService } from '../users/users.service';

function prismaStub(restaurant: { status: string; ownerUserId: string | null } | null) {
  const state = restaurant ? { ...restaurant, id: 'r1', slug: 'r1-slug', name: 'R1' } : null;
  return {
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
  } as unknown as PrismaService;
}

const auditStub = () => ({ log: vi.fn().mockResolvedValue(undefined) }) as unknown as AuditService;

/**
 * Bloc 9.1 (docs/31 §restaurant-ownership) — `isMemberOfRestaurant` is a
 * controllable boolean here, never a real `user_roles` lookup. Tests that
 * care about the EXACT (userId, restaurantId) pair pass `membersOf` to
 * assert the stub is actually consulted with the right arguments, not just
 * stubbed to always succeed.
 */
function usersStub(membersOf: Set<string> = new Set(['owner-1:r1'])) {
  return {
    isMemberOfRestaurant: vi.fn((userId: string, restaurantId: string) =>
      Promise.resolve(membersOf.has(`${userId}:${restaurantId}`)),
    ),
  } as unknown as UsersService;
}

describe('RestaurantsManagementService.assertCanManage (Bloc 9.1, docs/31 §restaurant-ownership)', () => {
  it('a member of the restaurant (via user_roles, regardless of ownerUserId) is allowed', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: 'someone-else' });
    const users = usersStub(new Set(['staff-1:r1']));
    const svc = new RestaurantsManagementService(prisma, auditStub(), users);

    await expect(svc.assertCanManage('staff-1', 'r1', false)).resolves.toMatchObject({
      status: 'active',
    });
    expect(users.isMemberOfRestaurant).toHaveBeenCalledWith('staff-1', 'r1');
  });

  it('a NON-member is rejected — even if they ARE Restaurant.ownerUserId (no silent divergence between ownership and role)', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' });
    const users = usersStub(new Set()); // owner-1 holds NO role grant for r1
    const svc = new RestaurantsManagementService(prisma, auditStub(), users);

    await expect(svc.assertCanManage('owner-1', 'r1', false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('a member of a DIFFERENT restaurant is rejected — cross-restaurant access stays closed', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: null });
    const users = usersStub(new Set(['staff-of-b:restaurant-b']));
    const svc = new RestaurantsManagementService(prisma, auditStub(), users);

    await expect(svc.assertCanManage('staff-of-b', 'r1', false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('admin tier bypasses membership entirely — never even calls isMemberOfRestaurant', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: null });
    const users = usersStub(new Set());
    const svc = new RestaurantsManagementService(prisma, auditStub(), users);

    await expect(svc.assertCanManage('admin-1', 'r1', true)).resolves.toMatchObject({
      status: 'active',
    });
    expect(users.isMemberOfRestaurant).not.toHaveBeenCalled();
  });

  it('throws NotFound for a non-existent restaurant before even checking membership', async () => {
    const prisma = prismaStub(null);
    const users = usersStub();
    const svc = new RestaurantsManagementService(prisma, auditStub(), users);

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
    );
    const result = await svc.update('staff-1', 'r1', { status: 'active' }, false);
    expect(result.status).toBe('active');
  });

  it('a non-member is rejected BEFORE the status-transition rule is even evaluated', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' });
    const svc = new RestaurantsManagementService(prisma, auditStub(), usersStub(new Set()));
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
    );
    await expect(svc.update('owner-1', 'r1', { status: 'closed' }, false)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('admin tier (isAdminTier=true) MAY set suspended, without needing a role grant at all', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' });
    const svc = new RestaurantsManagementService(prisma, auditStub(), usersStub(new Set()));
    const result = await svc.update('admin-1', 'r1', { status: 'suspended' }, true);
    expect(result.status).toBe('suspended');
  });

  it('non-status updates (e.g. renaming) never require admin tier — a plain member suffices', async () => {
    const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' });
    const svc = new RestaurantsManagementService(
      prisma,
      auditStub(),
      usersStub(new Set(['owner-1:r1'])),
    );
    await expect(svc.update('owner-1', 'r1', { name: 'New Name' }, false)).resolves.toBeDefined();
  });

  it('throws NotFound when the restaurant does not exist', async () => {
    const prisma = prismaStub(null);
    const svc = new RestaurantsManagementService(prisma, auditStub(), usersStub());
    await expect(svc.update('owner-1', 'missing', { name: 'X' }, false)).rejects.toThrow(
      NotFoundException,
    );
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
    const svc = new RestaurantsManagementService(prisma, auditStub(), usersStub());
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
    const svc = new RestaurantsManagementService(prisma, auditStub(), usersStub());
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
    const svc = new RestaurantsManagementService(prisma, auditStub(), usersStub());
    const result = await svc.listForAdmin(undefined, undefined, 1, 2);
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(5);
  });
});
