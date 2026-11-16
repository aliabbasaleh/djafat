-- 0038_placeholder_images_png — demo data only.
-- The demo seed used placehold.co addresses without an extension, which that
-- service answers in SVG; Next.js' image optimizer refuses SVG, so every demo
-- photo showed as broken on the live site. Ask for PNG instead. Touches only
-- placehold.co addresses (real photos are never matched). Idempotent.
-- Rollback: not needed (the old addresses were broken).

UPDATE restaurants
SET logo_url = regexp_replace(logo_url, '^(https://placehold\.co/[^?]*?)(\.png)?\?', '\1.png?')
WHERE logo_url LIKE 'https://placehold.co/%' AND logo_url NOT LIKE '%.png?%';

UPDATE restaurants
SET cover_url = regexp_replace(cover_url, '^(https://placehold\.co/[^?]*?)(\.png)?\?', '\1.png?')
WHERE cover_url LIKE 'https://placehold.co/%' AND cover_url NOT LIKE '%.png?%';

UPDATE menu_categories
SET image_url = regexp_replace(image_url, '^(https://placehold\.co/[^?]*?)(\.png)?\?', '\1.png?')
WHERE image_url LIKE 'https://placehold.co/%' AND image_url NOT LIKE '%.png?%';

UPDATE products
SET image_url = regexp_replace(image_url, '^(https://placehold\.co/[^?]*?)(\.png)?\?', '\1.png?')
WHERE image_url LIKE 'https://placehold.co/%' AND image_url NOT LIKE '%.png?%';
