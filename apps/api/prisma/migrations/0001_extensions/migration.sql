-- 0001_extensions — required PostgreSQL extensions + the restricted ledger role.
-- See docs/15 §8.2.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- Restricted, no-login role. Only the `ledger` module writes ledger_*/wallet_*
-- (docs/08 §8.9). Full REVOKE/GRANT wiring lands in 0007; membership + SET ROLE
-- usage is completed in Bloc 0.5.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'djafat_ledger') THEN
    CREATE ROLE djafat_ledger NOLOGIN;
  END IF;
END
$$;

-- Reusable trigger fn: keep timestamped rows honest.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Reusable trigger fn: forbid mutation of append-only tables.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table %.% is append-only (immutable)', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
