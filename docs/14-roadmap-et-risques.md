# 14 — Roadmap, ordre de développement & risques (révisé — post-audit)

> **Révision post-audit.** Séquence retravaillée : **Bloc 0.5 « Walking Skeleton » obligatoire** ; design system dégraissé ; **admin + restaurant + livreur avant** l'app mobile client native ; `MockPaymentProvider` = artefact **permanent** (CI). Classification de priorité **P0/P1/P2/P3** (§14.7). Traçabilité : `docs/15-audit-corrections.md`.

---

## 14.1 Périmètre MVP (lancement pilote N'Djamena)

**Inclus :** inscription tel + OTP · profil + adresses (GPS/carte/repère/manuel) · accueil + recherche + filtres · page restaurant + menu + options · panier + `quote` **indicatif** · **commande sans montant client** (serveur autoritaire) · `awaiting_payment` + **TTL d'expiration** · paiement **Cash + Mock + 1 Mobile Money réel** · machine à états commande · suivi temps réel + carte · historique + notation · **grand livre double entrée** (écrivain unique, pending/available, frais PSP, `settlements`) · dashboard restaurant · app livreur · **admin** (approbations, commandes, paiements + **remboursement idempotent**, vue ledger, settlements, audit, **2FA + step-up**) · notifications push + in-app + SMS critiques · PWA web · **config marché** (1 pays / 1 ville / 1 devise).

**Exclus (→ V1.x / V2) :** favoris · wallet/avoirs client · promotions avancées · stats restaurant poussées · payouts automatisés · réconciliation PSP automatisée · dessin de zones en UI · base landmarks en UI · carte bancaire (+ disputes câblés) · `capture()` réel · split payment · mode sombre · arabe/RTL · commande programmée · pourboire · multi-villes/pays effectif · dispatch intelligent · recommandations · fidélité · parrainage · social · marketplace non-alimentaire.

## 14.2 Hypothèse d'équipe & durée

Base : **1 lead full-stack + 2 devs + 1 designer (mi-temps) + 1 QA (mi-temps dès le Bloc 8)**. Durée indicative jusqu'au pilote : **~18 à 24 semaines**. Le chemin critique externe (**accès PSP Mobile Money**) démarre **maintenant**, en parallèle du Bloc 0.

---

## 14.3 ORDRE EXACT DE DÉVELOPPEMENT

Chaque étape se termine par : tests (unit + intégration), doc à jour, démo sur staging. `∥` = parallélisable.

### BLOC 0 — Fondations — _~2 semaines_

1. **Monorepo & outillage** — `git init` ; pnpm + Turborepo ; `tsconfig`/`eslint-config` partagés + **`eslint-plugin-boundaries`** (frontières de modules) + règle « pas de champ `*Xaf` » ; Husky + commitlint ; CI (lint/typecheck/test vides) ; Changesets.
2. **Infra locale** — `docker-compose` : PostgreSQL+PostGIS **+ PgBouncer**, Redis, MinIO, mock-SMS, **mock-PSP**, Mailhog ; `@djafat/config` (validation env).
3. **Packages partagés (squelette)** — `@djafat/types` (`Money`, `ProviderCapabilities`, enums) ; `@djafat/validation` (Zod + 1 schéma pilote) ; `@djafat/core` (`Money` + arithmétique testée, 1 machine à états pilote) ; `@djafat/tokens` ; `@djafat/i18n` (FR).
4. **Squelette API** — NestJS (Fastify) ; `common/` : logging+traceId, filtre d'erreurs normalisé, `ZodValidationPipe`, **`common/money`**, **`common/idempotency` (DB-backed)**, OpenAPI, `/health`+`/ready` ; Prisma + **PgBouncer** ; Docker ; déploiement staging. **∥** squelette `apps/web` (Next, tokens câblés).
5. **DB v1 + migrations + module `platform`** — `schema.prisma` : `currencies`, `countries`, `cities`, `platform_settings`, `feature_flags`, `roles`, `users`, `user_roles`, `sessions` (token family), `otp_codes`, `phone_auth_locks`, `outbox` (fiabilisé), `audit_logs`, `files`, `idempotency_keys`. **Transactional outbox** + `outbox-relay` (FOR UPDATE SKIP LOCKED). **Seed Tchad / N'Djamena / XAF**. Résolveurs `platform` (config marché).

**Sortie :** CI verte, API+web sur staging, `pnpm dev` opérationnel, 1 marché configuré.

### BLOC 0.5 — TRANCHE VERTICALE (« Walking Skeleton ») — **OBLIGATOIRE** — _~1,5 semaine_

But : **prouver les joints** modules × outbox × machines à états × grand livre × temps réel, en semaine 3–4. Laid mais **de bout en bout**.

6. **Chaîne minimale** :
   - 1 restaurant + 1 produit **seedés** ; `POST /orders` (sans montant, `Idempotency-Key` **DB**) ; `pricing` minimal (sous-total + frais fixes + commission résolue) ;
   - `payments` minimal + **`MockPaymentProvider`** (`getCapabilities`, `initiate` auto-`succeeded` synchrone) ;
   - **module `ledger`** : `LedgerService.postEntryGroup()` (contrôle d'équilibre + idempotence) + groupes `order_accrual` puis `funds_available` + projections `wallet_balances` ;
   - `orders` écoute `payment.succeeded` (via outbox) → `awaiting_payment → placed` ;
   - restaurant `accept` (API) → `confirmed` ; courier `accept` (API) → `assigned` ; `delivered` → groupe `funds_available` ; commande close ;
   - `realtime` : `order.status` poussé sur `order:{id}` ;
   - tests E2E API du flux complet + **assertion invariant grand livre** dans la CI.
   - `MockPaymentProvider` reste **définitivement** dans la base de code (dev, CI, filet).

**Sortie :** un `curl` scripté joue client→resto→livreur→livré→ledger équilibré ; c'est la colonne vertébrale.

### BLOC 1 — Identité complète — _~2 semaines_

7. `auth` : OTP (haché, TTL, ≤5 tentatives, **lock durable** `phone_auth_locks`, rate-limit Redis) ; JWT RS256 access 15 min + **refresh rotatif à token family** + détection de réutilisation → révocation family ; `logout` ; `SmsProvider` (interface + mock) ; **MFA TOTP + fenêtre step-up** (pour l'admin plus tard).
8. `rbac` : rôles/permissions, `@Roles` + **contrôle de portée**, deny par défaut, **test matriciel** de portée.
9. `users` : `GET/PATCH /me` ; `addresses` (geom nullable, `landmark`, `city_id`, `geocode_status`) ; `notification_preferences` ; `devices`. **∥** `@djafat/sdk` v1 (client typé, access/refresh, retry, `Idempotency-Key`).

### BLOC 2 — Catalogue — _~3 semaines_

10. Migration catalogue (`country_id`/`city_id`, `Money`/`currency`, index gist/trgm/tsvector).
11. `restaurants`/`menus`/`products` : CRUD `/v1/restaurant/*` (portée) ; `is_open_now` **interprété en `cities.timezone`** (job) + override ; dispo produit ; `wallet_balances` créés à l'activation.
12. `search` : `GET /v1/restaurants` (filtres + tri + keyset), `GET /v1/search`, `GET /v1/home` agrégé, fiche + menu ; cache Redis **single-flight**. **∥** `geo` (interfaces + impl OSM/Nominatim/haversine + cache + job géocodage).
13. `storage` + pipeline images (AVIF/WebP/JPEG + LQIP, strip EXIF).

### BLOC 3 — Design system SKELETON + Shell — _~2 semaines (le DS complet continue ∥ des Blocs 4–7)_

14. `@djafat/tokens` finalisés + **~10 primitives** nécessaires au skeleton (Button, Input, Select/Sheet, Card, Badge, Toast, Skeleton, EmptyState, PriceTag `Money`, NetworkBanner) + Storybook + tests a11y. **∥** début de la bibliothèque complète (`ui-web` + `ui-native`).
15. Shell `apps/web` : `<AppNavigation>` responsive ; providers (Query, Zustand, socket, i18n, SW/PWA) ; auth gate ; écrans **auth** ; `NetworkBanner` + file de mutations **`Idempotency-Key`** persistée (IndexedDB).

### BLOC 4 — Cœur commande — _~3 semaines_

16. `pricing` autoritaire : sous-total, frais livraison (zone + distance via `geo`), frais service, **commission résolue** (`CommissionResolverPort`), **taxe résolue** (`TaxResolverPort`), remise → **snapshot** ; 100 % testé dans `@djafat/core`.
17. Migration commande (`orders` avec `idempotency_key` **DB**, `awaiting_payment`/`expired`, `expires_at`, `commission_bps_snapshot`, `commission_minor`, `courier_fee_minor`, `currency`).
18. `carts` : `POST /carts/quote` **indicatif**. **∥** `promotions` (codes simples, `per_user_limit` vérifié serveur).
19. `orders` : `POST /orders` **sans montant** (idempotent DB), machine à états (`@djafat/core`), `GET`/`cancel`/`tracking`, endpoints restaurant `accept/reject/ready`, implémente **`OrderAmountPort`**, écoute `payment.*`. **+ job `order-expiry`** (TTL `awaiting_payment → expired`).

### BLOC 5 — Paiement — _~3 semaines (dépend de l'accès PSP)_

20. `payments` : interface **corrigée** (`getCapabilities`/`ProviderCapabilities`, `initiate`, `getStatus`, `verifyAndParseWebhook`, `cancel`, `capture?`, `refund`) ; **registry data-driven** (via `payment_provider_configs`) ; **`CashProvider`** + `MockProvider` promus « prod-grade » ; `POST /payments`, `/:id`, `/:id/retry`, `/:id/cancel`, `/webhook/:provider` ; `GET /v1/config/payment-methods`.
21. **`MobileMoneyProvider` #1** (opérateur le plus accessible en sandbox) : `initiate` (USSD) + `getStatus` + `verifyAndParseWebhook` (**signature = confiance** + horodatage) ; `webhook_events` (unique `(provider,event_id)`) ; worker `payments-reconcile` (getStatus + expiration).
22. **`ledger` complet** : plan comptable seedé, groupes `order_accrual`/`funds_available`/`settlement`/`refund` ; **frais PSP** (`PSP_FEE_EXPENSE`) + **`PSP_CLEARING`** ; `settlements` + `settlement_items` (ingestion relevé + matching + post `settlement` + écarts) ; projections `wallet_balances` pending/available + `wallet_transactions` ; **job `ledger-assert`**.
23. **Refunds** : `refunds` (idempotency_key, garde de sur-remboursement, `entry_group`, `attempts`) ; `POST /admin/payments/:id/refund` (**Idempotency-Key + step-up**) ; contre-écritures ledger.
24. **Payouts** (manuel MVP) : `payouts` + `payout_attempts` + `POST /admin/payouts/:id/approve` (step-up) ; groupe `payout`.
    ► **Revue de sécurité paiement/ledger en fin de Bloc 5** (OWASP ASVS L2 sur le périmètre financier).

### BLOC 6 — Livraison / Dispatch — _~3 semaines_

25. Migration livraison ; `couriers` (onboarding + validation, online/offline, ingestion position throttlée, `cash_float`) ; `deliveries` (machine à états, preuve photo+code).
26. Worker `dispatch` (« plus proche disponible », rayon croissant, offres, `FOR UPDATE` à l'acceptation, expiration des autres) ; `courier_fee_minor` via `pricing` ; crédit `COURIER_PAYABLE` à `delivered` (via `LedgerPort`) ; **garde manipulation frais de livraison** (frais par paliers de zone, recalcul à l'assignation).

### BLOC 7 — Temps réel / Notifications — _~2 semaines_

27. Gateway Socket.IO + adaptateur Redis + auth socket + rooms + **contrôle d'accès** ; relais outbox → rooms ; throttle position ; fallback polling.
28. `notifications` : event → canaux (push/SMS/email/in-app) selon préférences + criticité ; templates i18n ; worker (retries/DLQ) ; dédup `(user,type,order)` ; compteur/plafond SMS.

### BLOC 8 — Customer Web / PWA complet — _~4 semaines_

29. Découverte (accueil, adresse, recherche/filtres, catégorie, page restaurant, détail produit).
30. Commande (panier `quote`, checkout **adresse/repère/mode/créneau — moyen de paiement choisi via `GET /config/payment-methods`**, écran attente MM, confirmation, **suivi temps réel** + carte + code + contacts, historique, détail, notation).
31. PWA (SW app shell / images / GET catalogue SWR ; **jamais de POST rejoué par le SW**) + SEO public (SSG/ISR, metadata, JSON-LD, sitemap/robots) + Lighthouse CI + RUM web-vitals + mode économie de données.

### BLOC 9 — ADMIN — _~3 semaines (parallélisable dès le Bloc 5)_

32. `apps/admin` : login **2FA (TOTP)** + **step-up** ; dashboard KPI + alertes (dont `settlement.discrepancy`, `needs_review`) ; commandes (liste, détail, forcer annulation, réassigner) ; restaurants (créer, **approuver**, suspendre, **commission effective**) ; clients (rechercher, suspendre) ; livreurs (**approuver pièces**, suspendre, position live) ; paiements (détail, **rembourser idempotent**, transactions PSP, `webhook-events` + replay) ; **vue ledger** (comptes + écritures + soldes pending/available) ; **settlements** (liste + import) ; **payouts** (approuver/relancer) ; **disputes** (écran réservé) ; support tickets ; audit logs ; utilisateurs internes & rôles ; `platform` config (commission/tax rules, provider configs, countries/cities — `super_admin`).

### BLOC 10 — RESTAURANT — _~2–3 semaines (∥ Bloc 9)_

33. `apps/restaurant` : login (scope resto) ; **tableau commandes** temps réel + son (kanban ≥ lg) ; accept (prépa) / reject (motif) / ready ; historique ; menu (catégories/produits/options, prix `Money`) + dispo rapide ; horaires (**tz ville**) + « fermer maintenant » ; profil + upload ; relevé wallet (pending/available, lecture) ; support ; responsive.

### BLOC 11 — COURIER — _~2–3 semaines (∥ Bloc 10)_

34. `apps/courier` (Expo) : login + onboarding + attente validation ; Online/Offline géant + résumé du jour ; offre entrante (compte à rebours, son, accepter idempotent / refuser) ; course (aller resto → récupérer → aller client → livrer photo+code → échec/motif) ; récap gain + relevé ; localisation arrière-plan (foreground service Android, permission iOS justifiée, throttle, arrêt offline) ; file d'actions offline ; gros boutons / fort contraste.

### ── PILOTE POSSIBLE ICI (customer web/PWA + restaurant + livreur + admin) ──

### BLOC 12 — Native Customer Mobile — _~4 semaines (post-pilote)_

35. `apps/mobile` (Expo) : navigation expo-router (tabs/rail tablette) ; réutilisation `core`/`validation`/`sdk`/`tokens`/`i18n` + `ui-native` ; tous les parcours du Bloc 8 en natif ; `expo-notifications` (push) ; `expo-location` ; MapLibre ; file offline MMKV ; safe areas iOS ; perfs Android entrée de gamme ; EAS + OTA.

### BLOC 13 — Hardening / Launch — _~3 semaines_

36. Tests multi-device (matrice doc 12) + tactile/souris/clavier + rotation + redimensionnement + Slow 3G + offline temporaire.
37. E2E (Playwright J1/J3/J5/J6/J7 + Maestro J1 mobile/J4) + charge **k6** (`/home`, `/restaurants`, `POST /orders`, dispatch, webhook) + revue sécurité **globale** + audit a11y + **test de restauration de backup**.
38. Observabilité : **OpenTelemetry** (traces) + Grafana (latence p95/p99, erreurs, DLQ, lag outbox, écart réconciliation, web-vitals) + alertes + **runbooks** (incident paiement, dispatch bloqué, rollback, révocation de clés, **RPO/RTO chiffrés**).
39. Go-live : domaine + sous-domaines + TLS ; secrets prod ; **PSP live** (clés, webhooks prod, réconciliation activée) ; migration prod verrouillée ; smoke tests ; soft launch (1 quartier, quelques restaurants, livreurs internes) → itération → ouverture progressive.

---

## 14.4 Roadmap V1.x

- **V1.1** : favoris · préférences notifications fines · 2e opérateur Mobile Money · retry paiement UX · **payouts automatisés** (restaurant + livreur) · **réconciliation PSP automatisée** (rapport d'écarts) · relevés wallet détaillés · mode sombre.
- **V1.2** : promotions avancées (ciblage/campagnes) · wallet/avoirs client · base `landmarks` éditable · zones de livraison dessinées en UI · stats restaurant poussées.
- **V1.3** : commande programmée · pourboire livreur · réponses restaurant aux avis · support in-app enrichi · tableau ops temps réel avancé.

## 14.5 Roadmap V2

- **Card payments** (`CardProvider` + `payment_disputes` câblés + `capture()`) · split payment.
- **Multi-villes / multi-pays effectif** : activation `countries`/`cities` supplémentaires, i18n **AR + RTL**, traduction de contenu (`products.name_i18n`), résolveurs commission/taxe par marché.
- Dispatch intelligent (score ETA/charge/équité, batching, pré-positionnement).
- Catégorie « produits du quotidien » (épicerie, pharmacie) : catalogue étendu, paniers multi-fournisseurs, substitutions.
- Fidélité · abonnement livraison · publicité / mise en avant · recommandations.
- Entrepôt analytique + BI · prévision de demande.
- Extraction de services (gateway WS → notifications → `payments`+`ledger` → search → dispatch/geo) **si la charge l'impose**.

---

## 14.6 Risques

### Techniques

| #   | Risque                                                                             | Sev | Statut post-corrections                                                                                         | Mitigation                                                                                                                               |
| --- | ---------------------------------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | **Accès Mobile Money** (sandbox, API, délais contrat, settlement)                  | 🔴  | **Retiré du chemin critique** par `MockProvider` permanent + abstraction                                        | Démarches PSP dès maintenant ; `CashProvider` garantit un lancement ; 2 opérateurs visés                                                 |
| T2  | Cohérence commande/paiement sur réseau instable                                    | 🟠  | **Fortement mitigé** : idempotence **DB**, `webhook_events`, `provider_ref` unique, TTL, transitions monotones  | Tests offline systématiques                                                                                                              |
| T3  | Suivi position livreur coupé par OEM Android / permission iOS                      | 🟠  | inchangé (externe)                                                                                              | Foreground service + repli sur ouverture ; prototype Bloc 6 sur vrais tel                                                                |
| T4  | Adressage faible à N'Djamena (OSM, informel)                                       | 🟠  | inchangé                                                                                                        | Repère + tél en champs de 1er plan ; base `landmarks` ; provider premium ponctuel                                                        |
| T5  | Coût & délivrabilité SMS                                                           | 🟠  | inchangé                                                                                                        | SMS = critique seulement ; plafond/commande + monitoring ; push via PWA/app ; tarif agrégateur                                           |
| T6  | Perf Android entrée de gamme / data chère                                          | 🟠  | inchangé                                                                                                        | Budgets JS/images CI · RSC · FlashList · mode éco-data · tests Slow 3G                                                                   |
| T7  | Publication stores lente depuis le Tchad                                           | 🟡  | mitigé                                                                                                          | PWA canal principal ; OTA EAS ; comptes développeurs anticipés                                                                           |
| T8  | Double maintenance UI web/mobile                                                   | 🟠  | inchangé                                                                                                        | Tokens + `core` partagé + specs uniques ; web avant mobile                                                                               |
| T9  | Dispatch : acceptations concurrentes, livreurs fantômes, zones sans offre          | 🟠  | inchangé                                                                                                        | `FOR UPDATE` + statut conditionnel · `last_location_at` récent · alerte ops + réassignation · rayon croissant                            |
| T10 | Intégrité financière (écritures déséquilibrées, wallet faux, double refund)        | 🟠  | **Fortement mitigé** : `ledger` écrivain unique, `∑debit=∑credit` en CI, projections, refund idempotent + garde | `ledger-assert` horaire ; revue sécu fin Bloc 5                                                                                          |
| T11 | **Bug du projecteur ledger** (projections ≠ grand livre)                           | 🟠  | **nouveau**                                                                                                     | Projections écrites dans la **même tx** que l'entry group ; job d'assertion ; le grand livre reste la vérité, projection reconstructible |
| T12 | **Lag de settlement / visibilité de trésorerie** (cash chez le PSP non réconcilié) | 🟠  | **nouveau**                                                                                                     | `PSP_CLEARING` explicite ; `settlements` + écarts alertés ; dashboard position de trésorerie                                             |
| T13 | **Dette multi-devise latente** (1 seule devise réellement testée)                  | 🟡  | **nouveau (assumé)**                                                                                            | Modèle générique dès maintenant ; ajout d'une 2e devise = data + tests, pas de migration                                                 |
| T14 | Monolithe = point de défaillance ; migrations sur tables financières               | 🟡  | mitigé                                                                                                          | Workers séparés, readiness, bleu/vert, PgBouncer ; migrations expand/contract ; PITR + test de restauration                              |
| T15 | Latence EU ↔ Tchad                                                                | 🟡  | inchangé                                                                                                        | Région Paris · CDN · payloads compacts · cache single-flight                                                                             |
| T16 | Dépendance prestataires (PSP, SMS, tuiles, hébergeur)                              | 🟠  | inchangé                                                                                                        | Abstractions `PaymentProvider`/`SmsProvider`/`MapProvider` · conteneurs portables · exports réguliers                                    |
| T17 | Sécurité : fuite de secret, abus OTP, accès admin compromis                        | 🟠  | **mitigé** : gitleaks CI, `phone_auth_locks`, **2FA + step-up admin**, `audit_logs.step_up_verified`            | Security review avant prod                                                                                                               |

### Business

| #   | Risque                                                                              | Sev | Mitigation                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Liquidité à double face (restaurants ↔ clients ↔ livreurs)                        | 🔴  | Lancement hyper-local (1–2 quartiers, 8–15 restaurants signés, livreurs internes) ; densité avant expansion                                                               |
| B2  | Offre livreurs (recrutement, rétention, rémunération vs coût course)                | 🟠  | Rémunération transparente dans l'offre ; bonus heures de pointe (V1) ; paiement rapide (relevé + payout) ; petite flotte contrôlée                                        |
| B3  | Gestion du cash (float, vol, non-reversement, fausses livraisons)                   | 🔴  | Plafond `courier_cash_float_cap_minor` + blocage au-delà ; preuve photo+code ; compte `CASH_FLOAT` au ledger ; réconciliation quotidienne ; caution/contrat               |
| B4  | Économie unitaire (paniers faibles vs distance)                                     | 🟠  | Frais à la distance + minimum de commande ; `max_distance_km` par zone ; marge par commande visible au dashboard                                                          |
| B5  | Fraude (promos, faux comptes, collusion client-livreur, faux avis)                  | 🟠  | `per_user_limit` + `first_order_only` serveur ; cap comptes/device/numéro ; blocage `courier.user_id == customer_id` ; monitoring taux de remboursement ; modération avis |
| B6  | Confiance (commande fausse/incomplète, retard, litige)                              | 🟠  | Support + remboursement rapide (outillé) ; notation resto+livreur ; SLA préparation ; transparence du suivi                                                               |
| B7  | Réglementaire (agrément paiement/monnaie électronique, société, données, fiscalité) | 🔴  | Conformité portée par le PSP (KYC/AML) ; conseil juridique local tôt ; CGU + politique de confidentialité ; `tax_rules` paramétrable                                      |
| B8  | Concurrence / substituts (télécom, groupes WhatsApp, incumbents)                    | 🟠  | Exécution locale supérieure (fiabilité, délai, catalogue) ; relations restaurants privilégiées ; rapidité d'itération                                                     |
| B9  | Infrastructure pays (électricité, internet, pluies, MM down)                        | 🟠  | Mode dégradé (cash, polling, cache) ; communication proactive ; SLA réaliste ; pas d'ETA rigide en incident                                                               |
| B10 | CAC élevé / adoption lente                                                          | 🟡  | Parrainage (V1) ; présence terrain ; PWA sans friction store ; SEO local ; offres 1re commande maîtrisées                                                                 |
| B11 | Trésorerie (délais d'encaissement MM, avances, remboursements)                      | 🟠  | Suivi cash-flow via ledger + `PSP_CLEARING` ; payouts sur cycle (hebdo) au début ; réserve de trésorerie                                                                  |
| B12 | Dépendance à des personnes clés (petite équipe)                                     | 🟡  | Doc (ce dossier + `docs/adr/`) ; revues croisées ; pas de silo sur paiement/dispatch/ledger                                                                               |

---

## 14.7 Classification de priorité des corrections d'audit

| Priorité | Définition                                                                                   |
| -------- | -------------------------------------------------------------------------------------------- |
| **P0**   | Bloque le démarrage du Bloc 0 (doit être dans le modèle/doc avant d'écrire la 1re migration) |
| **P1**   | Doit être corrigé avant l'implémentation du bloc concerné                                    |
| **P2**   | Doit être corrigé avant la mise en production (pilote)                                       |
| **P3**   | Amélioration future (post-pilote)                                                            |

> **Note de révision (2e passe)** : la classification a été resserrée. **P0 = uniquement ce qui doit exister dans le socle/le schéma fondateur avant d'écrire la 1re migration** — c'est-à-dire des **types, des tables de référence et des règles d'architecture**, jamais de la logique métier ni des fonctionnalités V2. Pour C1/C3/C5/C6, la ligne distingue explicitement _schéma/types_ (P0) et _logique_ (P1, au bloc concerné).

| #   | Correction                                                                                                                                                                                                                     | Prio                               | Bloc                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------- |
| C1  | Paiement multi-provider : **types `Money`/`ProviderCapabilities`/enums `PaymentStatus`** = P0 ; **interface `PaymentProvider` + registry + implémentations** = P1                                                              | **P0** (types) · **P1** (impl)     | 0 (types) / 5 (impl)                  |
| C2  | Montants **génériques `Money {minor,currency}`** + colonnes `*_minor`/`currency` sur toutes les tables financières + `currencies`                                                                                              | **P0**                             | 0                                     |
| C3  | Payment methods data-driven : **tables `payment_methods`/`payment_providers`/`payment_provider_configs` + seed** = P0 ; **résolveur + `GET /config/payment-methods`** = P1                                                     | **P0** (schéma) · **P1** (logique) | 0 (schéma) / 5 (logique)              |
| C4  | **`countries` / `cities` / `currencies`** + `country_id`/`city_id` sur racines (`restaurants`, `orders`, `delivery_zones`, `promotions`)                                                                                       | **P0**                             | 0                                     |
| C5  | Commission/taxe : **tables `commission_rules`/`tax_rules` + seed** = P0 ; **résolveur + snapshot commande** = P1                                                                                                               | **P0** (schéma) · **P1** (logique) | 0 (schéma) / 4 (logique)              |
| C6  | Grand livre écrivain unique : **schéma `ledger_*` + grants `djafat_ledger` + révocation UPDATE/DELETE** = P0 ; **`LedgerService.postEntryGroup` + projections** = P0 pour le Bloc 0.5 (colonne vertébrale du Walking Skeleton) | **P0**                             | 0 (schéma) / 0.5 (service)            |
| C7  | **Idempotence durable PostgreSQL** : contraintes d'unicité + `common/idempotency` + table `idempotency_keys`                                                                                                                   | **P0**                             | 0 / 0.5                               |
| C8  | **DAG de modules explicite** + `eslint-plugin-boundaries` + `OrderAmountPort` (règle : `orders` n'importe jamais `payments`)                                                                                                   | **P0**                             | 0                                     |
| C9  | **`webhook_events`** + `unique(provider, provider_ref)` + signature = source de confiance                                                                                                                                      | **P1**                             | 5                                     |
| C10 | **Refunds** : idempotency_key + garde de sur-remboursement + lien ledger + endpoint idempotent                                                                                                                                 | **P1**                             | 5                                     |
| C11 | **Machine à états paiement** clarifiée + `NEEDS_REVIEW` (fin de `flagged`)                                                                                                                                                     | **P1**                             | 5                                     |
| C12 | **Séquencement `awaiting_payment` + TTL d'expiration** (job serveur)                                                                                                                                                           | **P1**                             | 4                                     |
| C13 | **PSP clearing + settlement** (`PSP_CLEARING`, `settlements`, frais PSP)                                                                                                                                                       | **P1**                             | 5                                     |
| C14 | **`cancel()`** provider + `POST /payments/:id/cancel`                                                                                                                                                                          | **P1**                             | 5                                     |
| C15 | **Payouts corrigés** (`payout_attempts`, idempotency, entry_group, approbation step-up)                                                                                                                                        | **P1**                             | 5                                     |
| C16 | **Fuseau horaire** : horaires restaurant en `cities.timezone`                                                                                                                                                                  | **P1**                             | 2                                     |
| C17 | **`sessions` token family** + `refresh_hash` unique + réutilisation → révocation family                                                                                                                                        | **P1**                             | 1                                     |
| C18 | **OTP brute-force durable** (`phone_auth_locks`)                                                                                                                                                                               | **P1**                             | 1                                     |
| C19 | **Admin 2FA (TOTP) + step-up** sur actions financières + `audit_logs.step_up_verified`                                                                                                                                         | **P1**                             | 1 / 9                                 |
| C20 | **Outbox fiabilisé** (`status`, `attempts`, `last_error`, `next_attempt_at`) + relay SKIP LOCKED                                                                                                                               | **P0**                             | 0                                     |
| C21 | **Bloc 0.5 Walking Skeleton** + `MockPaymentProvider` permanent (CI)                                                                                                                                                           | **P0**                             | 0.5                                   |
| C22 | **PgBouncer** (transaction pooling)                                                                                                                                                                                            | **P1**                             | 0                                     |
| C23 | Garde **manipulation frais de livraison** (paliers de zone, recalcul à l'assignation)                                                                                                                                          | **P2**                             | 6                                     |
| C24 | **`payment_disputes`** structure réservée (chargebacks)                                                                                                                                                                        | **P2**                             | 5 (table) / V2 (câblage)              |
| C25 | Anti-stampede cache (single-flight)                                                                                                                                                                                            | **P2**                             | 2                                     |
| C26 | **OpenTelemetry** (traces)                                                                                                                                                                                                     | **P2**                             | 13                                    |
| C27 | **Runbook DR** + RPO/RTO + test de restauration                                                                                                                                                                                | **P2**                             | 13                                    |
| C28 | Cibles de **load test** (k6) par palier                                                                                                                                                                                        | **P2**                             | 13                                    |
| C29 | Soft-delete user vs `phone` unique → partial unique + anonymisation                                                                                                                                                            | **P2**                             | 1                                     |
| C30 | Test matriciel de **portée RBAC**                                                                                                                                                                                              | **P1**                             | 1                                     |
| C31 | `ledger_assert` (invariant en CI + job horaire)                                                                                                                                                                                | **P1**                             | 0.5 / 5                               |
| C32 | Traduction de contenu (`products.name_i18n`) — **réservé, non implémenté**                                                                                                                                                     | **P3**                             | V2                                    |
| C33 | `capture()` / flux autorisation-capture réel                                                                                                                                                                                   | **P3**                             | V2                                    |
| C34 | Split payment                                                                                                                                                                                                                  | **P3**                             | V2                                    |
| C35 | **Scope pays/ville des utilisateurs internes** : colonnes `user_roles.scope_country_id`/`scope_city_id` = **P1** (schéma, Bloc 1, évite une migration) ; **logique de filtrage des listes admin** = **P2** (avant 2e marché)   | **P1** (schéma) · **P2** (logique) | 1 (schéma) / avant 2e ville (logique) |
| C36 | **Erreur ledger corrigée** (2e passe) : `DJAFAT_REVENUE` = produit **brut** (2 400), frais PSP en charge distincte ; l'exemple 10 000 XAF re-vérifié Σdébit=Σcrédit à chaque groupe                                            | **P0** (doc)                       | corrigé (doc 08 §8.9, doc 15 §4.3)    |
| C37 | **`orders.delivery_zone_id`** + note A8 (city_id = ville resto ; localité client séparée : `address_snapshot.geom`)                                                                                                            | **P1**                             | 4                                     |
| C38 | **`platform_settings`** : clés `psp_fee_policy` (A2), `funds_release_policy` (A3), `courier_compensation_policy` (A5), `otp_channels` (A9) — seed                                                                              | **P0** (seed)                      | 0                                     |
| C39 | **`OtpDeliveryPort`** (A9) + **`ObjectStoragePort`** (A6, portabilité hébergement) — interfaces posées au Bloc 0                                                                                                               | **P1**                             | 0 / 1                                 |

---

## 14.8 Ce qu'on attend de la validation

1. **Corrections d'audit** (§14.7) — valider l'ensemble P0/P1, ou signaler celles à discuter.
2. **Ordre de développement révisé** (§14.3) — les 13 blocs + le **Bloc 0.5 obligatoire**, web avant mobile, admin/restaurant/livreur avant mobile natif.
3. **Périmètre MVP** (§14.1) — OK pour lancer avec **Cash + Mock + 1 Mobile Money**, favoris/promos avancées/wallet client repoussés.
4. **Hypothèses** (README §Hypothèses) — équipe, budget, opérateurs Mobile Money ciblés, FR d'abord.
5. **Chemin critique T1** : lancer **maintenant** les démarches d'accès PSP Mobile Money.

Après feu vert → démarrage **Bloc 0**, incrément testable à chaque étape.
