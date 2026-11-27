import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { AddressesModule } from '../addresses/addresses.module';
import { CartsModule } from '../carts/carts.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminController } from './admin.controller';
import { PhoneOrdersController } from './phone-orders.controller';
import { PhoneOrdersService } from './phone-orders.service';
import { OfflineOrdersService } from './offline-orders.service';
import { CatalogModule } from '../catalog/catalog.module';
import { UsersAdminController } from './users-admin.controller';
import { GeoModule } from '../geo/geo.module';
import { NeighbourhoodsAdminController } from './neighbourhoods-admin.controller';
import { CouriersModule } from '../couriers/couriers.module';
import { ApplicationsAdminController } from './applications-admin.controller';
import { ApplicationsService } from './applications.service';

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
  imports: [
    UsersModule,
    AuthModule,
    AddressesModule,
    CartsModule,
    CatalogModule,
    OrdersModule,
    PaymentsModule,
    GeoModule,
    CouriersModule,
  ],
  controllers: [
    AdminController,
    UsersAdminController,
    PhoneOrdersController,
    NeighbourhoodsAdminController,
    ApplicationsAdminController,
  ],
  providers: [PhoneOrdersService, OfflineOrdersService, ApplicationsService],
})
export class AdminModule {}
