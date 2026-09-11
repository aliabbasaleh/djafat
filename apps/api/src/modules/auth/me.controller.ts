import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { UsersService } from '../users/users.service';
import { CurrentActor } from './current-actor.decorator';
import { RequireAuth } from './decorators';

/**
 * `GET /v1/me` (docs/07 §"Auth") — lives in `auth`, not `users`: `users`
 * never imports `auth`'s guards (that would make the two modules mutually
 * dependent). `auth` already legitimately imports `UsersModule`.
 */
@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequireAuth()
  async getMe(@CurrentActor() actor: AuthenticatedActor) {
    const user = await this.users.getByIdOrThrow(actor.userId);
    return this.users.toMeDto(user, actor.roles);
  }
}
