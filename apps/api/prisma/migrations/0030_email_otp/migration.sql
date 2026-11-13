-- 0030_email_otp — FEAT-007 (docs/features/FEAT-007-email-login).
-- One code store and one lock store for every channel, so SMS and email
-- codes share exactly the same security logic (OtpService):
--   * otp_codes.phone        -> target   (E.164 phone OR lower-cased email)
--   * otp_codes.channel      'sms' | 'email' (existing rows are SMS)
--   * purpose                + 'verify_email'
--   * phone_auth_locks       -> auth_target_locks (phone -> target)
-- Renames only: no data is lost. Rollback = the reverse renames.

ALTER TABLE otp_codes RENAME COLUMN phone TO target;
ALTER TABLE otp_codes ADD COLUMN channel text NOT NULL DEFAULT 'sms'
  CHECK (channel IN ('sms', 'email'));

ALTER TABLE otp_codes DROP CONSTRAINT otp_codes_purpose_check;
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_purpose_check
  CHECK (purpose IN ('login', 'register', 'change_phone', 'verify_email'));

DROP INDEX otp_codes_lookup_idx;
CREATE INDEX otp_codes_lookup_idx ON otp_codes (channel, target, purpose, expires_at DESC);

ALTER TABLE phone_auth_locks RENAME TO auth_target_locks;
ALTER TABLE auth_target_locks RENAME COLUMN phone TO target;
