-- 0026_notifications — Bloc 7 (docs/27 §15-16).
--
-- Additive: two new tables. No past migration is edited, no column is
-- dropped, no data is destroyed.

-- ── 1. Persisted, in-app notifications ───────────────────────────────────────
-- One row per (recipient, business event) pair. `dedup_key` is the OUTBOX ROW
-- id that produced this notification — the same reuse-the-durable-id pattern
-- the realtime payload uses (`eventId`, docs/27 §5, §13). The at-least-once
-- transport guarantees a redelivered event will be handled again; the unique
-- constraint below is what turns that into "recorded once" rather than a
-- growing pile of duplicate rows on every retry.
CREATE TABLE notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- A DOMAIN_EVENTS name (packages/types/src/events.ts) — reused rather than a
  -- second, parallel vocabulary. Never a free-text label.
  type             text NOT NULL,
  -- i18n keys, not rendered strings (docs/10 design system convention): the
  -- client resolves these against its own locale bundle. `data` carries only
  -- what a template needs to interpolate — never a full aggregate.
  title_key        text NOT NULL,
  body_key         text NOT NULL,
  data             jsonb NOT NULL DEFAULT '{}',
  -- What this notification is ABOUT, for a "view order" deep link — never a
  -- join target. `notifications` has no foreign key to `orders`/`deliveries`
  -- on purpose: a notification is a durable record of "we told the user this
  -- at the time", and must keep meaning even if the referenced row is later
  -- deleted or its shape changes.
  reference_aggregate text,
  reference_id        uuid,
  dedup_key        text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  read_at          timestamptz,
  CONSTRAINT notifications_dedup_uk UNIQUE (user_id, dedup_key)
);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX notifications_user_all_idx ON notifications (user_id, created_at DESC);

-- ── 2. Push device registrations ─────────────────────────────────────────────
-- Multiple devices per user (docs/27 §16): a customer may have a phone and a
-- tablet both registered. `push_token` is UNIQUE on its own, not per-user: a
-- token identifies one physical installation, and a reinstall or an account
-- switch on the same device legitimately moves a token from one user to
-- another (the `notification_devices_register` upsert below handles that by
-- re-pointing `user_id` rather than erroring).
--
-- No provider is wired yet (docs/27 §16) — this table exists so registration,
-- multi-device support, and revocation are real and tested against a `PushPort`
-- mock, ready for a real Expo/FCM/APNs provider to be plugged in without a
-- schema change.
CREATE TABLE notification_devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  -- The raw push token. Sensitive — never logged (docs/27 §16, §19); the
  -- application layer is responsible for keeping it out of log lines the same
  -- way OTP codes and payment secrets already are (docs/19 §7, §40).
  push_token      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  CONSTRAINT notification_devices_token_uk UNIQUE (push_token)
);
CREATE INDEX notification_devices_user_idx ON notification_devices (user_id)
  WHERE revoked_at IS NULL;
