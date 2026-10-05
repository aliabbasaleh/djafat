import { z } from 'zod';

/**
 * `PUT /v1/restaurants/me/hours` (Bloc 10, docs/33 §hours) — a full REPLACE
 * of the week, not a patch: the frontend always submits the complete 7-day
 * grid it just edited, so there is no partial-update ambiguity ("what happens
 * to the day I didn't mention?") to resolve. `weekday` matches JS
 * `Date#getDay()` (0=Sunday..6=Saturday — docs/20 §20, same convention
 * `computeRestaurantAvailability` already reads). Up to 3 windows per day
 * (e.g. lunch + dinner) × 7 days is a generous ceiling, never a realistic ask.
 */
const HoursWindowSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    opensMinutes: z.number().int().min(0).max(1439),
    closesMinutes: z.number().int().min(0).max(1439),
  })
  .strict();

export const ReplaceRestaurantHoursSchema = z
  .object({ hours: z.array(HoursWindowSchema).max(21) })
  .strict();
export type ReplaceRestaurantHoursInput = z.infer<typeof ReplaceRestaurantHoursSchema>;
