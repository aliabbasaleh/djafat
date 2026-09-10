/** Application roles (RBAC). See docs/05 §5.4. */
export const ROLES = [
  'customer',
  'restaurant_owner',
  'restaurant_staff',
  'courier',
  'admin',
  'super_admin',
] as const;
export type Role = (typeof ROLES)[number];

/**
 * Canonical order lifecycle. Transition rules live in
 * `@djafat/core` (order state machine) — see docs/06 §6.6.
 */
export const ORDER_STATUSES = [
  'draft',
  'awaiting_payment',
  'placed',
  'confirmed',
  'preparing',
  'ready',
  'courier_assigned',
  'picked_up',
  'on_the_way',
  'delivered',
  'cancelled',
  'rejected',
  'expired',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TERMINAL_STATUSES: readonly OrderStatus[] = [
  'delivered',
  'cancelled',
  'rejected',
  'expired',
];

export const FULFILLMENT_TYPES = ['delivery', 'pickup'] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

/**
 * Payment lifecycle. `authorized` and capture are OPTIONAL — only used when a
 * provider declares `capabilities.capture`. `needs_review` replaces the old
 * `flagged`. See docs/08 §8.3.
 */
export const PAYMENT_STATUSES = [
  'pending',
  'authorized',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
  'refunded',
  'partially_refunded',
  'needs_review',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Delivery lifecycle. See docs/09 Part A. */
export const DELIVERY_STATUSES = [
  'created',
  'searching_courier',
  'offered',
  'assigned',
  'arrived_at_restaurant',
  'picked_up',
  'on_the_way',
  'arrived_at_customer',
  'delivered',
  'failed',
  'cancelled',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Double-entry direction. */
export type LedgerDirection = 'debit' | 'credit';

/**
 * Stable ledger account codes (docs/15 §4.1). Per-owner accounts
 * (RESTAURANT_PAYABLE, COURIER_AVAILABLE, PSP_CLEARING, CASH_FLOAT) are
 * instantiated per owner id at runtime; the code is the class.
 */
export const LEDGER_ACCOUNT_CODES = [
  'PSP_CLEARING',
  'DJAFAT_BANK',
  'CASH_FLOAT',
  'DJAFAT_REVENUE',
  'PSP_FEE_EXPENSE',
  'PROMO_EXPENSE',
  'RESTAURANT_PAYABLE',
  'RESTAURANT_AVAILABLE',
  'COURIER_PAYABLE',
  'COURIER_AVAILABLE',
  'REFUNDS_PAYABLE',
  'CUSTOMER_CLEARING',
] as const;
export type LedgerAccountCode = (typeof LEDGER_ACCOUNT_CODES)[number];

export const LEDGER_ACCOUNT_TYPES = [
  'asset',
  'liability',
  'revenue',
  'expense',
  'equity',
  'contra',
] as const;
export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number];

/** Kinds of ledger entry groups (docs/15 §4.2). */
export const ENTRY_GROUP_KINDS = [
  'order_accrual',
  'funds_available',
  'settlement',
  'payout',
  'refund',
  'dispute',
  'cash_reconciliation',
  'adjustment',
] as const;
export type EntryGroupKind = (typeof ENTRY_GROUP_KINDS)[number];
