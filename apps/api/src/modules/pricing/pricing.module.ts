import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';

/**
 * Bloc 0.5: commission resolved for real, delivery fee flat (skeleton — see
 * docs/18 §4). Bloc 4: full server-authoritative engine (zones, tax).
 * DAG: `pricing` depends only on shared infra (PrismaService) — no `catalog`.
 */
@Module({
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
