-- 0005_payment_config — payment_methods, payment_providers, payment_provider_configs.
-- Data-driven: no CHECK enum of method/provider anywhere (docs/15 AD-04).

CREATE TABLE payment_methods (
  code         text PRIMARY KEY,
  display_name text NOT NULL,
  active       boolean NOT NULL DEFAULT true
);

CREATE TABLE payment_providers (
  code         text PRIMARY KEY,
  method_code  text NOT NULL REFERENCES payment_methods(code),
  display_name text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}',
  active       boolean NOT NULL DEFAULT true
);

CREATE TABLE payment_provider_configs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code    text NOT NULL REFERENCES payment_providers(code),
  country_id       uuid REFERENCES countries(id),
  city_id          uuid REFERENCES cities(id),
  restaurant_id    uuid,
  delivery_zone_id uuid,
  enabled          boolean NOT NULL DEFAULT true,
  priority         int NOT NULL DEFAULT 100,
  currency         char(3) REFERENCES currencies(code),
  min_amount_minor bigint,
  max_amount_minor bigint,
  config_ref       text,
  valid_from       timestamptz NOT NULL DEFAULT now(),
  valid_to         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ppc_provider_idx ON payment_provider_configs (provider_code) WHERE enabled;
CREATE INDEX ppc_geo_idx ON payment_provider_configs (country_id, city_id) WHERE enabled;
