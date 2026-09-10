# 06 — Schéma PostgreSQL (révisé — post-audit)

PostgreSQL 16 + extensions `postgis`, `pg_trgm`, `pgcrypto`, `citext`.

> **Révision post-audit.** Changements majeurs vs v1 : montants génériques `*_minor` + `currency` (fin du `*_xaf`), tables `countries`/`cities`/`currencies`, `commission_rules`/`tax_rules`, `payment_methods`/`payment_providers`/`payment_provider_configs`, `webhook_events`, `ledger_accounts`/`ledger_entry_groups` (grand livre à **écrivain unique**), `settlements`, `payouts` corrigés, `payment_disputes`, idempotence **durable** (contraintes DB), `outbox` fiabilisé, `sessions` avec _token family_, états `awaiting_payment`/`expired` sur `orders`. Voir `docs/15-audit-corrections.md` pour la traçabilité des décisions.

---

## 6.1 Conventions

- Clés primaires : `uuid` (`gen_random_uuid()`).
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` (trigger `set_updated_at`), `deleted_at timestamptz null` (soft delete là où l'historique compte).
- **Argent** : jamais de `float`. Toute valeur monétaire = **deux colonnes** : `<nom>_minor bigint` (unité mineure de la devise) **+** une colonne `currency char(3)` sur la ligne (référence `currencies.code`). Une ligne financière = **une seule devise** (pas de ligne multi-devise au MVP). Type domaine : `Money { minor: bigint; currency: string }`.
  - L'échelle « mineure » dépend de l'exposant ISO 4217 de la devise, stocké dans `currencies.exponent` (XAF → 0 : `minor` = franc entier ; EUR → 2 : `minor` = centime). **Aucun moteur de change** : une conversion éventuelle (V2) se fait à des frontières explicites (payout, reporting) avec un taux stocké, hors périmètre actuel.
- **Idempotence durable** : les opérations financières/métier critiques portent une `idempotency_key` **avec contrainte d'unicité PostgreSQL** (jamais Redis seul). Voir §6.7.
- Enums : types `enum` PG pour les statuts stables (migrables via `ADD VALUE`) ; **tables de référence** pour tout ce qui est administrable/extensible sans déploiement (`payment_methods`, `payment_providers`, `ledger_accounts`, `roles`, `currencies`, `countries`, `cities`).
- Toute FK indexée. `CHECK` explicites. Transactions pour tout ce qui touche `orders` / `payments` / `ledger_*` / `payouts` / `refunds` / `settlements`.
- Horodatage d'événements : tables `*_status_history` + `audit_logs` global.
- **Fuseau horaire** : tout `timestamptz` en UTC. Les heures « murales » (horaires restaurant) sont interprétées dans `cities.timezone` du marché du restaurant, **jamais** dans le fuseau du serveur (§6.4).

## 6.2 Vue d'ensemble (groupes)

```text
PLATEFORME    currencies, countries, cities, platform_settings, feature_flags,
              payment_methods, payment_providers, payment_provider_configs,
              commission_rules, tax_rules
IDENTITÉ      roles, users, user_roles, sessions, otp_codes, phone_auth_locks, addresses
CATALOGUE     restaurants, restaurant_users, restaurant_hours, delivery_zones,
              categories, products, product_option_groups, product_options
COMMANDE      carts(optionnel), orders, order_items, order_item_options,
              order_status_history, promotions, promotion_redemptions
PAIEMENT      payments, payment_transactions, webhook_events, refunds, payment_disputes
FINANCE       ledger_accounts, ledger_entry_groups, ledger_entries,
              wallet_balances, wallet_transactions (projection), settlements,
              settlement_items, payouts, payout_attempts
LIVRAISON     couriers, courier_shifts, deliveries, delivery_offers,
              delivery_status_history, delivery_locations, delivery_proofs
RELATION      reviews, notifications, notification_preferences, support_tickets, ticket_messages
SYSTÈME       audit_logs, outbox, files
```

---

## 6.3 DDL — Plateforme / configuration (module `platform`)

```sql
create table currencies (
  code        char(3) primary key,          -- ISO 4217 : 'XAF', 'XOF', 'EUR'...
  exponent    smallint not null default 0,  -- nb de décimales (XAF=0, EUR=2)
  symbol      text not null,
  display_name text not null,
  active      boolean not null default true
);

create table countries (
  id            uuid primary key default gen_random_uuid(),
  iso_code      char(2) not null unique,     -- ISO 3166-1 alpha-2 : 'TD', 'CM', 'SN', 'CI'
  name          text not null,
  currency      char(3) not null references currencies(code),
  default_locale text not null default 'fr',
  timezone      text not null,               -- IANA : 'Africa/Ndjamena'
  dial_code     text not null,               -- '+235'
  active        boolean not null default false
);

create table cities (
  id            uuid primary key default gen_random_uuid(),
  country_id    uuid not null references countries(id),
  name          text not null,
  slug          text not null,
  timezone      text not null,               -- IANA ; peut différer du pays
  centroid      geography(Point,4326),
  bbox          geography(Polygon,4326),
  active        boolean not null default false,
  unique (country_id, slug)
);

-- Paramètres opérationnels résolus city -> country -> global
create table platform_settings (
  key         text not null,                 -- 'unpaid_order_ttl_seconds', 'funds_hold_policy',
                                             -- 'courier_cash_float_cap_minor', 'offer_timeout_seconds'...
  scope       text not null default 'global' check (scope in ('global','country','city')),
  country_id  uuid references countries(id),
  city_id     uuid references cities(id),
  value       jsonb not null,
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  primary key (key, scope, coalesce(country_id,'00000000-0000-0000-0000-000000000000'),
                          coalesce(city_id,   '00000000-0000-0000-0000-000000000000'))
);

create table feature_flags (
  key        text primary key,
  enabled    boolean not null default false,
  rollout    jsonb,                          -- ciblage : {roles, countries, cities, percent}
  updated_at timestamptz not null default now()
);
```

### Moyens de paiement — **data-driven** (fin de l'enum rigide)

```sql
-- Catalogue des TYPES de moyen de paiement (table de réf, extensible par INSERT)
create table payment_methods (
  code         text primary key,             -- 'cash_on_delivery' | 'mobile_money' | 'card' | 'wallet'
  display_name text not null,
  active       boolean not null default true
);

-- Catalogue des PROVIDERS (implémentations concrètes)
create table payment_providers (
  code         text primary key,             -- 'cash' | 'mock' | 'airtel_money' | 'moov_money' | 'card_stripe'...
  method_code  text not null references payment_methods(code),
  display_name text not null,
  -- miroir de ProviderCapabilities (source de vérité = le code du provider ;
  -- copie ici pour l'UI/config et la validation)
  capabilities jsonb not null default '{}',  -- {initiate,webhook,polling,cancel,refund,partialRefund,
                                             --  capture,requiresPayerPhone,async,currencies:[...]}
  active       boolean not null default true
);

-- DISPONIBILITÉ + config d'un provider selon le contexte (résolue par spécificité + priorité)
create table payment_provider_configs (
  id             uuid primary key default gen_random_uuid(),
  provider_code  text not null references payment_providers(code),
  country_id     uuid references countries(id),
  city_id        uuid references cities(id),
  delivery_zone_id uuid,                       -- FK ajoutée après delivery_zones
  restaurant_id  uuid,                         -- FK ajoutée après restaurants (merchant override)
  enabled        boolean not null default true,
  priority       int not null default 100,
  currency       char(3) references currencies(code),   -- si le provider ne règle qu'en 1 devise
  min_amount_minor bigint,
  max_amount_minor bigint,
  config_ref     text,                         -- pointeur vers le jeu de clés dans le secret manager
                                               -- (JAMAIS de secret en base)
  valid_from     timestamptz not null default now(),
  valid_to       timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on payment_provider_configs (provider_code) where enabled;
create index on payment_provider_configs (country_id, city_id) where enabled;
```

**Résolution** (`GET /v1/config/payment-methods`) : filtrer par `(country_id, city_id[, zone][, restaurant])`, `enabled`, fenêtre de validité, `currency`, plage de montant → trier par spécificité (restaurant > zone > city > country > global) puis `priority` → renvoyer `{ method, provider, displayName, capabilities }`.

### Commissions & taxes — **règles configurables**

```sql
create table commission_rules (
  id            uuid primary key default gen_random_uuid(),
  scope         text not null check (scope in ('global','country','city','restaurant','category')),
  country_id    uuid references countries(id),
  city_id       uuid references cities(id),
  restaurant_id uuid,                          -- FK ajoutée après restaurants
  category_id   uuid,                          -- FK ajoutée après categories
  rate_bps      int not null check (rate_bps between 0 and 10000),   -- 2000 = 20 %
  min_fee_minor bigint,
  max_fee_minor bigint,
  priority      int not null default 100,
  valid_from    timestamptz not null default now(),
  valid_to      timestamptz,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index on commission_rules (scope, active);

create table tax_rules (
  id          uuid primary key default gen_random_uuid(),
  country_id  uuid not null references countries(id),
  city_id     uuid references cities(id),
  kind        text not null,                   -- 'vat' | 'service_tax' | ...
  rate_bps    int not null check (rate_bps between 0 and 10000),
  applies_to  text not null check (applies_to in ('subtotal','delivery_fee','service_fee','total')),
  inclusive   boolean not null default false,  -- prix TTC (true) ou HT + taxe ajoutée (false)
  priority    int not null default 100,
  valid_from  timestamptz not null default now(),
  valid_to    timestamptz,
  active      boolean not null default true
);
create index on tax_rules (country_id, active);
```

**Résolution** : la règle **la plus spécifique**, active et dans sa fenêtre de validité, `priority` la plus haute, gagne. Le taux résolu est **snapshoté** sur la commande (`orders.commission_bps_snapshot`, `orders.tax_minor`) → une commande passée ne change jamais si la règle évolue. Tchad MVP : `tax_rules` vide (0 %), `commission_rules` = 1 ligne `scope='country'` à 2000 bps.

---

## 6.4 DDL — Identité

```sql
create table roles (
  code  text primary key,   -- customer, restaurant_owner, restaurant_staff, courier, admin, super_admin
  label text not null
);

create table users (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null,                 -- E.164
  phone_verified_at timestamptz,
  email        citext,
  full_name    text,
  avatar_file_id uuid,
  country_id   uuid references countries(id), -- déduit du dial code / 1re commande ; nullable
  locale       text not null default 'fr',
  status       text not null default 'active' check (status in ('active','suspended','deleted')),
  last_seen_at timestamptz,
  deleted_at   timestamptz
);
create unique index users_phone_active_uk on users (phone) where deleted_at is null;
create unique index users_email_active_uk on users (email) where email is not null and deleted_at is null;
-- Suppression de compte = anonymisation (phone -> 'deleted:<uuid>', PII nulle), pas seulement soft delete,
-- pour libérer le numéro sans casser les FK historiques.

create table user_roles (
  user_id  uuid not null references users(id) on delete cascade,
  role     text not null references roles(code),
  scope_restaurant_id uuid,                   -- FK ajoutée après restaurants (restaurant_staff/owner)
  scope_country_id    uuid references countries(id),  -- admin régional (nullable = global) — logique de filtrage P2
  scope_city_id       uuid references cities(id),     -- admin de ville     (nullable = global) — logique de filtrage P2
  primary key (user_id, role,
    coalesce(scope_restaurant_id,'00000000-0000-0000-0000-000000000000'),
    coalesce(scope_country_id,   '00000000-0000-0000-0000-000000000000'),
    coalesce(scope_city_id,      '00000000-0000-0000-0000-000000000000'))
);
-- MVP : les admins sont GLOBAUX (scopes null). Les colonnes existent dès maintenant pour éviter
-- une migration avant le 2e marché ; le filtrage pays/ville dans les endpoints admin est P2.

create table sessions (                       -- refresh tokens rotatifs + token family
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  family_id     uuid not null,                -- toute la lignée d'une connexion
  refresh_hash  text not null unique,         -- hash du refresh token courant
  parent_id     uuid references sessions(id),
  user_agent    text, ip inet,
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  revoked_reason text                         -- 'rotated' | 'logout' | 'reuse_detected' | 'admin'
);
create index on sessions (user_id) where revoked_at is null;
create index on sessions (family_id);
-- Réutilisation d'un refresh déjà tourné (revoked_at not null, reason 'rotated') -> révoquer TOUTE la family.

create table otp_codes (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null,
  code_hash    text not null,
  purpose      text not null check (purpose in ('login','register','change_phone')),
  attempts     int not null default 0,
  consumed_at  timestamptz,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);
create index on otp_codes (phone, purpose, expires_at desc);

create table phone_auth_locks (               -- anti brute-force OTP, DURABLE (pas Redis seul)
  phone         text primary key,
  failed_count  int not null default 0,
  locked_until  timestamptz,
  updated_at    timestamptz not null default now()
);

create table addresses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  label         text,
  recipient_phone text,
  city_id       uuid references cities(id),
  quartier      text,
  street        text,
  landmark      text,
  instructions  text,
  geom          geography(Point,4326),
  geocode_status text not null default 'pending' check (geocode_status in ('pending','ok','failed','manual')),
  is_default    boolean not null default false
);
create index on addresses (user_id);
create index on addresses using gist (geom);
```

---

## 6.5 DDL — Catalogue

```sql
create table restaurants (
  id            uuid primary key default gen_random_uuid(),
  country_id    uuid not null references countries(id),
  city_id       uuid not null references cities(id),
  slug          text not null unique,
  name          text not null,
  description   text,
  logo_file_id  uuid, cover_file_id uuid,
  phone         text,
  geom          geography(Point,4326) not null,
  address_text  text, quartier text,
  status        text not null default 'draft' check (status in ('draft','active','suspended','closed_permanently')),
  is_open_now   boolean not null default false,   -- dérivé (horaires interprétés en cities.timezone + override)
  manual_closed boolean not null default false,
  rating_avg    numeric(2,1) not null default 0,
  rating_count  int not null default 0,
  prep_time_min int not null default 20,
  min_order_minor bigint not null default 0,
  currency      char(3) not null references currencies(code),   -- devise d'affichage/opération du resto
  commission_bps_effective int,                   -- cache de la règle résolue (nullable = résoudre live)
  deleted_at    timestamptz
);
create index on restaurants (status, city_id) where deleted_at is null;
create index on restaurants using gist (geom);
create index on restaurants using gin (name gin_trgm_ops);

-- FK différées désormais résolubles
alter table user_roles              add constraint fk_ur_restaurant  foreign key (scope_restaurant_id) references restaurants(id);
alter table payment_provider_configs add constraint fk_ppc_restaurant foreign key (restaurant_id)     references restaurants(id);
alter table commission_rules        add constraint fk_cr_restaurant  foreign key (restaurant_id)      references restaurants(id);

create table restaurant_users (
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  role          text not null check (role in ('owner','manager','staff')),
  primary key (restaurant_id, user_id)
);

create table restaurant_hours (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  weekday       int not null check (weekday between 0 and 6),   -- interprété en cities.timezone du resto
  opens_at      time not null,
  closes_at     time not null,
  unique (restaurant_id, weekday, opens_at)
);

create table delivery_zones (
  id            uuid primary key default gen_random_uuid(),
  country_id    uuid not null references countries(id),
  city_id       uuid not null references cities(id),
  restaurant_id uuid references restaurants(id) on delete cascade,   -- null = zone globale marché
  name          text not null,
  area          geography(Polygon,4326) not null,
  currency      char(3) not null references currencies(code),
  base_fee_minor bigint not null default 500,
  per_km_minor  bigint not null default 150,
  min_fee_minor bigint not null default 500,
  max_distance_km numeric(5,2) not null default 8,
  active        boolean not null default true
);
create index on delivery_zones using gist (area);
alter table payment_provider_configs add constraint fk_ppc_zone foreign key (delivery_zone_id) references delivery_zones(id);

create table categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,   -- null = catégorie globale
  name          text not null, icon text, sort_order int not null default 0
);
alter table commission_rules add constraint fk_cr_category foreign key (category_id) references categories(id);

create table products (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  category_id   uuid references categories(id) on delete set null,
  name          text not null,
  name_i18n     jsonb,                          -- réservé V2 (traduction contenu) ; MVP = name seul
  description   text,
  image_file_id uuid,
  price_minor   bigint not null check (price_minor >= 0),
  currency      char(3) not null references currencies(code),
  is_available  boolean not null default true,
  sort_order    int not null default 0,
  deleted_at    timestamptz
);
create index on products (restaurant_id) where deleted_at is null;
create index on products using gin (name gin_trgm_ops);

create table product_option_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  name text not null, min_select int not null default 0, max_select int not null default 1,
  required boolean not null default false, sort_order int not null default 0
);
create table product_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references product_option_groups(id) on delete cascade,
  name text not null,
  price_minor bigint not null default 0,
  currency char(3) not null references currencies(code),
  is_available boolean not null default true, sort_order int not null default 0
);
```

---

## 6.6 DDL — Commande

```sql
create type order_status as enum
  ('draft','awaiting_payment','placed','confirmed','preparing','ready','courier_assigned',
   'picked_up','on_the_way','delivered','cancelled','rejected','expired');

-- MACHINE À ÉTATS COMMANDE (canonique — implémentée dans @djafat/core, refusée sinon)
--   draft ─(POST /orders, COD)──────────────► placed
--   draft ─(POST /orders, prépayé)──────────► awaiting_payment
--   awaiting_payment ─(payment.succeeded)──► placed
--   awaiting_payment ─(TTL / order-expiry)─► expired            [terminal]
--   awaiting_payment ─(customer cancel)────► cancelled          [terminal]
--   placed ─(restaurant accept)────────────► confirmed
--   placed ─(restaurant reject)────────────► rejected           [terminal] (+ refund auto si payé)
--   placed | confirmed ─(customer/admin cancel, avant preparing)► cancelled [terminal] (+ refund auto si payé)
--   confirmed ─────────────────────────────► preparing ──► ready ──► courier_assigned
--   courier_assigned ──► picked_up ──► on_the_way ──► delivered  [terminal]
--   (n'importe quel état actif) ─(admin cancel, exceptionnel)──► cancelled [terminal] + audit + refund
-- États terminaux : delivered, cancelled, rejected, expired. Aucune transition sortante.
-- Interdits (jamais documentés/produits) : placed→awaiting_payment · delivered→*  · expired→*  ·
--   confirmed sans passage par placed · courier_assigned avant ready.

create type fulfillment_type as enum ('delivery','pickup');

create table orders (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,          -- DJF-7F3K2
  idempotency_key  text not null,                 -- fourni par le client, DURABLE
  -- A8 : city_id = VILLE DU RESTAURANT. La localité de livraison du client est portée
  --      SÉPARÉMENT par address_id + address_snapshot (geom lat/lng, quartier, repère, tél)
  --      + delivery_zone_id. Le système représente restaurant_city ≠ customer_delivery_locality.
  country_id       uuid not null references countries(id),
  city_id          uuid not null references cities(id),
  customer_id      uuid not null references users(id),
  restaurant_id    uuid not null references restaurants(id),
  status           order_status not null default 'draft',
  fulfillment      fulfillment_type not null default 'delivery',
  address_id       uuid references addresses(id),
  address_snapshot jsonb,                          -- {quartier, street, landmark, instructions, recipient_phone, geom:{lat,lng}}
  delivery_zone_id uuid references delivery_zones(id),   -- zone résolue (audit du frais de livraison)
  currency         char(3) not null references currencies(code),
  -- montants figés (autoritaires, calculés serveur) ; MÊME devise sur toute la ligne
  subtotal_minor        bigint not null default 0,
  delivery_fee_minor    bigint not null default 0,
  service_fee_minor     bigint not null default 0,
  discount_minor        bigint not null default 0,
  tax_minor             bigint not null default 0,
  total_minor           bigint not null default 0,
  -- répartition (snapshot des règles au moment de la commande)
  commission_bps_snapshot int not null default 0,
  commission_minor        bigint not null default 0,
  courier_fee_minor       bigint not null default 0,
  promotion_id     uuid references promotions(id),
  -- paiement : moyen CHOISI (peut changer au retry) ; l'autorité reste la table payments
  payment_method_code   text references payment_methods(code),
  payment_provider_code text references payment_providers(code),
  payment_status   text not null default 'pending',   -- miroir dénormalisé du dernier payment
  expires_at       timestamptz,                        -- TTL awaiting_payment (prépayé)
  customer_note    text,
  scheduled_for    timestamptz,
  placed_at        timestamptz,
  delivered_at     timestamptz,
  cancelled_reason text
);
create unique index orders_customer_idem_uk on orders (customer_id, idempotency_key);
create index on orders (customer_id, created_at desc);
create index on orders (restaurant_id, status);
create index on orders (status) where status not in ('delivered','cancelled','rejected','expired');
create index on orders (status, expires_at) where status = 'awaiting_payment';   -- balayage TTL

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id),
  name_snapshot text not null,
  unit_price_minor bigint not null,
  quantity int not null check (quantity > 0),
  line_total_minor bigint not null,
  currency char(3) not null references currencies(code),
  note text
);
create index on order_items (order_id);

create table order_item_options (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items(id) on delete cascade,
  option_id uuid references product_options(id),
  name_snapshot text not null,
  price_minor bigint not null default 0,
  currency char(3) not null references currencies(code)
);

create table order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  from_status order_status, to_status order_status not null,
  actor_user_id uuid references users(id), actor_role text, reason text,
  created_at timestamptz not null default now()
);
create index on order_status_history (order_id, created_at);

create table promotions (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  country_id uuid references countries(id), city_id uuid references cities(id),
  restaurant_id uuid references restaurants(id),
  kind text not null check (kind in ('percent','fixed','free_delivery')),
  value bigint not null default 0,                 -- bps si percent, sinon montant minor
  currency char(3) references currencies(code),    -- requis si kind='fixed'
  min_order_minor bigint not null default 0,
  max_discount_minor bigint,
  first_order_only boolean not null default false,
  starts_at timestamptz, ends_at timestamptz,
  usage_limit int, per_user_limit int not null default 1, used_count int not null default 0,
  active boolean not null default true
);

create table promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references promotions(id),
  user_id uuid not null references users(id),
  order_id uuid not null references orders(id),
  discount_minor bigint not null,
  currency char(3) not null references currencies(code),
  created_at timestamptz not null default now(),
  unique (promotion_id, order_id),
  unique (promotion_id, user_id, order_id)
);
```

---

## 6.7 DDL — Paiement (module `payments`)

```sql
create type payment_status as enum
  ('pending','authorized','succeeded','failed','cancelled','expired',
   'refunded','partially_refunded','needs_review');
-- Noms domaine : PENDING, AUTHORIZED*, SUCCESS(=succeeded), FAILED, CANCELLED, EXPIRED,
--                REFUNDED, PARTIALLY_REFUNDED, NEEDS_REVIEW.
-- (*) AUTHORIZED / capture : optionnels, utilisés seulement si capabilities.capture du provider.

create table payments (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders(id),
  provider_code  text not null references payment_providers(code),
  method_code    text not null references payment_methods(code),
  status         payment_status not null default 'pending',
  amount_minor   bigint not null check (amount_minor > 0),
  currency       char(3) not null references currencies(code),
  psp_fee_minor  bigint not null default 0,       -- connu à la confirmation/settlement
  provider_ref   text,                            -- id transaction côté PSP
  idempotency_key text not null,
  payer_phone    text,
  attempt_no     int not null default 1,          -- incrémente à chaque /retry (nouvelle ligne)
  expires_at     timestamptz,
  review_reason  text,                            -- rempli si status = 'needs_review'
  metadata       jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index payments_order_idem_uk   on payments (order_id, idempotency_key);
create unique index payments_provider_ref_uk on payments (provider_code, provider_ref) where provider_ref is not null;
create unique index payments_one_success_uk  on payments (order_id) where status = 'succeeded';   -- split payment = dette V2
create index on payments (order_id);
create index on payments (status) where status in ('pending','authorized','needs_review');

-- Journal du dialogue avec le PSP (init, callback, webhook, poll) — non idempotent, purement traçant
create table payment_transactions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  direction text not null check (direction in ('request','response','webhook','poll','cancel','capture','refund')),
  status_from payment_status, status_to payment_status,
  provider_ref text,
  payload_ref text,                               -- pointeur objet-storage (payload brut chiffré)
  payload_masked jsonb,                           -- copie masquée (pas de PII/secret)
  signature_valid boolean,
  created_at timestamptz not null default now()
);
create index on payment_transactions (payment_id, created_at);

-- Idempotence webhook — DURABLE
create table webhook_events (
  id            uuid primary key default gen_random_uuid(),
  provider_code text not null references payment_providers(code),
  event_id      text not null,                    -- id du PSP, ou sha256(body) si absent
  provider_ref  text,
  payload_hash  text not null,
  raw_ref       text,                             -- pointeur objet-storage (brut, chiffré, TTL 180 j)
  signature_valid boolean not null default false,
  status        text not null default 'received'
                 check (status in ('received','processing','processed','failed','ignored')),
  error         text,
  attempts      int not null default 0,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  unique (provider_code, event_id)                -- rejeu du même event = no-op
);
create index on webhook_events (status, received_at) where status in ('received','processing','failed');

create table refunds (
  id             uuid primary key default gen_random_uuid(),
  payment_id     uuid not null references payments(id),
  amount_minor   bigint not null check (amount_minor > 0),
  currency       char(3) not null references currencies(code),
  reason         text,
  status         text not null default 'pending'
                  check (status in ('pending','processing','succeeded','failed','cancelled')),
  provider_ref   text,
  idempotency_key text not null,
  entry_group    uuid,                            -- lien ledger (FK après ledger_entry_groups)
  attempts       int not null default 0,
  last_error     text,
  created_by     uuid references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (payment_id, idempotency_key)
);
create index on refunds (payment_id);
-- Garde de sur-remboursement : trigger BEFORE INSERT/UPDATE
--   sum(amount_minor where status in ('pending','processing','succeeded')) <= payments.amount_minor
--   + même currency que le payment.

-- Litiges / chargebacks — structure réservée (non câblée au MVP)
create table payment_disputes (
  id             uuid primary key default gen_random_uuid(),
  payment_id     uuid not null references payments(id),
  provider_code  text not null references payment_providers(code),
  provider_dispute_ref text,
  kind           text not null check (kind in ('chargeback','fraud','retrieval','complaint')),
  status         text not null default 'open'
                  check (status in ('open','under_review','won','lost','cancelled')),
  amount_minor   bigint, currency char(3) references currencies(code),
  reason_code    text,
  opened_at      timestamptz not null default now(),
  due_at         timestamptz, resolved_at timestamptz,
  entry_group    uuid,
  evidence       jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
```

---

## 6.8 DDL — Finance / Grand livre (module `ledger` — **écrivain unique**)

> **Règle d'or** : seul le module `ledger` écrit dans `ledger_accounts`, `ledger_entry_groups`, `ledger_entries`, `wallet_balances`, `wallet_transactions`, `settlements`, `payouts`. Tout autre module appelle `LedgerService.postEntryGroup(...)`. Droits SQL : `INSERT/UPDATE` sur ces tables retirés au rôle applicatif général, accordés au seul rôle `djafat_ledger`.

```sql
create table ledger_accounts (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,                    -- PSP_CLEARING, DJAFAT_BANK, DJAFAT_REVENUE,
                                                -- PSP_FEE_EXPENSE, RESTAURANT_PAYABLE, RESTAURANT_AVAILABLE,
                                                -- COURIER_PAYABLE, COURIER_AVAILABLE, CUSTOMER_CLEARING,
                                                -- CASH_FLOAT, REFUNDS_PAYABLE, PROMO_EXPENSE
  type        text not null check (type in ('asset','liability','revenue','expense','equity','contra')),
  owner_type  text check (owner_type in ('djafat','psp','restaurant','courier','customer')),
  owner_id    uuid,
  currency    char(3) not null references currencies(code),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (code, coalesce(owner_type,''), coalesce(owner_id,'00000000-0000-0000-0000-000000000000'), currency)
);

create table ledger_entry_groups (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in
                  ('order_accrual','funds_available','settlement','payout','refund',
                   'dispute','cash_reconciliation','adjustment')),
  idempotency_key text not null unique,          -- postEntryGroup() rejouable sans effet double
  currency       char(3) not null references currencies(code),
  order_id       uuid references orders(id),
  payment_id     uuid references payments(id),
  settlement_id  uuid,
  payout_id      uuid,
  refund_id      uuid references refunds(id),
  memo           text,
  posted_at      timestamptz not null default now(),
  created_by     text not null                  -- 'payments', 'deliveries', 'reconcile-worker'...
);

create table ledger_entries (
  id           bigserial primary key,
  entry_group  uuid not null references ledger_entry_groups(id),
  account_id   uuid not null references ledger_accounts(id),
  direction    text not null check (direction in ('debit','credit')),
  amount_minor bigint not null check (amount_minor > 0),
  currency     char(3) not null references currencies(code),
  memo         text,
  created_at   timestamptz not null default now()
);
create index on ledger_entries (account_id, created_at);
create index on ledger_entries (entry_group);
-- IMMUABLE : pas d'UPDATE/DELETE (révoqués). Correction = nouveau entry_group 'adjustment' (contre-écriture).
-- INVARIANT (vérifié dans postEntryGroup + job d'assertion horaire) :
--   pour chaque entry_group et chaque currency : sum(debit) = sum(credit).

-- PROJECTIONS (écrites UNIQUEMENT par le projecteur du module ledger, dans la même tx que l'entry_group)
create table wallet_balances (
  owner_type text not null check (owner_type in ('restaurant','courier')),
  owner_id   uuid not null,
  currency   char(3) not null references currencies(code),
  pending_minor   bigint not null default 0,     -- accru non libéré (RESTAURANT_PAYABLE / COURIER_PAYABLE)
  available_minor bigint not null default 0,     -- libéré, virable (RESTAURANT_AVAILABLE / COURIER_AVAILABLE)
  updated_at timestamptz not null default now(),
  primary key (owner_type, owner_id, currency)
);

create table wallet_transactions (              -- read-model paginable pour les relevés partenaires
  id uuid primary key default gen_random_uuid(),
  owner_type text not null, owner_id uuid not null,
  currency char(3) not null references currencies(code),
  bucket text not null check (bucket in ('pending','available')),
  direction text not null check (direction in ('credit','debit')),
  amount_minor bigint not null check (amount_minor > 0),
  balance_after_minor bigint not null,
  entry_group uuid not null references ledger_entry_groups(id),
  order_id uuid references orders(id),
  payout_id uuid,
  memo text,
  created_at timestamptz not null default now()
);
create index on wallet_transactions (owner_type, owner_id, created_at desc);

create table settlements (
  id             uuid primary key default gen_random_uuid(),
  provider_code  text not null references payment_providers(code),
  external_ref   text,                           -- id du lot côté PSP
  currency       char(3) not null references currencies(code),
  gross_amount_minor    bigint not null default 0,
  fee_amount_minor      bigint not null default 0,
  net_amount_minor      bigint not null default 0,
  expected_net_minor    bigint,                  -- calculé depuis nos payments
  status         text not null default 'expected'
                  check (status in ('expected','received','reconciled','discrepancy')),
  bank_credited_at timestamptz,
  entry_group    uuid,
  period_start   timestamptz, period_end timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table settlement_items (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references settlements(id) on delete cascade,
  payment_id uuid references payments(id),
  refund_id  uuid references refunds(id),
  amount_minor bigint not null,
  fee_minor bigint not null default 0,
  matched boolean not null default false,
  note text,
  unique (settlement_id, payment_id),
  unique (settlement_id, refund_id)
);

create table payouts (
  id              uuid primary key default gen_random_uuid(),
  beneficiary_type text not null check (beneficiary_type in ('restaurant','courier')),
  beneficiary_id  uuid not null,
  ledger_account_id uuid not null references ledger_accounts(id),   -- compte *_AVAILABLE ponctionné
  amount_minor    bigint not null check (amount_minor > 0),
  currency        char(3) not null references currencies(code),
  fee_minor       bigint not null default 0,
  method_code     text references payment_methods(code),
  provider_code   text references payment_providers(code),
  destination     text not null,                 -- numéro masqué
  status          text not null default 'requested'
                   check (status in ('requested','approved','processing','paid','failed','cancelled')),
  idempotency_key text not null unique,
  provider_ref    text,
  entry_group     uuid,
  requested_by    uuid references users(id),
  approved_by     uuid references users(id),
  requested_at    timestamptz not null default now(),
  approved_at     timestamptz, paid_at timestamptz,
  failed_reason   text
);

create table payout_attempts (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references payouts(id) on delete cascade,
  attempt_no int not null,
  provider_ref text,
  status text not null check (status in ('sent','succeeded','failed')),
  error text,
  request_ref text, response_ref text,
  created_at timestamptz not null default now(),
  unique (payout_id, attempt_no)
);

-- résolution des liens différés
alter table refunds              add constraint fk_refund_group   foreign key (entry_group)   references ledger_entry_groups(id);
alter table ledger_entry_groups  add constraint fk_leg_settlement foreign key (settlement_id) references settlements(id);
alter table ledger_entry_groups  add constraint fk_leg_payout     foreign key (payout_id)     references payouts(id);
alter table wallet_transactions  add constraint fk_wt_payout      foreign key (payout_id)     references payouts(id);
alter table settlements          add constraint fk_settle_group   foreign key (entry_group)   references ledger_entry_groups(id);
alter table payouts              add constraint fk_payout_group   foreign key (entry_group)   references ledger_entry_groups(id);
alter table payment_disputes     add constraint fk_dispute_group  foreign key (entry_group)   references ledger_entry_groups(id);
```

### Plan comptable minimal & exemple chiffré : voir `docs/08-architecture-paiement.md` §8.9 et `docs/15-audit-corrections.md`.

---

## 6.9 DDL — Livraison

```sql
create type delivery_status as enum
  ('created','searching_courier','offered','assigned','arrived_at_restaurant',
   'picked_up','on_the_way','arrived_at_customer','delivered','failed','cancelled');

create table couriers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  city_id uuid references cities(id),
  vehicle_type text not null check (vehicle_type in ('moto','velo','voiture','pieton')),
  status text not null default 'pending' check (status in ('pending','approved','suspended','rejected')),
  is_online boolean not null default false,
  last_geom geography(Point,4326), last_location_at timestamptz,
  rating_avg numeric(2,1) not null default 0, rating_count int not null default 0,
  active_delivery_id uuid,
  cash_float_minor bigint not null default 0,     -- projection : cash détenu non reversé
  currency char(3) not null references currencies(code)
);
create index on couriers using gist (last_geom) where is_online;

create table courier_shifts (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references couriers(id) on delete cascade,
  started_at timestamptz not null default now(), ended_at timestamptz
);

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id),
  courier_id uuid references couriers(id),
  status delivery_status not null default 'created',
  pickup_geom geography(Point,4326) not null,
  dropoff_geom geography(Point,4326),
  distance_m int, eta_seconds int,
  courier_fee_minor bigint not null default 0,
  currency char(3) not null references currencies(code),
  assigned_at timestamptz, picked_up_at timestamptz, delivered_at timestamptz,
  failure_reason text
);
create index on deliveries (courier_id, status);
create index on deliveries (status) where status not in ('delivered','failed','cancelled');
alter table couriers add constraint fk_active_delivery foreign key (active_delivery_id) references deliveries(id);

create table delivery_offers (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references deliveries(id) on delete cascade,
  courier_id uuid not null references couriers(id),
  distance_m int, score numeric,
  status text not null default 'sent' check (status in ('sent','accepted','declined','expired')),
  sent_at timestamptz not null default now(), responded_at timestamptz,
  expires_at timestamptz not null,
  unique (delivery_id, courier_id)
);
create index on delivery_offers (courier_id, status);

create table delivery_status_history (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references deliveries(id) on delete cascade,
  from_status delivery_status, to_status delivery_status not null,
  actor_user_id uuid references users(id), created_at timestamptz not null default now()
);

create table delivery_locations (
  id bigserial primary key,
  delivery_id uuid not null references deliveries(id) on delete cascade,
  courier_id uuid not null references couriers(id),
  geom geography(Point,4326) not null,
  heading real, speed real, accuracy real,
  recorded_at timestamptz not null, created_at timestamptz not null default now()
) partition by range (recorded_at);
create index on delivery_locations (delivery_id, recorded_at);

create table delivery_proofs (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references deliveries(id) on delete cascade,
  photo_file_id uuid, otp_verified boolean not null default false,
  signature_file_id uuid, note text, created_at timestamptz not null default now()
);
```

---

## 6.10 DDL — Relation & système

```sql
create table reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id),
  customer_id uuid not null references users(id),
  restaurant_id uuid not null references restaurants(id),
  courier_id uuid references couriers(id),
  restaurant_rating int check (restaurant_rating between 1 and 5),
  courier_rating int check (courier_rating between 1 and 5),
  comment text,
  status text not null default 'published' check (status in ('published','hidden','flagged')),
  created_at timestamptz not null default now()
);

create table notification_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  push_enabled boolean not null default true, sms_enabled boolean not null default true,
  email_enabled boolean not null default false, marketing_opt_in boolean not null default false
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null, channel text not null check (channel in ('push','sms','email','in_app')),
  title text, body text, data jsonb,
  status text not null default 'queued' check (status in ('queued','sent','failed','read')),
  dedup_key text,                                 -- (user_id,type,order_id) -> anti-spam
  sent_at timestamptz, read_at timestamptz, created_at timestamptz not null default now()
);
create index on notifications (user_id, created_at desc);
create unique index on notifications (dedup_key) where dedup_key is not null;

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id), order_id uuid references orders(id),
  category text not null, subject text not null,
  status text not null default 'open' check (status in ('open','pending','resolved','closed')),
  priority text not null default 'normal', assigned_to uuid references users(id),
  created_at timestamptz not null default now()
);
create table ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author_id uuid references users(id), body text not null, attachments jsonb,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id), actor_role text,
  action text not null, entity_type text not null, entity_id uuid,
  before jsonb, after jsonb, ip inet, trace_id text,
  step_up_verified boolean,                       -- action financière sensible : step-up MFA validé ?
  created_at timestamptz not null default now()
);
create index on audit_logs (entity_type, entity_id, created_at desc);
create index on audit_logs (actor_user_id, created_at desc);

-- OUTBOX fiabilisé
create table outbox (
  id uuid primary key default gen_random_uuid(),
  aggregate text not null, aggregate_id uuid not null,
  event_type text not null, payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','published','failed')),
  attempts int not null default 0, last_error text,
  next_attempt_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on outbox (status, next_attempt_at) where status in ('pending','processing','failed');
create index on outbox (aggregate, aggregate_id);

create table files (
  id uuid primary key default gen_random_uuid(),
  bucket text not null, key text not null, content_type text, size_bytes bigint,
  variants jsonb, uploaded_by uuid references users(id), created_at timestamptz not null default now()
);
```

---

## 6.11 Règles d'intégrité importantes

- **Prix autoritaire** : le client n'envoie **aucun montant**. `POST /orders` calcule tout via `pricing` (commission/taxe résolues + snapshotées). Le `quote` est indicatif (affichage).
- **Idempotence durable** (contraintes DB, pas Redis) : `orders(customer_id, idempotency_key)`, `payments(order_id, idempotency_key)`, `refunds(payment_id, idempotency_key)`, `payouts(idempotency_key)`, `ledger_entry_groups(idempotency_key)`, `webhook_events(provider_code, event_id)`.
- **Une devise par ligne financière** ; `orders.currency = payments.currency = ledger_entry_groups.currency` (rejet `409 CURRENCY_MISMATCH` sinon).
- **Grand livre** : écrivain unique = module `ledger` ; `ledger_entries` immuable ; `∑debit = ∑credit` par `entry_group` et par `currency` ; `wallet_balances`/`wallet_transactions` = **projections** écrites dans la même transaction que l'`entry_group`, jamais ailleurs.
- **Anti sur-remboursement** : trigger `∑ refunds actifs ≤ payments.amount_minor` + même devise.
- `payments` : au plus un `succeeded` par `order_id` (split payment = dette V2 assumée).
- `deliveries.order_id` unique ; `couriers.active_delivery_id` = 1 course active/livreur (MVP).
- **TTL commande impayée** : job serveur passe `awaiting_payment → expired` après `platform_settings['unpaid_order_ttl_seconds']` (défaut 900 s), annule le `payment` `pending` associé, libère les ressources.
- **Horaires** : `restaurant_hours` interprétés en `cities.timezone` du restaurant ; le job `is_open_now` calcule par fuseau de ville.
- Soft delete : vues publiques filtrent `deleted_at is null` ; suppression de compte = **anonymisation** (libère `phone`).
- `outbox` écrit dans la **même transaction** que le changement métier ; relais avec `attempts`/`next_attempt_at`/`last_error`, `FOR UPDATE SKIP LOCKED`, DLQ si `attempts` dépasse le seuil.

## 6.12 Index & performance

- Listing accueil : `gist(geom)` + `status='active'` + `is_open_now` + `city_id` ; cache Redis par (ville, zone) TTL 60 s **avec single-flight** (anti-stampede).
- Recherche : `gin (name gin_trgm_ops)` + `search_vector tsvector` généré (trigger) + `websearch_to_tsquery`.
- Historique client : `(customer_id, created_at desc)` keyset.
- File resto : `(restaurant_id, status)` partiel.
- Dispatch : `couriers using gist(last_geom) where is_online` + `last_location_at` récent.
- `delivery_locations` : partition/jour, rétention 30 j.
- `ledger_entries` : `(account_id, created_at)` ; envisager partition par mois au-delà de ~10 M.
- `orders` : partition par mois au-delà de ~5 M.
- **PgBouncer** (transaction pooling) devant PostgreSQL dès le Bloc 0 (Prisma + NestJS saturent vite les connexions).

## 6.13 Sauvegardes & rétention

- PostgreSQL managé + **PITR 7–14 j** + copie de backup **cross-région** + **test de restauration** périodique (runbook DR, RPO/RTO chiffrés — doc 14).
- Rétention : `delivery_locations` 30 j · `payment_transactions.payload_masked` 180 j (brut chiffré en objet-storage, TTL 180 j) · `webhook_events.raw_ref` 180 j · `audit_logs` 2 ans · `notifications` 90 j · `ledger_*` **jamais purgé** (archivage froid seulement).
- Export analytics quotidien vers stockage objet (parquet), reporting hors OLTP.

## 6.14 Seed initial (Bloc 0)

```text
currencies:        XAF (exponent 0, 'FCFA')
countries:         TD  Tchad  currency=XAF  locale=fr  tz=Africa/Ndjamena  dial=+235  active=true
cities:            N'Djamena  country=TD  tz=Africa/Ndjamena  active=true
roles:             customer, restaurant_owner, restaurant_staff, courier, admin, super_admin
payment_methods:   cash_on_delivery, mobile_money, card
payment_providers: cash (cash_on_delivery, active) ; mock (mobile_money, active — non-prod uniquement) ;
                   airtel_money (mobile_money, INACTIF — accès API/contrat non vérifié, A1) ;
                   moov_money   (mobile_money, INACTIF — accès API/contrat non vérifié, A1)
payment_provider_configs: cash -> TD/N'Djamena enabled ; mock -> TD/N'Djamena enabled (non-prod)
commission_rules:  scope=country TD, rate_bps=2000 (20 %)
tax_rules:         (vide — 0 %)
ledger_accounts:   DJAFAT_BANK, DJAFAT_REVENUE, PSP_FEE_EXPENSE, PSP_CLEARING(mock), CASH_FLOAT,
                   REFUNDS_PAYABLE, PROMO_EXPENSE, CUSTOMER_CLEARING   (currency=XAF)
platform_settings: unpaid_order_ttl_seconds     = 900     (global — A4)
                   offer_timeout_seconds        = 30      (global)
                   courier_cash_float_cap_minor = 200000  (country TD — B3)
                   psp_fee_policy               = "absorb"                                          (global — A2)
                   funds_release_policy         = {"trigger":"delivered","delay_hours":0,"reserve_percent":0}  (global — A3)
                   courier_compensation_policy  = {"type":"delivery_fee"}                            (global — A5)
                   otp_channels                 = ["sms"]                                            (global — A9)
```
