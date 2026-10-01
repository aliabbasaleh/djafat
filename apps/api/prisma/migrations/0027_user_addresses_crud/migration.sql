-- 0027_user_addresses_crud — Bloc 8 (docs/29 §address-domain).
--
-- Additive only. `addresses` already exists (migration 0003) and is already
-- modelled in Prisma (`Address`, Bloc 6) — it was read-only until now (only
-- `orders.service.ts`'s own snapshot read touched it). This migration adds
-- exactly the two things a real CRUD needs that a read-only consumer never
-- required: the default-address invariant enforced by the database, and the
-- `updated_at` trigger every other mutable table in this schema already has.

-- ── 1. "At most one default address per user" — enforced by the database ────
-- Same pattern as `carts_one_open_per_user` (migration 0019): a partial
-- unique index, not an application-only promise. Two concurrent "set this as
-- my default" calls for the same user can never both land `is_default = true`
-- — the loser's own UPDATE raises a unique violation (23505 -> Prisma P2002),
-- translated to a clean business error by the service, never a raw 500
-- (docs/25 §B6.1-1 precedent).
CREATE UNIQUE INDEX addresses_one_default_per_user ON addresses (user_id) WHERE is_default = true;

-- ── 2. `updated_at` trigger — every other mutable table in this schema has one ──
-- `addresses` was created in migration 0003 as a read-mostly fixture table
-- (seed-only) and never got the trigger `couriers`/`deliveries`/`refunds`
-- all carry. Now that real writes exist, the gap is closed the same way.
CREATE TRIGGER addresses_set_updated_at BEFORE UPDATE ON addresses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
