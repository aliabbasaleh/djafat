-- 0032_mobile_money_receipts — FEAT-009 (docs/features/FEAT-009-mobile-money-transfer-matching).
-- Transfers received on DJAFAT's merchant phone (Airtel Money, Tigo Cash…),
-- recorded by staff (later: SMS forwarder, operator API) and matched to a
-- pending wallet payment by transaction number / payer phone.
-- PostgreSQL is the guarantee (README, "idempotence financière"):
--   * a transaction number exists once per operator;
--   * a payment is paid by at most one receipt;
--   * a matched receipt always points to its payment.
-- Rollback: DROP TABLE mobile_money_receipts;

CREATE TABLE mobile_money_receipts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code   text        NOT NULL REFERENCES payment_providers (code),
  transaction_ref text        NOT NULL CHECK (transaction_ref ~ '^[A-Z0-9._-]{4,64}$'),
  amount_minor    bigint      NOT NULL CHECK (amount_minor > 0),
  currency        char(3)     NOT NULL,
  sender_phone    text        NOT NULL CHECK (sender_phone ~ '^\+[0-9]{8,15}$'),
  received_at     timestamptz NOT NULL,
  source          text        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'sms_forwarder', 'api')),
  status          text        NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched', 'matched')),
  payment_id      uuid        UNIQUE REFERENCES payments (id),
  matched_at      timestamptz,
  recorded_by     uuid        REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobile_money_receipts_ref_uk UNIQUE (provider_code, transaction_ref),
  CONSTRAINT mobile_money_receipts_match_ck CHECK (
    (status = 'matched' AND payment_id IS NOT NULL AND matched_at IS NOT NULL)
    OR (status = 'unmatched' AND payment_id IS NULL AND matched_at IS NULL)
  )
);

CREATE INDEX mobile_money_receipts_lookup_idx
  ON mobile_money_receipts (provider_code, status, received_at DESC);
