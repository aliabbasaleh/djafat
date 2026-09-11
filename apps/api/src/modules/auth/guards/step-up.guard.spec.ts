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
