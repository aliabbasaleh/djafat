import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, HttpException } from '@nestjs/common';
import { ActorResolverService, type RequestWithActor } from '../actor-resolver.service';
import { SessionService } from '../session.service';
import { AppConfigService } from '../../../common/config/config.service';
import { REQUIRE_STEP_UP_KEY } from '../decorators';

/**
 * `@RequireStepUp()` — sensitive actions need RECENT MFA re-authentication,
 * not just a valid session (docs/19 §23, docs/05 §5.4 "< 10 min"). Unlike
 * the base `AuthGuard`, this ALWAYS reads the session fresh from the DB —
 * step-up state can expire mid-access-token-lifetime and that must take
 * effect immediately; these routes are rare/low-frequency enough that the
 * extra read is a non-issue.
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
    const required = this.reflector.getAllAndOverride<boolean | undefined>(REQUIRE_STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<RequestWithActor>();
    const actor = await this.resolver.resolve(req);
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
