import type { MobileMoneyProvider } from '@djafat/core';

/**
 * FEAT-022 (SPEC-022-07 R6, SC05): where a courier's earnings are sent — the
 * Mobile Money number DJAFAT approved, never one still waiting for an admin.
 * `payments` may not import `couriers` (module DAG,
 * `packages/eslint-config/api-boundaries.js`), so it reads it through this
 * port, which the `couriers` module provides (`@Global`, like
 * `COURIER_ONBOARDING_PORT`).
 */
export const COURIER_PAYOUT_ACCOUNT_PORT = Symbol('COURIER_PAYOUT_ACCOUNT_PORT');

export interface CourierPayoutAccount {
  readonly provider: MobileMoneyProvider;
  readonly number: string;
}

export interface CourierPayoutAccountPort {
  /**
   * The approved number of each courier that has one. A courier created by
   * the team (no application) or not yet approved is absent: staff use the
   * account's phone, as before FEAT-022.
   */
  approvedPayoutAccounts(courierIds: readonly string[]): Promise<Map<string, CourierPayoutAccount>>;
}
