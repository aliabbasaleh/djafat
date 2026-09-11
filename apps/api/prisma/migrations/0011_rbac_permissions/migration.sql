-- 0011_rbac_permissions — granular, data-driven RBAC (docs/19 §17-19).
--
-- Mirrors the `roles` table's own philosophy (Bloc 0): a plain reference
-- table + a junction table, no application-code `if (role === ...)` branch.
-- `@RequirePermission(...)` (apps/api/src/modules/auth) resolves the union
-- of every role a user holds (`user_roles`) through this junction.

CREATE TABLE permissions (
  code  text PRIMARY KEY,
  label text NOT NULL
);

CREATE TABLE role_permissions (
  role       text NOT NULL REFERENCES roles(code),
  permission text NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (role, permission)
);
-- Reverse-lookup index: "which roles grant permission X" (admin UI, audits).
CREATE INDEX role_permissions_permission_idx ON role_permissions (permission);
