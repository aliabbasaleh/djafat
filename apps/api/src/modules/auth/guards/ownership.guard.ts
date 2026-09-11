import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import type { Permission } from '@djafat/types';
import { ActorResolverService, type RequestWithActor } from '../actor-resolver.service';
import {
  OWNERSHIP_OVERRIDE_PERMISSION_KEY,
  OWNERSHIP_SPEC_KEY,
  type OwnershipSpec,
} from '../decorators';

/**
 * `@RequireOwnership(...)` (docs/19 §21). Resolves the target service
 * per-request via `ModuleRef.get(..., { strict: false })` — the only way to
 * reach a real DI-managed service instance from route metadata set by a
 * decorator (decorators run at class-definition time, with no controller
 * instance to close over — see `decorators.ts`).
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: ActorResolverService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const spec = this.reflector.getAllAndOverride<OwnershipSpec | undefined>(OWNERSHIP_SPEC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!spec) return true;

    const overridePermission = this.reflector.getAllAndOverride<Permission | undefined>(
      OWNERSHIP_OVERRIDE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    const req = context.switchToHttp().getRequest<RequestWithActor>();
    const actor = await this.resolver.resolve(req);

    if (overridePermission && actor.permissions.includes(overridePermission)) return true;

    const serviceInstance = this.moduleRef.get(spec.token, { strict: false });
    const ownerUserId = await spec.resolve(serviceInstance, req);
    if (ownerUserId !== actor.userId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not own this resource.' });
    }
    return true;
  }
}
