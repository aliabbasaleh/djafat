import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@djafat/types';
import { ActorResolverService, type RequestWithActor } from '../actor-resolver.service';
import { REQUIRED_ROLES_KEY } from '../decorators';

/** `@RequireRole(...)` — deny by default: no roles required = deny (docs/19 §20, §26). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: ActorResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<RequestWithActor>();
    const actor = await this.resolver.resolve(req);
    const allowed = actor.roles.some((r) => required.includes(r));
    if (!allowed) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: `Requires one of roles: ${required.join(', ')}.`,
      });
    }
    return true;
  }
}
