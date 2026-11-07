-- 0033_courier_cash_control — FEAT-010 (docs/features/FEAT-010-courier-cash-control).
--   * couriers.cash_blocked_at: set while the cash a courier holds
--     (ledger CASH_FLOAT) is at or above the ceiling; dispatch skips them.
--   * mobile_money_receipts.courier_id: a received transfer can pay a payment
--     OR be a courier's cash remittance — exactly one of the two once matched.
-- Rollback: restore the previous mobile_money_receipts_match_ck, then drop
-- the two columns.

ALTER TABLE couriers ADD COLUMN cash_blocked_at timestamptz;

ALTER TABLE mobile_money_receipts ADD COLUMN courier_id uuid REFERENCES users (id);

ALTER TABLE mobile_money_receipts DROP CONSTRAINT mobile_money_receipts_match_ck;
ALTER TABLE mobile_money_receipts ADD CONSTRAINT mobile_money_receipts_match_ck CHECK (
  (status = 'matched' AND matched_at IS NOT NULL
     AND ((payment_id IS NOT NULL AND courier_id IS NULL)
       OR (payment_id IS NULL AND courier_id IS NOT NULL)))
  OR (status = 'unmatched' AND payment_id IS NULL AND courier_id IS NULL AND matched_at IS NULL)
);
