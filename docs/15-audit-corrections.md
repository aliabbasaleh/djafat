# 15 — Journal d'audit & de décisions d'architecture

> Journal vivant. Chaque entrée = **problème → correction → raison → impact → statut → décision → dette assumée éventuelle**.
> Créé suite à l'audit CTO du 2026-09-10 (verdict : **GO AVEC CORRECTIONS**). Ce document tient lieu de registre ADR jusqu'à la mise en place de `docs/adr/`.
> **2e passe de validation (2026-09-10)** : décisions A1–A9 **verrouillées** (§10), **erreur d'équilibre du ledger corrigée** (exemple 10 000 XAF — C36), corrections C35–C39 ajoutées, classification P0/P1 resserrée. Checkpoint final : `docs/16-final-architecture-validation.md`.

**Légende statut** : `DOC` = appliqué dans la documentation d'architecture · `IMPL` = à implémenter au bloc indiqué · `RESERVED` = structure prévue, non câblée · `DEBT` = dette technique volontairement conservée.
**Légende priorité** : `P0` = doit exister dans le socle/schéma fondateur avant la 1re migration (types, tables de réf, règles d'archi — **jamais** de la logique métier/V2) · `P1` avant l'implémentation du bloc · `P2` avant production · `P3` amélioration future.

---

## 1. Fichiers modifiés / créés

### Modifiés

| Fichier                            | Nature des changements                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/01-architecture-generale.md` | Bandeau multi-pays/devise/provider dès le MVP ; `Money` dans `@djafat/core`/`types` ; modules `platform` + `ledger` dans l'archi logique ; flux « paiement confirmé » réécrit (outbox, signature, `NEEDS_REVIEW`) ; §6 « multi-pays/devise/provider — principes » ; §7 « séquencement commande↔paiement » ; §8 conséquences futures                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `docs/05-architecture-backend.md`  | Modules `platform` & `ledger` ajoutés ; **DAG de dépendances** ; `OrderAmountPort` (rupture `orders↔payments`) ; règle « grand livre écrivain unique » ; frontière **PostgreSQL vérité / Redis accélération** ; idempotence DB-backed ; `admin` = services only ; jobs `order-expiry`, `outbox-relay`, `ledger-assert`, settlements ; step-up MFA                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `docs/06-schema-postgresql.md`     | **Réécriture.** `Money` (`*_minor` + `currency`) ; `currencies`/`countries`/`cities` ; `platform_settings` ; `payment_methods`/`payment_providers`/`payment_provider_configs` ; `commission_rules`/`tax_rules` ; `webhook_events` ; `ledger_accounts`/`ledger_entry_groups`/`ledger_entries` (écrivain unique) ; `wallet_balances`/`wallet_transactions` (projections) ; `settlements`/`settlement_items` ; `payouts`/`payout_attempts` refaits ; `payment_disputes` (réservé) ; `orders.idempotency_key` + `awaiting_payment`/`expired` + `expires_at` + snapshots commission/courier ; `outbox` fiabilisé ; `sessions` token family + `refresh_hash` unique ; `phone_auth_locks` ; `users` partial-unique + anonymisation ; `restaurant_hours` en tz ville ; seed Tchad/N'Djamena/XAF |
| `docs/07-api.md`                   | **Réécriture.** Type `Money` en JSON (`minor` string) ; `GET /v1/config/payment-methods` ; `POST /v1/payments/:id/cancel` ; `Idempotency-Key` sur refund + payouts ; `POST /orders` **sans montant**, `paymentIntent` optionnel ; **scope/permission par endpoint** ; endpoints `ledger`, `settlements`, `webhook-events/replay`, `commission-rules`/`tax-rules`/`payment-provider-configs`/`countries`/`cities` ; admin **2FA + step-up** ; WS `payment.status`                                                                                                                                                                                                                                                                                                                        |
| `docs/14-roadmap-et-risques.md`    | **Réécriture.** Séquence Bloc 0 → 0.5 → 1..13 ; **Bloc 0.5 Walking Skeleton obligatoire** ; DS dégraissé ; admin/restaurant/livreur avant mobile natif ; `MockPaymentProvider` permanent ; §14.7 **classification P0/P1/P2/P3 (C1–C34)** ; risques mis à jour (T11–T13 nouveaux)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### Modifiés — 2e passe de validation (corrections A1–A9 verrouillées + C35–C39)

| Fichier                               | Nature des changements (2e passe)                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/01-architecture-generale.md`    | §6 : tableau **« Décisions verrouillées A1–A9 »** + « aucun code métier ne suppose Chad/XAF/N'Djamena » ; §7 : machine à états canonique référencée, job `order-expiry` idempotent                                                                                                                                                                                                       |
| `docs/05-architecture-backend.md`     | §5.4 : portée pays/ville des utilisateurs internes (C35) ; `OtpDeliveryPort` (A9) ; **portabilité hébergement / `ObjectStoragePort` (A6)** ; step-up élargi (replay webhook, import settlement, tax rule)                                                                                                                                                                                |
| `docs/06-schema-postgresql.md`        | **Machine à états `order_status` canonique** (13 états, transitions autorisées + interdites) en commentaire du type ; `orders.delivery_zone_id` + note A8 ; `user_roles.scope_country_id`/`scope_city_id` (C35) ; seed `platform_settings` : `psp_fee_policy`/`funds_release_policy`/`courier_compensation_policy`/`otp_channels` (C38) ; providers airtel/moov marqués **INACTIF** (A1) |
| `docs/07-api.md`                      | Suppression du code d'erreur `PRICE_MISMATCH` (obsolète) → `AMOUNT_NOT_ACCEPTED` (422) si un montant est soumis ; `POST /orders` : « références et choix, jamais un montant » + résolution serveur explicite + `order.city_id` = ville resto                                                                                                                                             |
| `docs/08-architecture-paiement.md`    | §8.1 : **décision A1 verrouillée** (n'activer que les providers vérifiés) ; §8.9 : **exemple ledger 10 000 XAF corrigé** (C36 — `DJAFAT_REVENUE` brut 2 400, `PSP_FEE_EXPENSE` charge distincte, Σdébit=Σcrédit vérifié + contrôle global) ; convention A2 ; `funds_release_policy` A3                                                                                                   |
| `docs/09-livraison-geo-temps-reel.md` | §A.4 : **décision A5** (`courier compensation = delivery fee`, configurable via `courier_compensation_policy`), fee figée à l'assignation, crédit via `LedgerPort` ; §D.2 : `OtpDeliveryPort` (A9)                                                                                                                                                                                       |
| `docs/14-roadmap-et-risques.md`       | §14.7 : classification **resserrée** (P0 = schéma/types/règles d'archi uniquement ; split schéma/logique pour C1/C3/C5/C6) ; ajout **C35–C39**                                                                                                                                                                                                                                           |

### Créés

| Fichier                                    | Rôle                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/15-audit-corrections.md`             | Journal d'audit & décisions + plan de migration (mis à jour 2e passe)                                                                                        |
| `docs/16-final-architecture-validation.md` | **Checkpoint officiel** de validation avant développement (verdict, décisions verrouillées, contradictions, readiness Bloc 0 / 0.5, conditions de démarrage) |

### Régénéré (dérivé)

| Fichier                           | Rôle                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `DJAFAT-architecture-complete.md` | Concaténation des 17 fichiers `docs/` (README + 01→16) — pour relecture / ChatGPT |

> Les documents `02`, `03`, `04`, `10`, `11`, `12`, `13` **n'ont pas été modifiés** : l'audit ne les visait pas et leurs décisions restent valides. `12` (offline/perf/sécurité) et `13` (Git/CI) recevront des ajouts mineurs (PgBouncer, OpenTelemetry, anti-stampede, runbook DR, lint de frontières, `ObjectStoragePort`) **au moment de leur bloc** — noté ici, non urgent.

---

## 2. Résumé des corrections (C1–C39)

| ID      | Problème identifié                                                                                                                                  | Correction appliquée                                                                                                                                                                                                                                                                                        | Raison                                                                        | Impact                                                            | Prio                       | Statut                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------- | -------------------------- |
| **C1**  | Interface `PaymentProvider` incomplète ; risque de conception autour d'Airtel                                                                       | Interface complète (`getCapabilities`, `initiate`, `getStatus`, `verifyAndParseWebhook`, `cancel`, `capture?`, `refund`) + `ProviderCapabilities` + registry **data-driven** (aucun `switch` provider)                                                                                                      | Ajouter/retirer un PSP sans toucher `orders`/API                              | Le cœur ne dépend que de `PaymentPort`                            | P0/P1                      | DOC → IMPL Bloc 5          |
| **C2**  | Devise câblée (`amountXaf`, `number`) dans tout le cœur financier                                                                                   | Type `Money { minor: bigint; currency: string }` ; colonnes `*_minor` + `currency` ; `currencies.exponent`                                                                                                                                                                                                  | Multi-pays sans migration rétroactive du cœur                                 | Toutes les tables/DTO financières                                 | P0                         | DOC                        |
| **C3**  | Enum rigide `cash_on_delivery\|mobile_money\|card` = seule source de vérité                                                                         | `payment_methods` + `payment_providers` + `payment_provider_configs` (dispo par pays/ville/zone/resto) + `GET /config/payment-methods`                                                                                                                                                                      | Configurer les moyens sans déploiement                                        | Fin du `CHECK` sur `orders`, DTO ouvert                           | P0/P1                      | DOC → IMPL Bloc 5          |
| **C4**  | Pas de `countries`/`cities` ; Chad/XAF/fr implicites                                                                                                | Tables `currencies`/`countries`/`cities` + `country_id`/`city_id` sur `restaurants`/`orders`/`delivery_zones`/`promotions`                                                                                                                                                                                  | Ouvrir un marché = INSERT, pas migration                                      | Racines métier + requêtes scoping                                 | P0                         | DOC                        |
| **C5**  | Commission mono-colonne, pas de taxes                                                                                                               | `commission_rules` + `tax_rules` (résolution global→pays→ville→resto→catégorie + validité) + **snapshot** sur `orders`                                                                                                                                                                                      | Règles commerciales configurables et historisées                              | `pricing`, `orders`                                               | P0/P1                      | DOC → IMPL Bloc 4          |
| **C6**  | Écritures `ledger_entries` dispersées ; double système `wallet_transactions`/ledger                                                                 | Module `ledger` **écrivain unique** ; `LedgerService.postEntryGroup()` (équilibre + idempotence) ; `wallet_balances`/`wallet_transactions` = **projections** dans la même tx                                                                                                                                | Invariant financier gardé en un point ; extraction `payments`+`ledger` propre | Tous les modules qui bougent de l'argent passent par `LedgerPort` | P0                         | DOC → IMPL Bloc 0.5        |
| **C7**  | Idempotence financière en Redis seul (éviction = double effet)                                                                                      | Contraintes d'unicité **PostgreSQL** : `orders(customer_id, idempotency_key)`, `payments(order_id, idempotency_key)`, `refunds(payment_id, idempotency_key)`, `payouts(idempotency_key)`, `ledger_entry_groups(idempotency_key)`, `webhook_events(provider, event_id)` + table `idempotency_keys` générique | La garantie doit être durable                                                 | `common/idempotency`, schéma                                      | P0                         | DOC → IMPL Bloc 0/0.5      |
| **C8**  | Graphe de dépendances des modules jamais spécifié ; cycle `orders↔payments`                                                                        | **DAG explicite** (doc 05 §5.3) + `OrderAmountPort` (possédé par `payments`, implémenté par `orders`) ; `orders` n'importe jamais `payments` (events uniquement)                                                                                                                                            | Empêcher la dérive et rendre l'extraction possible                            | Lint de frontières, structure des modules                         | P0                         | DOC → IMPL Bloc 0          |
| **C9**  | `provider_ref` non unique ; pas de table webhook                                                                                                    | `webhook_events` (`unique(provider, event_id)`, `status`, `attempts`, `raw_ref`) + `unique(provider_code, provider_ref)` sur `payments` ; **signature = source de confiance**, IP allowlist = complément                                                                                                    | Rejeu de webhook = no-op ; pas de double crédit                               | `payments`, migration                                             | P1                         | DOC → IMPL Bloc 5          |
| **C10** | Refund fragile (pas d'idempotency, pas de garde, pas de lien ledger)                                                                                | `refunds.idempotency_key` + trigger `∑ ≤ payment` + `entry_group` + `attempts`/`last_error` ; endpoint `Idempotency-Key` + step-up                                                                                                                                                                          | Pas de double remboursement ; traçable                                        | `payments`, `ledger`, API admin                                   | P1                         | DOC → IMPL Bloc 5          |
| **C11** | État `flagged` référencé mais inexistant                                                                                                            | `NEEDS_REVIEW` dans l'enum `payment_status` + politique (écart montant/devise/signature suspecte → aucun crédit auto, alerte ops)                                                                                                                                                                           | États cohérents doc ↔ modèle                                                 | Enum, machine à états                                             | P1                         | DOC → IMPL Bloc 5          |
| **C12** | Commande impayée jamais expirée                                                                                                                     | États `awaiting_payment`/`expired` + `orders.expires_at` + `platform_settings['unpaid_order_ttl_seconds']` (défaut 900) + worker `order-expiry` (30 s)                                                                                                                                                      | Pas de commandes zombies ; libère les ressources                              | `orders`, migration, worker                                       | P1                         | DOC → IMPL Bloc 4          |
| **C13** | Frais PSP & settlement non modélisés                                                                                                                | Comptes `PSP_CLEARING`/`PSP_FEE_EXPENSE` ; `settlements`/`settlement_items` ; ingestion relevé + matching + post `settlement` + écarts ; `payments.psp_fee_minor`                                                                                                                                           | Comptes justes dès la 1re commande MM ; visibilité trésorerie                 | `ledger`, `payments-reconcile`                                    | P1                         | DOC → IMPL Bloc 5          |
| **C14** | Pas de `cancel()` provider ni d'endpoint                                                                                                            | `PaymentProvider.cancel()` + `POST /v1/payments/:id/cancel` (Idempotency-Key, owns-order\|admin)                                                                                                                                                                                                            | USSD abandonné / redirection non terminée                                     | `payments`, API                                                   | P1                         | DOC → IMPL Bloc 5          |
| **C15** | `payouts` : pas de FK, pas d'idempotency, pas de retry, pas de lien ledger                                                                          | `payouts` refait (`idempotency_key` unique, `ledger_account_id`, `entry_group`, `fee_minor`, statuts) + `payout_attempts` + approbation step-up                                                                                                                                                             | Payouts auditables et rejouables                                              | `ledger`, migration, API admin                                    | P1                         | DOC → IMPL Bloc 5          |
| **C16** | Horaires restaurant sans fuseau                                                                                                                     | `restaurant_hours` interprétés en `cities.timezone` ; job `is_open_now` par fuseau de ville                                                                                                                                                                                                                 | Multi-pays ; correction même en mono-pays (indépendance du fuseau serveur)    | `restaurants`, `@djafat/core`                                     | P1                         | DOC → IMPL Bloc 2          |
| **C17** | `sessions.refresh_hash` non unique, pas de token family                                                                                             | `family_id` + `refresh_hash` unique + réutilisation d'un refresh tourné → révocation de toute la family + alerte                                                                                                                                                                                            | Détection de vol de refresh token                                             | `auth`, migration                                                 | P1                         | DOC → IMPL Bloc 1          |
| **C18** | OTP brute-force au-delà des tentatives par code                                                                                                     | `phone_auth_locks` (durable) : N échecs / M min → `locked_until` ; Redis en 1re ligne                                                                                                                                                                                                                       | Résistance brute-force durable                                                | `auth`, migration                                                 | P1                         | DOC → IMPL Bloc 1          |
| **C19** | Admin sans 2FA ; pas de step-up sur actions financières                                                                                             | 2FA TOTP au login + **step-up** (< 10 min) pour refund/payout/commission/suspension/flags/ajustement ledger + `audit_logs.step_up_verified`                                                                                                                                                                 | Réduire le risque de compromission admin                                      | `auth`, `admin`, API                                              | P1                         | DOC → IMPL Bloc 1/9        |
| **C20** | `outbox` sans retry fiable                                                                                                                          | `status`/`attempts`/`last_error`/`next_attempt_at`/`processed_at` + relay `FOR UPDATE SKIP LOCKED` + DLQ + alerte                                                                                                                                                                                           | Aucun événement de domaine perdu                                              | migration, `outbox-relay`                                         | P0                         | DOC → IMPL Bloc 0          |
| **C21** | Pas de tranche verticale early ; PSP sur le chemin critique                                                                                         | **Bloc 0.5 Walking Skeleton obligatoire** + `MockPaymentProvider` **permanent** (dev/CI/filet)                                                                                                                                                                                                              | Valider les joints en semaine 3–4 ; PSP hors chemin critique                  | Roadmap                                                           | P0                         | DOC → IMPL Bloc 0.5        |
| **C22** | Pas de pooling de connexions                                                                                                                        | PgBouncer (transaction pooling) dès le Bloc 0                                                                                                                                                                                                                                                               | Prisma+NestJS saturent vite Postgres                                          | infra                                                             | P1                         | DOC → IMPL Bloc 0          |
| **C23** | Manipulation des frais de livraison via `lat/lng` client                                                                                            | Frais par **paliers de zone (polygone)** au MVP ; recalcul + réconciliation à l'assignation livreur ; plafond de remise                                                                                                                                                                                     | Fraude sur les frais                                                          | `pricing`, `deliveries`                                           | P2                         | DOC → IMPL Bloc 6          |
| **C24** | Chargebacks non modélisés                                                                                                                           | `payment_disputes` (structure + enum) **réservée**, non câblée                                                                                                                                                                                                                                              | Ne pas bloquer l'ajout carte                                                  | migration (table) / V2 (câblage)                                  | P2                         | DOC / RESERVED             |
| **C25** | Cache home `TTL 60 s` sans protection stampede                                                                                                      | Single-flight (lock court) sur la régénération du cache listing                                                                                                                                                                                                                                             | Éviter l'effondrement au pic                                                  | `search`, `common`                                                | P2                         | DOC → IMPL Bloc 2          |
| **C26** | Seul Prometheus prévu                                                                                                                               | Ajout **OpenTelemetry** (traces) + propagation `traceId` HTTP+jobs                                                                                                                                                                                                                                          | Diagnostiquer les incidents distribués                                        | observabilité                                                     | P2                         | DOC → IMPL Bloc 13         |
| **C27** | Pas de plan DR chiffré                                                                                                                              | Runbook DR + **RPO/RTO chiffrés** + copie backup cross-région + test de restauration périodique                                                                                                                                                                                                             | Continuité                                                                    | ops                                                               | P2                         | DOC → IMPL Bloc 13         |
| **C28** | Pas de cibles de charge                                                                                                                             | Scénarios **k6** par palier (`/home`, `/restaurants`, `POST /orders`, dispatch, webhook)                                                                                                                                                                                                                    | Détecter les plafonds avant prod                                              | tests                                                             | P2                         | DOC → IMPL Bloc 13         |
| **C29** | Soft-delete user vs `phone` unique global                                                                                                           | `unique (phone) where deleted_at is null` + **anonymisation** à la suppression (libère le numéro)                                                                                                                                                                                                           | Réinscription possible sans casser les FK                                     | `users`, migration                                                | P2                         | DOC → IMPL Bloc 1          |
| **C30** | Bugs de portée RBAC (vuln n°1 marketplace)                                                                                                          | **Test matriciel** : chaque endpoint `/v1/restaurant/*` et `/v1/courier/*` vérifie la propriété                                                                                                                                                                                                             | Empêcher l'accès croisé                                                       | tests                                                             | P1                         | DOC → IMPL Bloc 1          |
| **C31** | Invariant grand livre non gardé                                                                                                                     | `ledger-assert` : assertion `∑debit=∑credit` par groupe/devise + `soldes projetés == grand livre`, en CI (Bloc 0.5) + job horaire (Bloc 5)                                                                                                                                                                  | Détecter toute dérive financière                                              | tests, worker                                                     | P1                         | DOC → IMPL Bloc 0.5/5      |
| **C32** | Contenu (`products.name`) non traduisible                                                                                                           | Colonne `products.name_i18n jsonb` **réservée** ; MVP = `name` seul                                                                                                                                                                                                                                         | Ne pas bloquer l'AR en V2                                                     | migration (colonne)                                               | P3                         | RESERVED                   |
| **C33** | Machine à états référence `capture` sans méthode                                                                                                    | `capture()` **optionnel** (si `capabilities.capture`) ; `AUTHORIZED` non imposé aux providers async                                                                                                                                                                                                         | Cohérence ; pas de sur-spéc MVP                                               | `payments`                                                        | P3                         | DOC / V2                   |
| **C34** | `unique(order_id) where succeeded` bloque le split payment                                                                                          | Conservé ; **split payment = dette V2 assumée**                                                                                                                                                                                                                                                             | Simplicité MVP ; besoin non prouvé                                            | —                                                                 | P3                         | DEBT                       |
| **C35** | Pas de scope pays/ville pour les utilisateurs internes (admin régional) alors qu'on revendique le multi-pays                                        | `user_roles.scope_country_id` / `scope_city_id` (nullable = global) **ajoutés maintenant** ; MVP = admins globaux ; **filtrage** des listes admin = P2                                                                                                                                                      | Éviter une migration + une faille cross-country avant le 2e marché            | `user_roles`, `common/rbac`                                       | P1 (schéma) · P2 (logique) | DOC → IMPL Bloc 1 (schéma) |
| **C36** | **Erreur d'équilibre** dans l'exemple ledger 10 000 XAF (1re passe) : `DJAFAT_REVENUE` crédité de 2 250 (net) → `Σcrédit = 9 850 ≠ Σdébit = 10 000` | `DJAFAT_REVENUE` = **produit brut 2 400** ; frais PSP = **charge distincte** `PSP_FEE_EXPENSE 150` (A2) ; marge nette 2 250 = P&L, pas une écriture. Exemple re-vérifié groupe par groupe (Σdébit = Σcrédit) + contrôle global                                                                              | Un exemple faux dans la doc de référence = risque d'implémentation fausse     | doc 08 §8.9, doc 15 §4.3                                          | **P0** (doc)               | **DOC — corrigé 2e passe** |
| **C37** | `orders` ne conservait pas explicitement la zone de livraison ; A8 pas assez explicite                                                              | `orders.delivery_zone_id` ajouté ; commentaire A8 : `city_id` = ville resto, localité client = `address_id` + `address_snapshot.geom` + `delivery_zone_id` ; `restaurant city ≠ customer locality` représentable                                                                                            | Audit du frais de livraison + réalité terrain N'Djamena                       | `orders`, migration `0009`                                        | P1                         | DOC → IMPL Bloc 4          |
| **C38** | Politiques A2/A3/A5/A9 pas matérialisées                                                                                                            | `platform_settings` seed : `psp_fee_policy='absorb'`, `funds_release_policy={trigger:'delivered',...}`, `courier_compensation_policy={type:'delivery_fee'}`, `otp_channels=['sms']`                                                                                                                         | Rendre les décisions verrouillées **configurables sans déploiement**          | `platform_settings`, seed `0002`                                  | **P0** (seed)              | DOC → IMPL Bloc 0          |
| **C39** | Abstractions A6/A9 pas nommées comme ports                                                                                                          | `ObjectStoragePort` (S3-compatible, aucun SDK propriétaire dans le métier — A6) et `OtpDeliveryPort` (impl `sms`, extensible — A9) posés dès le Bloc 0/1                                                                                                                                                    | Portabilité hébergement + extensibilité canaux OTP                            | `common/storage`, `auth`                                          | P1                         | DOC → IMPL Bloc 0/1        |

---

## 3. Décisions d'architecture (AD)

### AD-01 — Représentation monétaire : `Money { minor: bigint; currency: string }`

Toute valeur monétaire = entier en **unité mineure** + code devise ISO 4217. `currencies.exponent` porte l'échelle (XAF=0). Sérialisation JSON : `minor` en **string**. **Une seule devise par ligne financière** (garde `409 CURRENCY_MISMATCH`). **Pas de moteur de change** : une conversion (V2) se fait à des frontières explicites (payout, reporting) avec un taux stocké. **Raison** : renommer `*_xaf` après coup = migration de tout le cœur + code + API + SDK. **Conséquence** : colonnes `currency` partout + rigueur d'arithmétique (dans `@djafat/core`).

### AD-02 — Grand livre à écrivain unique ; soldes = projections

Seul le module `ledger` écrit `ledger_*`, `wallet_*`, `settlements`, `payouts` (droits SQL restreints au rôle `djafat_ledger`). API unique `LedgerService.postEntryGroup(entries[], {kind, idempotencyKey, currency, refs})` : valide `∑debit=∑credit` par devise, insère groupe immuable, met à jour `wallet_balances`/`wallet_transactions` **dans la même transaction**. Correction = groupe `adjustment` (contre-écriture), jamais `UPDATE`. `wallet_balances` (pending/available) est **reconstructible** depuis `ledger_entries`. **Raison** : un invariant ne se garde qu'à un seul endroit ; c'est aussi la condition d'une extraction propre de `payments`+`ledger`.

### AD-03 — Abstraction paiement provider-agnostic

`PaymentProvider` (interface) + `ProviderCapabilities` (déclaratif) + registry **data-driven** (`payment_provider_configs`). Implémentations : `CashProvider`, `MockProvider` (**permanent**), `AirtelMoneyProvider`, `MoovMoneyProvider`, `CardProvider` (V2), extensible. **Aucun `if (provider === …)`** hors registry. Le cœur `orders`/`carts`/`pricing`/API ne connaît que `PaymentPort`. **Raison** : ne jamais construire DJAFAT autour d'un PSP. **Conséquence** : ajouter un PSP = 1 fichier provider + 1 ligne de config, zéro migration, zéro évolution d'API.

### AD-04 — Moyens de paiement pilotés par les données

`payment_methods` (types) + `payment_providers` (implémentations + capabilities) + `payment_provider_configs` (disponibilité + plage montant + devise + validité, par pays/ville/zone/restaurant). `orders.payment_method_code` **sans CHECK**. Découverte : `GET /v1/config/payment-methods`. Le moyen de paiement **n'est pas figé** à la création de commande (choisi/modifiable au niveau `payments`, y compris au `retry`).

### AD-05 — Modèle multi-pays : `country` + `city` (pas de table `markets` au MVP)

`currencies` / `countries` (ISO, devise, locale, timezone, dial code) / `cities` (timezone propre, bbox). `country_id`+`city_id` sur `restaurants`/`orders`/`delivery_zones`/`promotions` ; `users.country_id` nullable. Un « marché » opérationnel = le couple `(country, city)`. Une table `markets` (paramètres propres à un marché au-delà de country+city) pourra être ajoutée si le besoin apparaît — **non nécessaire au MVP**. **Raison** : préparer sans sur-ingénierie. **Conséquence** : ouvrir un marché = INSERT (countries/cities/currencies + provider configs + commission/tax rules + i18n).

### AD-06 — Règles de commission & taxe résolues + snapshotées

`commission_rules` (scope global→country→city→restaurant→category, `rate_bps`, min/max, validité, priorité) et `tax_rules` (country/city, kind, `rate_bps`, `applies_to`, `inclusive`, validité). Résolution : la plus spécifique + active + valide + priorité max. Le taux **résolu est figé** sur `orders.commission_bps_snapshot` / `orders.tax_minor` → une commande passée ne bouge jamais. **MVP** : commission 20 % (scope country TD), taxe 0 %.

### AD-07 — Séquencement commande ↔ paiement + expiration

Prépayé : `draft → awaiting_payment` (`expires_at`, TTL config, défaut 15 min) → `payment.succeeded` → `placed` → `confirmed`. Cash : `draft → placed` (provider synchrone). Worker `order-expiry` : `awaiting_payment` périmé → `expired` + annule le `payment` `pending`. **Le restaurant n'est notifié qu'à `placed`.**

### AD-08 — Idempotence durable = PostgreSQL ; Redis = accélération

Garantie = contrainte d'unicité PostgreSQL (voir C7). Redis : cache, locks courts, rate limits, idempotence **non financière** courte durée, rooms WS, transport BullMQ. Jamais la seule barrière pour `payments`/`orders`/`ledger`/`payouts`/`refunds`/`webhooks`.

### AD-09 — DAG de modules + `OrderAmountPort`

Dépendances en DAG strict (doc 05 §5.3). `orders` implémente `OrderAmountPort` (`getAuthoritativeAmount`, `getPaymentContext`) ; `payments` en dépend, **n'importe jamais** le service/repo concret de `orders`. Réactions inverses (`orders` ← `payment.*`, `deliveries` ← `order.*`) via l'outbox. Lint de frontières (`eslint-plugin-boundaries`).

### AD-10 — Webhooks : signature = confiance, idempotence durable

`webhook_events(unique(provider, event_id))` (event_id = id PSP ou `sha256(body)`), `status`/`attempts`, `raw_ref` chiffré. Ordre : insérer (dédup) → `verifyAndParseWebhook` (signature + horodatage ±5 min) → `200` < 1 s → job transactionnel. Écart montant/devise → `NEEDS_REVIEW`. IP allowlist = **complément**, jamais substitut.

### AD-11 — PSP clearing + settlement explicites

À `payment.succeeded` (MM) : l'argent est en `PSP_CLEARING:<provider>` (actif), pas en banque. `settlements`/`settlement_items` : ingestion des relevés PSP + matching + post du groupe `settlement` (`PSP_CLEARING → DJAFAT_BANK`, frais → `PSP_FEE_EXPENSE`) + `discrepancy` alerté. **Jamais** « payment = success » sans piste de réconciliation.

### AD-12 — Admin : 2FA + step-up MFA

TOTP obligatoire au login admin. **Step-up** (ré-auth < 10 min) pour toute action financière/critique. `audit_logs.step_up_verified`. IP allowlist `/v1/admin/*` optionnelle.

### AD-13 — Outbox fiabilisé

`outbox` : `status`(`pending/processing/published/failed`) + `attempts` + `last_error` + `next_attempt_at` + `processed_at`. Relay : `FOR UPDATE SKIP LOCKED`, backoff, DLQ + alerte.

### AD-14 — Refresh token family

`sessions.family_id` + `refresh_hash` unique. Présentation d'un refresh déjà tourné (`revoked_reason='rotated'`) → révocation de toute la family + alerte sécurité.

---

## 4. Nouveau modèle financier

### 4.1 Plan comptable (`ledger_accounts.code`)

| Code                                    | Type      | Portée       | Sens                                           |
| --------------------------------------- | --------- | ------------ | ---------------------------------------------- |
| `PSP_CLEARING`                          | asset     | par provider | Encaissé, chez le PSP, pas en banque           |
| `DJAFAT_BANK`                           | asset     | global       | Compte bancaire DJAFAT                         |
| `CASH_FLOAT`                            | asset     | par courier  | Espèces détenues par le livreur, non reversées |
| `DJAFAT_REVENUE`                        | revenue   | global       | Commission + frais de service − subventions    |
| `PSP_FEE_EXPENSE`                       | expense   | global       | Frais prélevés par le PSP                      |
| `PROMO_EXPENSE`                         | expense   | global       | Coût des remises DJAFAT                        |
| `RESTAURANT_PAYABLE`                    | liability | par resto    | Dû au resto, **non libéré** → `wallet.pending` |
| `RESTAURANT_AVAILABLE`                  | liability | par resto    | Dû au resto, **libéré** → `wallet.available`   |
| `COURIER_PAYABLE` / `COURIER_AVAILABLE` | liability | par courier  | Idem livreur                                   |
| `REFUNDS_PAYABLE`                       | liability | global       | Remboursements dus non versés                  |
| `CUSTOMER_CLEARING`                     | liability | global       | Encaissements clients en transit               |

### 4.2 Cycle de vie des fonds (kinds de `ledger_entry_groups`)

`order_accrual` (à `payment.succeeded` ou cash `delivered`) → `funds_available` (à `order.delivered`, fin de fenêtre de litige) → `settlement` (relevé PSP → banque) → `payout` (banque → partenaire). Corrections : `adjustment`. Litiges : `dispute`. Reversement d'espèces livreur : `cash_reconciliation`.

### 4.3 Exemple bout-à-bout — **10 000 XAF**, Mobile Money (vérifié : Σdébit = Σcrédit à chaque groupe)

> **Convention (A2)** : `DJAFAT_REVENUE` = **produit brut** (commission + service + livraison collectée − rémunération livreur) = **2 400**. Les frais PSP (150) sont une **charge distincte** (`PSP_FEE_EXPENSE`), **jamais** nette du revenu au grand livre. Marge nette = 2 400 − 150 = **2 250** (compte de résultat, pas une écriture).

```
Décomposition : sous-total 8 000 · livraison 1 500 · service 500 · TOTAL 10 000
                commission 20%×8 000 = 1 600 · livreur 1 200 (= delivery fee, A5) · frais PSP 1,5%×10 000 = 150
Cibles        : restaurant 6 400 · livreur 1 200 · DJAFAT produit brut 2 400 · charge PSP 150

G1  order_accrual        DÉBIT  PSP_CLEARING 9 850 + PSP_FEE_EXPENSE 150            = 10 000
                         CRÉDIT RESTAURANT_PAYABLE 6 400 + COURIER_PAYABLE 1 200
                                + DJAFAT_REVENUE 2 400                              = 10 000   ✔
G2  funds_available       DÉBIT  RESTAURANT_PAYABLE 6 400 + COURIER_PAYABLE 1 200   = 7 600
                          CRÉDIT RESTAURANT_AVAILABLE 6 400 + COURIER_AVAILABLE 1 200 = 7 600  ✔
                          (reclassement PUR passif→passif : aucun argent créé)
G3  settlement            DÉBIT  DJAFAT_BANK 9 850   CRÉDIT PSP_CLEARING 9 850      9 850 = 9 850 ✔
G4  payout (restaurant)   DÉBIT  RESTAURANT_AVAILABLE 6 400  CRÉDIT DJAFAT_BANK 6 400  6 400 = 6 400 ✔

Contrôle global : Σactifs (DJAFAT_BANK +3 450) = Σpassifs (COURIER_PAYABLE +1 200)
                  + résultat (REVENUE 2 400 − PSP_FEE 150 = 2 250)  →  3 450 = 3 450  ✔
```

Variante **Cash** : `G1` = `DÉBIT CASH_FLOAT:<courier> 10 000` / `CRÉDIT RESTAURANT_PAYABLE 6 400 + COURIER_PAYABLE 1 200 + DJAFAT_REVENUE 2 400` (10 000 = 10 000 ✔ ; aucun frais PSP) ; `G3` = `cash_reconciliation` `DÉBIT DJAFAT_BANK 10 000 / CRÉDIT CASH_FLOAT 10 000` au reversement d'espèces. Plafond de float via `platform_settings['courier_cash_float_cap_minor']`.

> **`pending → available` (G2) ne crée jamais d'argent** : `RESTAURANT_PAYABLE` et `RESTAURANT_AVAILABLE` sont deux comptes de **passif** ; G2 déplace le solde de l'un à l'autre, total passif inchangé. Vérifié en CI (`ledger-assert`).

### 4.4 Projections

`wallet_balances(owner_type, owner_id, currency, pending_minor, available_minor)` : `pending` = solde `*_PAYABLE:<id>`, `available` = solde `*_AVAILABLE:<id>`. `wallet_transactions` : read-model paginable (relevés). Écrits **uniquement** par le projecteur `ledger`, même transaction que l'`entry_group`. `ledger-assert` vérifie `projection == grand livre`.

---

## 5. Nouveau modèle multi-pays

```
currencies (code PK, exponent, symbol, display_name, active)
   └─ 1..* countries (iso_code, name, currency→currencies, default_locale, timezone, dial_code, active)
        └─ 1..* cities (name, slug, timezone, centroid, bbox, active)

country_id / city_id ajoutés sur : restaurants, orders, delivery_zones, promotions
users.country_id (nullable — déduit du dial code / 1re commande)

platform_settings (key, scope: global|country|city, country_id?, city_id?, value jsonb)
   ex. unpaid_order_ttl_seconds, offer_timeout_seconds, courier_cash_float_cap_minor, funds_hold_policy

commission_rules (scope, country_id?, city_id?, restaurant_id?, category_id?, rate_bps, min/max, priority, validité)
tax_rules       (country_id, city_id?, kind, rate_bps, applies_to, inclusive, priority, validité)
```

Règle **fuseau** : les heures « murales » (`restaurant_hours`) sont interprétées dans `cities.timezone` du restaurant ; `timestamptz` toujours UTC ; jamais le fuseau du serveur.

**Ouvrir un marché** = INSERT `countries`/`cities` (+ éventuelle `currencies`) + `payment_provider_configs` + `commission_rules`/`tax_rules` + traductions i18n. Aucune migration de schéma, aucune réécriture du cœur.

**Seed MVP** : `XAF` (exp 0) · `TD` Tchad (XAF, fr, Africa/Ndjamena, +235) · `N'Djamena`.

---

## 6. Nouveau modèle payment provider

```
interface ProviderCapabilities {
  initiate; webhook; polling; cancel; refund; partialRefund; capture;
  requiresPayerPhone; async; currencies: string[]; minAmount?: Money; maxAmount?: Money;
}

interface PaymentProvider {
  readonly code: string;
  getCapabilities(): ProviderCapabilities;
  initiate({ paymentId, amount: Money, orderCode, payerPhone?, idempotencyKey, returnUrl? })
    -> { providerRef, status, action?, expiresAt? };
  getStatus(providerRef) -> { status, raw };
  verifyAndParseWebhook(rawReq) -> { eventId, providerRef, status, signatureValid, amount?, raw };
  cancel({ providerRef, idempotencyKey }) -> { status };
  capture?({ providerRef, amount: Money, idempotencyKey }) -> { status };   // si capabilities.capture
  refund({ providerRef, amount: Money, idempotencyKey }) -> { status, providerRef };
}

PaymentService
  ├─ resolveMethods(ctx)  → via platform.PaymentMethodResolverPort  (payment_provider_configs)
  ├─ registry: Map<providerCode, PaymentProvider>   (data-driven — aucun switch)
  └─ orchestration : initiate / getStatus / handleWebhook / cancel / capture? / refund
                     + post ledger via LedgerPort
```

**États `payment_status`** : `pending · authorized(opt) · succeeded · failed · cancelled · expired · refunded · partially_refunded · needs_review`.
`authorized`/`capture()` = **optionnels**, activés seulement si `capabilities.capture` (jamais imposés au Mobile Money).

**Implémentations** : `cash` · `mock` (permanent, CI) · `airtel_money` · `moov_money` · `card_*` (V2) · futurs.

---

## 7. Nouveau graphe de dépendances backend (résumé — détail doc 05 §5.3)

```
L0  platform · geo
L1  auth · users · restaurants/menus/products · promotions
L2  search · pricing(←platform,geo,promotions) · ledger(←platform)          [ledger = écrivain unique]
L3  carts(←pricing,catalog)
L4  orders(←carts,pricing,catalog,platform)                                 [implémente OrderAmountPort]
L5  payments(←platform,ledger,OrderAmountPort) · deliveries(←geo,ledger,OrderAmountPort) · couriers(←ledger)
L6  notifications · realtime · analytics        (réactifs — écoutent l'outbox)
L7  admin        (compose les SERVICES, jamais les repos)

Règles : aucune flèche remontante · orders n'importe jamais payments (events + OrderAmountPort) ·
         seul ledger écrit ledger_*/wallet_*/settlements/payouts.
```

---

## 8. Plan de migration PostgreSQL

> **Contexte** : le projet **n'a pas encore de base de données** (Bloc 0 non démarré). Il n'y a donc **rien à migrer d'un existant** : le doc 06 révisé **est** le modèle cible, et ce « plan de migration » = (a) l'**ordre de création** des migrations initiales, (b) la **stratégie d'évolution** pour les changements qui surviendront pendant l'implémentation, (c) le **seed**.

### 8.1 Modèle cible

Le schéma complet de `docs/06-schema-postgresql.md` (révisé). Extensions : `postgis`, `pg_trgm`, `pgcrypto`, `citext`.

### 8.2 Ordre des migrations initiales (Bloc 0 → Bloc 0.5)

| #                         | Migration                                                                                                                                                                                                | Contenu                  | Bloc |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---- |
| `0001_extensions`         | `create extension` (postgis, pg_trgm, pgcrypto, citext) + rôle `djafat_ledger`                                                                                                                           | 0                        |
| `0002_platform`           | `currencies`, `countries`, `cities`, `platform_settings`, `feature_flags`                                                                                                                                | 0                        |
| `0003_identity`           | `roles`, `users` (+ index partiels), `user_roles`, `sessions` (family), `otp_codes`, `phone_auth_locks`, `addresses`                                                                                     | 0                        |
| `0004_system`             | `outbox` (fiabilisé), `audit_logs`, `files`, `idempotency_keys`                                                                                                                                          | 0                        |
| `0005_payment_config`     | `payment_methods`, `payment_providers`, `payment_provider_configs`                                                                                                                                       | 0                        |
| `0006_commerce_rules`     | `commission_rules`, `tax_rules`                                                                                                                                                                          | 0                        |
| `0007_catalog`            | `restaurants`, `restaurant_users`, `restaurant_hours`, `delivery_zones`, `categories`, `products`, `product_option_groups`, `product_options` + FK différées                                             | 0.5 (min.) → 2 (complet) |
| `0008_ledger`             | `ledger_accounts`, `ledger_entry_groups`, `ledger_entries` + révocation `UPDATE/DELETE` + grants `djafat_ledger` ; `wallet_balances`, `wallet_transactions`                                              | 0.5                      |
| `0009_orders`             | `order_status` enum (avec `awaiting_payment`/`expired`), `fulfillment_type`, `orders` (+ `idempotency_key` unique, `expires_at`, snapshots), `order_items`, `order_item_options`, `order_status_history` | 0.5 (min.) → 4 (complet) |
| `0010_promotions`         | `promotions`, `promotion_redemptions`                                                                                                                                                                    | 4                        |
| `0011_payments`           | `payment_status` enum (avec `needs_review`), `payments`, `payment_transactions`, `webhook_events`, `refunds` (+ trigger sur-remboursement), `payment_disputes`                                           | 5                        |
| `0012_finance_settlement` | `settlements`, `settlement_items`, `payouts`, `payout_attempts` + FK ledger différées                                                                                                                    | 5                        |
| `0013_delivery`           | `delivery_status` enum, `couriers`, `courier_shifts`, `deliveries`, `delivery_offers`, `delivery_status_history`, `delivery_locations` (partitionnée) + partitions initiales, `delivery_proofs`          | 6                        |
| `0014_relation`           | `reviews`, `notification_preferences`, `notifications`, `support_tickets`, `ticket_messages`                                                                                                             | 6–7                      |
| `0015_partitions_jobs`    | fonction de création mensuelle de partitions (`delivery_locations`, plus tard `orders`/`ledger_entries`) + purge rétention                                                                               | 6                        |

### 8.3 Modifications proposées vs schéma v1 (pour mémoire — pas d'existant à migrer)

- **Renommage** conceptuel `*_xaf → *_minor` + ajout `currency` sur : `orders`, `order_items`, `order_item_options`, `products`, `product_options`, `delivery_zones`, `promotions`/`promotion_redemptions`, `payments`, `refunds`, `deliveries`, `wallet_*`, `payouts`, `ledger_entries`, `settlements`.
- **Ajouts de tables** : `currencies`, `countries`, `cities`, `platform_settings`, `payment_methods`, `payment_providers`, `payment_provider_configs`, `commission_rules`, `tax_rules`, `webhook_events`, `ledger_accounts`, `ledger_entry_groups`, `settlements`, `settlement_items`, `payout_attempts`, `payment_disputes`, `phone_auth_locks`, `idempotency_keys`.
- **Remplacement** : `ledger_entries.account` (texte) → `account_id → ledger_accounts` ; `wallet_transactions` autonome → projection ; `wallets.balance_xaf` → `wallet_balances.{pending,available}_minor`.
- **Colonnes ajoutées** : `orders.idempotency_key/country_id/city_id/expires_at/commission_bps_snapshot/commission_minor/courier_fee_minor` ; `orders.status` +2 valeurs ; `payments` : `provider_code/method_code/psp_fee_minor/attempt_no/review_reason` + `payment_status` +`needs_review` ; `sessions.family_id` + `refresh_hash` unique ; `outbox` +`status/attempts/last_error/next_attempt_at` ; `restaurants.city_id/country_id/currency` ; `products.name_i18n` (réservé) ; `audit_logs.step_up_verified`.
- **Contraintes ajoutées** : uniques d'idempotence (C7), `unique(provider_code, provider_ref)`, trigger sur-remboursement, `unique(phone) where deleted_at is null`, `unique(refresh_hash)`.

### 8.4 Risques de migration

| Risque                                                             | Niveau        | Traitement                                                                                                                             |
| ------------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Le modèle bouge encore pendant les Blocs 2–5 (catalogue, paiement) | Moyen         | Migrations **expand/contract** ; ne pas figer `0007`/`0009`/`0011` avant leur bloc ; versions « min. » au Bloc 0.5, complétées ensuite |
| Enums PG difficiles à modifier                                     | Faible        | `ADD VALUE` seulement (jamais retirer) ; états prévus larges dès le départ                                                             |
| Partitionnement `delivery_locations` mal calibré                   | Faible        | Partition par jour + job de création anticipée + purge 30 j                                                                            |
| `ledger_entries` volumineuse                                       | Moyen (>10 M) | Index `(account_id, created_at)` ; partition mensuelle prévue (`0015`) ; jamais purgée (archivage froid)                               |
| Grants `djafat_ledger` oubliés → écriture ledger hors module       | Moyen         | `0008` révoque `INSERT/UPDATE/DELETE` au rôle applicatif ; test d'intégration « seul le rôle ledger écrit »                            |
| Devise : ajout d'une 2e devise plus tard                           | Faible        | **Aucune migration de schéma** (générique) — data + tests seulement                                                                    |

### 8.5 Stratégie de migration (évolutions post-Bloc 0)

- **Expand/contract** systématique : (1) ajouter colonne/table nullable + backfill + double écriture ; (2) basculer les lectures ; (3) supprimer l'ancien après une release stable.
- Migrations **rétro-compatibles** obligatoires (déploiement API et migration découplés).
- Étape de migration **verrouillée** en CI/CD (un seul runner), `statement_timeout` court, `lock_timeout` court, `CREATE INDEX CONCURRENTLY` hors transaction.
- Rollback = redeploy du tag précédent + migration `down` testée en staging.
- **PITR** avant toute migration de prod ; test de restauration périodique.

### 8.6 Compatibilité

- **Pas de rétro-compat de données** requise (aucun existant).
- **Rétro-compat d'API** : `/v1` stable ; ajout de provider/pays/devise = non cassant (data-driven + `Money` générique).
- SDK régénéré à chaque release ; incompatibilités attrapées à la compilation des fronts.

### 8.7 Seed Chad / N'Djamena (repris de doc 06 §6.14)

```
currencies:  XAF (exponent 0)
countries:   TD Tchad — currency XAF, locale fr, tz Africa/Ndjamena, dial +235, active
cities:      N'Djamena — country TD, tz Africa/Ndjamena, active
roles:       customer, restaurant_owner, restaurant_staff, courier, admin, super_admin
payment_methods:   cash_on_delivery, mobile_money, card
payment_providers: cash(cash_on_delivery, active) · mock(mobile_money, active non-prod)
                   · airtel_money(mobile_money, INACTIF — accès non vérifié, A1)
                   · moov_money(mobile_money, INACTIF — accès non vérifié, A1)
payment_provider_configs: cash → TD/N'Djamena enabled · mock → TD/N'Djamena enabled (non-prod)
commission_rules:  scope=country TD, rate_bps=2000 (20 %)
tax_rules:         — (0 %)
ledger_accounts:   DJAFAT_BANK, DJAFAT_REVENUE, PSP_FEE_EXPENSE, PSP_CLEARING(mock),
                   CASH_FLOAT, REFUNDS_PAYABLE, PROMO_EXPENSE, CUSTOMER_CLEARING  (currency XAF)
platform_settings: unpaid_order_ttl_seconds        = 900     (global — A4)
                   offer_timeout_seconds           = 30      (global)
                   courier_cash_float_cap_minor     = 200000  (country TD — B3)
                   psp_fee_policy                   = "absorb"                          (global — A2)
                   funds_release_policy             = {trigger:"delivered",delay_hours:0,reserve_percent:0}  (global — A3)
                   courier_compensation_policy       = {type:"delivery_fee"}            (global — A5)
```

---

## 9. Roadmap corrigée (résumé — détail doc 14 §14.3)

```
Bloc 0    Foundations (+ platform : countries/cities/currencies · PgBouncer · idempotence DB · outbox fiable · DAG/lint)
Bloc 0.5  WALKING SKELETON (obligatoire) — 1 resto/1 produit → order (sans montant) → MockProvider auto-success
          → ledger.postEntryGroup équilibré → resto accept → courier accept → delivered → realtime. MockProvider permanent.
Bloc 1    Identity (OTP + lock durable · JWT refresh token family · RBAC + test matriciel · MFA/step-up)
Bloc 2    Catalog (country_id/city_id · horaires en tz ville · search · geo · images)
Bloc 3    Design System SKELETON + Shell (DS complet ∥ ensuite)
Bloc 4    Core Order (pricing autoritaire + commission/taxe résolues · quote indicatif · awaiting_payment + TTL)
Bloc 5    Payment (abstraction corrigée · Cash + Mock + Mobile Money #1 · webhook_events · refunds idempotents · cancel
          · NEEDS_REVIEW · ledger complet : frais PSP + PSP_CLEARING + settlements · payouts manuels) ► revue sécu
Bloc 6    Delivery / Dispatch (garde manipulation frais de livraison)
Bloc 7    Realtime / Notifications
Bloc 8    Customer Web / PWA complet (+ SEO + budgets perf)
Bloc 9    Admin (2FA + step-up · ledger view · settlements · payouts · disputes réservé)
Bloc 10   Restaurant
Bloc 11   Courier
── PILOTE (customer web/PWA + restaurant + livreur + admin) ──
Bloc 12   Native Customer Mobile (post-pilote)
Bloc 13   Hardening / Launch (multi-device · E2E + k6 · OpenTelemetry · runbook DR RPO/RTO · PSP live · soft launch)
```

---

## 10. Décisions A1–A9 — **VERROUILLÉES** (2e passe de validation)

Les 9 arbitrages ci-dessous sont désormais **tranchés et appliqués aux documents**. Ils sont tous **configurables** (aucun n'est figé dans le code) — les valeurs par défaut sont dans `platform_settings` / `payment_provider_configs` / `commission_rules`.

| #      | Décision verrouillée                                                                                                                                                                                                                                                                                                          | Mécanisme de configuration                                                                                                         | Docs                        |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **A1** | **Multi-provider dès la conception ; n'activer que les providers dont l'accès technique ET commercial est vérifié.** Aucune affirmation de disponibilité d'Airtel/Moov au Tchad. MVP = `cash` + `mock` ; ≥ 1 Mobile Money réel activé au Bloc 5 selon dispo. `MockProvider` permanent (CI).                                   | `payment_providers.active` + `payment_provider_configs.enabled` (seed : airtel/moov = INACTIF)                                     | 08 §8.1, 06 §6.14, 14, 15   |
| **A2** | **DJAFAT absorbe les frais PSP** au MVP. Ils sont **comptabilisés séparément** (`PSP_FEE_EXPENSE`), **jamais** nets du revenu (`DJAFAT_REVENUE` = produit brut). Politique modifiable.                                                                                                                                        | `platform_settings['psp_fee_policy']` ∈ `absorb`(défaut)·`pass_through`·`split`                                                    | 08 §8.1 & §8.9, 06, 15 §4.3 |
| **A3** | **`payment success → pending` ; `order delivered → available`.** Règle de libération configurable (délai, réserve, litige, par pays/provider plus tard). Pas de moteur complexe maintenant.                                                                                                                                   | `platform_settings['funds_release_policy']` = `{trigger:'delivered',delay_hours:0,reserve_percent:0}`                              | 08 §8.9, 06, 15             |
| **A4** | **TTL commande impayée = 15 min**, `awaiting_payment → expired`, **100 % serveur**, job **idempotent** (`order-expiry`, garde sur `status='awaiting_payment' AND expires_at<now()`), aucune confiance frontend.                                                                                                               | `platform_settings['unpaid_order_ttl_seconds']` = 900                                                                              | 06, 08 §8.4, 05, 14         |
| **A5** | **`courier compensation = delivery fee`** par défaut. Règle configurable, évolutive (fixe, %, distance, zone, bonus, surge, par ville). Non implémenté maintenant ; l'archi ne bloque pas.                                                                                                                                    | `platform_settings['courier_compensation_policy']` = `{type:'delivery_fee'}` ; `deliveries.courier_fee_minor` figé à l'assignation | 09 §A.4, 06, 15             |
| **A6** | **Hébergement initial : Scaleway (Paris).** **Aucun couplage du code applicatif** : Docker, PostgreSQL standard, Redis standard, stockage **S3-compatible** derrière une interface, IaC + infra documentée → déplacement Hetzner/AWS/Azure/GCP possible.                                                                      | `@djafat/config` (env) + interface `ObjectStoragePort` ; pas de SDK propriétaire Scaleway dans le code métier                      | 05, 02, 13                  |
| **A7** | **Pas de table `markets` au MVP.** Modèle `Country → City`, suffisant pour ouvrir de nouveaux marchés. `markets` ajoutable plus tard si un besoin métier le justifie.                                                                                                                                                         | — (dette D8 assumée)                                                                                                               | 06, 15 §5, 01               |
| **A8** | **`order.city_id = ville du restaurant.** La localité du client **n'est pas déduite** de `city_id` : la commande conserve **séparément** `address_id` + `address_snapshot` (quartier, repère, **lat/lng**, instructions, tél) **+ `delivery_zone_id`**. Le système représente `restaurant city ≠ customer delivery locality`. | `orders.city_id` (resto) + `orders.address_snapshot.geom` + `orders.delivery_zone_id`                                              | 06 §6.6, 08, 01 §6          |
| **A9** | **OTP = SMS au MVP.** Abstraction `OtpDeliveryPort` (impl `sms`) extensible à `whatsapp` / `email` / autre sans changer `auth`. Autres canaux non implémentés maintenant.                                                                                                                                                     | `OtpDeliveryPort` + `platform_settings['otp_channels']` = `['sms']`                                                                | 05 §5.4, 09 §D, 15          |

### Ambiguïtés restantes (n'empêchent pas le Bloc 0 / 0.5)

| #   | Sujet                                                                               | Impact                                                                                                                       | Quand trancher                                                              |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Q1  | **Opérateur Mobile Money réel #1** (Airtel vs Moov vs agrégateur)                   | Contenu du **Bloc 5** uniquement                                                                                             | Dès retour des démarches PSP (en cours, hors chemin critique grâce au Mock) |
| Q2  | **Format des relevés de settlement** du PSP retenu                                  | Détail d'implémentation `payments-reconcile` (Bloc 5)                                                                        | À l'obtention de l'accès PSP                                                |
| Q3  | **Barème exact** frais de livraison / rémunération livreur / min. commande par zone | Données `delivery_zones` + `platform_settings` (pas de schéma)                                                               | Avant le pilote (Bloc 6)                                                    |
| Q4  | **Politique de réserve / anti-fraude sur les payouts** (seuils, délais)             | Config `platform_settings` (pas de schéma)                                                                                   | Avant V1.1 (payouts auto)                                                   |
| Q5  | **Scope pays/ville des utilisateurs internes** (admin régional)                     | Colonnes `user_roles.scope_country_id/scope_city_id` **ajoutées maintenant** ; logique de filtrage = **P2** (avant 2e ville) | Avant le 2e marché                                                          |

---

## 11. Dette technique volontairement conservée

| #   | Dette                                                                              | Pourquoi assumée                                                                            | Coût de remboursement                                                                          | Échéance                   |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------- |
| D1  | **Split payment impossible** (`unique(order_id) where succeeded`)                  | Besoin non prouvé ; simplifie fortement la logique de paiement MVP                          | Retirer la contrainte + modéliser `payment_allocations` + adapter le ledger                    | V2                         |
| D2  | **Pas de moteur de change (FX)**                                                   | Une seule devise réellement en service ; FX = complexité (taux, spreads, arrondis, hedging) | Ajouter `fx_rates` + points de conversion (payout/reporting) ; le modèle `Money` est déjà prêt | V2 (multi-pays effectif)   |
| D3  | **Traduction de contenu non implémentée** (`products.name_i18n` réservé)           | MVP FR-only ; l'AR/RTL est V2                                                               | Remplir `name_i18n` + résolveur de langue côté API/SDK                                         | V2                         |
| D4  | **`capture()` / flux autorisation-capture non réalisé**                            | Mobile Money = `pending→succeeded` direct ; carte = V2                                      | Implémenter `capture()` sur `CardProvider` + états `authorized` actifs                         | V2                         |
| D5  | **Payouts manuels** (déclenchés depuis l'admin)                                    | Volume pilote faible ; réduit le risque financier au lancement                              | Worker `payouts` automatique sur cycle + règles de seuil                                       | V1.1                       |
| D6  | **Réconciliation settlement semi-manuelle** (import déclenché)                     | Formats de relevés PSP inconnus tant que l'opérateur n'est pas choisi                       | Ingestion automatisée + rapport d'écarts programmé                                             | V1.1                       |
| D7  | **`payment_disputes` non câblés**                                                  | Pas de carte au MVP                                                                         | Brancher le webhook de dispute + gel de fonds + issue                                          | V2 (avec carte)            |
| D8  | **`markets` table absente** (country+city seulement)                               | Suffisant pour Tchad + 1re expansion                                                        | Ajouter `markets` + FK + migration de paramètres                                               | Si besoin                  |
| D9  | **Dispatch « plus proche disponible » simple**                                     | Suffisant à faible densité ; l'interface `DispatchStrategy` permet de brancher mieux        | Implémenter le scoring ETA/charge/équité                                                       | V2                         |
| D10 | **Recherche = FTS PostgreSQL** (pas de moteur dédié)                               | Volume catalogue faible ; `pg_trgm` + `tsvector` suffisent                                  | Extraire vers Meilisearch/OpenSearch                                                           | Si latence/qualité l'exige |
| D11 | **`wallet_transactions` = table de projection** (redondante avec `ledger_entries`) | Pagination/relevés partenaires plus simples qu'une vue sur le grand livre                   | La supprimer et la remplacer par une vue si la double écriture pose problème                   | Si incident de cohérence   |

---

## 12. Statut global

**Verdict d'audit : 🟠 GO AVEC CORRECTIONS — corrections P0/P1 appliquées dans la documentation (`DOC`).**
Aucune ligne de code applicatif écrite. Le Bloc 0 **n'est pas démarré**. En attente de relecture et de feu vert du porteur avant l'implémentation.
