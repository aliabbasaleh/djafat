-- 0028_role_management — Bloc 9 (docs/30 §role-management).
--
-- Additive only. `user_roles` already exists (migration 0003) with
-- `scope_restaurant_id` already on it — this bloc is the first to actually
-- WRITE non-'customer' grants through application code (previously SQL/seed
-- only), so it closes the one real gap in the existing schema: nothing
-- stopped a `restaurant_staff`/`restaurant_owner` grant from being inserted
-- for a SECOND restaurant for the same user, which the mandate explicitly
-- forbids ("jamais permettre restaurant_staff -> accès restaurant A ET B").
--
-- A partial unique index on (user_id, role) — narrower than the table's own
-- composite primary key — is the DB-enforced backstop, same precedent as
-- `addresses_one_default_per_user` (migration 0027) and
-- `carts_one_open_per_user` (migration 0019): the application validates this
-- too, but a concurrent race is caught here even if that reasoning has a gap.
CREATE UNIQUE INDEX user_roles_one_restaurant_per_staff
  ON user_roles (user_id, role)
  WHERE role IN ('restaurant_owner', 'restaurant_staff');
