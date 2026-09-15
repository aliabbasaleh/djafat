/**
 * Application roles (RBAC). See docs/05 §5.4, docs/19 §5. `support`/`finance`
 * extend the original docs/05 list per the Bloc 1 brief — not a locked A1–A9
 * decision, purely additive.
 */
export const ROLES = [
  'customer',
  'restaurant_owner',
  'restaurant_staff',
  'courier',
  'support',
  'finance',
  'admin',
  'super_admin',
] as const;
export type Role = (typeof ROLES)[number];

/**
 * Roles that must complete TOTP MFA at login and pass step-up re-auth for
 * sensitive actions (docs/05 §5.4, docs/19 §11).
 */
export const MFA_REQUIRED_ROLES: readonly Role[] = ['admin', 'super_admin'];

/** Account lifecycle (docs/19 §3). `pending` = created, onboarding incomplete. */
export const USER_STATUSES = ['pending', 'active', 'suspended', 'blocked', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Granular permission codes (docs/19 §6). Data-driven — the DB table
 * `role_permissions` is the actual source of truth (mirrors `roles`/
 * `ledger_accounts`' data-driven philosophy); this const array exists only so
 * `@RequirePermission(...)` call sites get autocomplete + a typo check.
 */
export const PERMISSIONS = [
  'users:read',
  'users:write',
  'orders:read',
  'orders:write',
  'restaurants:read',
  'restaurants:write',
  'menus:read',
  'menus:write',
  'deliveries:read',
  'deliveries:write',
  'payments:read',
  'payments:write',
  'payments:refund',
  'ledger:read',
  'ledger:write',
  'payouts:read',
  'payouts:write',
  'admin:read',
  'admin:write',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

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

/**
 * Restaurant lifecycle (docs/20 §6). Visibility to the public catalogue:
 * `active`/`paused` are visible (paused shows as temporarily unavailable);
 * `draft`/`pending_review`/`suspended`/`closed` are never visible — the
 * client never decides this, `RestaurantsService` filters server-side.
 */
export const RESTAURANT_STATUSES = [
  'draft',
  'pending_review',
  'active',
  'paused',
  'suspended',
  'closed',
] as const;
export type RestaurantStatus = (typeof RESTAURANT_STATUSES)[number];

/** Statuses the public catalogue is allowed to ever return (docs/20 §6). */
export const RESTAURANT_PUBLIC_STATUSES: readonly RestaurantStatus[] = ['active', 'paused'];

/** The live open/closed signal a client renders — never recomputed independently (docs/20 §23). */
export const RESTAURANT_AVAILABILITY_STATUSES = [
  'OPEN',
  'CLOSED',
  'PAUSED',
  'UNAVAILABLE',
] as const;
export type RestaurantAvailabilityStatus = (typeof RESTAURANT_AVAILABILITY_STATUSES)[number];

/** How many options a customer may pick within one `ProductOptionGroup` (docs/20 §16). */
export const OPTION_SELECTION_TYPES = ['single', 'multiple'] as const;
export type OptionSelectionType = (typeof OPTION_SELECTION_TYPES)[number];

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
