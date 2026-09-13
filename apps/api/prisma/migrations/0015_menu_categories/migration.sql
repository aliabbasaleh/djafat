-- 0015_menu_categories — restaurant-scoped menu categories (docs/20 §11).
-- Named `menu_categories` (not the more generic `categories` docs/06 §6.5
-- sketched) because this bloc's mandate is explicit: restaurant-scoped only,
-- no global/shared categories yet — a narrower, more honest name for a
-- narrower table. `commission_rules.category_id` (added nullable in Bloc 0,
-- migration 0006_commerce_rules, FK deferred for lack of a target table) now
-- gets its FK closed.

CREATE TABLE menu_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (btrim(name) <> ''),
  description   text,
  image_url     text,
  sort_order    int NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX menu_categories_restaurant_idx ON menu_categories (restaurant_id, sort_order) WHERE is_active;
CREATE TRIGGER menu_categories_set_updated_at BEFORE UPDATE ON menu_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE commission_rules ADD CONSTRAINT fk_cr_category
  FOREIGN KEY (category_id) REFERENCES menu_categories(id);
