-- 0023_delivery_dispatch_core — Bloc 6: real dispatch (docs/25).
--
-- Additive throughout: no past migration is edited, `deliveries` is ALTERed
-- (columns added, status vocabulary widened, existing rows remapped), never
-- dropped. `addresses` (migration 0003) and PostGIS (migration 0001) already
-- exist — this only adds what Bloc 6 actually needs on top.

-- ── 1. Dropoff snapshot on orders (docs/25 §8) ───────────────────────────────
-- Order stays the source of truth for WHERE a historical order was delivered,
-- independent of a customer's mutable address book (mandate §20). Nullable:
-- existing pre-Bloc-6 orders have none; every new order sets them at creation.
ALTER TABLE orders ADD COLUMN dropoff_address_id uuid REFERENCES addresses(id);
ALTER TABLE orders ADD COLUMN dropoff_quartier text;
ALTER TABLE orders ADD COLUMN dropoff_street text;
ALTER TABLE orders ADD COLUMN dropoff_landmark text;
ALTER TABLE orders ADD COLUMN dropoff_instructions text;
ALTER TABLE orders ADD COLUMN dropoff_recipient_phone text;
-- Nullable: N'Djamena addressing is landmark-first (docs/09 B.1) — a manually
-- entered address legitimately has no coordinates yet.
ALTER TABLE orders ADD COLUMN dropoff_geom geography(Point, 4326);
ALTER TABLE orders ADD COLUMN dropoff_geocode_status text NOT NULL DEFAULT 'pending'
  CHECK (dropoff_geocode_status IN ('pending', 'ok', 'failed', 'manual'));
CREATE INDEX orders_dropoff_geom_idx ON orders USING gist (dropoff_geom);

-- The Bloc 0.5 hack this bloc's mandate explicitly requires gone: a courier
-- was resolved and frozen onto the ORDER at creation time, before any real
-- dispatch existed. Real dispatch assigns `deliveries.courier_id` instead,
-- once the order is ready — never before payment, often well after.
ALTER TABLE orders DROP COLUMN courier_id;

-- ── 2. Courier profile (docs/25 §4) — 1:1 with users, role='courier' ────────
CREATE TABLE couriers (
  user_id            uuid PRIMARY KEY REFERENCES users(id),
  status             text NOT NULL DEFAULT 'offline'
                        CHECK (status IN ('offline', 'online', 'busy', 'suspended')),
  active_delivery_id uuid REFERENCES deliveries(id),
  last_geom          geography(Point, 4326),
  last_accuracy_m    numeric,
  last_heading       numeric,
  last_speed_mps     numeric,
  last_location_at   timestamptz,
  vehicle_type       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX couriers_status_idx ON couriers (status);
CREATE INDEX couriers_last_geom_idx ON couriers USING gist (last_geom);
CREATE TRIGGER couriers_set_updated_at BEFORE UPDATE ON couriers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Invariant "a courier has at most one ACTIVE delivery" is enforced at the
-- service layer (transactional lock ordering: courier row before delivery
-- row, always — docs/25 §12-13), not by a DB constraint: "active" spans
-- several `deliveries.status` values, which a single FK/unique index cannot
-- express on its own.

-- ── 3. deliveries — widen for real dispatch (ALTER, not drop/recreate) ──────
ALTER TABLE deliveries ALTER COLUMN courier_id DROP NOT NULL; -- unknown until assigned
ALTER TABLE deliveries ALTER COLUMN status DROP DEFAULT;
ALTER TABLE deliveries DROP CONSTRAINT deliveries_status_check;

-- Remap the Bloc 0.5 vocabulary onto the Bloc 6 state machine (docs/25 §3)
-- BEFORE the new CHECK lands, so any row surviving from the walking skeleton
-- stays valid. 'picked_up'/'delivered'/'failed'/'cancelled' are unchanged.
UPDATE deliveries SET status = 'pending' WHERE status = 'created';
UPDATE deliveries SET status = 'courier_accepted' WHERE status = 'assigned';

ALTER TABLE deliveries ADD CONSTRAINT deliveries_status_check CHECK (status IN (
  'pending', 'searching_courier', 'courier_assigned', 'courier_accepted',
  'pickup_in_progress', 'picked_up', 'on_the_way', 'delivered', 'cancelled', 'failed'
));
ALTER TABLE deliveries ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE deliveries ADD COLUMN pickup_geom geography(Point, 4326);
ALTER TABLE deliveries ADD COLUMN dropoff_geom geography(Point, 4326);
ALTER TABLE deliveries ADD COLUMN estimated_distance_m numeric;
ALTER TABLE deliveries ADD COLUMN actual_distance_m numeric;
ALTER TABLE deliveries ADD COLUMN dispatch_radius_m int;
ALTER TABLE deliveries ADD COLUMN dispatch_attempts int NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN searching_since timestamptz;
ALTER TABLE deliveries ADD COLUMN accepted_at timestamptz;
ALTER TABLE deliveries ADD COLUMN pickup_arrived_at timestamptz;
ALTER TABLE deliveries ADD COLUMN on_the_way_at timestamptz;
ALTER TABLE deliveries ADD COLUMN cancelled_at timestamptz;
ALTER TABLE deliveries ADD COLUMN cancelled_reason text;
ALTER TABLE deliveries ADD COLUMN cancelled_by uuid REFERENCES users(id);
ALTER TABLE deliveries ADD COLUMN failed_at timestamptz;
ALTER TABLE deliveries ADD COLUMN failed_reason text;
ALTER TABLE deliveries ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX deliveries_status_idx ON deliveries (status);
CREATE INDEX deliveries_pickup_geom_idx ON deliveries USING gist (pickup_geom);
CREATE TRIGGER deliveries_set_updated_at BEFORE UPDATE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 4. Delivery offers (docs/25 §5) ──────────────────────────────────────────
CREATE TABLE delivery_offers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id  uuid NOT NULL REFERENCES deliveries(id),
  courier_id   uuid NOT NULL REFERENCES users(id),
  status       text NOT NULL DEFAULT 'offered'
                 CHECK (status IN ('offered', 'accepted', 'rejected', 'expired')),
  offered_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  responded_at timestamptz
);
CREATE INDEX delivery_offers_delivery_idx ON delivery_offers (delivery_id, status);
CREATE INDEX delivery_offers_courier_idx ON delivery_offers (courier_id, status);
-- "At most one ACTIVE offer per delivery" is enforced by the assignment
-- transaction (docs/25 §12), same reasoning as the courier invariant above:
-- "active" = status='offered' AND expires_at > now(), which a static
-- constraint cannot express without a companion expiry job anyway.

-- ── 5. Delivery proofs (docs/25 §19) — extensible, MVP = delivery code ──────
CREATE TABLE delivery_proofs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id),
  type        text NOT NULL CHECK (type IN ('delivery_code', 'photo', 'signature')),
  value_hash  text NOT NULL, -- never the raw code — hashed, like OTP (docs/19)
  reference   text,          -- e.g. object storage key for a photo — unused at MVP
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL REFERENCES users(id)
);
CREATE INDEX delivery_proofs_delivery_idx ON delivery_proofs (delivery_id);
