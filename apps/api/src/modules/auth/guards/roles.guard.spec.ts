import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthenticatedActor } from '@djafat/types';
import { RolesGuard } from './roles.guard';
import type { ActorResolverService, RequestWithActor } from '../actor-resolver.service';

const actor = (roles: AuthenticatedActor['roles']): AuthenticatedActor => ({
  userId: 'u1',
  sessionId: 's1',
  roles,
  permissions: [],
  stepUpVerifiedAt: null,
});

function makeContext(req: RequestWithActor): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}) as never,
    getClass: () => ({}) as never,
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows when no roles are required (undecorated route)', async () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const resolver = { resolve: vi.fn() } as unknown as ActorResolverService;
    const guard = new RolesGuard(reflector, resolver);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).resolves.toBe(true);
    expect(resolver.resolve).not.toHaveBeenCalled(); // never even resolves the actor if nothing is required
  });

  it('allows when the actor holds one of the required roles', async () => {
    const reflector = { getAllAndOverride: () => ['admin', 'super_admin'] } as unknown as Reflector;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(actor(['admin'])),
    } as unknown as ActorResolverService;
    const guard = new RolesGuard(reflector, resolver);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).resolves.toBe(true);
  });

  it('DENIES BY DEFAULT when the actor holds none of the required roles', async () => {
    const reflector = { getAllAndOverride: () => ['admin', 'super_admin'] } as unknown as Reflector;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(actor(['customer'])),
    } as unknown as ActorResolverService;
    const guard = new RolesGuard(reflector, resolver);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('a user with multiple roles is allowed if ANY of them matches', async () => {
    const reflector = { getAllAndOverride: () => ['finance'] } as unknown as Reflector;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(actor(['customer', 'finance'])),
    } as unknown as ActorResolverService;
    const guard = new RolesGuard(reflector, resolver);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).resolves.toBe(true);
  });
});
