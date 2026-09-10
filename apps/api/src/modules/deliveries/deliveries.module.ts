import { Module } from '@nestjs/common';

/**
 * Skeleton (Bloc 0). Bloc 6: delivery lifecycle, proof (photo + code), courier
 * fee credited via `LedgerPort` (never a direct wallet write), delivery-fee
 * tampering guard. DAG: `deliveries` depends on `geo` and `ledger`.
 */
@Module({})
export class DeliveriesModule {}
