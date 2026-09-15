-- 0022_settlements — minimal settlement primitive (docs/08 §8.9, docs/15 AD-11).
--
-- Deliberately NOT a statement-ingestion/auto-matching engine (mandate scope
-- exclusion: "no full banking engine"). This is the semi-manual V1.1-deferred
-- shape: an admin records a settlement batch (what the PSP actually paid out
-- for a period) and it posts one balanced `settlement` ledger group
-- (PSP_CLEARING -> DJAFAT_BANK). `discrepancy_minor` is a reconciliation
-- signal (expected vs reported), never auto-corrected — see docs/15 AD-11.

CREATE TABLE settlements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code      text NOT NULL REFERENCES payment_providers(code),
  period_start       timestamptz NOT NULL,
  period_end         timestamptz NOT NULL,
  currency           char(3) NOT NULL REFERENCES currencies(code),
  gross_minor        bigint NOT NULL CHECK (gross_minor >= 0),
  fees_minor         bigint NOT NULL DEFAULT 0 CHECK (fees_minor >= 0),
  net_minor          bigint NOT NULL CHECK (net_minor >= 0),
  expected_net_minor bigint,
  status             text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'reconciled', 'discrepancy')),
  provider_reference text,
  idempotency_key    text NOT NULL UNIQUE,
  entry_group        uuid REFERENCES ledger_entry_groups(id),
  reconciliation_notes text,
  created_by         uuid NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  reconciled_at      timestamptz
);
CREATE INDEX settlements_provider_period_idx ON settlements (provider_code, period_start);
