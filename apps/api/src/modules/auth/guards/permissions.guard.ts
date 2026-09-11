import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@djafat/types';
import { ActorResolverService, type RequestWithActor } from '../actor-resolver.service';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators';

/** `@RequirePermission(...)` — resolved from `role_permissions`, never an `if (role === ...)` (docs/19 §17-19). */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: ActorResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<RequestWithActor>();
    const actor = await this.resolver.resolve(req);
    const allowed = required.every((p) => actor.permissions.includes(p));
    if (!allowed) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: `Requires permission(s): ${required.join(', ')}.`,
      });
    }
    return true;
  }
}
