import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CouriersService } from './couriers.service';
import { CouriersController } from './couriers.controller';
import { CouriersAdminController } from './couriers-admin.controller';
import { UsersModule } from '../users/users.module';
import { GeoModule } from '../geo/geo.module';
import { CourierApplicationController } from './courier-application.controller';
import { CourierApplicationService } from './courier-application.service';

/**
 * Bloc 6 — real courier profile: availability, last-known position,
 * eligibility search for dispatch (docs/25 §4). `deliveries` imports this
 * module directly (boundaries allow it — see `api-boundaries.js`) to join
 * its own transaction for the assignment claim (`lockAndClaim`/`release`),
 * the same reason `payments`/`deliveries` inject `LedgerService` directly.
 */
@Module({
  imports: [AuthModule, UsersModule, GeoModule],
  controllers: [CouriersController, CouriersAdminController, CourierApplicationController],
  // FEAT-022: the courier's application; `admin` composes its review (SPEC-022-07).
  providers: [CouriersService, CourierApplicationService],
  exports: [CouriersService, CourierApplicationService],
})
export class CouriersModule {}
