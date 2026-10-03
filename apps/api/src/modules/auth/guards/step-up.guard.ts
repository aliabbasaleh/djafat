import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, HttpException } from '@nestjs/common';
import type { Role } from '@djafat/types';
import { ActorResolverService, type RequestWithActor } from '../actor-resolver.service';
import { SessionService } from '../session.service';
import { AppConfigService } from '../../../common/config/config.service';
import { REQUIRE_STEP_UP_KEY } from '../decorators';

type StepUpRequirement = true | readonly Role[] | undefined;

/**
 * `@RequireStepUp()` — sensitive actions need RECENT MFA re-authentication,
 * not just a valid session (docs/19 §23, docs/05 §5.4 "< 10 min"). Unlike
 * the base `AuthGuard`, this ALWAYS reads the session fresh from the DB —
 * step-up state can expire mid-access-token-lifetime and that must take
 * effect immediately; these routes are rare/low-frequency enough that the
 * extra read is a non-issue.
 *
 * Bloc 9.1 (BUG-3, docs/31 §mfa-effective): the metadata set by
 * `@RequireStepUp()` is either the literal `true` (unconditional — step-up
 * applies to every actor who reaches this route) or a role list (step-up
 * applies ONLY to an actor whose role intersects it). This is what lets
 * `MFA_REQUIRED_ROLES` actually decide something at runtime instead of
 * being a constant nobody reads: a route can pass it straight into
 * `@RequireStepUp(MFA_REQUIRED_ROLES)` and the intersection below is the
 * real, executed decision. This NEVER grants or widens authorization — an
 * actor outside the list is simply exempt from the SECOND factor on this
 * one route; `RolesGuard`/`PermissionsGuard` (which already ran, see the
 * call sites' decorator order) are the only source of the "may this actor
 * reach this route at all" decision, unchanged.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: ActorResolverService,
    private readonly sessions: SessionService,
    private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<StepUpRequirement>(REQUIRE_STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<RequestWithActor>();
    const actor = await this.resolver.resolve(req);

    if (Array.isArray(required) && !required.some((role: Role) => actor.roles.includes(role))) {
      return true; // this actor's role is not subject to the MFA policy for this route
    }

    const session = await this.sessions.getActiveSession(actor.sessionId);
    if (!session) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Session no longer active.' });
    }

    const windowMs = this.config.get('STEP_UP_WINDOW_SECONDS') * 1000;
    const fresh =
      session.stepUpVerifiedAt !== null &&
      Date.now() - session.stepUpVerifiedAt.getTime() <= windowMs;
    if (!fresh) {
      throw new HttpException(
        { code: 'STEP_UP_REQUIRED', message: 'This action requires recent MFA re-authentication.' },
        428, // Precondition Required — not in @nestjs/common's HttpStatus enum
      );
    }
    return true;
  }
}
