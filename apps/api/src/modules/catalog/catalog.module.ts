import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';

/**
 * Bloc 0.5: minimal restaurant/product reads to create a real order.
 * Bloc 2: menus, options, search, hours (tz de la ville). Leaf of the DAG.
 */
@Module({
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
