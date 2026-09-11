import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthenticatedActor } from '@djafat/types';
import { PermissionsGuard } from './permissions.guard';
import type { ActorResolverService, RequestWithActor } from '../actor-resolver.service';

const actor = (permissions: AuthenticatedActor['permissions']): AuthenticatedActor => ({
  userId: 'u1',
  sessionId: 's1',
  roles: ['support'],
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

describe('PermissionsGuard', () => {
  it('allows when no permissions are required', async () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const resolver = { resolve: vi.fn() } as unknown as ActorResolverService;
    const guard = new PermissionsGuard(reflector, resolver);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).resolves.toBe(true);
  });

  it('allows when the actor has the required permission', async () => {
    const reflector = { getAllAndOverride: () => ['orders:read'] } as unknown as Reflector;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(actor(['orders:read', 'payments:read'])),
    } as unknown as ActorResolverService;
    const guard = new PermissionsGuard(reflector, resolver);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).resolves.toBe(true);
  });

  it('DENIES when the actor is missing the required permission (deny by default)', async () => {
    const reflector = { getAllAndOverride: () => ['ledger:write'] } as unknown as Reflector;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(actor(['ledger:read'])),
    } as unknown as ActorResolverService;
    const guard = new PermissionsGuard(reflector, resolver);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('requires ALL listed permissions, not just one', async () => {
    const reflector = {
      getAllAndOverride: () => ['orders:read', 'payments:refund'],
    } as unknown as Reflector;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(actor(['orders:read'])), // missing payments:refund
    } as unknown as ActorResolverService;
    const guard = new PermissionsGuard(reflector, resolver);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('nobody is ever granted ledger:write by this guard alone (no role grants it — data-driven, see seed.ts)', async () => {
    const reflector = { getAllAndOverride: () => ['ledger:write'] } as unknown as Reflector;
    const resolver = {
      // even super_admin's resolved permission set never includes ledger:write (seed.ts) — simulated here directly.
      resolve: vi.fn().mockResolvedValue(actor(['ledger:read', 'admin:write'])),
    } as unknown as ActorResolverService;
    const guard = new PermissionsGuard(reflector, resolver);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
