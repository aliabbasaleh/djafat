-- PAY-04: a paid order that ends without delivery (rejected, cancelled, not
-- confirmed in time) is refunded by the system, not only by a staff member.

-- A system refund has no human requester (the reason says what ended the order).
ALTER TABLE refunds ALTER COLUMN requested_by DROP NOT NULL;

-- True when the order's accrual was reversed into REFUNDS_PAYABLE before this
-- refund (the order ended before the kitchen started): the refund then pays
-- that debt off instead of debiting DJAFAT_REVENUE.
ALTER TABLE refunds ADD COLUMN compensates_accrual boolean NOT NULL DEFAULT false;

-- Operations list the refunds still to send or finish by hand.
CREATE INDEX refunds_open_idx ON refunds (created_at) WHERE status IN ('pending', 'failed');
