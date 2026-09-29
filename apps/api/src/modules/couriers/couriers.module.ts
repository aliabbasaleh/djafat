import { Module } from '@nestjs/common';
import { CouriersService } from './couriers.service';
import { CouriersController } from './couriers.controller';
import { CouriersAdminController } from './couriers-admin.controller';

/**
 * Bloc 6 — real courier profile: availability, last-known position,
 * eligibility search for dispatch (docs/25 §4). `deliveries` imports this
 * module directly (boundaries allow it — see `api-boundaries.js`) to join
 * its own transaction for the assignment claim (`lockAndClaim`/`release`),
 * the same reason `payments`/`deliveries` inject `LedgerService` directly.
 */
@Module({
  controllers: [CouriersController, CouriersAdminController],
  providers: [CouriersService],
  exports: [CouriersService],
})
export class CouriersModule {}
