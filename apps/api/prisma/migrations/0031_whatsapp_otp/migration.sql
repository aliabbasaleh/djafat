-- 0031_whatsapp_otp — FEAT-008 (docs/features/FEAT-008-whatsapp-login).
-- Login codes can now be replied on WhatsApp. Same store and security logic
-- as SMS and email (OtpService); target = E.164 phone for 'whatsapp'.
-- Rollback: DELETE FROM otp_codes WHERE channel = 'whatsapp'; then restore
-- the previous CHECK (channel IN ('sms', 'email')).

ALTER TABLE otp_codes DROP CONSTRAINT otp_codes_channel_check;
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_channel_check
  CHECK (channel IN ('sms', 'email', 'whatsapp'));
