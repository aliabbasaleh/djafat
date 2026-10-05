import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import type { Permission } from '@djafat/types';
import { isStaffTierFor } from '../../../common/authz/staff-tier';
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
 *
 * ROOT-CAUSE HARDENING (pre-Bloc-10, after the BUG-10.1.x family). The
 * `overridePermission` escape used to be "holds the permission ⇒ skip
 * ownership entirely". That single line was the shared root of four distinct
 * cross-tenant defects, because the seed grants `orders:read`,
 * `deliveries:read` and `deliveries:write` to `restaurant_owner`,
 * `restaurant_staff` and `courier` as well — so a tenant-scoped actor holding
 * a permission for its OWN resources silently gained access to EVERYONE's.
 *
 * The override now additionally requires a staff-tier ROLE (`isStaffTierFor`).
 * This is a strict narrowing — it can only refuse actors the old rule allowed,
 * never admit new ones — and it changes nothing for the overrides in the tree
 * today (`payments:read`/`payments:write`, held only by
 * support/finance/admin/super_admin). What it buys is that the NEXT
 * `@RequireOwnership(..., 'x:y')` written on a permission a tenant role
 * happens to hold cannot re-open the hole: the guard refuses to treat a
 * tenant role as staff, whatever permission is passed. RBAC itself is
 * untouched — no permission is added, removed or re-assigned.
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

    if (overridePermission && isStaffTierFor(actor, overridePermission)) return true;

    const serviceInstance = this.moduleRef.get(spec.token, { strict: false });
    const ownerUserId = await spec.resolve(serviceInstance, req);
    if (ownerUserId !== actor.userId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not own this resource.' });
    }
    return true;
  }
}
