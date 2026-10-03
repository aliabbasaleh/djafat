import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthenticatedActor } from '@djafat/types';
import { StepUpGuard } from './step-up.guard';
import type { ActorResolverService, RequestWithActor } from '../actor-resolver.service';
import type { SessionService } from '../session.service';
import type { AppConfigService } from '../../../common/config/config.service';

const actor: AuthenticatedActor = {
  userId: 'u1',
  sessionId: 's1',
  roles: ['admin'],
  permissions: [],
  stepUpVerifiedAt: null,
};

function makeContext(req: RequestWithActor): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}) as never,
    getClass: () => ({}) as never,
  } as unknown as ExecutionContext;
}

const configStub = (windowSeconds = 600) =>
  ({ get: () => windowSeconds }) as unknown as AppConfigService;

describe('StepUpGuard', () => {
  it('allows when step-up is not required (undecorated route)', async () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const resolver = { resolve: vi.fn() } as unknown as ActorResolverService;
    const sessions = { getActiveSession: vi.fn() } as unknown as SessionService;
    const guard = new StepUpGuard(reflector, resolver, sessions, configStub());
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).resolves.toBe(true);
  });

  it('DENIES when the session has never stepped up (stepUpVerifiedAt is null)', async () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(actor),
    } as unknown as ActorResolverService;
    const sessions = {
      getActiveSession: vi.fn().mockResolvedValue({ id: 's1', stepUpVerifiedAt: null }),
    } as unknown as SessionService;
    const guard = new StepUpGuard(reflector, resolver, sessions, configStub());
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).rejects.toThrow(
      HttpException,
    );
  });

  it('allows within the step-up window', async () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(actor),
    } as unknown as ActorResolverService;
    const sessions = {
      getActiveSession: vi
        .fn()
        .mockResolvedValue({ id: 's1', stepUpVerifiedAt: new Date(Date.now() - 60_000) }), // 1 min ago
    } as unknown as SessionService;
    const guard = new StepUpGuard(reflector, resolver, sessions, configStub(600)); // 10 min window
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).resolves.toBe(true);
  });

  it('DENIES once the step-up window has elapsed', async () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(actor),
    } as unknown as ActorResolverService;
    const sessions = {
      getActiveSession: vi
        .fn()
        .mockResolvedValue({ id: 's1', stepUpVerifiedAt: new Date(Date.now() - 700_000) }), // ~11.6 min ago
    } as unknown as SessionService;
    const guard = new StepUpGuard(reflector, resolver, sessions, configStub(600)); // 10 min window
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).rejects.toThrow(
      HttpException,
    );
  });

  it('the rejection carries the STEP_UP_REQUIRED code', async () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(actor),
    } as unknown as ActorResolverService;
    const sessions = {
      getActiveSession: vi.fn().mockResolvedValue({ id: 's1', stepUpVerifiedAt: null }),
    } as unknown as SessionService;
    const guard = new StepUpGuard(reflector, resolver, sessions, configStub());
    try {
      await guard.canActivate(makeContext({} as RequestWithActor));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getResponse()).toMatchObject({ code: 'STEP_UP_REQUIRED' });
      expect((e as HttpException).getStatus()).toBe(428);
    }
  });

  it('DENIES when the session is no longer active (revoked/logged out)', async () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(actor),
    } as unknown as ActorResolverService;
    const sessions = {
      getActiveSession: vi.fn().mockResolvedValue(null),
    } as unknown as SessionService;
    const guard = new StepUpGuard(reflector, resolver, sessions, configStub());
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).rejects.toThrow(
      /no longer active/,
    );
  });
});

/**
 * Bloc 9.1 BUG-3 (docs/31 §mfa-effective) — `@RequireStepUp(roleList)`'s
 * role-filtered form. These tests deliberately stub the Reflector's
 * returned metadata directly (a plain role-array literal, never
 * `RolesGuard`/`@RequireRole`) to prove the GUARD's own branching logic in
 * isolation — "is this actor's role subject to the MFA policy" is a
 * different question from "may this actor reach the route at all", and
 * mixing them into one test would prove nothing about either. The
 * production wiring that `grantRole`/`revokeRole` actually pass the REAL
 * `MFA_REQUIRED_ROLES` constant here (not a coincidental copy) is proven
 * separately, by reference-identity, in `users-admin.controller.spec.ts`.
 */
describe('StepUpGuard — role-filtered form proves MFA_REQUIRED_ROLES-style config is causal, not decorative', () => {
  function stubbedGuard(
    requiredRoles: readonly string[],
    actorRoles: readonly string[],
    stepUpVerifiedAt: Date | null,
  ) {
    const reflector = { getAllAndOverride: () => requiredRoles } as unknown as Reflector;
    const resolver = {
      resolve: vi.fn().mockResolvedValue({ ...actor, roles: actorRoles }),
    } as unknown as ActorResolverService;
    const getActiveSession = vi.fn().mockResolvedValue({ id: 's1', stepUpVerifiedAt });
    const sessions = { getActiveSession } as unknown as SessionService;
    const guard = new StepUpGuard(reflector, resolver, sessions, configStub());
    return { guard, getActiveSession };
  }

  it('A. admin, in the policy, never stepped up -> step-up IS required (428)', async () => {
    const { guard } = stubbedGuard(['admin', 'super_admin'], ['admin'], null);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).rejects.toThrow(
      HttpException,
    );
  });

  it('A2. admin, in the policy, freshly stepped up -> allowed', async () => {
    const { guard } = stubbedGuard(['admin', 'super_admin'], ['admin'], new Date());
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).resolves.toBe(true);
  });

  it('B. super_admin, in the policy, never stepped up -> step-up IS required (428)', async () => {
    const { guard } = stubbedGuard(['admin', 'super_admin'], ['super_admin'], null);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).rejects.toThrow(
      HttpException,
    );
  });

  it('B2. super_admin, in the policy, freshly stepped up -> allowed', async () => {
    const { guard } = stubbedGuard(['admin', 'super_admin'], ['super_admin'], new Date());
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).resolves.toBe(true);
  });

  it('C. finance, NOT in the policy, never stepped up -> allowed WITHOUT a session check — the guard exempts this role before touching session state', async () => {
    const { guard, getActiveSession } = stubbedGuard(['admin', 'super_admin'], ['finance'], null);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).resolves.toBe(true);
    expect(getActiveSession).not.toHaveBeenCalled();
  });

  it('D. shrinking the policy to exclude admin -> an admin actor is no longer subject to step-up (never stepped up, still allowed)', async () => {
    const { guard } = stubbedGuard(['super_admin'], ['admin'], null);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).resolves.toBe(true);
  });

  it('E. growing the policy to include finance -> a finance actor, previously exempt, is now subject to step-up', async () => {
    const { guard } = stubbedGuard(['admin', 'super_admin', 'finance'], ['finance'], null);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).rejects.toThrow(
      HttpException,
    );
  });

  it('a multi-role actor is covered if ANY one of their roles intersects the policy', async () => {
    const { guard } = stubbedGuard(['super_admin'], ['support', 'super_admin'], null);
    await expect(guard.canActivate(makeContext({} as RequestWithActor))).rejects.toThrow(
      HttpException,
    );
  });

  it('the unconditional form (`true`) still applies to every actor, independent of role — unchanged for settlements/payments/sensitive-ping', async () => {
    const { guard: guardForOutsider } = (() => {
      const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
      const resolver = {
        resolve: vi.fn().mockResolvedValue({ ...actor, roles: ['finance'] }),
      } as unknown as ActorResolverService;
      const sessions = {
        getActiveSession: vi.fn().mockResolvedValue({ id: 's1', stepUpVerifiedAt: null }),
      } as unknown as SessionService;
      return { guard: new StepUpGuard(reflector, resolver, sessions, configStub()) };
    })();
    await expect(guardForOutsider.canActivate(makeContext({} as RequestWithActor))).rejects.toThrow(
      HttpException,
    );
  });
});
