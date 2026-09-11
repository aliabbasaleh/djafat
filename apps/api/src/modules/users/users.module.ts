import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

/**
 * Owns `users`/`user_roles` (docs/19 §3, §17). `auth` imports this to
 * find-or-create identities and resolve roles/permissions — `users` itself
 * imports nothing (a base layer, same tier as `auth` in the docs/19 §43
 * DAG). No controller here yet: `GET /v1/me` lives in `auth`'s
 * `MeController` instead, so `users` never needs to import `auth`'s guards
 * back (which would make `auth`<->`users` circular — `auth` already
 * legitimately imports THIS module). Real `users`-owned endpoints (profile
 * edit, addresses, favourites) are Bloc 2+.
 */
@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
