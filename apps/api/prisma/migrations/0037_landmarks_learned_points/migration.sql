-- 0037_landmarks_learned_points — FEAT-018 (docs/features/FEAT-018-landmarks-learned-points).
-- N'Djamena addressing is landmark-first: shared landmarks, an address placed
-- relative to one ("derrière la Grande Mosquée") with a door hint, the point
-- learned from the courier's GPS at delivery, and a short voice note.
-- Owned by module `addresses` (landmarks, address columns, voice notes) and
-- `orders` (the door hint snapshot).
-- Rollback: DROP TABLE address_voice_notes; DROP TABLE landmarks; drop the
-- added columns of addresses and orders.

-- Case- and accent-insensitive matching for landmark search, without the
-- unaccent extension (French accents are all that matter here).
CREATE FUNCTION unaccent_lower(t text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT translate(lower(t), 'àâäéèêëîïôöùûüçœæÿ', 'aaaeeeeiioouuucoay')
$$;

CREATE TABLE landmarks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id    uuid NOT NULL REFERENCES cities (id),
  name       text NOT NULL,
  kind       text NOT NULL DEFAULT 'other'
               CHECK (kind IN ('mosque', 'church', 'market', 'school', 'health', 'roundabout',
                               'administration', 'shop', 'other')),
  aliases    text[] NOT NULL DEFAULT '{}',
  geom       geography(Point, 4326) NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, name)
);
CREATE INDEX landmarks_geom_idx ON landmarks USING gist (geom);

ALTER TABLE addresses
  ADD COLUMN landmark_id       uuid REFERENCES landmarks (id) ON DELETE SET NULL,
  ADD COLUMN landmark_relation text CHECK (landmark_relation IN
               ('behind', 'in_front_of', 'next_to', 'opposite', 'near')),
  ADD COLUMN door_hint         text CHECK (char_length(door_hint) <= 80),
  ADD COLUMN gps_accuracy_m    integer CHECK (gps_accuracy_m >= 0),
  ADD COLUMN geom_source       text NOT NULL DEFAULT 'user'
               CHECK (geom_source IN ('user', 'gps', 'landmark', 'learned')),
  -- learned from the courier's GPS at successful deliveries (running mean)
  ADD COLUMN verified_geom     geography(Point, 4326),
  ADD COLUMN verified_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN verified_at       timestamptz;

-- ≤ 10 s, ≤ 40 KB: kept in the database at this size (no object storage yet).
CREATE TABLE address_voice_notes (
  address_id  uuid PRIMARY KEY REFERENCES addresses (id) ON DELETE CASCADE,
  mime        text NOT NULL CHECK (mime IN ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac')),
  data        bytea NOT NULL CHECK (octet_length(data) <= 40960),
  duration_ms integer NOT NULL CHECK (duration_ms > 0 AND duration_ms <= 10000),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE orders ADD COLUMN dropoff_door_hint text;
