import {
  createParamDecorator,
  type ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { AuthenticatedActor } from '@djafat/types';
import type { RequestWithActor } from './actor-resolver.service';

/**
 * `@CurrentActor()` — the resolved caller, set by any of the `Require*`
 * guards (docs/19 §2). Throws loudly if used on a route with none of them:
 * a missing actor here is a PROGRAMMING error (route forgot `@RequireAuth()`
 * or equivalent), not a 401 — never silently treat "no actor" as "anonymous".
 */
export const CurrentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedActor => {
    const req = ctx.switchToHttp().getRequest<RequestWithActor>();
    if (!req.actor) {
      throw new InternalServerErrorException(
        'CurrentActor() used on a route with no auth guard — add @RequireAuth() or a Require*() decorator.',
      );
    }
    return req.actor;
  },
);
