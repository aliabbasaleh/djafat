-- 0041_account_onboarding — FEAT-022 (docs/features/FEAT-022-inscription-par-type-de-compte).
-- Sign-up as a courier or a restaurant, validated by DJAFAT: N'Djamena's
-- neighbourhoods (module `geo`), the courier's and the restaurant's application
-- (modules `couriers`, `catalog`), and changes waiting for an admin after the
-- approval (module `admin`). Purely additive: existing couriers and restaurants
-- get an `approved` application — they already work.
-- Rollback: DROP TABLE application_changes; DROP TABLE courier_applications;
--   DROP TABLE restaurant_applications;
--   ALTER TABLE couriers DROP CONSTRAINT couriers_vehicle_type_check,
--     DROP COLUMN neighbourhood_id, DROP COLUMN neighbourhood_other, DROP COLUMN birth_date;
--   ALTER TABLE restaurants DROP COLUMN neighbourhood_id, DROP COLUMN neighbourhood_other,
--     DROP COLUMN landmark;
--   DROP TABLE neighbourhoods.

-- SPEC-022-09: a list DJAFAT edits, loaded with the reference data.
CREATE TABLE neighbourhoods (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id     uuid NOT NULL REFERENCES cities (id),
  -- Stable key of a reference-data row (R1): a reinstall finds it by this code
  -- even after an admin renamed or disabled it. NULL = added by an admin.
  code        text,
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 60),
  -- Lower-case, accents removed (R4): two active neighbourhoods never share it.
  name_key    text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX neighbourhoods_code_uk ON neighbourhoods (city_id, code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX neighbourhoods_active_name_uk ON neighbourhoods (city_id, name_key) WHERE active;

-- SPEC-022-02: the courier's vehicle (four values; NULL for couriers created
-- before FEAT-022), neighbourhood and date of birth.
ALTER TABLE couriers ADD CONSTRAINT couriers_vehicle_type_check
  CHECK (vehicle_type IS NULL OR vehicle_type IN ('moto', 'velo', 'voiture', 'a_pied'));
ALTER TABLE couriers ADD COLUMN neighbourhood_id uuid REFERENCES neighbourhoods (id);
ALTER TABLE couriers ADD COLUMN neighbourhood_other text
  CHECK (neighbourhood_other IS NULL OR char_length(btrim(neighbourhood_other)) BETWEEN 2 AND 60);
ALTER TABLE couriers ADD COLUMN birth_date date;

-- SPEC-022-03, SPEC-022-05: the restaurant's neighbourhood and landmark.
ALTER TABLE restaurants ADD COLUMN neighbourhood_id uuid REFERENCES neighbourhoods (id);
ALTER TABLE restaurants ADD COLUMN neighbourhood_other text
  CHECK (neighbourhood_other IS NULL OR char_length(btrim(neighbourhood_other)) BETWEEN 2 AND 60);
ALTER TABLE restaurants ADD COLUMN landmark text CHECK (landmark IS NULL OR char_length(landmark) <= 240);

-- SPEC-022-02, SPEC-022-06: the courier's application. Photo keys point into
-- the private storage (SPEC-022-04), never a public address.
CREATE TABLE courier_applications (
  courier_user_id                 uuid PRIMARY KEY REFERENCES couriers (user_id) ON DELETE CASCADE,
  status                          text NOT NULL DEFAULT 'to_complete'
                                  CHECK (status IN ('to_complete', 'pending_review', 'approved', 'rejected')),
  terms_accepted_at               timestamptz,
  mobile_money_provider           text CHECK (mobile_money_provider IN ('airtel', 'moov')),
  mobile_money_number             text,
  emergency_contact_name          text,
  emergency_contact_phone         text,
  face_photo_key                  text,
  id_card_photo_key               text,
  driving_licence_photo_key       text,
  vehicle_registration_photo_key  text,
  insurance_photo_key             text,
  plate_photo_key                 text,
  rejection_reason                text CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 500),
  submitted_at                    timestamptz,
  decided_at                      timestamptz,
  decided_by                      uuid REFERENCES users (id),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX courier_applications_review_idx ON courier_applications (submitted_at)
  WHERE status = 'pending_review';

-- SPEC-022-03, SPEC-022-05: the restaurant's application (RCCM or NIF, the
-- owner's ID, the payout number).
CREATE TABLE restaurant_applications (
  restaurant_id          uuid PRIMARY KEY REFERENCES restaurants (id) ON DELETE CASCADE,
  status                 text NOT NULL DEFAULT 'to_complete'
                         CHECK (status IN ('to_complete', 'pending_review', 'approved', 'rejected')),
  terms_accepted_at      timestamptz,
  registry_number        text CHECK (registry_number IS NULL OR char_length(registry_number) <= 60),
  registry_photo_key     text,
  owner_id_photo_key     text,
  mobile_money_provider  text CHECK (mobile_money_provider IN ('airtel', 'moov')),
  mobile_money_number    text,
  rejection_reason       text CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 500),
  submitted_at           timestamptz,
  decided_at             timestamptz,
  decided_by             uuid REFERENCES users (id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX restaurant_applications_review_idx ON restaurant_applications (submitted_at)
  WHERE status = 'pending_review';

-- SPEC-022-07 R6 (FEAT-022-Q03): after the approval, a new payout number or a
-- new paper waits for an admin; the courier or restaurant keeps working.
CREATE TABLE application_changes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type      text NOT NULL CHECK (subject_type IN ('courier', 'restaurant')),
  -- The courier's user id, or the restaurant's id.
  subject_id        uuid NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('mobile_money', 'document')),
  -- {provider, number} for a payout number; {documentKind, key} for a paper.
  new_value         jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason  text CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 500),
  created_at        timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz,
  decided_by        uuid REFERENCES users (id)
);
CREATE INDEX application_changes_pending_idx ON application_changes (subject_type, created_at)
  WHERE status = 'pending';

-- Couriers and restaurants created before FEAT-022 already work.
INSERT INTO courier_applications (courier_user_id, status, decided_at)
  SELECT user_id, 'approved', now() FROM couriers;
INSERT INTO restaurant_applications (restaurant_id, status, decided_at)
  SELECT id, 'approved', now() FROM restaurants;
