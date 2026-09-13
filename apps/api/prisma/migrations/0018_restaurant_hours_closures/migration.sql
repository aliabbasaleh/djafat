-- 0018_restaurant_hours_closures — weekly hours + exceptional closures
-- (docs/20 §20-§23). Interpreted in the restaurant's CITY timezone, never
-- UTC-as-local (decision carried from Bloc 0) — `RestaurantAvailabilityService`
-- reads `cities.timezone` via the restaurant's `city_id`, already present.

-- `weekday`: 0=Sunday..6=Saturday (matches JS `Date#getDay()` — see
-- `@djafat/core`'s `computeRestaurantAvailability`). Minutes-since-midnight
-- (plain int), NOT a SQL `time` column: Prisma's `@db.Time` <-> JS `Date`
-- mapping has ambiguous local/UTC serialisation behaviour across drivers —
-- an integer is unambiguous and matches the pure function's own input shape
-- (`RestaurantHoursLike.opensMinutes`/`closesMinutes`) exactly, end to end.
-- `unique(restaurant_id, weekday, opens_minutes)` allows multiple shifts per
-- day (e.g. lunch + dinner). Overnight-crossing windows (closes < opens,
-- e.g. 18:00->02:00) are valid and interpreted by the application.
CREATE TABLE restaurant_hours (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  weekday        int NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_minutes  int NOT NULL CHECK (opens_minutes BETWEEN 0 AND 1439),
  closes_minutes int NOT NULL CHECK (closes_minutes BETWEEN 0 AND 1439),
  UNIQUE (restaurant_id, weekday, opens_minutes)
);
CREATE INDEX restaurant_hours_restaurant_idx ON restaurant_hours (restaurant_id);

-- Exceptional closures (docs/20 §22): "closed on 2026-12-25", a temporary
-- shutdown, etc. — no calendar/recurrence engine, just a time range.
CREATE TABLE restaurant_closures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL CHECK (ends_at > starts_at),
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX restaurant_closures_restaurant_idx ON restaurant_closures (restaurant_id, starts_at, ends_at);
