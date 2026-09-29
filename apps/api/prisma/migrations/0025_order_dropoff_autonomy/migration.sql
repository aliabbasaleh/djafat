-- 0025_order_dropoff_autonomy — Bloc 6.1 §6 (docs/25 §B6.1-6).
--
-- Additive: two columns added, one foreign-key action relaxed. No column is
-- dropped, no data is destroyed, no past migration is edited.
--
-- The mandate's requirement is that an order's delivery address snapshot be
-- GENUINELY autonomous: deleting or editing the customer's address book entry
-- — or the customer's whole profile — must never alter what a past order says
-- it was delivered to. Migration 0023 froze most of the address onto the order
-- but left two real holes.

-- ── 1. The two fields 0023 forgot ───────────────────────────────────────────
-- `label` ("Maison", "Bureau") is what the customer recognises the address by,
-- and it appears on the order history screen. `city` completes the postal
-- identity: N'Djamena addressing is landmark-first (docs/09 B.1), so quartier
-- + city is what actually locates a delivery for a human reader.
--
-- `city` is stored as TEXT, not as a foreign key to `cities`. A FK would make
-- the snapshot depend on a row it does not own — the precise coupling this
-- migration exists to remove. The order keeps `city_id` nowhere: analytics
-- joins go through `orders.city_id`, which already exists and is the city the
-- ORDER was placed in.
ALTER TABLE orders ADD COLUMN dropoff_label text;
ALTER TABLE orders ADD COLUMN dropoff_city text;

-- ── 2. The address may now be deleted without taking history with it ────────
-- `orders.dropoff_address_id` (0023) is a pointer to a row the customer fully
-- controls. Its foreign key defaulted to NO ACTION, which meant:
--   * deleting an address referenced by any past order failed outright, and
--   * `addresses.user_id` cascades from `users` (migration 0003), so deleting
--     a customer tried to cascade into addresses and was then BLOCKED by this
--     reference — a customer with order history could not be erased at all.
-- That is a data-protection problem (docs/09: a user must be erasable) dressed
-- up as referential integrity.
--
-- ON DELETE SET NULL is the correct action for a snapshot back-reference: the
-- link is a convenience for "re-order to the same address", never the source of
-- truth. Every field the order actually needs is frozen in its own columns, so
-- losing the pointer loses nothing about what was delivered where.
ALTER TABLE orders DROP CONSTRAINT orders_dropoff_address_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_dropoff_address_id_fkey
  FOREIGN KEY (dropoff_address_id) REFERENCES addresses(id) ON DELETE SET NULL;
