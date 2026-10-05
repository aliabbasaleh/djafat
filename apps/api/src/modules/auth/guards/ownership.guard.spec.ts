import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { ModuleRef, Reflector } from '@nestjs/core';
import type { AuthenticatedActor } from '@djafat/types';
import { OwnershipGuard } from './ownership.guard';
import type { OwnershipSpec } from '../decorators';
import type { ActorResolverService, RequestWithActor } from '../actor-resolver.service';

const actor = (
  userId: string,
  permissions: AuthenticatedActor['permissions'] = [],
  roles: AuthenticatedActor['roles'] = ['customer'],
): AuthenticatedActor => ({
  userId,
  sessionId: 's1',
  roles,
  permissions,
  stepUpVerifiedAt: null,
});

function makeContext(req: RequestWithActor): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}) as never,
    getClass: () => ({}) as never,
  } as unknown as ExecutionContext;
}

class FakeOrdersService {
  getOwnerUserId: () => Promise<string> = vi.fn().mockResolvedValue('owner-1');
}

describe('OwnershipGuard', () => {
  it('allows when no ownership spec is declared', async () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const resolver = { resolve: vi.fn() } as unknown as ActorResolverService;
    const moduleRef = { get: vi.fn() } as unknown as ModuleRef;
    const guard = new OwnershipGuard(reflector, resolver, moduleRef);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).resolves.toBe(true);
  });

  it('allows the OWNER', async () => {
    const fakeOrders = new FakeOrdersService();
    const spec: OwnershipSpec = {
      token: FakeOrdersService,
      resolve: (svc, _req) => (svc as FakeOrdersService).getOwnerUserId(),
    };
    const reflector = {
      getAllAndOverride: (key: string) => (key === 'djafat:ownership-spec' ? spec : undefined),
    } as unknown as Reflector;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(actor('owner-1')),
    } as unknown as ActorResolverService;
    const moduleRef = { get: () => fakeOrders } as unknown as ModuleRef;
    const guard = new OwnershipGuard(reflector, resolver, moduleRef);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).resolves.toBe(true);
  });

  it('DENIES a non-owner (docs/19 §21 — "Customer B must never retrieve X just by knowing orderId")', async () => {
    const fakeOrders = new FakeOrdersService();
    const spec: OwnershipSpec = {
      token: FakeOrdersService,
      resolve: (svc, _req) => (svc as FakeOrdersService).getOwnerUserId(),
    };
    const reflector = {
      getAllAndOverride: (key: string) => (key === 'djafat:ownership-spec' ? spec : undefined),
    } as unknown as Reflector;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(actor('someone-else')),
    } as unknown as ActorResolverService;
    const moduleRef = { get: () => fakeOrders } as unknown as ModuleRef;
    const guard = new OwnershipGuard(reflector, resolver, moduleRef);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('a staff-tier override permission bypasses ownership entirely', async () => {
    const fakeOrders = new FakeOrdersService();
    const spec: OwnershipSpec = {
      token: FakeOrdersService,
      resolve: (svc, _req) => (svc as FakeOrdersService).getOwnerUserId(),
    };
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === 'djafat:ownership-spec'
          ? spec
          : key === 'djafat:ownership-override-permission'
            ? 'orders:read'
            : undefined,
    } as unknown as Reflector;
    const resolver = {
      // Was `actor('support-agent', ['orders:read'])` with the helper's default
      // `roles: ['customer']` — i.e. this test NAMED "staff-tier" was in fact
      // exercising the bypass that turned out to be BUG-10.1. The fixture now
      // matches the name.
      resolve: vi.fn().mockResolvedValue(actor('support-agent', ['orders:read'], ['support'])),
    } as unknown as ActorResolverService;
    const moduleRef = { get: () => fakeOrders } as unknown as ModuleRef;
    const guard = new OwnershipGuard(reflector, resolver, moduleRef);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).resolves.toBe(true);
    // The override short-circuits BEFORE resolving ownership at all — cheaper, and proves the bypass is real.
    expect(fakeOrders.getOwnerUserId).not.toHaveBeenCalled();
  });

  it('an override permission the actor does NOT have does not bypass ownership', async () => {
    const fakeOrders = new FakeOrdersService();
    const spec: OwnershipSpec = {
      token: FakeOrdersService,
      resolve: (svc, _req) => (svc as FakeOrdersService).getOwnerUserId(),
    };
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === 'djafat:ownership-spec'
          ? spec
          : key === 'djafat:ownership-override-permission'
            ? 'orders:read'
            : undefined,
    } as unknown as Reflector;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(actor('random-customer', [])), // no orders:read
    } as unknown as ActorResolverService;
    const moduleRef = { get: () => fakeOrders } as unknown as ModuleRef;
    const guard = new OwnershipGuard(reflector, resolver, moduleRef);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('propagates a NotFoundException thrown by the resolver unchanged (never masked as 403)', async () => {
    class NotFoundStub extends Error {}
    const throwing: { getOwnerUserId: () => Promise<string> } = {
      getOwnerUserId: vi.fn().mockRejectedValue(new NotFoundStub('no such order')),
    };
    const spec: OwnershipSpec = {
      token: FakeOrdersService,
      resolve: (svc, _req) => (svc as typeof throwing).getOwnerUserId(),
    };
    const reflector = {
      getAllAndOverride: (key: string) => (key === 'djafat:ownership-spec' ? spec : undefined),
    } as unknown as Reflector;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(actor('u1')),
    } as unknown as ActorResolverService;
    const moduleRef = { get: () => throwing } as unknown as ModuleRef;
    const guard = new OwnershipGuard(reflector, resolver, moduleRef);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).rejects.toThrow(
      NotFoundStub,
    );
  });
});

/**
 * Root-cause hardening after the BUG-10.1.x family (pre-Bloc-10). The override
 * used to be "holds the permission ⇒ skip ownership", which made every
 * permission the seed shares with a tenant-scoped role into a cross-tenant
 * key. It now requires a staff-tier ROLE as well.
 */
describe('OwnershipGuard — the override can no longer be used by a tenant-scoped role', () => {
  function build(actorValue: AuthenticatedActor, overridePermission = 'orders:read') {
    const fakeOrders = new FakeOrdersService();
    const spec: OwnershipSpec = {
      token: FakeOrdersService,
      resolve: (svc, _req) => (svc as FakeOrdersService).getOwnerUserId(),
    };
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === 'djafat:ownership-spec'
          ? spec
          : key === 'djafat:ownership-override-permission'
            ? overridePermission
            : undefined,
    } as unknown as Reflector;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(actorValue),
    } as unknown as ActorResolverService;
    const moduleRef = { get: () => fakeOrders } as unknown as ModuleRef;
    return { guard: new OwnershipGuard(reflector, resolver, moduleRef), fakeOrders };
  }

  it.each([
    ['restaurant_owner', 'orders:read'],
    ['restaurant_staff', 'orders:read'],
    ['courier', 'orders:read'],
    ['courier', 'deliveries:read'],
    ['courier', 'deliveries:write'],
    ['customer', 'orders:read'],
  ] as const)(
    'a %s holding %s is still subject to ownership — the permission alone no longer bypasses',
    async (role, permission) => {
      const { guard, fakeOrders } = build(actor('intruder', [permission], [role]), permission);
      await expect(guard.canActivate(makeContext({} as RequestWithActor))).rejects.toThrow(
        ForbiddenException,
      );
      // Ownership was ACTUALLY consulted — proof the override did not fire.
      expect(fakeOrders.getOwnerUserId).toHaveBeenCalled();
    },
  );

  it.each(['admin', 'super_admin', 'support', 'finance'] as const)(
    '%s with the permission still bypasses ownership — existing staff access preserved',
    async (role) => {
      const { guard, fakeOrders } = build(actor('staff-1', ['orders:read'], [role]));
      await expect(guard.canActivate(makeContext({} as RequestWithActor))).resolves.toBe(true);
      expect(fakeOrders.getOwnerUserId).not.toHaveBeenCalled();
    },
  );

  it('a staff-tier ROLE without the permission does not bypass — both halves required', async () => {
    const { guard } = build(actor('support-1', [], ['support']));
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('the OWNER is still allowed even when no override applies at all', async () => {
    const { guard } = build(actor('owner-1', [], ['customer']));
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).resolves.toBe(true);
  });

  it('a tenant role that IS the owner is allowed through ownership, not through the override', async () => {
    const { guard, fakeOrders } = build(actor('owner-1', ['orders:read'], ['courier']));
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).resolves.toBe(true);
    expect(fakeOrders.getOwnerUserId).toHaveBeenCalled();
  });
});
