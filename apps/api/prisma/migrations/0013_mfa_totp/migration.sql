-- 0013_mfa_totp — TOTP enrollment for admin/super_admin (docs/05 §5.4,
-- docs/19 §22). One row per user; `enabled=false` until the enrollment code
-- is confirmed once, so a half-finished enrollment can never lock an admin
-- out (the OLD confirmed secret, if any, stays authoritative until a NEW one
-- is confirmed — enrollment overwrites this row only on confirm, see
-- MfaService).

CREATE TABLE mfa_totp_secrets (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted text NOT NULL,
  enabled          boolean NOT NULL DEFAULT false,
  confirmed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER mfa_totp_secrets_set_updated_at BEFORE UPDATE ON mfa_totp_secrets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
