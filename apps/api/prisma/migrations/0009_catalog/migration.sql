-- 0009_catalog — minimal catalog for the Bloc 0.5 walking skeleton.
-- Just enough to create a real order: a restaurant and its products.
-- Full catalog (categories, options, hours, zones, search) is Bloc 2 —
-- see docs/05 §5.2 module `catalog`.

CREATE TABLE restaurants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id    uuid NOT NULL REFERENCES countries(id),
  city_id       uuid NOT NULL REFERENCES cities(id),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  currency      char(3) NOT NULL REFERENCES currencies(code),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'suspended')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX restaurants_city_idx ON restaurants (city_id) WHERE status = 'active';
CREATE TRIGGER restaurants_set_updated_at BEFORE UPDATE ON restaurants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  price_minor   bigint NOT NULL CHECK (price_minor >= 0),
  currency      char(3) NOT NULL REFERENCES currencies(code),
  is_available  boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_restaurant_idx ON products (restaurant_id) WHERE is_available;
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
