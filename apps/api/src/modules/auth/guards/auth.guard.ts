import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ActorResolverService, type RequestWithActor } from '../actor-resolver.service';

/** Base guard — resolves `req.actor` or throws `UNAUTHENTICATED`. Every other guard below implies this one. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly resolver: ActorResolverService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithActor>();
    await this.resolver.resolve(req);
    return true;
  }
}
