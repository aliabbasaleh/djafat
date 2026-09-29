-- 0024_delivery_invariants — Bloc 6.1 CTO hardening (docs/25 §B6.1).
--
-- Additive throughout: three partial unique indexes and one column. No past
-- migration is edited, no column is dropped, no data is destroyed.
--
-- ── Correcting 0023's reasoning ──────────────────────────────────────────────
-- Migration 0023 claimed the invariant "a courier has at most one ACTIVE
-- delivery" could not be expressed as a DB constraint because "'active' spans
-- several `deliveries.status` values, which a single FK/unique index cannot
-- express on its own". That is wrong: a PARTIAL unique index expresses exactly
-- that — the WHERE clause enumerates the active statuses, and the uniqueness
-- applies only to rows matching it. The same applies to 0023's second claim
-- about "at most one active offer per delivery". Both are fixed below.
--
-- The service-layer transactional locking (docs/25 §12-13) is NOT replaced by
-- these indexes — it stays the primary mechanism, because it produces clean
-- business errors and keeps the courier row consistent. The indexes are the
-- backstop that makes the invariant true even against a buggy caller, a second
-- writer (the worker), a manual SQL fix, or a future code path nobody reviewed.

-- ── 1. One courier = at most one ACTIVE delivery (mandate §1) ────────────────
-- "Active" is defined precisely as: a courier is attached AND the delivery has
-- not reached a terminal status. Before `courier_assigned` no courier_id is
-- set; `delivered`/`cancelled`/`failed` all release the courier. The canonical
-- list lives in `DELIVERY_COURIER_HOLDING_STATUSES` (@djafat/types) — this SQL
-- necessarily repeats it as literals, and `deliveries-db-invariant.spec.ts`
-- fails if the two ever drift.
CREATE UNIQUE INDEX deliveries_one_active_per_courier_idx
  ON deliveries (courier_id)
  WHERE courier_id IS NOT NULL
    AND status IN ('courier_assigned', 'courier_accepted', 'pickup_in_progress',
                   'picked_up', 'on_the_way');

-- ── 2. The mirror invariant on the courier side ──────────────────────────────
-- `couriers.active_delivery_id` is the denormalised back-pointer the dispatch
-- candidate query filters on (`active_delivery_id IS NULL`). Two courier rows
-- pointing at the SAME delivery would mean two couriers claimed one delivery —
-- the other half of the same race.
CREATE UNIQUE INDEX couriers_one_active_delivery_idx
  ON couriers (active_delivery_id)
  WHERE active_delivery_id IS NOT NULL;

-- ── 3. At most one OFFERED offer per delivery (mandate §8) ───────────────────
-- 0023 argued the expiry predicate made this inexpressible. It does not: the
-- real invariant is "at most one row in status 'offered'", and the expiry job
-- flips `status` to 'expired' — so the time predicate never belongs in the
-- index. Without this, two concurrent dispatch waves could each create an
-- `offered` row for the same delivery and two couriers could each hold a
-- "valid" offer.
CREATE UNIQUE INDEX delivery_offers_one_offered_per_delivery_idx
  ON delivery_offers (delivery_id)
  WHERE status = 'offered';

-- ── 4. Delivery-proof hardening (mandate §7) ─────────────────────────────────
-- The MVP delivery code was write-once/verify-many: nothing marked it consumed,
-- nothing expired it, and nothing limited guessing — a 4-digit code is only
-- 10 000 possibilities. Three additive columns close that.
ALTER TABLE delivery_proofs ADD COLUMN consumed_at timestamptz;
ALTER TABLE delivery_proofs ADD COLUMN expires_at timestamptz;
ALTER TABLE delivery_proofs ADD COLUMN failed_attempts int NOT NULL DEFAULT 0;

-- `created_by` is `uuid NOT NULL REFERENCES users(id)`, but the Bloc 6 code
-- wrote the literal string 'system' into it — a guaranteed `invalid input
-- syntax for type uuid` (a raw 500) the moment it ran against a real
-- PostgreSQL. The code now writes the real actor's uuid; this comment records
-- why the column was never relaxed to text: a proof must always be
-- attributable to an actual user.
