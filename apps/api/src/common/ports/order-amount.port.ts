import type { OrderAmountPort } from '@djafat/types';

/**
 * DI token for `OrderAmountPort`. Lives in `common/` (not `modules/orders/*`)
 * on purpose: `common/` is reachable from every module, so `payments` can
 * inject this WITHOUT importing anything under `modules/orders/*` — which is
 * exactly what keeps `orders -> payments` a one-way, lint-enforced edge
 * (docs/15 AD-09, docs/05 §5.3). `OrdersModule` (Global) binds this token to
 * `OrdersService`.
 */
export const ORDER_AMOUNT_PORT = Symbol('ORDER_AMOUNT_PORT');

export type { OrderAmountPort };
