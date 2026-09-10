# 01 — Architecture générale & multi-plateforme (révisé — post-audit)

> **Révision post-audit.** DJAFAT est conçu **dès le MVP** comme une plateforme **multi-pays / multi-devise / multi-provider de paiement**, exploitable au Tchad (N'Djamena) sans réécriture du cœur pour s'étendre. Ajouts structurants : module `platform` (configuration de marché), module `ledger` (finance, **écrivain unique** du grand livre), type monétaire générique `Money { minor, currency }`, séquencement `awaiting_payment` + TTL, graphe de dépendances des modules en DAG (doc 05). Traçabilité complète : `docs/15-audit-corrections.md`.

## 1. Problème

On doit servir 4 rôles (client, restaurant, livreur, admin) sur 4 familles de devices (Android, iOS, tablette, desktop/navigateur), sans construire ni maintenir 4+ bases de code disjointes, tout en gardant une UX réellement adaptée à chaque device (et pas un « desktop rétréci »).

## 2. Options

| Option                                                                   | Description                                                                     | Verdict                                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| A. Apps 100 % indépendantes                                              | Une équipe/base par surface                                                     | ❌ Duplication massive de logique métier, dérive des règles, coût                |
| B. Une seule UI universelle (React Native Web / Tamagui / Flutter Web)   | Un seul rendu pour tout                                                         | ⚠️ Compromis UX, maturité web variable, difficile de faire « excellent partout » |
| C. **Backend unique + socle partagé + 2 rendus UI (web / mobile natif)** | Partage tout sauf l'UI ; 2 implémentations d'UI pilotées par des tokens communs | ✅ Recommandé                                                                    |

## 3. Recommandation — Option C

```text
                          DJAFAT PLATFORM (monorepo TypeScript)
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
   packages/ (partagé)            apps/api (NestJS)                infra/
   ├── types      (DटO, enums)   ├── modules métier               ├── docker-compose
   ├── validation (Zod)          ├── REST + OpenAPI                ├── migrations
   ├── sdk        (client API)   ├── WebSocket gateway             └── IaC / CI
   ├── core       (logique pure) ├── workers (BullMQ)
   ├── tokens     (design)       └── PostgreSQL + Redis
   └── i18n
        │
        ├──────────────► apps/web        (Next.js)  → client desktop/tablette + site public + PWA
        ├──────────────► apps/mobile     (Expo/RN)  → client Android/iOS + tablette
        ├──────────────► apps/restaurant (Next.js)  → dashboard restaurant (desktop/tablette/mobile web)
        ├──────────────► apps/courier    (Expo/RN)  → app livreur (mobile) + apps/courier-web (Next.js) fallback
        └──────────────► apps/admin      (Next.js)  → back-office
```

### Ce qui est partagé (packages/)

| Package              | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                     | Consommé par                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `@djafat/types`      | Interfaces DTO, enums (`OrderStatus`, `PaymentStatus`, `DeliveryStatus`, `Role`…), types d'événements temps réel                                                                                                                                                                                                                                                                                                            | tout                                    |
| `@djafat/validation` | Schémas **Zod** (inscription, adresse, checkout, création produit…). Une seule source de vérité, utilisée côté serveur (pipe de validation) **et** côté client (formulaires)                                                                                                                                                                                                                                                | api, web, mobile, restaurant, admin     |
| `@djafat/core`       | Logique métier **pure et testable** sans I/O : type **`Money { minor: bigint; currency: string }`** + arithmétique monétaire (une devise par calcul), calcul du panier (sous-total, options, remises), frais de livraison, **résolution commission/taxe**, format prix multi-devise, calcul/format ETA, machines à états (commande, paiement, livraison), règles d'ouverture restaurant (interprétées dans un fuseau donné) | api, web, mobile                        |
| `@djafat/sdk`        | Client API typé + hooks React Query, gestion des tokens, retry, **`Idempotency-Key`**, base URL par environnement                                                                                                                                                                                                                                                                                                           | web, mobile, restaurant, admin, courier |
| `@djafat/tokens`     | Design tokens (couleurs, espacements, typo, rayons, ombres, z-index, breakpoints) en JSON + exports : CSS vars (web), objet JS (RN)                                                                                                                                                                                                                                                                                         | web, mobile, restaurant, admin          |
| `@djafat/i18n`       | Clés de traduction FR (+ structure AR/RTL), helpers de pluralisation, **format nombre/devise par `currency` + `locale`**, format date par fuseau                                                                                                                                                                                                                                                                            | tout front                              |
| `@djafat/config`     | Constantes non secrètes, schéma de validation des variables d'environnement                                                                                                                                                                                                                                                                                                                                                 | tout                                    |

> **Argent** : `@djafat/types` exporte `Money`, `ProviderCapabilities`, `LedgerAccountCode`, les enums `OrderStatus` / `PaymentStatus` / `DeliveryStatus`. Aucun champ ne porte une devise dans son nom (`amountXaf` interdit — lint).

### Ce qui n'est PAS partagé (assumé)

- **Composants d'UI** : `apps/web` utilise Radix + Tailwind ; `apps/mobile` a sa propre bibliothèque RN. Les deux consomment `@djafat/tokens` → cohérence visuelle sans couplage de code.
- **Navigation / routing** : Next App Router vs expo-router.
- **APIs plateforme** : notifications, GPS en arrière-plan, caméra, safe areas, biométrie.

> **Règle** : si un bug de règle métier peut apparaître différemment sur web et mobile, c'est que la règle n'est pas dans `@djafat/core`. On la déplace.

## 4. Architecture logique du système

```text
Clients (web/mobile) ──HTTPS──►  API Gateway (NestJS, REST) ──► Modules métier ──► PostgreSQL
        │                              │                             │  (via PgBouncer)
        │◄────────WSS────────► WebSocket Gateway (Socket.IO) ◄──────┤ (événements domaine via OUTBOX)
        │                              │
        │                         Redis  = ACCÉLÉRATION : cache, pub/sub, rooms, rate-limit,
        │                                  locks courts, BullMQ transport
        │                         PostgreSQL = VÉRITÉ DURABLE : orders, payments, ledger,
        │                                  payouts, refunds, webhook_events, idempotency, outbox
        │                              │
        │                         Workers (dispatch, notifications, payments-reconcile + settlements,
        │                                  order-expiry TTL, outbox-relay, ledger-assert, géocodage, images)
        │
   CDN + Object Storage (S3-compatible) : images/menus, justificatifs de livraison, payloads PSP bruts (chiffrés)
```

Modules clés (détail + DAG dans doc 05) :

- **`platform`** — configuration de marché : `countries`, `cities`, `currencies`, moyens de paiement disponibles (`payment_provider_configs`), `commission_rules`, `tax_rules`, `platform_settings`, `feature_flags`. Consommé (lecture) par presque tous les modules ; ne dépend de rien.
- **`ledger` (finance)** — **écrivain unique** du grand livre double entrée. Expose `LedgerService.postEntryGroup(entries[])` (équilibre `∑debit = ∑credit`, idempotence durable). `wallet_balances` (pending/available) = **projections** du grand livre. Gère `settlements` (PSP → banque) et `payouts`.
- **`payments`** — abstraction `PaymentProvider` (registry data-driven : Cash, Mock, Airtel Money, Moov Money, Card, futurs). Le cœur `orders` **ne connaît jamais un PSP**, seulement `PaymentPort`.

### Flux d'un événement — « paiement confirmé (Mobile Money) »

1. Webhook PSP → `POST /v1/payments/webhook/:provider` → insert `webhook_events` (unique `(provider, event_id)` → rejeu = no-op) → `200` < 1 s.
2. Job : `provider.verifyAndParseWebhook()` — **signature = source de confiance** ; recoupe `amount`/`currency` ; écart → `NEEDS_REVIEW`.
3. **Une transaction SQL** : `payments.status → succeeded` (update conditionnel `WHERE status IN (pending,authorized)`), `LedgerService.postEntryGroup('order_accrual', …)` (+ projections wallet), `orders.payment_status`, insert `outbox('payment.succeeded')`.
4. `outbox-relay` publie ; `orders` (abonné) passe `awaiting_payment → placed` ; `realtime` pousse `order:{id}` + `customer:{id}` ; `notifications` enfile push client + push restaurant (« à préparer ») ; `dispatch` s'amorce.

> Le restaurant n'est **jamais** notifié « à préparer » pour une commande prépayée tant que `payment.succeeded` n'est pas acté (§7).

## 5. Environnements

| Env          | Usage                     | Données         | Paiements        |
| ------------ | ------------------------- | --------------- | ---------------- |
| `local`      | Dev poste                 | seed + fixtures | providers _mock_ |
| `staging`    | Recette, tests E2E, démos | anonymisées     | sandbox PSP      |
| `production` | Réel                      | réelles         | PSP live         |

Chaque app front cible une base URL API par env. Config via `.env` validé au boot par `@djafat/config` (l'API refuse de démarrer si une variable requise manque).

## 6. Multi-pays / multi-devise / multi-provider — principes (dès le MVP)

| Axe                   | Mécanisme                                                                                                                                                              | MVP                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Pays**              | Table `countries` (ISO, devise, locale, fuseau, dial code). `country_id` sur `restaurants`, `orders`, `delivery_zones`, `promotions`                                   | 1 ligne : Tchad (`TD`)                        |
| **Ville**             | Table `cities` (fuseau propre, bbox). `city_id` sur les mêmes racines                                                                                                  | 1 ligne : N'Djamena                           |
| **Devise**            | Type `Money { minor, currency }` partout ; colonnes `*_minor` + `currency` sur toute table financière ; `currencies` porte l'exposant ISO. **Pas de moteur de change** | XAF (exposant 0)                              |
| **Langue**            | `@djafat/i18n` FR ; structure AR/RTL réservée ; `products.name_i18n` réservé (contenu)                                                                                 | FR                                            |
| **Fuseau**            | Horaires restaurant interprétés dans `cities.timezone`, jamais le fuseau serveur                                                                                       | `Africa/Ndjamena`                             |
| **Paiement**          | `PaymentProvider` + `payment_provider_configs` (dispo par pays/ville/zone/restaurant). Ajouter un PSP = **données + un fichier provider**, zéro impact `orders`/API    | Cash + Mock (+ 1 Mobile Money réel au Bloc 5) |
| **Commission / taxe** | `commission_rules` / `tax_rules` résolues (global→pays→ville→resto→catégorie) + **snapshot** sur la commande                                                           | commission 20 % pays ; taxe 0 %               |

Ajouter un marché (Cameroun, Sénégal, Côte d'Ivoire…) = **INSERT** dans `countries`/`cities`/`currencies` + `payment_provider_configs` + `commission_rules` + traduction i18n. **Aucune migration structurelle, aucune réécriture du cœur.** Aucun code métier ne suppose `Chad` / `XAF` / `N'Djamena` comme valeurs permanentes.

### Décisions verrouillées A1–A9 (2e passe de validation — détail `docs/15-audit-corrections.md` §10)

|        | Décision                                                                                                                                                                                                                                                                  | Configurable via                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **A1** | Multi-provider dès la conception ; n'activer que les providers dont l'accès technique **et** commercial est vérifié. Aucune affirmation de dispo Airtel/Moov. MVP = `cash` + `mock`. `MockProvider` permanent.                                                            | `payment_providers.active`, `payment_provider_configs.enabled`                |
| **A2** | DJAFAT absorbe les frais PSP au MVP, **comptabilisés séparément** (`PSP_FEE_EXPENSE`), jamais nets du revenu.                                                                                                                                                             | `platform_settings['psp_fee_policy']` = `absorb`                              |
| **A3** | `payment success → pending` ; `order delivered → available`. Règle de libération configurable (délai, réserve).                                                                                                                                                           | `platform_settings['funds_release_policy']`                                   |
| **A4** | TTL commande impayée = **15 min**, `awaiting_payment → expired`, job serveur **idempotent**, zéro confiance frontend.                                                                                                                                                     | `platform_settings['unpaid_order_ttl_seconds']` = 900                         |
| **A5** | `courier compensation = delivery fee` par défaut ; règle configurable et évolutive (fixe/%/distance/zone/surge/ville).                                                                                                                                                    | `platform_settings['courier_compensation_policy']`                            |
| **A6** | Hébergement initial **Scaleway (Paris)** ; **aucun couplage** du code (Docker, PG/Redis standard, S3-compatible derrière `ObjectStoragePort`, IaC). Déplacement Hetzner/AWS/Azure/GCP possible.                                                                           | `@djafat/config`, `ObjectStoragePort`                                         |
| **A7** | **Pas de table `markets`** au MVP. Modèle `Country → City` suffisant. `markets` ajoutable plus tard si besoin.                                                                                                                                                            | —                                                                             |
| **A8** | `order.city_id` = **ville du restaurant**. La localité de livraison du client est portée **séparément** : `address_id` + `address_snapshot` (geom lat/lng, quartier, repère, tél) + `delivery_zone_id`. `restaurant city ≠ customer delivery locality` est représentable. | `orders.city_id` + `orders.address_snapshot.geom` + `orders.delivery_zone_id` |
| **A9** | OTP = **SMS** au MVP ; port `OtpDeliveryPort` extensible (`whatsapp`/`email`/…) sans changer `auth`.                                                                                                                                                                      | `platform_settings['otp_channels']` = `["sms"]`                               |

## 7. Séquencement commande ↔ paiement

- **Prépayé** : `draft → awaiting_payment` (avec `expires_at`, TTL = `platform_settings['unpaid_order_ttl_seconds']`, défaut 900 s = 15 min — A4) → `payment.succeeded` → `placed` (éligible restaurant) → `confirmed` (restaurant accepte) → … Job `order-expiry` (30 s, **idempotent**, garde `status='awaiting_payment' AND expires_at < now()`) : périmé → `expired` + annulation du `payment` `pending`.
- **Cash à la livraison** : `draft → placed` directement (provider `cash` synchrone) ; `payment.succeeded` à `delivered`.
- Le restaurant n'est notifié qu'à `placed` (jamais avant confirmation du paiement pour un prépayé).
- Machine à états canonique complète (13 états, transitions autorisées, transitions interdites) : `docs/06-schema-postgresql.md` §6.6 (commentaire du type `order_status`).

## 8. Conséquences futures

- **+** Extraire `payments` **+ `ledger`** en service autonome se fait proprement : `ledger` est écrivain unique et `payments` ne partage aucune table (le SDK masque l'URL, l'UI ne bouge pas).
- **+** Nouveau marché = INSERT de configuration, pas une nouvelle app ni une migration.
- **+** Nouveau moyen de paiement = un fichier provider + une ligne de config.
- **−** Le monorepo impose de la discipline de CI (cache Turborepo, jobs affectés) + un **lint de frontières de modules**.
- **−** Deux implémentations d'UI = coût récurrent. Mitigation : design system strict, specs d'écran uniques (doc 11), séquencement (web/PWA avant mobile natif — doc 14).
- **−** Multi-devise structurel ajoute des colonnes `currency` partout et une garde « une devise par ligne » : léger surcoût de rigueur, assumé (bien moins cher que la migration rétroactive).
