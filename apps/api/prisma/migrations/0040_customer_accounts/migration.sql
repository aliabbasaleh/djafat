-- 0040_customer_accounts — FEAT-020 (docs/features/FEAT-020-compte-email-mot-de-passe).
-- Customer accounts with an email and a password: the password hash, pending
-- registrations and password logins waiting for their email code, devices a
-- customer chose to remember, and codes bound to the request that asked them.
-- Owned by module `auth` (users columns: `users`). Purely additive.
-- Rollback: DROP TABLE trusted_devices; DROP TABLE auth_challenges;
--   DELETE FROM otp_codes WHERE purpose IN ('login_device', 'reset_password', 'verify_phone');
--   ALTER TABLE otp_codes DROP COLUMN context; restore the CHECK of 0030;
--   ALTER TABLE users DROP COLUMN password_updated_at, DROP COLUMN password_hash.

-- scrypt hash (`scrypt$N$r$p$salt$hash`, SPEC-020-02 R7); never the password.
ALTER TABLE users ADD COLUMN password_hash text;
ALTER TABLE users ADD COLUMN password_updated_at timestamptz;

-- A code can be bound to the request that asked it (a registration, a
-- password login, an account): it then verifies only for that request
-- (SPEC-020-03 R7, FEAT-007-Q07). NULL = unbound, the behaviour before 0040.
ALTER TABLE otp_codes ADD COLUMN context text;
ALTER TABLE otp_codes DROP CONSTRAINT otp_codes_purpose_check;
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_purpose_check
  CHECK (purpose IN ('login', 'register', 'change_phone', 'verify_email',
                     'login_device', 'reset_password', 'verify_phone'));

-- A registration waiting for its email code (nothing in `users` before it),
-- or a password login waiting for a new device's code.
CREATE TABLE auth_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('registration', 'password_login')),
  user_id     uuid REFERENCES users (id),
  email       citext NOT NULL,
  -- registration: { fullName, phone, passwordHash } — a hash, never a password.
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT auth_challenges_login_user_ck CHECK (kind <> 'password_login' OR user_id IS NOT NULL)
);
-- Expired rows are purged on each new challenge (FEAT-020-Q15).
CREATE INDEX auth_challenges_expires_idx ON auth_challenges (expires_at);

-- A device that passed the email code: its password login skips the code for
-- `trusted_device_ttl_seconds`. Only an HMAC of the random token is stored.
CREATE TABLE trusted_devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id),
  token_hash     text NOT NULL UNIQUE,
  label          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason text
);
CREATE INDEX trusted_devices_user_idx ON trusted_devices (user_id) WHERE revoked_at IS NULL;
