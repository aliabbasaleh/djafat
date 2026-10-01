import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';

/**
 * The customer's own address book (Bloc 8, docs/29). Deliberately its own
 * top-level module rather than folded into `users` — `users` stays the pure
 * base identity layer (`@@`"reaches nothing", `packages/eslint-config/
 * api-boundaries.js`), exactly the role it already plays for `auth`. Address
 * CRUD is real business logic (an invariant to protect, a checkout
 * dependency), the same reasoning that already gave `couriers` and
 * `notifications` their own modules instead of living inside `users`/`auth`.
 *
 * `AuthModule` is imported directly (not relied upon transitively) for the
 * `@RequireAuth`/`@RequireRole`/`CurrentActor` decorators the controller
 * uses — the same wiring `NotificationsModule` uses. Safe here: `AuthModule`
 * imports `UsersModule`, never this module, so there is no cycle to create
 * (unlike `UsersModule` itself, which is why these files do not live there).
 */
@Module({
  imports: [AuthModule],
  controllers: [AddressesController],
  providers: [AddressesService],
  exports: [AddressesService],
})
export class AddressesModule {}
