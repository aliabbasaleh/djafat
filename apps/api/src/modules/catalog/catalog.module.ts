import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { CatalogManagementController } from './catalog-management.controller';
import { RestaurantAvailabilityService } from './restaurant-availability.service';
import { RestaurantsManagementService } from './restaurants-management.service';
import { MenuCategoriesService } from './menu-categories.service';
import { ProductsManagementService } from './products-management.service';

/**
 * Catalog & Restaurant Discovery (Bloc 2, docs/20). Depends only on
 * `auth`/`users` (guards/ownership) — never `payments`/`ledger`/`delivery`
 * (docs/20 §57). `orders` still consumes `CatalogService.getActiveRestaurant`/
 * `getAvailableProducts` unchanged (Bloc 0.5 contract preserved).
 */
@Module({
  controllers: [CatalogController, CatalogManagementController],
  providers: [
    CatalogService,
    RestaurantAvailabilityService,
    RestaurantsManagementService,
    MenuCategoriesService,
    ProductsManagementService,
  ],
  exports: [CatalogService],
})
export class CatalogModule {}
