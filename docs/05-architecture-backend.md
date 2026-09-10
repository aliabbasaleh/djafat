# 05 — Architecture backend (NestJS modular monolith — révisé post-audit)

> **Révision post-audit.** Ajouts : modules `platform` (configuration/marché) et `ledger` (finance, **écrivain unique** du grand livre) ; **graphe de dépendances explicite (DAG)** ; rupture du couplage `orders ↔ payments` via `OrderAmountPort` + événements ; frontière stricte « PostgreSQL = vérité durable / Redis = accélération » ; idempotence financière **DB-backed** ; `admin` compose des **services** uniquement. Traçabilité : `docs/15-audit-corrections.md`.

## 5.1 Principe

Un seul déployable (`apps/api`) + des **workers** (`apps/worker`, même code, entrypoint différent). Découpage en **modules métier à frontières nettes**. Chaque module = `controller` (HTTP) + `gateway` (WS si besoin) + `service` (règles) + `repository` (accès données) + `dto` + `events` + `ports` (interfaces qu'il expose/consomme).

**Règles de frontière (non négociables) :**

1. Un module n'accède **jamais** à la table d'un autre module. Communication = appel de **service via interface (port)** en DI, ou **événement de domaine** via l'outbox.
2. Le graphe de dépendances est un **DAG** (voir §5.3). Aucun cycle. En particulier `orders` **n'importe jamais** `payments`.
3. Le **grand livre a un écrivain unique** : seul le module `ledger` écrit `ledger_*`, `wallet_*`, `settlements`, `payouts`. Tout le monde appelle `LedgerService.postEntryGroup(...)`.
4. `admin` compose des **services**, jamais des repositories.

```text
apps/api/src/
├── main.ts                      # bootstrap HTTP (Fastify)
├── app.module.ts
├── common/                      # transverse
│   ├── auth/                    # JWT strategy, guards, @CurrentUser, step-up MFA
│   ├── rbac/                    # rôles + permissions + contrôle de portée
│   ├── validation/             # ZodValidationPipe (schémas @djafat/validation)
│   ├── idempotency/            # helper d'idempotence DB-backed (+ fast-path Redis)
│   ├── money/                  # type Money {minor,currency}, helpers, garde "1 devise/ligne"
│   ├── rate-limit/             # guard (Redis token bucket)
│   ├── errors/                 # filtre d'exception -> {error:{code,message,details,traceId}}
│   ├── logging/                # pino + traceId
│   ├── events/                 # EventBus (in-process) + relais outbox
│   ├── outbox/                 # transactional outbox (status/attempts/next_attempt_at)
│   └── openapi/
├── modules/
│   ├── platform/               # countries, cities, currencies, feature_flags, platform_settings,
│   │                           #   payment_methods, payment_providers, payment_provider_configs,
│   │                           #   commission_rules, tax_rules  (+ résolveurs)
│   ├── auth/                    # OTP, JWT access+refresh rotatif (token family), sessions, locks
│   ├── users/                  # profil, préférences, adresses, favoris
│   ├── restaurants/            # fiche, horaires (tz de la ville), zones, staff
│   ├── menus/  ├── products/  ├── search/
│   ├── pricing/                # calcul autoritaire (commission/taxe résolues + snapshot)
│   ├── promotions/
│   ├── carts/                  # POST /carts/quote (indicatif)
│   ├── orders/                 # cycle de vie, machine à états, awaiting_payment + TTL ; implémente OrderAmountPort
│   ├── payments/               # abstraction PaymentProvider, providers, webhook_events, reconcile
│   ├── ledger/                 # FINANCE — écrivain unique : ledger_*, wallet_*, settlements, payouts, disputes
│   ├── deliveries/            ├── couriers/
│   ├── geo/                    # Map/Geocoding/Routing (interfaces + impls)
│   ├── notifications/         ├── reviews/  ├── support/  ├── analytics/
│   └── admin/                  # compose les SERVICES ci-dessus (lecture large + actions privilégiées)
└── infra/
    ├── prisma/  ├── redis/  ├── queue/ (BullMQ)  └── storage/ (S3 + pipeline images)

apps/worker/src/processors/
    ├── dispatch.processor.ts
    ├── notifications.processor.ts
    ├── payments-reconcile.processor.ts     # getStatus + ingestion settlements + matching
    ├── order-expiry.processor.ts           # awaiting_payment -> expired (TTL)
    ├── outbox-relay.processor.ts           # FOR UPDATE SKIP LOCKED + retry/DLQ
    ├── ledger-assert.processor.ts          # invariant ∑debit=∑credit (horaire)
    ├── geocoding.processor.ts  ├── images.processor.ts  └── analytics-rollup.processor.ts
```

## 5.2 Modules — responsabilités & ports

| Module                           | Responsabilité                                                                                                                                                                                                               | Expose (port)                                                                                | Consomme                                                                                 | Événements émis                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `platform`                       | Config marché : pays, villes, devises, moyens de paiement dispo, règles commission/taxe, settings, flags                                                                                                                     | `MarketConfigPort`, `PaymentMethodResolverPort`, `CommissionResolverPort`, `TaxResolverPort` | —                                                                                        | `config.updated`                                                                                           |
| `auth`                           | OTP (haché, TTL, lock durable), JWT access + refresh **rotatif à token family**, sessions révocables, step-up MFA admin                                                                                                      | `AuthPort`                                                                                   | `platform` (dial code)                                                                   | `user.registered`                                                                                          |
| `users`                          | Profil, préférences, adresses (tz ville), favoris                                                                                                                                                                            | `UserPort`, `AddressPort`                                                                    | `platform`, `geo`                                                                        | `address.created`                                                                                          |
| `restaurants`/`menus`/`products` | Catalogue, horaires (interprétés en `cities.timezone`), zones, dispo, prix `Money`                                                                                                                                           | `CatalogPort`                                                                                | `platform`                                                                               | `restaurant.opened/closed`, `product.availability_changed`                                                 |
| `search`                         | FTS Postgres + filtres + tri                                                                                                                                                                                                 | `SearchPort`                                                                                 | `restaurants`/`products` (lecture via port)                                              | —                                                                                                          |
| `pricing`                        | **Calcul autoritaire** : sous-total, frais livraison (zone+distance), frais service, **commission résolue**, **taxe résolue**, remise → snapshot                                                                             | `PricingPort`                                                                                | `platform` (`CommissionResolverPort`,`TaxResolverPort`), `geo`, `promotions`             | —                                                                                                          |
| `promotions`                     | Codes, règles, imputation (`per_user_limit` vérifié serveur)                                                                                                                                                                 | `PromotionPort`                                                                              | `platform`                                                                               | `promotion.redeemed`                                                                                       |
| `carts`                          | `POST /carts/quote` (indicatif, jamais autoritaire)                                                                                                                                                                          | —                                                                                            | `pricing`, `CatalogPort`                                                                 | —                                                                                                          |
| `orders`                         | Cycle de vie, snapshot items+adresse, machine à états, `awaiting_payment` + `expires_at`, idempotence DB                                                                                                                     | **`OrderAmountPort`** (montant/devise figés d'une commande)                                  | `carts`, `pricing`, `CatalogPort`, `platform`                                            | `order.placed/awaiting_payment/confirmed/preparing/ready/picked_up/on_the_way/delivered/cancelled/expired` |
| `payments`                       | Abstraction `PaymentProvider` (registry data-driven), `initiate/getStatus/verifyAndParseWebhook/cancel/capture?/refund`, `webhook_events`, reconcile                                                                         | `PaymentPort`                                                                                | `platform` (`PaymentMethodResolverPort`), **`OrderAmountPort`**, `ledger` (`LedgerPort`) | `payment.succeeded/failed/cancelled/expired/needs_review/refunded`                                         |
| `ledger`                         | **FINANCE — écrivain unique.** `postEntryGroup()` (équilibre + idempotence), projections `wallet_balances`/`wallet_transactions`, `settlements` (ingestion + matching), `payouts` (+ attempts), `payment_disputes` (réservé) | **`LedgerPort`** (`postEntryGroup`, `getBalances`, `requestPayout`, `ingestSettlement`)      | `platform` (devises)                                                                     | `wallet.credited/debited`, `payout.requested/paid`, `settlement.reconciled/discrepancy`                    |
| `deliveries`                     | Livraison liée à commande, machine à états, preuve (photo+code), garde manipulation frais                                                                                                                                    | `DeliveryPort`                                                                               | `geo`, `LedgerPort` (frais livreur), `OrderAmountPort`                                   | `delivery.created/assigned/picked_up/delivered/failed`                                                     |
| `couriers`                       | Onboarding, online/offline, ingestion position (throttle), dispo, float                                                                                                                                                      | `CourierPort`                                                                                | `LedgerPort` (gains, float)                                                              | `courier.online/offline`, `courier.location`                                                               |
| `geo`                            | `MapProvider`/`GeocodingProvider`/`RoutingProvider` derrière interfaces + cache                                                                                                                                              | `GeoPort`                                                                                    | —                                                                                        | —                                                                                                          |
| `notifications`                  | Event → canaux (push/SMS/email/in-app) selon préférences + criticité ; templates i18n ; dédup                                                                                                                                | —                                                                                            | (écoute events)                                                                          | —                                                                                                          |
| `reviews`                        | Avis, modération, agrégat note                                                                                                                                                                                               | `ReviewPort`                                                                                 | —                                                                                        | `review.created`                                                                                           |
| `support`                        | Tickets, messages                                                                                                                                                                                                            | —                                                                                            | —                                                                                        | `ticket.created/updated`                                                                                   |
| `analytics`                      | Agrégats (rollup)                                                                                                                                                                                                            | —                                                                                            | (écoute events / lit projections)                                                        | —                                                                                                          |
| `admin`                          | Back-office : compose les **services** (jamais les repos) ; actions privilégiées + `audit_logs` + step-up                                                                                                                    | —                                                                                            | tous les ports                                                                           | `audit_log.created`                                                                                        |

## 5.3 Graphe de dépendances des modules (DAG)

Une flèche `A ──► B` = « A peut appeler le **port** de B ». Aucune flèche ne remonte : **pas de cycle**.

```text
Niveau 0 (feuilles de config / infra)
   platform            geo
     ▲  ▲ ▲ ▲            ▲
     │  │ │ │            │
Niveau 1
   auth   users ──────► geo
   restaurants/menus/products ──► platform
   promotions ──► platform
     ▲
Niveau 2
   search ──► (catalog ports)
   pricing ──► platform (Commission/Tax resolvers), geo, promotions
   ledger  ──► platform (devises)            ◄── SEUL écrivain grand livre
     ▲
Niveau 3
   carts ──► pricing, catalog
   orders ──► carts, pricing, catalog, platform        [implémente OrderAmountPort]
     ▲
Niveau 4
   payments ──► platform, ledger(LedgerPort), OrderAmountPort
   deliveries ──► geo, ledger(LedgerPort), OrderAmountPort
   couriers ──► ledger(LedgerPort)
     ▲
Niveau 5 (réactifs — écoutent l'outbox, ne sont appelés par personne en synchrone)
   notifications      realtime(gateway)      analytics
     ▲
Niveau 6
   admin ──► (services de tous les niveaux, en lecture large + actions privilégiées)
```

### Rupture explicite du couplage `orders ↔ payments`

- `orders` **implémente** `OrderAmountPort` : `getAuthoritativeAmount(orderId) → Money`, `getPaymentContext(orderId) → { countryId, cityId, restaurantId, currency }`.
- `payments` **dépend de `OrderAmountPort`** (interface qu'il possède), jamais du repository ni du service concret de `orders`.
- `orders` **n'importe jamais** `payments`. Il **écoute** `payment.succeeded/failed/expired` (via l'outbox) pour faire évoluer `order.status` (`awaiting_payment → placed`, ou rester/expirer).
- Même principe `deliveries`→`orders` (via `OrderAmountPort` + events), `ledger` ne dépend d'aucun module métier (il reçoit des `postEntryGroup` et émet des events).

## 5.4 Patterns transverses

### Argent

`common/money` : type `Money { minor: bigint; currency: string }`, sérialisation `minor` en **string** en JSON (précision), garde « une seule devise par ligne financière » (rejet `409 CURRENCY_MISMATCH`). Aucun `number` pour de l'argent. Aucun nom de champ portant une devise (`amountXaf` interdit — lint).

### Idempotence — **PostgreSQL = vérité durable**, Redis = accélération

| Besoin                                                                                                                                  | Garantie                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `POST /orders`, `/payments`, `/payments/:id/refund`, payout, webhook, `postEntryGroup`                                                  | **Contrainte d'unicité PostgreSQL** (voir doc 06 §6.11 & doc 08 §8.5). C'est la garantie. |
| Fast-path anti-double-clic, verrous courts, rate limits, cache, idempotence **non financière** courte durée, rooms WS, transport BullMQ | **Redis** (best-effort, jamais la seule barrière)                                         |

Helper `common/idempotency` : tente un `INSERT ... ON CONFLICT DO NOTHING` sur la table cible / une table `idempotency_keys` dédiée pour les endpoints sans table naturelle, renvoie la réponse mémorisée sur conflit.

### Transactional outbox (fiabilisé)

Événement de domaine écrit dans `outbox` **dans la même transaction SQL** que le changement métier. `outbox-relay` : `SELECT ... FOR UPDATE SKIP LOCKED`, publication Redis pub/sub / BullMQ, `attempts++`, `next_attempt_at` (backoff), `status='failed'` + DLQ + alerte au-delà du seuil.

### Machine à états

Définie dans `@djafat/core` (transitions autorisées par rôle). Service refuse toute transition illégale (`409/422`), journalise `*_status_history` + `audit_logs`.

### RBAC + portée + step-up

Rôles : `customer, restaurant_owner, restaurant_staff, courier, admin, super_admin`. Guard `@Roles(...)` **+ contrôle de portée systématique** (resto ↔ son établissement, livreur ↔ ses livraisons, client ↔ ses ressources). **Deny par défaut.** Test **matriciel** automatisé : chaque endpoint `/v1/restaurant/*` et `/v1/courier/*` vérifie la propriété.
**Portée pays/ville des utilisateurs internes** : `user_roles.scope_country_id` / `scope_city_id` (nullable = global). MVP : admins **globaux**. Le filtrage des listes admin par pays/ville est **P2** (avant l'ouverture d'un 2e marché) — les colonnes existent dès le Bloc 0 pour éviter une migration. Toute requête admin scopée passera par le même mécanisme centralisé (`common/rbac`), pas de filtrage ad hoc par endpoint.
**Admin** : 2FA (TOTP) au login + **step-up MFA** (ré-auth récente < 10 min) pour : refund, payout approve, changement de commission/tax rule, suspension user/courier/restaurant, feature flag, `platform_settings`, ajustement ledger, replay webhook, import settlement. `audit_logs.step_up_verified`.

### Auth durable & canaux OTP (A9)

Refresh **rotatif à token family** (`sessions.family_id`, `refresh_hash` unique). Réutilisation d'un refresh déjà tourné → **révocation de toute la family** + alerte. OTP : haché, TTL 5 min, ≤ 5 tentatives/code, **lock durable** `phone_auth_locks` (N échecs / M min → `locked_until`), rate-limit Redis en première ligne.
La **remise** de l'OTP passe par un port `OtpDeliveryPort` (implémentation `sms` au MVP, câblée sur `SmsProvider`), extensible à `whatsapp` / `email` / autre **sans changer `auth`** ; canaux actifs pilotés par `platform_settings['otp_channels']` (`["sms"]` au MVP).

### Portabilité de l'hébergement (A6)

Hébergement initial **Scaleway (Paris)**, mais **le code applicatif n'est couplé à aucun fournisseur** : PostgreSQL et Redis standard (pas d'extension propriétaire), stockage objet derrière `ObjectStoragePort` (impl S3-compatible : Scaleway Object Storage / Cloudflare R2 — **aucun SDK propriétaire dans le code métier**), tout containerisé (Docker), configuration par variables d'environnement validées (`@djafat/config`), infra décrite en IaC + runbook. Un déplacement vers Hetzner / AWS / Azure / GCP = changer l'IaC et les endpoints, pas le code.

### Rate limiting

Token bucket Redis : global/IP, renforcé `auth/otp` (3/10 min/numéro, 30/h/IP), recherche, création commande (anti-spam resto), création de compte (par device/numéro), webhooks (par `:provider`).

### Sécurité HTTP

Helmet, CORS allowlist par domaine, HSTS, CSP stricte (web), cookies `Secure`+`HttpOnly`+`SameSite` + CSRF pour les flux à cookie, taille de payload bornée, timeouts.

### Observabilité

`pino` + `traceId` propagé (HTTP + jobs), **OpenTelemetry** (traces) + Prometheus (latence p50/p95/p99 par route, taux d'erreur, profondeur queues, temps dispatch, lag outbox, écart de réconciliation), Sentry (scrubbing PII), `/health` + `/ready`.

## 5.5 Jobs asynchrones (BullMQ)

| Queue                                       | Déclencheur                                              | Rôle                                                                                                            |
| ------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `dispatch`                                  | `payment.succeeded` \| commande COD `placed` (livraison) | candidats livreurs, offres, timeout/relance                                                                     |
| `order-expiry`                              | cron (30 s)                                              | `awaiting_payment` dont `expires_at < now()` → `expired` + annule le `payment` pending                          |
| `payments-reconcile`                        | cron + `payment.pending` ancien + import relevé          | `getStatus()` unitaire **+** ingestion `settlements`/`settlement_items` + matching + post `settlement` + écarts |
| `notifications`                             | events                                                   | template i18n → canal → retries/DLQ + dédup                                                                     |
| `outbox-relay`                              | continu                                                  | publier `outbox` de façon fiable                                                                                |
| `ledger-assert`                             | cron horaire                                             | vérifier `∑debit = ∑credit` par `entry_group`/devise + soldes projetés = grand livre                            |
| `payouts`                                   | cron + demande                                           | préparer/relancer virements (`payout_attempts`)                                                                 |
| `geocoding` / `images` / `analytics-rollup` | events / uploads / cron                                  | inchangé                                                                                                        |

Toutes : retries + backoff exponentiel + dead-letter + alerte si DLQ non vide.

## 5.6 Extraction future en services

Chaque module expose un **port**. Ordre d'extraction probable (piloté par la douleur réelle, pas anticipé) :

1. **gateway WebSocket** (déjà logiquement séparée),
2. **notifications** (I/O externe, spiky),
3. **payments + ledger ensemble** (isolation conformité, cadence de déploiement propre — c'est **parce que** `ledger` est écrivain unique et `payments` ne partage aucune table que l'extraction est propre),
4. **search** → moteur dédié,
5. **dispatch/geo** (CPU).
   L'UI ne bouge pas (le SDK masque l'URL). Bascule des événements sur un vrai bus (Redis Streams / NATS).

## 5.7 Conséquences

- **+** Frontières explicites + DAG + écrivain unique du grand livre = dette d'archi faible, extraction sans big-bang, invariant financier gardé en un seul point.
- **+** `orders` découplé de `payments` : on ajoute un PSP sans recompiler `orders`.
- **−** Discipline requise : lint de frontières (`eslint-plugin-boundaries`), revue d'archi sur tout nouveau module, tests de contrat sur chaque port.
- **−** Un incident process impacte tout → mitigé par workers séparés, readiness probes, déploiement bleu/vert, PgBouncer.
