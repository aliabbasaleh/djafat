import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { CatalogManagementController } from './catalog-management.controller';
import { RestaurantsAdminController } from './restaurants-admin.controller';
import { RestaurantAvailabilityService } from './restaurant-availability.service';
import { RestaurantsManagementService } from './restaurants-management.service';
import { MenuCategoriesService } from './menu-categories.service';
import { ProductsManagementService } from './products-management.service';
import { GeoModule } from '../geo/geo.module';
import { RestaurantApplicationService } from './restaurant-application.service';

/**
 * Catalog & Restaurant Discovery (Bloc 2, docs/20). Depends only on
 * `auth`/`users` (guards/ownership) — never `payments`/`ledger`/`delivery`
 * (docs/20 §57). `orders` still consumes `CatalogService.getActiveRestaurant`/
 * `getAvailableProducts` unchanged (Bloc 0.5 contract preserved). `UsersModule`
 * is now an actual NestJS import (not just an allowed DAG edge) — Bloc 9's
 * `GET /restaurants/me/balance` resolves the caller's restaurant scope via
 * `UsersService.getRestaurantScope` (docs/30 §ledger-read), the first thing
 * in this module to need it injected rather than just the guards.
 */
@Module({
  imports: [UsersModule, AuthModule, GeoModule],
  controllers: [CatalogController, CatalogManagementController, RestaurantsAdminController],
  providers: [
    CatalogService,
    RestaurantAvailabilityService,
    RestaurantsManagementService,
    MenuCategoriesService,
    ProductsManagementService,
    // FEAT-022: the restaurants' applications, read by `admin` (SPEC-022-07).
    RestaurantApplicationService,
  ],
  exports: [CatalogService, RestaurantApplicationService],
})
export class CatalogModule {}
