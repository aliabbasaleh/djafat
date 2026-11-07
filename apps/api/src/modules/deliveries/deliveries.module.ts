import { Global, Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { CouriersModule } from '../couriers/couriers.module';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { DELIVERY_TRACKING_PORT } from '../../common/ports/delivery-tracking.port';
import { DeliveriesService } from './deliveries.service';
import { DeliveriesController } from './deliveries.controller';
import { CourierDeliveryController } from './courier-delivery.controller';
import { CourierCashService } from './courier-cash.service';
import { CourierCashController } from './courier-cash.controller';

/**
 * Bloc 6 — real dispatch core (docs/25). DAG: `deliveries` depends on
 * `ledger` (join `postEntryGroupTx`) and `couriers` (join the assignment
 * transaction — `lockAndClaim`/`release`, boundaries explicitly widened for
 * this, see `api-boundaries.js`), plus `auth`/`users`/`platform`/`geo`
 * (generic). NEVER `orders` directly — reached only via `OrderAmountPort`
 * (`common/ports`) and `@OnEvent`.
 *
 * Global so `DELIVERY_TRACKING_PORT` (token in `common/ports`) can be
 * injected by `realtime` without a module-level `imports: [DeliveriesModule]`
 * — mirrors `OrdersModule`/`ORDER_AMOUNT_PORT` exactly.
 */
@Global()
@Module({
  imports: [LedgerModule, CouriersModule, UsersModule, AuthModule],
  controllers: [DeliveriesController, CourierDeliveryController, CourierCashController],
  providers: [
    DeliveriesService,
    CourierCashService,
    { provide: DELIVERY_TRACKING_PORT, useExisting: DeliveriesService },
  ],
  exports: [DeliveriesService, DELIVERY_TRACKING_PORT],
})
export class DeliveriesModule {}
