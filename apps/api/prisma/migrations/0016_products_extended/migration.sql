-- 0016_products_extended — Bloc 2 additions to the Bloc 0.5 `products` table
-- (docs/20 §12, §19). Purely additive.

ALTER TABLE products ADD COLUMN category_id uuid REFERENCES menu_categories(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN slug        text;
ALTER TABLE products ADD COLUMN description text;
ALTER TABLE products ADD COLUMN image_url   text;
ALTER TABLE products ADD COLUMN sort_order  int NOT NULL DEFAULT 0;
-- `is_active` (in the catalogue at all) is DISTINCT from the existing
-- `is_available` (temporarily unorderable) — docs/20 §19: a product must
-- never be deleted just because it's briefly out of stock.
ALTER TABLE products ADD COLUMN is_active   boolean NOT NULL DEFAULT true;

-- Backfill a deterministic slug for the Bloc 0.5 seed rows (Poulet braisé,
-- Frites) before the column becomes mandatory — no product is ever created
-- without a slug from this point on.
UPDATE products SET slug = lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(id::text, 1, 8)
  WHERE slug IS NULL;
ALTER TABLE products ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX products_restaurant_slug_uk ON products (restaurant_id, slug);

CREATE INDEX products_category_idx ON products (category_id) WHERE is_active;

ALTER TABLE products ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('french', coalesce(name, '') || ' ' || coalesce(description, ''))
  ) STORED;
CREATE INDEX products_search_idx ON products USING gin (search_vector);
