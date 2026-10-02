import { Global, Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { PricingModule } from '../pricing/pricing.module';
import { CartsModule } from '../carts/carts.module';
import { AddressesModule } from '../addresses/addresses.module';
import { UsersModule } from '../users/users.module';
import { ORDER_AMOUNT_PORT } from '../../common/ports/order-amount.port';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrdersAdminController } from './orders-admin.controller';

/**
 * Bloc 0.5: order lifecycle driving the canonical state machine end-to-end
 * (create, confirm, ready, + event-driven reactions to payments/deliveries).
 *
 * Global so `ORDER_AMOUNT_PORT` (token in `common/ports`, NOT under
 * `modules/orders/*`) can be injected by `payments` without a module-level
 * `imports: [OrdersModule]` — which would itself be a boundary violation.
 * `orders` never imports `payments`/`deliveries`; it reacts to their events
 * by name (`@OnEvent`). Enforced by `eslint-plugin-boundaries`.
 */
@Global()
@Module({
  imports: [CatalogModule, PricingModule, CartsModule, AddressesModule, UsersModule],
  controllers: [OrdersController, OrdersAdminController],
  providers: [OrdersService, { provide: ORDER_AMOUNT_PORT, useExisting: OrdersService }],
  exports: [ORDER_AMOUNT_PORT],
})
export class OrdersModule {}
