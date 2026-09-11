import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedActor } from '@djafat/types';
import { UsersService } from '../users/users.service';
import { TokenService } from './token.service';

export type RequestWithActor = FastifyRequest & { actor?: AuthenticatedActor };

/**
 * The single place that turns a `Bearer` header into an `AuthenticatedActor`
 * (docs/19 §2, §13). Every guard below calls this FIRST and idempotently —
 * order between `@UseGuards(...)` entries never matters, each one just
 * ensures `req.actor` exists before checking its own concern.
 *
 * Deliberately NOT fully stateless: `roles` come from the (short-lived,
 * signed) access token, but `permissions` and account `status` are resolved
 * FRESH from the DB on every call — a role change or suspension takes effect
 * on the very next request, not after the access token happens to expire.
 * Session revocation itself is the one thing NOT re-checked here (docs/19
 * §13 "selon politique") — `logout`/`logout-all` take effect for `refresh`
 * immediately, but an already-issued (15 min) access token keeps working
 * until its own expiry. `StepUpGuard` does its own extra, session-scoped
 * DB read on top of this for the rare sensitive-action routes that need it.
 */
@Injectable()
export class ActorResolverService {
  constructor(
    private readonly tokenService: TokenService,
    private readonly users: UsersService,
  ) {}

  async resolve(req: RequestWithActor): Promise<AuthenticatedActor> {
    if (req.actor) return req.actor;

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Missing bearer token.',
      });
    }
    const payload = this.tokenService.verifyAccessToken(header.slice('Bearer '.length));

    const user = await this.users.getById(payload.sub);
    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'User not found.' });
    }
    if (user.status !== 'active') {
      throw new ForbiddenException({
        code: 'ACCOUNT_INACTIVE',
        message: `Account is ${user.status}.`,
      });
    }

    const permissions = await this.users.getPermissions(payload.roles);
    const actor: AuthenticatedActor = {
      userId: payload.sub,
      sessionId: payload.sid,
      roles: payload.roles,
      permissions,
      stepUpVerifiedAt: null, // resolved on demand — see class doc
    };
    req.actor = actor;
    return actor;
  }
}
