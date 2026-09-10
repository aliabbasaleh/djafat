-- 0003_identity — roles, users, user_roles, sessions, otp_codes,
--                 phone_auth_locks, addresses.

CREATE TABLE roles (
  code  text PRIMARY KEY,
  label text NOT NULL
);

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone             text NOT NULL,
  phone_verified_at timestamptz,
  email             citext,
  full_name         text,
  avatar_file_id    uuid,
  country_id        uuid REFERENCES countries(id),
  locale            text NOT NULL DEFAULT 'fr',
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  last_seen_at      timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_phone_active_uk ON users (phone) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_email_active_uk ON users (email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_roles (
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                text NOT NULL REFERENCES roles(code),
  scope_restaurant_id uuid,
  scope_country_id    uuid REFERENCES countries(id),
  scope_city_id       uuid REFERENCES cities(id),
  PRIMARY KEY (user_id, role,
    COALESCE(scope_restaurant_id, '00000000-0000-0000-0000-000000000000'),
    COALESCE(scope_country_id,    '00000000-0000-0000-0000-000000000000'),
    COALESCE(scope_city_id,       '00000000-0000-0000-0000-000000000000'))
);

CREATE TABLE sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id      uuid NOT NULL,
  refresh_hash   text NOT NULL UNIQUE,
  parent_id      uuid REFERENCES sessions(id),
  user_agent     text,
  ip             inet,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_family_idx ON sessions (family_id);

CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  code_hash   text NOT NULL,
  purpose     text NOT NULL CHECK (purpose IN ('login','register','change_phone')),
  attempts    int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_lookup_idx ON otp_codes (phone, purpose, expires_at DESC);

CREATE TABLE phone_auth_locks (
  phone        text PRIMARY KEY,
  failed_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE addresses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label           text,
  recipient_phone text,
  city_id         uuid REFERENCES cities(id),
  quartier        text,
  street          text,
  landmark        text,
  instructions    text,
  geom            geography(Point, 4326),
  geocode_status  text NOT NULL DEFAULT 'pending' CHECK (geocode_status IN ('pending','ok','failed','manual')),
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX addresses_user_idx ON addresses (user_id);
CREATE INDEX addresses_geom_idx ON addresses USING gist (geom);
