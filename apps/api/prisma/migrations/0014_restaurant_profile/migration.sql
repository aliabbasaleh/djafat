-- 0014_restaurant_profile — Bloc 2 additions to the Bloc 0.5 `restaurants`
-- table (docs/20 §5-§9). Purely additive: no column dropped, existing rows
-- (Bloc 0.5 seed) stay valid.

-- Profile fields (docs/20 §5). `rating_avg`/`rating_count` are a CACHE, not
-- a second source of truth: they will be recomputed from a future `reviews`
-- table (Bloc 8+) — never written directly by the catalog module itself.
ALTER TABLE restaurants ADD COLUMN owner_user_id   uuid REFERENCES users(id);
ALTER TABLE restaurants ADD COLUMN description     text;
ALTER TABLE restaurants ADD COLUMN phone           text;
ALTER TABLE restaurants ADD COLUMN address_text    text;
ALTER TABLE restaurants ADD COLUMN logo_url        text;
ALTER TABLE restaurants ADD COLUMN cover_url       text;
-- Nullable: no geocoding pipeline yet (Bloc 6) — tightened once one exists.
ALTER TABLE restaurants ADD COLUMN geom            geography(Point, 4326);
ALTER TABLE restaurants ADD COLUMN rating_avg      numeric(2,1) NOT NULL DEFAULT 0;
ALTER TABLE restaurants ADD COLUMN rating_count    int NOT NULL DEFAULT 0;
ALTER TABLE restaurants ADD COLUMN prep_time_min   int NOT NULL DEFAULT 20;
ALTER TABLE restaurants ADD COLUMN min_order_minor bigint NOT NULL DEFAULT 0;

CREATE INDEX restaurants_geom_idx ON restaurants USING gist (geom);
CREATE INDEX restaurants_owner_idx ON restaurants (owner_user_id);

-- Lifecycle widened from ('draft','active','suspended') to the full Bloc 2
-- set (docs/20 §6). New restaurants default to 'draft' (docs/06 §6.5); the
-- Bloc 0.5 rows are already 'active' and remain valid under the wider CHECK.
ALTER TABLE restaurants ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE restaurants DROP CONSTRAINT restaurants_status_check;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_status_check
  CHECK (status IN ('draft', 'pending_review', 'active', 'paused', 'suspended', 'closed'));

-- Full-text search (docs/20 §27) — PostgreSQL FTS, no external search engine.
-- `french` ships with the default Postgres install (stemming for the launch
-- market's primary language); `simple` would be the fallback if a future
-- market's default config lacks it.
ALTER TABLE restaurants ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('french', coalesce(name, '') || ' ' || coalesce(description, ''))
  ) STORED;
CREATE INDEX restaurants_search_idx ON restaurants USING gin (search_vector);

-- Closes the FK deferred since `user_roles` was created (Bloc 1, migration
-- 0003_identity) — `restaurants` didn't exist yet at the time (docs/06 §6.5
-- already anticipated this exact statement).
ALTER TABLE user_roles ADD CONSTRAINT fk_ur_restaurant
  FOREIGN KEY (scope_restaurant_id) REFERENCES restaurants(id);
