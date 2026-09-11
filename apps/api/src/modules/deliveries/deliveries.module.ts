import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { DeliveriesService } from './deliveries.service';
import { DeliveriesController } from './deliveries.controller';

/**
 * Bloc 0.5: minimal delivery path (assign / picked-up / delivered), releasing
 * funds via `LedgerPort` at `delivered`. DAG: `deliveries` depends on `ledger`
 * only — never `orders` (docs/05 §5.3). Full dispatch is Bloc 6.
 */
@Module({
  imports: [LedgerModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService],
})
export class DeliveriesModule {}
