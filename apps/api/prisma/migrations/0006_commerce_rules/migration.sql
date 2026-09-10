-- 0006_commerce_rules — commission_rules, tax_rules (resolved + snapshotted per order).

CREATE TABLE commission_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL CHECK (scope IN ('global','country','city','restaurant','category')),
  country_id    uuid REFERENCES countries(id),
  city_id       uuid REFERENCES cities(id),
  restaurant_id uuid,
  category_id   uuid,
  rate_bps      int NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  min_fee_minor bigint,
  max_fee_minor bigint,
  priority      int NOT NULL DEFAULT 100,
  valid_from    timestamptz NOT NULL DEFAULT now(),
  valid_to      timestamptz,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commission_rules_scope_idx ON commission_rules (scope, active);

CREATE TABLE tax_rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id uuid NOT NULL REFERENCES countries(id),
  city_id    uuid REFERENCES cities(id),
  kind       text NOT NULL,
  rate_bps   int NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  applies_to text NOT NULL CHECK (applies_to IN ('subtotal','delivery_fee','service_fee','total')),
  inclusive  boolean NOT NULL DEFAULT false,
  priority   int NOT NULL DEFAULT 100,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to   timestamptz,
  active     boolean NOT NULL DEFAULT true
);
CREATE INDEX tax_rules_country_idx ON tax_rules (country_id, active);
