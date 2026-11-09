-- 0036_sms_gateways — FEAT-016 (docs/features/FEAT-016-merchant-sms-ingestion).
-- Merchant phones that forward the operator's confirmation SMS, and every SMS
-- they forwarded with what became of it. Owned by module `payments`.
-- Rollback: DROP TABLE mobile_money_sms; DROP TABLE sms_gateway_devices.

CREATE TABLE sms_gateway_devices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code      text NOT NULL,
  label              text NOT NULL,
  secret_enc         text NOT NULL,          -- AES-256-GCM, never plaintext
  created_by         uuid NOT NULL REFERENCES users (id),
  active             boolean NOT NULL DEFAULT true,
  last_seq           bigint NOT NULL DEFAULT 0,
  last_seen_at       timestamptz,
  last_balance_minor bigint,                 -- reference for the balance-continuity check
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mobile_money_sms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id   uuid NOT NULL REFERENCES sms_gateway_devices (id),
  seq         bigint NOT NULL,
  sender      text NOT NULL,
  body        text NOT NULL,
  received_at timestamptz NOT NULL,
  outcome     text NOT NULL CHECK (outcome IN
                ('recorded', 'duplicate', 'quarantined', 'unknown_sender', 'no_template')),
  template    text,
  receipt_id  uuid REFERENCES mobile_money_receipts (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobile_money_sms_seq_uk UNIQUE (device_id, seq)
);
CREATE INDEX mobile_money_sms_review_idx ON mobile_money_sms (outcome, created_at DESC)
  WHERE outcome IN ('quarantined', 'unknown_sender', 'no_template');
