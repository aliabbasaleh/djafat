import type { RestaurantAvailabilityStatus } from '@djafat/sdk';

/**
 * The ONLY place the frontend turns a `RestaurantAvailabilityStatus` into
 * words/colour — the STATUS ITSELF always comes from the API
 * (`RestaurantAvailabilityService`, docs/20 §22-§23). The frontend never
 * recomputes open/closed from hours — it only labels what the server said.
 */
export const AVAILABILITY_LABEL: Record<RestaurantAvailabilityStatus, string> = {
  OPEN: 'Ouvert',
  CLOSED: 'Fermé',
  PAUSED: 'Fermé temporairement',
  UNAVAILABLE: 'Indisponible',
};

export type AvailabilityTone = 'success' | 'warning' | 'muted';

export const AVAILABILITY_TONE: Record<RestaurantAvailabilityStatus, AvailabilityTone> = {
  OPEN: 'success',
  CLOSED: 'muted',
  PAUSED: 'warning',
  UNAVAILABLE: 'muted',
};
