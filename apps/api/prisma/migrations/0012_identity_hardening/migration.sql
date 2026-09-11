-- 0012_identity_hardening — Bloc 1 additions to the Bloc 0 identity tables
-- (docs/19). Purely additive: no existing column dropped, no data migrated
-- destructively — safe to run against a populated Bloc 0/0.5 database.

-- users.status: widen 'active'|'suspended'|'deleted' (Bloc 0) to the full
-- Bloc 1 lifecycle (docs/19 §4). Existing rows are already 'active' by
-- default and remain valid under the new, wider CHECK.
ALTER TABLE users DROP CONSTRAINT users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('pending', 'active', 'suspended', 'blocked', 'deleted'));
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

-- sessions: step-up marker (docs/19 §23) — "did this session recently pass
-- MFA re-authentication?", checked against a configurable window, never a
-- separate long-lived elevated-privilege token.
ALTER TABLE sessions ADD COLUMN step_up_verified_at timestamptz;

-- audit_logs: free-form metadata for events with no natural before/after
-- entity (e.g. AUTH_OTP_REQUESTED), and user_agent alongside the existing ip
-- (docs/19 §24).
ALTER TABLE audit_logs ADD COLUMN metadata jsonb;
ALTER TABLE audit_logs ADD COLUMN user_agent text;

-- Append-only (docs/19 §24 "immuable ou append-only") — reuses the same
-- `forbid_mutation()` function ledger_entries/ledger_entry_groups already
-- rely on (migration 0001_extensions).
CREATE TRIGGER audit_logs_no_mutation
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
