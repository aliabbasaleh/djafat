-- 0010_orders — orders, order_items, order_status_history, payments,
--               webhook_events, deliveries : the Bloc 0.5 walking skeleton.
--
-- order_status / payment_status mirror the CANONICAL enums already validated
-- in @djafat/core (packages/types/src/enums.ts, packages/core/src/order/state-
-- machine.ts, 58 tests). The skeleton drives the REAL machine end-to-end
-- rather than a simplified shortcut set — see docs/18 §3.

CREATE TYPE order_status AS ENUM (
  'draft', 'awaiting_payment', 'placed', 'confirmed', 'preparing', 'ready',
  'courier_assigned', 'picked_up', 'on_the_way', 'delivered',
  'cancelled', 'rejected', 'expired'
);

CREATE TYPE payment_status AS ENUM (
  'pending', 'authorized', 'succeeded', 'failed', 'cancelled', 'expired',
  'refunded', 'partially_refunded', 'needs_review'
);

CREATE TABLE orders (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     text NOT NULL UNIQUE,
  idempotency_key          text NOT NULL,
  country_id               uuid NOT NULL REFERENCES countries(id),
  city_id                  uuid NOT NULL REFERENCES cities(id),
  customer_id              uuid NOT NULL REFERENCES users(id),
  restaurant_id            uuid NOT NULL REFERENCES restaurants(id),
  -- Bloc 0.5 simplification (no real dispatch yet — Bloc 6): the single
  -- seeded test courier is resolved at order-creation time so the courier
  -- portion of `order_accrual` can be posted at payment.succeeded exactly
  -- like the validated reference model (docs/08 §8.9). See docs/18.
  courier_id               uuid REFERENCES users(id),
  status                   order_status NOT NULL DEFAULT 'draft',
  currency                 char(3) NOT NULL REFERENCES currencies(code),
  -- Server-authoritative snapshot — figé à la création, jamais recalculé.
  subtotal_minor           bigint NOT NULL DEFAULT 0,
  delivery_fee_minor       bigint NOT NULL DEFAULT 0,
  commission_bps_snapshot  int NOT NULL DEFAULT 0,
  commission_minor         bigint NOT NULL DEFAULT 0,
  courier_fee_minor        bigint NOT NULL DEFAULT 0,
  total_minor              bigint NOT NULL DEFAULT 0,
  expires_at               timestamptz,
  placed_at                timestamptz,
  delivered_at             timestamptz,
  cancelled_reason         text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX orders_customer_idem_uk ON orders (customer_id, idempotency_key);
CREATE INDEX orders_customer_idx ON orders (customer_id, created_at DESC);
CREATE INDEX orders_restaurant_status_idx ON orders (restaurant_id, status);
CREATE INDEX orders_awaiting_payment_idx ON orders (status, expires_at) WHERE status = 'awaiting_payment';
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id        uuid REFERENCES products(id),
  name_snapshot     text NOT NULL,
  unit_price_minor  bigint NOT NULL,
  quantity          int NOT NULL CHECK (quantity > 0),
  line_total_minor  bigint NOT NULL,
  currency          char(3) NOT NULL REFERENCES currencies(code)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE order_status_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status order_status,
  to_status   order_status NOT NULL,
  actor_role  text,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_status_history_order_idx ON order_status_history (order_id, created_at);

CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id),
  provider_code   text NOT NULL REFERENCES payment_providers(code),
  method_code     text NOT NULL REFERENCES payment_methods(code),
  status          payment_status NOT NULL DEFAULT 'pending',
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  currency        char(3) NOT NULL REFERENCES currencies(code),
  psp_fee_minor   bigint NOT NULL DEFAULT 0,
  provider_ref    text,
  idempotency_key text NOT NULL,
  attempt_no      int NOT NULL DEFAULT 1,
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_order_idem_uk ON payments (order_id, idempotency_key);
CREATE UNIQUE INDEX payments_provider_ref_uk ON payments (provider_code, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE UNIQUE INDEX payments_one_success_uk ON payments (order_id) WHERE status = 'succeeded';
CREATE INDEX payments_order_idx ON payments (order_id);
CREATE INDEX payments_active_idx ON payments (status) WHERE status IN ('pending', 'authorized', 'needs_review');
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Durable webhook idempotency (docs/08 §8.6).
CREATE TABLE webhook_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code   text NOT NULL REFERENCES payment_providers(code),
  event_id        text NOT NULL,
  provider_ref    text,
  payload_hash    text NOT NULL,
  signature_valid boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received', 'processing', 'processed', 'failed', 'ignored')),
  error           text,
  attempts        int NOT NULL DEFAULT 0,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  UNIQUE (provider_code, event_id)
);
CREATE INDEX webhook_events_pending_idx ON webhook_events (status, received_at)
  WHERE status IN ('received', 'processing', 'failed');

-- Delivery — minimal (full doc06 model + dispatch is Bloc 6).
CREATE TABLE deliveries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL UNIQUE REFERENCES orders(id),
  courier_id         uuid NOT NULL REFERENCES users(id),
  status             text NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created', 'assigned', 'picked_up', 'delivered', 'failed', 'cancelled')),
  currency           char(3) NOT NULL REFERENCES currencies(code),
  courier_fee_minor  bigint NOT NULL DEFAULT 0,
  assigned_at        timestamptz,
  picked_up_at       timestamptz,
  delivered_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deliveries_courier_idx ON deliveries (courier_id, status);
