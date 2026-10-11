import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { UsersAdminController } from './users-admin.controller';

/**
 * Skeleton (Bloc 0) + guard-stack proof endpoints (Bloc 1, see
 * `admin.controller.ts`'s doc comment — NOT real features). Bloc 9 starts
 * the real back-office: role management lives here (not in `users`, which
 * must stay able to "reach nothing" — docs/19 §43 DAG) composing
 * `UsersService`. Restaurant/courier/order/finance admin surfaces live in
 * THEIR OWNING module instead (`catalog`, `couriers`, `orders`, `ledger`),
 * each route-prefixed `admin/*` — the same split `couriers-admin.controller.ts`
 * and `settlements.controller.ts` already established before this bloc.
 */
@Module({
  imports: [UsersModule, AuthModule],
  controllers: [AdminController, UsersAdminController],
})
export class AdminModule {}
