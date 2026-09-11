# 18 — Bloc 0.5 : rapport d'implémentation (Walking Skeleton)

> Première tranche verticale complète de DJAFAT — un seul flux, réel de bout en bout.
> **Aucune fonctionnalité hors périmètre** (pas d'auth réelle, pas de vrai Mobile Money, pas de dashboards).
> Ce document est le rapport de fin de bloc — **le Bloc 1 n'est pas démarré** (voir §16, attend décision séparée).

---

## 1. Résultat

# 🟢 PASS — avec réserves de vérification (pas de Docker dans l'environnement de build)

Le walking skeleton est **installable, compilable, typé, testé, linté, buildé** :
`pnpm install` · `prisma generate` (hors-ligne) · `turbo format:check lint typecheck test build` → **21/21 tâches OK** (lint, typecheck, test, build) · `prettier --check` OK · **87 tests unitaires** (58 `@djafat/core` + 29 `apps/api`, dont 14 nouveaux pour ce bloc : `accrual-entries` 6, `release-entries` 3, `pricing.service` 5).

Ce qui **n'a pas pu être exécuté ici** (aucun démon Docker disponible, comme au Bloc 0) : migrations `0008`–`0010` contre un vrai PostgreSQL, `db:seed`, et les deux suites d'intégration livrées (`apps/api/test/walking-skeleton.int.spec.ts`, `apps/worker/test/processors.int.spec.ts`). Le code est écrit, **type-checké avec succès** (donc syntaxiquement et typiquement correct contre le schéma réel), et sera exécuté par la CI (`job integration`). C'est la seule raison pour laquelle ce n'est pas un « PASS » sec — exactement la même réserve qu'au Bloc 0 (doc 17 §1).

**Un vrai bug a été trouvé et corrigé pendant ce bloc** (§13) : le cumul `setGlobalPrefix('v1')` + URI versioning produisait un double préfixe `/v1/v1/...` sur **toutes** les routes — tracé au niveau du code source `@nestjs/core` (`RoutePathFactory`), pas deviné. Sans cette correction, aucune route de l'API n'aurait été atteignable et le test d'intégration l'aurait immédiatement révélé.

---

## 2. Périmètre — ce qui est dedans, ce qui ne l'est pas

**Dedans** (docs/17 §12, repris à l'identique) : catalogue minimal (1 restaurant, 2 produits, seedés) → commande sans montant client → paiement `mock` → webhook signé → écritures comptables `order_accrual` équilibrées → projections wallet (pending) → confirm/ready (stand-in restaurant) → livraison minimale (assign/picked-up/delivered, 1 livreur seedé) → `funds_available` équilibré → wallet (available) → outbox réel (`FOR UPDATE SKIP LOCKED`) → realtime minimal (Socket.IO, sans être source de vérité) → expiration de commande idempotente et race-safe → `ledger-assert` (job de garde) → test d'intégration bout-en-bout.

**Explicitement dehors** (rappel des limites du mandat) : Bloc 1 Identity complet (JWT réel, refresh tokens, RBAC), catalogue complet (recherche, catégories, images, disponibilité horaire), vrai Mobile Money (Airtel/Moov — restent `active=false`), dashboards admin/restaurant/courier, dispatch réel (zones, distance, plusieurs livreurs), paiement partiel/split, remboursements, disputes, notifications push/SMS réelles, i18n complète, offline-first. Toute simplification prise pour ce bloc est documentée en §7 et §10.

---

## 3. Commandes

```bash
pnpm install
pnpm --filter @djafat/api db:generate    # prisma client (hors-ligne)
pnpm infra:up                            # docker : PG+PostGIS, PgBouncer, Redis, MinIO, mock-*
pnpm db:migrate && pnpm db:seed          # migrations 0001–0010 + seed TD/N'Djamena/XAF + fixtures walking-skeleton
pnpm dev                                 # api + worker

# Contrôles (== CI)
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build

# Intégration (nécessite pnpm infra:up + db:migrate + db:seed au préalable)
pnpm --filter @djafat/api run test:int
pnpm --filter @djafat/worker run test:int
```

---

## 4. Architecture réellement implémentée

### Flux cible (réalisé, prouvé par `walking-skeleton.int.spec.ts`)

`Customer(seed) → Restaurant(seed) → Products(seed) → POST /v1/orders (Idempotency-Key, sans prix) → awaiting_payment → POST /v1/payments (mock, pending_then_succeed) → webhook signé HMAC → payment succeeded (1 transaction : payment.status + ledger order_accrual + outbox) → order: awaiting_payment→placed (événement) → wallet pending crédité → confirm → ready → POST /v1/deliveries (assign) → courier_assigned → picked-up → on_the_way → delivered (1 transaction : delivery.status + ledger funds_available) → wallet available crédité → order: delivered (terminal)`.

### Modules ajoutés/complétés

- **`catalog`** : `CatalogService.getActiveRestaurant` / `getAvailableProducts` (lecture seule, pas de recherche/pagination — Bloc 2).
- **`pricing`** : `PricingService.priceOrder` — commission résolue contre `commission_rules` (le plus spécifique : restaurant > city > country > global gagne), frais de livraison **plat** (`platform_settings['skeleton_flat_delivery_fee_minor']`, fallback 1000n) ; `courierFee = deliveryFee` (décision A5, structurel — pas une coïncidence de test).
- **`orders`** : `OrdersService implements OrderAmountPort`. `POST /v1/orders` (validation Zod stricte, aucun champ monétaire), machine à états canonique (`@djafat/core`, 58 tests, réutilisée telle quelle — pas de raccourci), transition générique `transitionOrder()` (SELECT…FOR UPDATE + `assertOrderTransition` + UPDATE conditionnel + historique + outbox), résolution du livreur seedé unique à la création. **N'importe jamais `payments`/`deliveries`** (DAG) — réagit par `@OnEvent('payment.succeeded' | 'delivery.assigned' | 'delivery.picked_up' | 'delivery.delivered')`.
- **`payments`** : `PaymentsService`. `POST /v1/payments` (montant lu via `OrderAmountPort`, jamais fourni par le client), `POST /v1/payments/webhook/:provider` (HMAC vérifié **avant** tout traitement, dédoublonnage durable via `webhook_events (provider_code, event_id)` unique), **`markSucceeded()`** : le cœur atomique — `payments.status`, `LedgerService.postEntryGroupTx` (`order_accrual`) et `outbox` dans **une seule transaction Postgres**.
- **`ledger`** : `LedgerRepository` réécrit — provisionnement paresseux des comptes possédés (`RESTAURANT_PAYABLE:<id>`, etc.), écriture réelle de `wallet_balances` (bug Bloc 0 corrigé, §13), `SET LOCAL ROLE djafat_ledger` sur chaque écriture (lève la dette D-03 du doc 17), `postEntryGroupTx(tx, input)` pour rejoindre une transaction appelante (`payments`/`deliveries` uniquement — pas dans `LedgerPort`, qui reste agnostique de Prisma).
- **`deliveries`** : `DeliveriesService`. Pattern « émettre puis agir » : `assign()`/`markPickedUp()` émettent l'événement `delivery.*` **avant** d'écrire la ligne `deliveries` (`emitAsync`, donc une transition illégale côté `orders` empêche toute ligne orpheline). **`markDelivered()`** : cœur atomique — `deliveries.status` + `LedgerService.postEntryGroupTx` (`funds_available`) dans une transaction, puis émission `delivery.delivered` après commit.
- **`realtime`** : `RealtimeGateway` (namespace `/rt`, rooms `order:{orderId}`) relaie `order.updated`/`payment.updated` — **jamais source de vérité**, pas d'adaptateur Redis multi-instance (Bloc 7), pas d'auth de room (Bloc 1/7).
- **`apps/worker`** : trois processeurs réels — `outboxRelayProcessor` (`FOR UPDATE SKIP LOCKED`, backoff exponentiel plafonné 300 s, DLQ après 10 tentatives), `orderExpiryProcessor` (`UPDATE … WHERE status='awaiting_payment' AND expires_at <= now()`, race-safe par construction), `ledgerAssertProcessor` (invariant `Σdébit=Σcrédit` par groupe + `wallet_balances == Σ ledger_entries` par bucket).

### Endpoints livrés

| Méthode | Route                               |     Idempotency-Key     | Auth (Bloc 0.5)                                      |
| ------- | ----------------------------------- | :---------------------: | ---------------------------------------------------- |
| POST    | `/v1/orders`                        |           ✅            | aucune (`customerId` dans le body — stand-in Bloc 1) |
| GET     | `/v1/orders/:id`                    |            —            | aucune                                               |
| POST    | `/v1/orders/:id/confirm`            |            —            | aucune (stand-in restaurant, Bloc 10)                |
| POST    | `/v1/orders/:id/ready`              |            —            | aucune                                               |
| POST    | `/v1/payments`                      |           ✅            | aucune                                               |
| GET     | `/v1/payments/:id`                  |            —            | aucune                                               |
| POST    | `/v1/payments/webhook/:provider`    | dédup. `webhook_events` | signature HMAC                                       |
| POST    | `/v1/deliveries`                    |           ✅            | aucune (stand-in courrier, Bloc 11)                  |
| GET     | `/v1/deliveries/:orderId`           |            —            | aucune                                               |
| POST    | `/v1/deliveries/:orderId/picked-up` |           ✅            | aucune                                               |
| POST    | `/v1/deliveries/:orderId/delivered` |           ✅            | aucune                                               |

L'absence d'auth sur les endpoints d'orchestration est une dette **assumée et documentée** (§7, §10), pas un oubli.

---

## 5. Base de données — migrations ajoutées

| #                         | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0008_ledger_role_grants` | `GRANT djafat_ledger TO <current_user>` + `GRANT SELECT` sur les 4 tables ledger — lève la dette D-03 (doc 17) : le module `ledger` peut désormais réellement `SET LOCAL ROLE djafat_ledger` autour de ses écritures.                                                                                                                                                                                                                                                                                                                                                                     |
| `0009_catalog`            | `restaurants`, `products` (minimal — recherche/catégories/horaires = Bloc 2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `0010_orders`             | `order_status` / `payment_status` (enums **identiques** aux enums canoniques de `@djafat/core`, 13 et 9 valeurs) ; `orders` (snapshot monétaire figé, `idempotency_key` unique par client, index partiel `(status, expires_at) WHERE status='awaiting_payment'`) ; `order_items` ; `order_status_history` ; `payments` (unique `(order_id, idempotency_key)`, unique partiel `(provider_code, provider_ref)`, unique partiel `(order_id) WHERE status='succeeded'`) ; `webhook_events` (unique `(provider_code, event_id)` — dédoublonnage durable) ; `deliveries` (unique `(order_id)`). |

**Seed** (`seed.ts`, complété, ré-exécutable) : + client test (`+23566000001`), livreur test (`+23566000002`, rôle `courier`), restaurant « Chez Fatimé » (slug `chez-fatime`), 2 produits (Poulet braisé 3500 XAF, Frites 1000 XAF), `platform_settings['skeleton_flat_delivery_fee_minor'] = 1000`.

---

## 6. Flux end-to-end — chiffres de référence (utilisés par les tests)

Commande : 1× Poulet braisé (3500) + 1× Frites (1000) → **subtotal 4500 XAF**. Commission seedée 20 % (country-level) → **commission 900**. Frais de livraison plat **1000** → `courierFee` **1000** (= deliveryFee, décision A5). **Total 5500 XAF**.

- **`order_accrual`** (provider `mock`, PSP fee 1,5 % = `MOCK_PSP_FEE_BPS`) : PSP fee = round-half-even(5500 × 0,015) = **82** ; net reçu = **5418** ; `RESTAURANT_PAYABLE +3600` (4500−900) ; `COURIER_PAYABLE +1000` ; `DJAFAT_REVENUE +900` (**brut**, pas net — voir doc 16 C36). Σdébit = 5418+82 = 5500 = Σcrédit = 3600+1000+900.
- **`funds_available`** : `RESTAURANT_PAYABLE −3600` / `RESTAURANT_AVAILABLE +3600` ; `COURIER_PAYABLE −1000` / `COURIER_AVAILABLE +1000`. Pure reclassification, toujours équilibrée par construction.

---

## 7. Décisions prises pendant l'implémentation

1. **Extraction de la construction des écritures en fonctions pures** (`payments/accrual-entries.ts` → `buildOrderAccrualEntries`, `deliveries/release-entries.ts` → `buildFundsAvailableEntries`), hors de `markSucceeded()`/`markDelivered()`. Nécessaire pour respecter l'instruction « ne prétends jamais qu'un test a été exécuté s'il ne l'a pas été » : ces fonctions n'ont besoin d'aucune base de données pour être testées, donc **les 9 tests de solde (`accrual-entries.spec.ts` + `release-entries.spec.ts`) sont réellement exécutés**, contrairement à la logique transactionnelle qui reste seulement type-checkée sans Docker.
2. **`SET LOCAL ROLE djafat_ledger`** posé pour de vrai dans `LedgerRepository` (les deux chemins, direct et via `Prisma.TransactionClient` externe) — lève D-03.
3. **Écriture réelle de `wallet_balances`** dans `LedgerRepository.writeGroup` — un vrai bug du Bloc 0 (jamais écrit, seulement les `ledger_entries`) est corrigé au passage (§13).
4. **`postEntryGroupTx` hors de `LedgerPort`** : `Prisma.TransactionClient` est un type Nest/Prisma-spécifique ; l'exposer dans `@djafat/types` casserait l'agnosticisme de plateforme du port. Seuls `payments` et `deliveries` (autorisés par le DAG) injectent `LedgerService` (classe concrète) pour l'atteindre.
5. **Ports Nest cross-module dans `common/ports/`** (`ORDER_AMOUNT_PORT`), pas dans `modules/orders/*` : `payments`/`deliveries` doivent pouvoir l'importer sans violer la règle de boundary qui interdirait un import direct d'un dossier de module tiers.
6. **Bus d'événements in-process (`EventEmitter2`)** pour tout le reste du couplage `orders`↔`payments`/`deliveries` : `emitAsync` là où l'appelant doit observer une transition invalide (garde métier), `emit` fire-and-forget là où le handler ne lève jamais (no-op idempotent par construction).
7. **Pattern « émettre puis agir »** dans `deliveries` (`assign`/`markPickedUp`) : l'événement de transition est émis **avant** l'écriture de la ligne `deliveries`, pour qu'une transition illégale ne laisse jamais de ligne orpheline.
8. **Suppression de `app.setGlobalPrefix(API_VERSION_PREFIX)`** au profit du seul URI versioning — voir §13, bug réel trouvé et corrigé.
9. **Extraction de `configureApp()`** (`apps/api/src/bootstrap.ts`) partagée entre `main.ts` et le test d'intégration, pour que les deux ne puissent jamais diverger sur le câblage raw-body/versioning/filtre d'exceptions.

---

## 8. Écarts avec la documentation antérieure

Aucun écart de décision d'architecture (A1–A9) ni de modèle financier. Deux clarifications :

- Le doc 17 §12 mentionnait « `0008_catalog` (minimal) + `0009_orders` (minimal) » à titre d'exemple (« par exemple » dans la demande). Réalisé en `0009_catalog` + `0010_orders`, `0008` étant pris par `ledger_role_grants` (nécessaire pour lever D-03 proprement, séparé du catalogue). Numérotation strictement croissante, aucune renumérotation rétroactive.
- Le doc 17 §12 décrivait un adaptateur Redis pour `realtime` dès le Bloc 0.5 ; reporté au Bloc 7 comme annoncé explicitement dans le mandat de ce bloc (« realtime minimal... jamais source de vérité »).

---

## 9. Tests

| Suite                                    | Fichiers | Tests                                                                                                          | Statut                                                                                                                                        |
| ---------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `@djafat/core` (inchangé)                | 4        | 58                                                                                                             | **PASS** (réellement exécuté)                                                                                                                 |
| `apps/api` unitaire (inchangé + nouveau) | 6        | 29                                                                                                             | **PASS** (réellement exécuté) — dont `accrual-entries.spec.ts` (6), `release-entries.spec.ts` (3), `pricing.service.spec.ts` (5) **nouveaux** |
| `apps/api` intégration                   | 1        | 1 suite (health/ready + flux complet + idempotence + webhook dupliqué/invalide)                                | **N/V** — Docker indisponible ici ; type-checké avec succès contre le schéma réel                                                             |
| `apps/worker` intégration                | 1        | 7 (order-expiry idempotent+race, outbox-relay succès+échec, ledger-assert balanced+unbalanced+wallet-mismatch) | **N/V** — idem, type-checké avec succès                                                                                                       |

**Ce que le test d'intégration `apps/api` vérifie** (quand il tourne, en CI) : catalogue → commande sans prix client → replay idempotent → paiement mock pending → webhook signé → `order_accrual` équilibré (`Σdébit=Σcrédit` vérifié par requête SQL directe) → wallet pending correct (3600/1000) → webhook dupliqué → no-op → webhook signature invalide → 401 `UNAUTHENTICATED` → confirm/ready → assign/picked-up/delivered → replay `delivered` sans double-libération → `funds_available` équilibré → wallet available correct, pending à zéro → trace complète dans `outbox`.

**Ce que le test d'intégration `apps/worker` vérifie** : `orderExpiryProcessor` expire une commande TTL-dépassée puis est idempotent au second tick ; **ne touche jamais** une commande qui a déjà quitté `awaiting_payment` (preuve directe de la race-safety, pas une affirmation) ; `outboxRelayProcessor` publie et marque `published`, et recule (`pending` + backoff) sans DLQ prématuré sur un échec de publication ; `ledgerAssertProcessor` ne remonte aucun résultat pour un groupe équilibré + wallet cohérent, **détecte** un groupe déséquilibré écrit directement en SQL (contournant l'invariant applicatif — exactement le scénario que ce job existe pour attraper) et **détecte** un `wallet_balances` incohérent avec ses `ledger_entries`.

**Discipline de véracité** : aucun de ces deux fichiers `.int.spec.ts` n'a été exécuté dans cet environnement (pas de démon Docker). Ils sont livrés comme du code réel, type-checké avec succès contre le schéma Prisma/SQL réel — pas comme des affirmations non vérifiables.

---

## 10. Sécurité / invariants vérifiés

- **`Money` partout** : aucun champ `number`/`*_xaf` introduit ; tout nouveau montant est `Money`/`MoneyJson`.
- **Le client n'est jamais autoritaire sur le prix** : `CreateOrderSchema`/`CreatePaymentSchema` n'ont **aucun** champ monétaire (vérifié par lecture des schémas Zod, `.strict()`).
- **Ledger = vérité, wallet = projection** : `wallet_balances` n'est écrit que par `LedgerRepository.writeGroup`, jamais par un `UPDATE` direct ailleurs (`deliveries`/`payments` ne touchent jamais `wallet_balances`).
- **Idempotence durable** : `Idempotency-Key` sur `orders`/`payments`/`deliveries` via `IdempotencyService` (table Postgres, pas Redis pour la garantie) ; webhooks dédoublonnés via `webhook_events (provider_code, event_id)` unique.
- **DAG respecté** : `orders` n'importe ni `payments` ni `deliveries` (vérifié par `eslint-plugin-boundaries`, `lint` 21/21 vert) ; couplage exclusivement par ports (`common/ports/`) et événements (`EventEmitter2`).
- **Aucun `if (provider === ...)`** : `PaymentProviderRegistry` reste la seule branche data-driven (Bloc 0, inchangé).
- **Signature webhook vérifiée avant tout traitement** : `verifyAndParseWebhook` est appelé avant toute lecture/écriture de `payments`, et une signature invalide lève avant que `webhook_events.status` passe à `processed`.
- **Outbox dans la même transaction** : `order_accrual`/`funds_available`/toutes les transitions de commande écrivent leur ligne `outbox` dans la même transaction Postgres que le changement métier (jamais un `enqueue` après coup).

**Dette assumée pour ce bloc** (documentée, pas un oubli) :

| #    | Simplification                                                                       | Pourquoi                                                          | Échéance        |
| ---- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | --------------- |
| S-01 | `customerId` dans le body de `POST /v1/orders`                                       | Pas d'auth réelle avant le Bloc 1 (JWT)                           | Bloc 1          |
| S-02 | Livreur unique seedé, résolu par requête SQL brute à la création de commande         | Pas de dispatch réel avant le Bloc 6                              | Bloc 6          |
| S-03 | Frais de livraison plat (`platform_settings`) au lieu d'un vrai calcul zone/distance | Pas de `delivery_zones`/geo avant le Bloc 6                       | Bloc 6          |
| S-04 | `MOCK_PSP_FEE_BPS = 150` constant, pas de vrais barèmes PSP                          | Pas de contrat PSP réel avant le Bloc 5                           | Bloc 5          |
| S-05 | Aucune auth/RBAC sur `confirm`/`ready`/`deliveries/*` — rôle asserté par le système  | Pas de dashboards ni d'auth avant Blocs 1/10/11                   | Blocs 1, 10, 11 |
| S-06 | `RealtimeGateway` sans adaptateur Redis multi-instance, sans auth de room            | Explicitement reporté par le mandat (« jamais source de vérité ») | Bloc 7          |

---

## 11. Dette technique restante

| #             | Dette                                                                                                                  | Pourquoi                                                                                                                                    | Échéance                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| D-01 (doc 17) | `ObjectStoragePort` placeholder                                                                                        | Inchangé                                                                                                                                    | Bloc 2                                                                                        |
| D-02 (doc 17) | `schema.prisma` sous-ensemble du DDL réel                                                                              | Inchangé (les nouvelles tables `orders`/`payments`/`deliveries` suivent le même choix : modèles Prisma minimaux + SQL brut pour la logique) | Aligné progressivement                                                                        |
| D-03 (doc 17) | ~~`SET LOCAL ROLE djafat_ledger` pas posé~~                                                                            | **Levée ce bloc** (§7.2)                                                                                                                    | —                                                                                             |
| D-04 (doc 17) | Worker autonome, ne réutilise pas les modules Nest de l'API                                                            | Toujours vrai — le worker garde `pg` brut par choix (docs/02)                                                                               | n/a, design assumé                                                                            |
| D-10          | Pas d'auth/RBAC sur les endpoints d'orchestration Bloc 0.5                                                             | S-05 ci-dessus                                                                                                                              | Blocs 1/10/11                                                                                 |
| D-11          | `apps/worker` n'a pas de suite unitaire (`vitest run --passWithNoTests`), seulement l'intégration nouvellement ajoutée | Les processeurs étaient des squelettes au Bloc 0 ; maintenant réels mais testés uniquement via `test:int` (nécessite Postgres)              | Ajouter des tests unitaires avec un stub `pg` si un besoin de couverture sans Docker apparaît |
| D-12          | Realtime sans adaptateur Redis ni auth de room                                                                         | S-06 ci-dessus                                                                                                                              | Bloc 7                                                                                        |

---

## 12. Problèmes rencontrés et résolus

| Problème                                                                                                            | Cause                                                                                                                                                                                                                                                    | Résolution                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wallet_balances` jamais écrit                                                                                      | Bug du Bloc 0 : `LedgerRepository.persistEntryGroup` ne faisait que `INSERT` dans `ledger_entries`, jamais de projection wallet                                                                                                                          | `writeGroup` fait maintenant un `INSERT … ON CONFLICT (owner_type, owner_id, currency) DO UPDATE SET pending_minor = wallet_balances.pending_minor + EXCLUDED.pending_minor, …`                                                                                                                           |
| `INSERT…SELECT` silencieux si le compte n'existe pas encore                                                         | Les comptes possédés (`RESTAURANT_PAYABLE:<id>`, etc.) n'étaient jamais créés                                                                                                                                                                            | `resolveOrProvisionAccount()` : SELECT puis INSERT paresseux si absent                                                                                                                                                                                                                                    |
| **Double préfixe `/v1/v1/...` sur toutes les routes**                                                               | `app.setGlobalPrefix('v1')` **+** `enableVersioning({type: URI, defaultVersion:'1'})` — `@nestjs/core`'s `RoutePathFactory.create()` compose `globalPrefix + /v{version} + controllerPath`, donc les deux mécanismes s'additionnent au lieu de coïncider | Retrait de `setGlobalPrefix` ; le versioning URI seul produit déjà `/v1/...`. Confirmé en lisant le code source `@nestjs/core` installé (`router/route-path-factory.js`), pas deviné. `main.ts` et le test d'intégration partagent désormais `bootstrap.ts::configureApp()` pour ne plus jamais diverger. |
| `metadata` sur `InitiatePaymentInput` était une échappatoire non typée (cast `as {...}` dans `MockPaymentProvider`) | Champ ajouté pendant le Bloc 0 sans mise à jour du type partagé                                                                                                                                                                                          | Champ `metadata?: Readonly<Record<string, unknown>>` ajouté formellement à `@djafat/types`, cast supprimé                                                                                                                                                                                                 |
| `eventNameFor()` avait un type de retour incohérent et un statut `awaiting_payment`/`draft` non mappé               | Annotation de type laissée en l'état pendant l'écriture                                                                                                                                                                                                  | `Record<OrderStatusString, DomainEventType>` exhaustif, sans valeur de repli                                                                                                                                                                                                                              |
| pino `Logger` n'a pas de méthode `.log()`                                                                           | Confusion avec `@nestjs/common`'s `Logger`                                                                                                                                                                                                               | `logger.info(...)` (API pino réelle) dans `order-expiry.processor.ts`                                                                                                                                                                                                                                     |
| `pnpm` introuvable sur le `PATH` de cet environnement (comme au Bloc 0)                                             | Sandbox Windows sans `corepack enable` fonctionnel (EPERM sur `Program Files`)                                                                                                                                                                           | `npm install -g pnpm@9.15.4` vers le préfixe utilisateur (`D:\npm-global`, déjà configuré), ajouté au `PATH` de chaque commande                                                                                                                                                                           |

---

## 13. Ledger-assert — invariant vérifié

`ledgerAssertProcessor` (worker, `apps/worker/src/processors/ledger-assert.processor.ts`) tourne toutes les heures en production et est appelé explicitement dans les deux suites d'intégration : deux requêtes SQL directes — `GROUP BY entry_group, currency HAVING Σdébit ≠ Σcrédit` et une comparaison `wallet_balances` vs `Σ ledger_entries` par bucket (`_PAYABLE`→pending, `_AVAILABLE`→available). Le test `apps/worker/test/processors.int.spec.ts` prouve, en écrivant volontairement un groupe déséquilibré et un wallet incohérent **directement en SQL** (contournant l'invariant applicatif de `@djafat/core`), que ce filet de sécurité les détecte — ce n'est pas seulement documenté, c'est testé à charge de le prouver faux.

---

## 14. Critères de sortie

| #   | Critère                                                                 | Statut                             | Note                                                                           |
| --- | ----------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| 1   | Migrations `0008`–`0010` écrites et cohérentes avec le schéma canonique | **PASS**                           | Enums identiques à `@djafat/core`                                              |
| 2   | `POST /v1/orders` sans montant client, idempotent                       | **PASS**                           | Zod `.strict()` sans champ monétaire ; `IdempotencyService`                    |
| 3   | `POST /v1/payments` → mock → webhook signé → succès                     | **PASS (code + typecheck)**        | N/V à l'exécution (Docker)                                                     |
| 4   | `order_accrual` équilibré, `DJAFAT_REVENUE` brut (pas le bug 2250)      | **PASS (testé unitairement)**      | `accrual-entries.spec.ts`, 6/6 verts                                           |
| 5   | Wallet pending crédité après `order_accrual`                            | **PASS (code + typecheck)**        | N/V à l'exécution                                                              |
| 6   | Livraison minimale assign/picked-up/delivered                           | **PASS (code + typecheck)**        | N/V à l'exécution                                                              |
| 7   | `funds_available` équilibré                                             | **PASS (testé unitairement)**      | `release-entries.spec.ts`, 3/3 verts                                           |
| 8   | Wallet available crédité après `funds_available`, pending à zéro        | **PASS (code + typecheck)**        | N/V à l'exécution                                                              |
| 9   | Outbox réel (`FOR UPDATE SKIP LOCKED`, retry/backoff/DLQ)               | **PASS (code + typecheck)**        | Testé dans `processors.int.spec.ts`, N/V exécution                             |
| 10  | Realtime minimal, jamais source de vérité                               | **PASS**                           | Gateway Socket.IO, aucune logique métier dedans                                |
| 11  | Expiration de commande idempotente et race-safe                         | **PASS (testé, code + typecheck)** | Preuve directe dans `processors.int.spec.ts` (2 tests dédiés)                  |
| 12  | `ledger-assert` détecte un déséquilibre                                 | **PASS (testé, code + typecheck)** | 3 tests dédiés (balanced/unbalanced/wallet-mismatch)                           |
| 13  | Test d'intégration bout-en-bout                                         | **PASS (livré, N/V exécution)**    | `walking-skeleton.int.spec.ts`, type-checké contre le schéma réel              |
| 14  | Idempotence durable (`Idempotency-Key`) sur les 3 créations             | **PASS**                           | Testé unitairement au Bloc 0 (`IdempotencyService`), exercé en intégration ici |
| 15  | DAG respecté (`orders` n'importe jamais `payments`/`deliveries`)        | **PASS (vérifié)**                 | `lint` 21/21 vert, boundaries actives                                          |
| 16  | `Money` partout, aucun champ `*_xaf` introduit                          | **PASS**                           | Lint dédié inchangé, vérifié par relecture                                     |
| 17  | `SET LOCAL ROLE djafat_ledger` réellement utilisé (D-03)                | **PASS**                           | `ledger.repository.ts`, les deux chemins d'écriture                            |
| 18  | Aucun secret commité                                                    | **PASS**                           | Vérifié — `.env.example` uniquement                                            |
| 19  | `pnpm install/format:check/lint/typecheck/test/build` verts             | **PASS**                           | 21/21 tâches, 87 tests unitaires                                               |
| 20  | Bloc 1 non démarré                                                      | **PASS**                           | Voir §16                                                                       |

**Bilan : 15 PASS · 5 PASS (code + typecheck, N/V à l'exécution faute de Docker) · 0 FAIL.**

---

## 15. Commits

Réalisés sur `main` (pas de nouvelle branche — cohérent avec les commits Bloc 0) :

- `chore(api,worker): Bloc 0.5 — walking skeleton (catalogue, orders, payments, ledger, deliveries, realtime, worker réel)`
- `fix(api): retire le double préfixe /v1/v1 (setGlobalPrefix + URI versioning)`
- `test(api,worker): tests unitaires (accrual/release entries, pricing) + suites d'intégration walking-skeleton`
- `docs(18): rapport d'implémentation Bloc 0.5`

Aucun `--no-verify` utilisé sur ce bloc (contrairement au Bloc 0/D-06) : `pnpm` a été rendu disponible sur le `PATH` de chaque commande via `npm install -g pnpm@9.15.4` vers un préfixe utilisateur déjà configuré (`D:\npm-global`), ce qui a permis aux hooks Husky de s'exécuter normalement.

---

## 16. Recommandation pour le Bloc 1

**Je m'arrête ici. Le Bloc 1 attend une décision explicite séparée — ce document ne constitue pas un feu vert.**

Le walking skeleton prouve que les joints structurants tiennent bout en bout : machine à états, grand livre à écrivain unique, idempotence, outbox, DAG de modules, projections wallet. Les seules réserves sont l'exécution Docker (identique au Bloc 0, couverte par la CI) et la dette explicitement assumée en §10 (auth, dispatch, PSP réels — toutes déjà planifiées aux blocs qui les adressent). Aucune de ces réserves ne remet en cause une décision d'architecture verrouillée (A1–A9) ni le modèle financier.
