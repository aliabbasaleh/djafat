import { Module } from '@nestjs/common';

/**
 * Skeleton (Bloc 0). Bloc 4: order lifecycle, item/address snapshot, canonical
 * state machine (`@djafat/core`), `awaiting_payment` + TTL, durable idempotency.
 *
 * `orders` implements `OrderAmountPort` (defined in `@djafat/types`) and
 * **never imports `payments`** — it reacts to `payment.*` events. This is
 * enforced by `eslint-plugin-boundaries` (packages/eslint-config/api-boundaries).
 */
@Module({})
export class OrdersModule {}
