-- 0004_system — outbox (reliable), audit_logs, files, idempotency_keys.

CREATE TABLE outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate       text NOT NULL,
  aggregate_id    uuid NOT NULL,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','published','failed')),
  attempts        int NOT NULL DEFAULT 0,
  last_error      text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox (status, next_attempt_at)
  WHERE status IN ('pending','processing','failed');
CREATE INDEX outbox_aggregate_idx ON outbox (aggregate, aggregate_id);

CREATE TABLE audit_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id    uuid REFERENCES users(id),
  actor_role       text,
  action           text NOT NULL,
  entity_type      text NOT NULL,
  entity_id        uuid,
  before           jsonb,
  after            jsonb,
  ip               inet,
  trace_id         text,
  step_up_verified boolean,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, created_at DESC);

CREATE TABLE files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket       text NOT NULL,
  key          text NOT NULL,
  content_type text,
  size_bytes   bigint,
  variants     jsonb,
  uploaded_by  uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Durable idempotency guarantee for financial/business writes (docs/15 AD-08).
CREATE TABLE idempotency_keys (
  scope        text NOT NULL,
  key          text NOT NULL,
  fingerprint  text NOT NULL,
  status       text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','completed')),
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (scope, key)
);
