-- 0029_ledger_schema_usage — 0007/0008 granted `djafat_ledger` table- and
-- sequence-level privileges on the ledger_* tables but never schema-level
-- USAGE on `public` itself. Without it, Postgres can't even resolve an
-- unqualified table name through that role — it reports "relation ...
-- does not exist" (not "permission denied"), because a role with no USAGE
-- on a schema can't see into it at all. Found only now because this is the
-- first time these migrations have ever run against a real PostgreSQL.

GRANT USAGE ON SCHEMA public TO djafat_ledger;
