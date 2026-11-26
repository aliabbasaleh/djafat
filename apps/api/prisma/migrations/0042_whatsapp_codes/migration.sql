-- 0042_whatsapp_codes — FEAT-023 (docs/features/FEAT-023-whatsapp-gratuit).
-- Free WhatsApp login: a screen shows a code, the customer SENDS it to
-- DJAFAT's WhatsApp number, the webhook notes who sent it, and only the screen
-- holding the token learns the outcome (SPEC-023-01 to 03). DJAFAT sends
-- nothing, so nothing is billed by Meta. Owned by module `auth`. Purely
-- additive; rows live a few minutes and are purged on each new code.
-- Rollback: DROP TABLE whatsapp_codes.

CREATE TABLE whatsapp_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose         text NOT NULL CHECK (purpose IN ('login', 'login_device', 'verify_phone')),
  -- HMACs (OTP_HASH_SECRET) of the 6-digit code and of the screen's token: never in clear.
  code_hash       text NOT NULL,
  token_hash      text NOT NULL,
  -- The account a confirmation or a new device belongs to; NULL for a login (unknown yet).
  user_id         uuid REFERENCES users (id),
  -- The password login a new device's code finishes; its purge removes the code too.
  challenge_id    uuid REFERENCES auth_challenges (id) ON DELETE CASCADE,
  -- Set once, when the first message carrying the code arrives (SPEC-023-02 R6).
  sender_phone    text,
  outcome         text CHECK (outcome IN ('matched', 'not_confirmed', 'wrong_number')),
  matched_user_id uuid REFERENCES users (id),
  received_at     timestamptz,
  -- Set once, when the screen reads the outcome (SPEC-023-03 R3).
  consumed_at     timestamptz,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_codes_owner_ck CHECK ((purpose = 'login') = (user_id IS NULL)),
  CONSTRAINT whatsapp_codes_challenge_ck CHECK ((purpose = 'login_device') = (challenge_id IS NOT NULL)),
  CONSTRAINT whatsapp_codes_received_ck CHECK ((received_at IS NULL) = (outcome IS NULL)),
  CONSTRAINT whatsapp_codes_matched_ck CHECK (outcome IS DISTINCT FROM 'matched' OR purpose <> 'login' OR matched_user_id IS NOT NULL)
);
CREATE UNIQUE INDEX whatsapp_codes_token_hash_key ON whatsapp_codes (token_hash);
-- Two codes waiting for their message are never equal (SPEC-023-01 R2).
CREATE UNIQUE INDEX whatsapp_codes_waiting_code_uk ON whatsapp_codes (code_hash) WHERE received_at IS NULL;
CREATE INDEX whatsapp_codes_expires_idx ON whatsapp_codes (expires_at);
