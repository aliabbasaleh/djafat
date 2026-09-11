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
): AuthenticatedActor => ({
  userId,
  sessionId: 's1',
  roles: ['customer'],
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
      resolve: vi.fn().mockResolvedValue(actor('support-agent', ['orders:read'])),
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
