/**
 * BullMQ queue names. Processors live in `apps/worker`. At Bloc 0 these are
 * declared but only `outbox-relay`, `order-expiry` and `ledger-assert` have a
 * (skeleton) processor — see docs/05 §5.5.
 */
export const QUEUES = {
  outboxRelay: 'outbox-relay',
  orderExpiry: 'order-expiry',
  ledgerAssert: 'ledger-assert',
  dispatch: 'dispatch',
  notifications: 'notifications',
  paymentsReconcile: 'payments-reconcile',
  geocoding: 'geocoding',
  images: 'images',
  analyticsRollup: 'analytics-rollup',
  payouts: 'payouts',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
