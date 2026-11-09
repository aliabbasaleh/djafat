-- 0035_courier_payouts — FEAT-014 (docs/features/FEAT-014-courier-earnings-payouts).
-- A courier's earnings paid to their Airtel Money: requested by the courier
-- (on demand) or prepared each Monday (weekly), sent by staff who record the
-- operator's transaction number. Money moves only through the ledger
-- (cash_reconciliation + payout groups) when the payout is marked sent.
-- Owned by module `payments`. Rollback: DROP TABLE courier_payouts.

CREATE TABLE courier_payouts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id       uuid NOT NULL REFERENCES users (id),
  kind             text NOT NULL CHECK (kind IN ('on_demand', 'weekly')),
  status           text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'sent', 'cancelled')),
  fee_payer        text NOT NULL CHECK (fee_payer IN ('courier', 'djafat')),
  currency         char(3) NOT NULL REFERENCES currencies (code),
  requested_minor  bigint NOT NULL CHECK (requested_minor > 0),
  paid_minor       bigint,
  received_minor   bigint,
  airtel_fee_minor bigint,
  period_start     timestamptz,
  transaction_ref  text,
  sent_by          uuid REFERENCES users (id),
  requested_at     timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  CONSTRAINT courier_payouts_sent_ck CHECK (
    status <> 'sent' OR (paid_minor IS NOT NULL AND received_minor IS NOT NULL
                         AND transaction_ref IS NOT NULL AND sent_at IS NOT NULL)
  ),
  CONSTRAINT courier_payouts_weekly_ck CHECK (kind <> 'weekly' OR period_start IS NOT NULL)
);

-- One open request per courier at a time.
CREATE UNIQUE INDEX courier_payouts_one_open_uk ON courier_payouts (courier_id) WHERE status = 'requested';
-- One weekly payout per courier and week.
CREATE UNIQUE INDEX courier_payouts_weekly_uk ON courier_payouts (courier_id, period_start) WHERE kind = 'weekly';
CREATE INDEX courier_payouts_courier_idx ON courier_payouts (courier_id, requested_at DESC);
