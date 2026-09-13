-- 0017_product_options — customisable products (docs/20 §15-§18).

CREATE TABLE product_option_groups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (btrim(name) <> ''),
  selection_type text NOT NULL DEFAULT 'single' CHECK (selection_type IN ('single', 'multiple')),
  min_selections int NOT NULL DEFAULT 0 CHECK (min_selections >= 0),
  max_selections int NOT NULL DEFAULT 1 CHECK (max_selections >= 1 AND max_selections >= min_selections),
  is_required    boolean NOT NULL DEFAULT false,
  sort_order     int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_option_groups_product_idx ON product_option_groups (product_id, sort_order);
CREATE TRIGGER product_option_groups_set_updated_at BEFORE UPDATE ON product_option_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_options (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  option_group_id  uuid NOT NULL REFERENCES product_option_groups(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (btrim(name) <> ''),
  -- Money (docs/20 §17): a `Money`-shaped pair, never a bare float. Can be
  -- negative (e.g. a smaller size costing LESS than the product's base price).
  price_delta_minor bigint NOT NULL DEFAULT 0,
  currency         char(3) NOT NULL REFERENCES currencies(code),
  is_available     boolean NOT NULL DEFAULT true,
  sort_order       int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_options_group_idx ON product_options (option_group_id, sort_order);
CREATE TRIGGER product_options_set_updated_at BEFORE UPDATE ON product_options
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
