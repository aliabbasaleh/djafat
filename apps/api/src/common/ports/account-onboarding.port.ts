import type { Prisma } from '@prisma/client';
import type { CourierVehicle } from '@djafat/core';

/**
 * FEAT-022 (SPEC-022-02 R4, SPEC-022-03 R2): signing up as a courier or a
 * restaurant creates, in the SAME transaction as the account, the rows the
 * `couriers` and `catalog` modules own. `auth` may only reach `users` (module
 * DAG, `packages/eslint-config/api-boundaries.js`), so it calls these ports;
 * the owning modules provide them (`@Global`, like `DELIVERY_TRACKING_PORT`).
 * Roles are granted by `users`, not here.
 */

/** Where the courier usually works: from the list, or the name typed under « Autre » — one of the two. */
export interface NeighbourhoodChoice {
  readonly neighbourhoodId: string | null;
  readonly neighbourhoodOther: string | null;
}

export interface CourierSignupRecord extends NeighbourhoodChoice {
  readonly vehicle: CourierVehicle;
  /** `YYYY-MM-DD`, 18 years or more on the sign-up day (checked before). */
  readonly birthDate: string;
  readonly termsAcceptedAt: Date;
}

export const COURIER_ONBOARDING_PORT = Symbol('COURIER_ONBOARDING_PORT');

export interface CourierOnboardingPort {
  /** The `couriers` row (offline) and its application `to_complete`. */
  provisionCourier(
    tx: Prisma.TransactionClient,
    userId: string,
    signup: CourierSignupRecord,
  ): Promise<void>;
}

export interface RestaurantSignupRecord extends NeighbourhoodChoice {
  readonly restaurantName: string;
  readonly termsAcceptedAt: Date;
}

export const RESTAURANT_ONBOARDING_PORT = Symbol('RESTAURANT_ONBOARDING_PORT');

export interface RestaurantOnboardingPort {
  /** The restaurant (`draft`, invisible to customers, owned by `userId`) and its application `to_complete`. */
  provisionRestaurant(
    tx: Prisma.TransactionClient,
    userId: string,
    signup: RestaurantSignupRecord,
  ): Promise<{ restaurantId: string }>;
}
