-- 0002_platform — currencies, countries, cities, platform_settings, feature_flags.

CREATE TABLE currencies (
  code         char(3) PRIMARY KEY,
  exponent     smallint NOT NULL DEFAULT 0,
  symbol       text NOT NULL,
  display_name text NOT NULL,
  active       boolean NOT NULL DEFAULT true
);

CREATE TABLE countries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iso_code       char(2) NOT NULL UNIQUE,
  name           text NOT NULL,
  currency       char(3) NOT NULL REFERENCES currencies(code),
  default_locale text NOT NULL DEFAULT 'fr',
  timezone       text NOT NULL,
  dial_code      text NOT NULL,
  active         boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id uuid NOT NULL REFERENCES countries(id),
  name       text NOT NULL,
  slug       text NOT NULL,
  timezone   text NOT NULL,
  centroid   geography(Point, 4326),
  bbox       geography(Polygon, 4326),
  active     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_id, slug)
);
CREATE INDEX cities_active_idx ON cities (country_id) WHERE active;

CREATE TABLE platform_settings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text NOT NULL,
  scope      text NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'country', 'city')),
  country_id uuid REFERENCES countries(id),
  city_id    uuid REFERENCES cities(id),
  value      jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_settings_scope_uk UNIQUE NULLS NOT DISTINCT (key, scope, country_id, city_id)
);

CREATE TABLE feature_flags (
  key        text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT false,
  rollout    jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
