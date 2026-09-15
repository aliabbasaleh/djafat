-- 0021_payments_refunds — refunds (docs/08 §8.8, docs/15 C10).
--
-- Over-refund guard is a TRIGGER, not just application logic — same lesson as
-- Bloc 4 (docs/23 §1.1): a check computed without locking the parent row lets
-- two concurrent refunds each read "still within budget" before either
-- commits. The trigger explicitly locks the `payments` row FIRST
-- (`SELECT ... FOR UPDATE`), forcing concurrent refund writes for the SAME
-- payment to serialize before recomputing the sum.

CREATE TABLE refunds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      uuid NOT NULL REFERENCES payments(id),
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  currency        char(3) NOT NULL REFERENCES currencies(code),
  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
  provider_ref    text,
  idempotency_key text NOT NULL,
  entry_group     uuid REFERENCES ledger_entry_groups(id),
  requested_by    uuid NOT NULL REFERENCES users(id),
  attempts        int NOT NULL DEFAULT 0,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX refunds_payment_idem_uk ON refunds (payment_id, idempotency_key);
CREATE INDEX refunds_payment_idx ON refunds (payment_id);
CREATE TRIGGER refunds_set_updated_at BEFORE UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION check_refund_does_not_exceed_payment() RETURNS trigger AS $$
DECLARE
  payment_amount bigint;
  total_refunded bigint;
BEGIN
  -- Only the transition TO 'succeeded' is the money-moving moment — lock the
  -- parent payment row only then, not on every pending/processing write, so
  -- refund creation doesn't serialize unnecessarily on the same payment.
  IF NEW.status = 'succeeded' THEN
    SELECT amount_minor INTO payment_amount FROM payments WHERE id = NEW.payment_id FOR UPDATE;
    IF payment_amount IS NULL THEN
      RAISE EXCEPTION 'Refund references unknown payment %', NEW.payment_id;
    END IF;

    SELECT COALESCE(SUM(amount_minor), 0) INTO total_refunded
      FROM refunds
      WHERE payment_id = NEW.payment_id AND status = 'succeeded' AND id <> NEW.id;
    IF total_refunded + NEW.amount_minor > payment_amount THEN
      RAISE EXCEPTION 'Refund % would exceed payment % amount: % + % > %',
        NEW.id, NEW.payment_id, total_refunded, NEW.amount_minor, payment_amount
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER refunds_guard_over_refund
  BEFORE INSERT OR UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION check_refund_does_not_exceed_payment();
