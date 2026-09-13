import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RestaurantsManagementService } from './restaurants-management.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../../common/audit/audit.service';

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

describe('RestaurantsManagementService', () => {
  describe('getOwnerUserId (docs/19 §21 ownership resolution)', () => {
    it('returns the actual owner id when one is set', async () => {
      const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' });
      const svc = new RestaurantsManagementService(prisma, auditStub());
      expect(await svc.getOwnerUserId('r1')).toBe('owner-1');
    });

    it('returns a sentinel that no real user id can ever match when there is no owner', async () => {
      const prisma = prismaStub({ status: 'active', ownerUserId: null });
      const svc = new RestaurantsManagementService(prisma, auditStub());
      const result = await svc.getOwnerUserId('r1');
      expect(result).not.toBe(null);
      expect(result).not.toBe('owner-1');
    });

    it('throws NotFound for a non-existent restaurant (never returns a sentinel for "missing")', async () => {
      const prisma = prismaStub(null);
      const svc = new RestaurantsManagementService(prisma, auditStub());
      await expect(svc.getOwnerUserId('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update — status transition rules (docs/20 §6, §35)', () => {
    it('an owner (isAdminTier=false) MAY set draft/active/paused themselves', async () => {
      const prisma = prismaStub({ status: 'draft', ownerUserId: 'owner-1' });
      const svc = new RestaurantsManagementService(prisma, auditStub());
      const result = await svc.update('owner-1', 'r1', { status: 'active' }, false);
      expect(result.status).toBe('active');
    });

    it('an owner (isAdminTier=false) may NOT set suspended', async () => {
      const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' });
      const svc = new RestaurantsManagementService(prisma, auditStub());
      await expect(svc.update('owner-1', 'r1', { status: 'suspended' }, false)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('an owner (isAdminTier=false) may NOT set closed', async () => {
      const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' });
      const svc = new RestaurantsManagementService(prisma, auditStub());
      await expect(svc.update('owner-1', 'r1', { status: 'closed' }, false)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('admin tier (isAdminTier=true) MAY set suspended', async () => {
      const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' });
      const svc = new RestaurantsManagementService(prisma, auditStub());
      const result = await svc.update('admin-1', 'r1', { status: 'suspended' }, true);
      expect(result.status).toBe('suspended');
    });

    it('non-status updates (e.g. renaming) never require admin tier', async () => {
      const prisma = prismaStub({ status: 'active', ownerUserId: 'owner-1' });
      const svc = new RestaurantsManagementService(prisma, auditStub());
      await expect(svc.update('owner-1', 'r1', { name: 'New Name' }, false)).resolves.toBeDefined();
    });

    it('throws NotFound when the restaurant does not exist', async () => {
      const prisma = prismaStub(null);
      const svc = new RestaurantsManagementService(prisma, auditStub());
      await expect(svc.update('owner-1', 'missing', { name: 'X' }, false)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
