-- 0034_delivery_code_presets — FEAT-012 (docs/features/FEAT-012-phone-order-airtel-and-code).
-- An order taken on the phone: the customer has no app to read the delivery
-- code, so the operator gives it during the call. The code is chosen at that
-- moment, kept hashed (verification truth) and encrypted (read back by the
-- owning customer or the operator), and used when the courier picks up.
-- Owned by module `deliveries`. Rollback: DROP TABLE delivery_code_presets.

CREATE TABLE delivery_code_presets (
  order_id   uuid PRIMARY KEY REFERENCES orders (id) ON DELETE CASCADE,
  value_hash text NOT NULL,
  reference  text NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
