import { Module } from '@nestjs/common';

/**
 * Skeleton (Bloc 0). Bloc 4: the server-authoritative price engine — subtotal,
 * delivery fee (zone + distance), service fee, resolved commission & tax
 * (snapshotted on the order). Pure math lives in `@djafat/core`.
 * DAG: `pricing` depends on `platform` and `geo`.
 */
@Module({})
export class PricingModule {}
