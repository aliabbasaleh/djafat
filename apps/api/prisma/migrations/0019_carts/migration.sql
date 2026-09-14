-- 0019_carts — Bloc 4: Cart + Core Order (docs/22 §3, §4, §9).
--
-- The cart is NEVER the pricing authority (docs/22 §3, §6): `name_snapshot`/
-- `unit_price_minor`/`price_delta_minor` on cart_items/cart_item_options are
-- a DISPLAY-ONLY snapshot taken when a line is added, so `GET /v1/carts` can
-- render the cart cheaply (no live join) without an extra round trip. The
-- one deliberate live-recompute step is `POST /v1/carts/quote` (docs/22 §8)
-- — every quote AND every order creation re-reads the LIVE price from
-- `products`/`product_options` and recomputes; these snapshot columns are
-- never read back as an authoritative amount.

CREATE TABLE carts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id),
  -- NULL until the first item is added (docs/22 §2.1 — a cart belongs to at
  -- most one restaurant; it starts empty, not pre-bound to one).
  restaurant_id  uuid REFERENCES restaurants(id),
  currency       char(3) REFERENCES currencies(code),
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'converted')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- At most one OPEN cart per user — the orthogonal invariant to "one
-- restaurant per cart" (that one is enforced in the service layer, since it
-- depends on the item being added, not just the row's own columns).
CREATE UNIQUE INDEX carts_one_open_per_user ON carts (user_id) WHERE status = 'open';
CREATE INDEX carts_user_idx ON carts (user_id);
CREATE TRIGGER carts_set_updated_at BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cart_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id          uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id       uuid NOT NULL REFERENCES products(id),
  name_snapshot    text NOT NULL,
  quantity         int NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  unit_price_minor bigint NOT NULL,
  currency         char(3) NOT NULL REFERENCES currencies(code),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cart_items_cart_idx ON cart_items (cart_id);
CREATE TRIGGER cart_items_set_updated_at BEFORE UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cart_item_options (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_item_id      uuid NOT NULL REFERENCES cart_items(id) ON DELETE CASCADE,
  option_group_id   uuid NOT NULL REFERENCES product_option_groups(id),
  option_id         uuid NOT NULL REFERENCES product_options(id),
  name_snapshot     text NOT NULL,
  price_delta_minor bigint NOT NULL DEFAULT 0,
  currency          char(3) NOT NULL REFERENCES currencies(code),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_item_id, option_id)
);
CREATE INDEX cart_item_options_item_idx ON cart_item_options (cart_item_id);

-- Immutable per-order-item option snapshot (docs/22 §9): an order's
-- historical price NEVER depends on today's catalog. `option_id` is kept
-- ON DELETE SET NULL purely for traceability — `name_snapshot`/
-- `price_delta_minor` are what the order actually charged, forever.
CREATE TABLE order_item_options (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id     uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  option_id         uuid REFERENCES product_options(id) ON DELETE SET NULL,
  name_snapshot     text NOT NULL,
  price_delta_minor bigint NOT NULL DEFAULT 0,
  currency          char(3) NOT NULL REFERENCES currencies(code),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_item_options_item_idx ON order_item_options (order_item_id);
