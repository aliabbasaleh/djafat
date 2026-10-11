import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { PricingModule } from '../pricing/pricing.module';
import { PlatformModule } from '../platform/platform.module';
import { AuthModule } from '../auth/auth.module';
import { CartsService } from './carts.service';
import { CartsController } from './carts.controller';

/**
 * Cart + live quote (Bloc 4, docs/22). DAG: `carts` -> {catalog, pricing,
 * auth, users} — never `orders`/`payments`/`ledger` (packages/eslint-config
 * api-boundaries.js already had this edge prepared ahead of time).
 */
@Module({
  imports: [CatalogModule, PricingModule, PlatformModule, AuthModule],
  controllers: [CartsController],
  providers: [CartsService],
  exports: [CartsService],
})
export class CartsModule {}
