# 16 — Validation finale d'architecture (checkpoint avant développement)

> **Checkpoint officiel.** Dernière passe de cohérence sur `01`, `05`, `06`, `07`, `08`, `09`, `14`, `15`.
> Aucune ligne de code. Aucune migration exécutable. Aucun écran. **En attente du feu vert humain explicite** pour lancer le Bloc 0.

---

## A. Verdict

# 🟢 GO WITH CONDITIONS

L'architecture est **cohérente, multi-pays, multi-devise, multi-provider de paiement, financièrement fiable et pragmatique**. Les 9 décisions structurantes sont verrouillées et **toutes configurables** (aucune n'est figée dans le code). Une **erreur d'équilibre comptable** dans l'exemple de référence a été trouvée et **corrigée** (C36). Il reste des **conditions de démarrage** (section H) — organisationnelles et de vérification, pas de refonte.

Ce n'est pas un GO sec parce que 4 conditions non techniques doivent être satisfaites avant/pendant le Bloc 0 (accès PSP lancé, hébergement provisionné, secrets, barèmes zone). Ce n'est pas un NO-GO ni un « GO avec corrections » : les corrections d'architecture sont **faites**.

---

## B. Décisions verrouillées A1 → A9

| #      | Décision                                                                                                                                                                                                                                                                                                                         | Valeur MVP                                                                                                                      | Levier de configuration                                                       | Docs                           |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------ |
| **A1** | **Multi-provider dès la conception.** DJAFAT n'**active** que les providers dont l'accès **technique (API/sandbox)** ET **commercial (contrat)** est effectivement vérifié. Aucune affirmation de disponibilité d'Airtel Money / Moov Money au Tchad. `MockProvider` **permanent** (dev, CI, tests, filet).                      | `cash` + `mock` actifs ; `airtel_money`/`moov_money` **INACTIF** ; ≥ 1 Mobile Money réel activé au Bloc 5 selon dispo constatée | `payment_providers.active`, `payment_provider_configs.enabled`                | 08 §8.1 · 06 §6.14 · 01 §6     |
| **A2** | **DJAFAT absorbe les frais PSP** au MVP. **Comptabilisés séparément** (`PSP_FEE_EXPENSE`), **jamais** nets du revenu (`DJAFAT_REVENUE` = produit brut). Politique changeable.                                                                                                                                                    | `psp_fee_policy = "absorb"`                                                                                                     | `platform_settings['psp_fee_policy']` ∈ `absorb` \| `pass_through` \| `split` | 08 §8.1/§8.9 · 15 §4.3         |
| **A3** | `payment success → funds pending` ; `order delivered → funds available`. Règle de libération configurable (délai, réserve, litige, par pays/provider plus tard). Pas de moteur complexe maintenant.                                                                                                                              | `{ trigger:"delivered", delay_hours:0, reserve_percent:0 }`                                                                     | `platform_settings['funds_release_policy']`                                   | 08 §8.9 · 06                   |
| **A4** | **TTL commande impayée = 15 min.** `awaiting_payment → expired`, **100 % serveur**, job `order-expiry` **idempotent** (garde `status='awaiting_payment' AND expires_at < now()`), zéro confiance frontend.                                                                                                                       | `unpaid_order_ttl_seconds = 900`                                                                                                | `platform_settings['unpaid_order_ttl_seconds']`                               | 06 · 08 §8.4 · 05 §5.5 · 01 §7 |
| **A5** | **`courier compensation = delivery fee`** par défaut. Configurable et évolutif (`fixed`/`percent`/`distance`/`zone`/`surge`/par ville) sans changement de schéma. `deliveries.courier_fee_minor` **figé à l'assignation**.                                                                                                       | `{ "type":"delivery_fee" }`                                                                                                     | `platform_settings['courier_compensation_policy']`                            | 09 §A.4 · 06                   |
| **A6** | **Hébergement initial : Scaleway (Paris).** **Aucun couplage du code** : Docker, PostgreSQL/Redis standard, stockage **S3-compatible** derrière `ObjectStoragePort` (aucun SDK propriétaire dans le métier), config par env (`@djafat/config`), IaC + runbook. Déplacement Hetzner/AWS/Azure/GCP = IaC + endpoints, pas le code. | Scaleway Paris                                                                                                                  | `@djafat/config`, `ObjectStoragePort`                                         | 05 §5.4 · 02 · 13              |
| **A7** | **Pas de table `markets`** au MVP. Modèle **`Country → City`**, suffisant pour ouvrir de nouveaux marchés. `markets` ajoutable si un besoin métier l'exige (dette D8).                                                                                                                                                           | —                                                                                                                               | —                                                                             | 06 · 15 §5 · 01 §6             |
| **A8** | **`order.city_id` = ville du restaurant.** La localité de livraison du client est portée **séparément** : `address_id` + `address_snapshot` (**geom lat/lng**, quartier, repère, instructions, tél) + `delivery_zone_id`. `restaurant city ≠ customer delivery locality` est représentable.                                      | —                                                                                                                               | `orders.city_id` + `orders.address_snapshot.geom` + `orders.delivery_zone_id` | 06 §6.6 · 07 §7.6 · 01 §6      |
| **A9** | **OTP = SMS** au MVP. Port dédié **`OtpDeliveryPort`** (impl `sms` via `SmsProvider`), extensible `whatsapp`/`email`/autre **sans changer `auth`**.                                                                                                                                                                              | `otp_channels = ["sms"]`                                                                                                        | `platform_settings['otp_channels']` + `OtpDeliveryPort`                       | 05 §5.4 · 09 §D.2              |

---

## C. Contradictions trouvées lors de la passe de cohérence

| #   | Document                  | Problème                                                                                                                                                                                | Correction appliquée                                                                                                                                                                                                                                                                                                                                                 | Priorité                             |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| X1  | `08` §8.9 **+** `15` §4.3 | **Erreur d'équilibre comptable.** L'exemple 10 000 XAF créditait `DJAFAT_REVENUE` de **2 250** (marge _nette_) → `Σcrédit = 6 400 + 1 200 + 2 250 = 9 850 ≠ Σdébit = 10 000`.           | `DJAFAT_REVENUE` crédité du **produit brut 2 400** ; `PSP_FEE_EXPENSE 150` reste une **charge distincte** au débit ; marge nette 2 250 = compte de résultat (`REVENUE − PSP_FEE`), **pas** une écriture. Exemple ré-écrit **groupe par groupe avec `Σdébit = Σcrédit` explicite + contrôle global des soldes**. Le cas **Cash** était déjà juste (pas de frais PSP). | **P0** (doc) — **corrigé**           |
| X2  | `07` §7.1                 | Le code d'erreur `PRICE_MISMATCH` était listé comme « obsolète » — vestige d'une conception où le client envoyait un total.                                                             | Supprimé. Remplacé par `AMOUNT_NOT_ACCEPTED` (422 si un champ monétaire est soumis sur `POST /orders`). `POST /orders` documente « le client transmet des **références et des choix**, jamais un montant ».                                                                                                                                                          | **P1** — corrigé                     |
| X3  | `06` `orders`             | La machine à états commande n'était écrite **nulle part** de façon canonique (seul le happy-path figurait en prose dans `01`). Risque : « états impossibles » implémentés différemment. | **Table de transitions canonique** (13 états, transitions **autorisées** ET **interdites**) ajoutée en commentaire du type `order_status` (`06` §6.6). Référencée depuis `01` §7 et `05` §5.4.                                                                                                                                                                       | **P1** — corrigé                     |
| X4  | `06` `orders` / A8        | `A8` (city_id = ville resto, localité client séparée) était une recommandation ambiguë, pas dans le schéma.                                                                             | `orders.delivery_zone_id` ajouté ; commentaire A8 explicite dans `06` ; `07 §7.6` précise `order.city_id = ville resto`.                                                                                                                                                                                                                                             | **P1** — corrigé (C37)               |
| X5  | Multi-pays / RBAC         | Aucun **scope pays/ville** pour les utilisateurs internes → faille cross-country latente + migration future certaine.                                                                   | `user_roles.scope_country_id` / `scope_city_id` (nullable = global) **ajoutés dès le Bloc 1** ; MVP = admins globaux ; **filtrage** des listes admin = **P2** (avant 2e marché).                                                                                                                                                                                     | **P1** schéma / **P2** logique (C35) |
| X6  | A2/A3/A5/A9               | Décisions verrouillées mais **non matérialisées** (pas de clé de config).                                                                                                               | Seed `platform_settings` : `psp_fee_policy`, `funds_release_policy`, `courier_compensation_policy`, `otp_channels`.                                                                                                                                                                                                                                                  | **P0** seed (C38)                    |
| X7  | A6/A9                     | Abstractions revendiquées mais **non nommées** comme ports.                                                                                                                             | `ObjectStoragePort` (A6) et `OtpDeliveryPort` (A9) posés au Bloc 0/1.                                                                                                                                                                                                                                                                                                | **P1** (C39)                         |

### Passe de cohérence — points **vérifiés conformes** (aucune contradiction)

| Domaine      | Vérifié                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Résultat                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Money**    | Plus aucune conception structurante dépendant de `amountXaf` / `*_xaf`. Tout est `Money { minor, currency }` ; colonnes `*_minor` + `currency` sur toutes les tables financières ; `minor` sérialisé **string** en JSON ; garde « une seule devise par ligne » (`CURRENCY_MISMATCH`). Lint interdit tout champ portant une devise dans son nom.                                                                                                                                                        | ✅ (les occurrences résiduelles de `_xaf` dans les docs sont des **mentions historiques** — « fin des `*_xaf` », tableau de migration — pas des définitions) |
| **Payment**  | `PaymentProvider` ↔ `ProviderCapabilities` ↔ `payment_methods`/`payment_providers`/`payment_provider_configs` ↔ `payments` ↔ `webhook_events` ↔ `refunds` ↔ `settlements` : cohérents. Aucune couche ne contourne `PaymentProvider` (registry data-driven, aucun `switch` provider ; le cœur ne connaît que `PaymentPort`).                                                                                                                                                                      | ✅                                                                                                                                                           |
| **Ledger**   | Écrivain unique = module `ledger` (grants SQL `djafat_ledger`, `UPDATE/DELETE` révoqués). Modules métier → `LedgerPort.postEntryGroup()` uniquement. `wallet_balances`/`wallet_transactions` = **projections** dans la même transaction, jamais 2e source de vérité. Écritures équilibrées (`∑debit = ∑credit` par groupe + devise), immuables (correction = `adjustment`), groupes idempotents (`ledger_entry_groups.idempotency_key` unique). Invariant testé en CI (`ledger-assert`) + job horaire. | ✅ (après correction X1)                                                                                                                                     |
| **Orders**   | 13 états, machine canonique (X3). Aucun état impossible documenté. `awaiting_payment` (prépayé) vs `placed` direct (COD). Restaurant notifié **seulement à `placed`**. `expired` via job idempotent A4.                                                                                                                                                                                                                                                                                                | ✅                                                                                                                                                           |
| **Realtime** | `realtime` n'est **jamais** source de vérité : tous les événements dérivent de l'**outbox** (écrit dans la transaction métier). Client se désabonne des rooms terminées. Fallback polling documenté.                                                                                                                                                                                                                                                                                                   | ✅                                                                                                                                                           |
| **Outbox**   | `outbox` : transaction DB + `status` (`pending/processing/published/failed`) + `attempts` + `last_error` + `next_attempt_at` + `processed_at` ; relay `FOR UPDATE SKIP LOCKED` + backoff + DLQ + alerte. Idempotence de publication côté consommateurs.                                                                                                                                                                                                                                                | ✅                                                                                                                                                           |
| **Redis**    | Utilisé pour cache, coordination, locks courts, rate limits, rooms WS, transport BullMQ, idempotence **non financière** courte durée. **Jamais** source de vérité financière (celle-ci = contraintes PostgreSQL).                                                                                                                                                                                                                                                                                      | ✅                                                                                                                                                           |

---

## C-bis. Revue spécifique du ledger — exemple 10 000 XAF re-vérifié

```
Hypothèses : subtotal 8 000 · delivery 1 500 · service 500 · TOTAL 10 000
             commission 20%×8 000 = 1 600 · courier 1 200 (= delivery fee, A5) · PSP fee 1,5%×10 000 = 150
             restaurant = 8 000 − 1 600 = 6 400
             DJAFAT produit brut = 1 600 + 500 + 1 500 − 1 200 = 2 400
             marge nette DJAFAT = 2 400 − 150 = 2 250          (P&L, PAS une écriture)

G1 order_accrual   DÉBIT  PSP_CLEARING 9 850 + PSP_FEE_EXPENSE 150                 = 10 000
                   CRÉDIT RESTAURANT_PAYABLE 6 400 + COURIER_PAYABLE 1 200 + DJAFAT_REVENUE 2 400 = 10 000  ✔
G2 funds_available DÉBIT  RESTAURANT_PAYABLE 6 400 + COURIER_PAYABLE 1 200         = 7 600
                   CRÉDIT RESTAURANT_AVAILABLE 6 400 + COURIER_AVAILABLE 1 200     = 7 600  ✔
                   → passif→passif : AUCUN argent créé (total passif inchangé)
G3 settlement      DÉBIT  DJAFAT_BANK 9 850   CRÉDIT PSP_CLEARING 9 850            9 850 = 9 850  ✔
G4 payout resto    DÉBIT  RESTAURANT_AVAILABLE 6 400   CRÉDIT DJAFAT_BANK 6 400    6 400 = 6 400  ✔

Contrôle global après G1..G4 :
  Actifs  : DJAFAT_BANK +3 450 · PSP_CLEARING 0
  Passifs : COURIER_PAYABLE +1 200 (payout livreur non émis) · RESTAURANT_* 0
  Résultat: DJAFAT_REVENUE +2 400 − PSP_FEE_EXPENSE 150 = +2 250
  Actif (3 450) = Passif (1 200) + Résultat (2 250)  →  3 450 = 3 450  ✔
```

**Éléments vérifiés** : PSP fees (charge séparée) · restaurant payable/available · courier payable/available · DJAFAT revenue (brut) · PSP clearing (soldé par settlement) · settlement · payout · refund (contre-écritures + `REFUNDS_PAYABLE`). **`pending → available` ne crée pas d'argent** : reclassement entre deux comptes de passif, vérifié en CI par `ledger-assert`.

---

## C-ter. Revue multi-pays

Ouvrir un 2e pays = **INSERT**, aucune refonte structurelle :

```
INSERT currencies (si nouvelle devise — ex. XOF, exponent 0)
INSERT countries  (iso_code, currency, default_locale, timezone, dial_code, active)
INSERT cities     (country_id, timezone, active)
INSERT payment_provider_configs (providers dispos dans ce pays)
INSERT commission_rules / tax_rules (scope country/city)
INSERT platform_settings (overrides scope country/city si besoin)
+ traductions i18n
```

Vérifié : `currency` **explicite** sur toute table financière · `timezone` **explicite** (`countries` + `cities`, horaires interprétés dans `cities.timezone`) · `country_id`/`city_id` présents sur `restaurants`, `orders`, `delivery_zones`, `promotions` (+ `users.country_id`, `couriers.city_id`, `addresses.city_id`) · règles commerciales (`commission_rules`, `tax_rules`, `platform_settings`) configurables par pays/ville. **Aucun code métier ne suppose `Chad`/`XAF`/`N'Djamena`** — seed uniquement (`06` §6.14). Dette assumée : pas de moteur FX (D2), pas de table `markets` (A7/D8).

---

## C-quater. Revue API

- `POST /v1/orders` : **n'accepte aucun montant** (422 `AMOUNT_NOT_ACCEPTED`). Le serveur (`pricing`) calcule/fige `subtotal`, `deliveryFee`, `serviceFee`, `tax`, `discount`, `commission` (snapshot), `courierFee`, `total`. Le client transmet **références et choix** (produits, options, adresse, promo, moyen de paiement). ✅ cohérent avec `06` §6.11.
- `GET /v1/config/payment-methods` : résout via `payment_provider_configs` (pays/ville/zone/resto, `enabled`, validité, plage, devise) → `{ method, provider, capabilities }`. ✅
- `POST /v1/payments` · `GET /v1/payments/:id` · `POST /v1/payments/:id/retry` · `POST /v1/payments/:id/cancel` · `POST /v1/payments/webhook/:provider` · `POST /v1/admin/payments/:id/refund` (**Idempotency-Key + step-up**) : présents, scoping documenté. ✅
- Réconciliation / settlements : `GET /v1/admin/settlements[/:id]`, `POST /v1/admin/settlements/import` (step-up), `GET /v1/admin/ledger/{accounts,entries}`. ✅
- Payouts : `GET/POST /v1/{restaurant,courier}/payouts` (Idempotency-Key) ; `POST /v1/admin/payouts/:id/{approve,retry}` (step-up). ✅
- **Scopes/permissions** : table de portée (`self`, `owns-order`, `resto-scope`, `courier-self`, `admin`, `admin+stepup`, `public`) + colonne portée sur **chaque** endpoint. ✅
- Money en JSON : `{ "minor": "<string>", "currency": "<ISO>" }`. ✅
- Versionnement `/v1`, `Deprecation`/`Sunset`, ajout provider/pays/devise **non cassant**. ✅

---

## D. Risques restants (réellement importants)

| #   | Risque                                                                                                   | Sev | Nature                    | Mitigation / suivi                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------- | --- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Accès Mobile Money réel #1** (sandbox, API, contrat, format de settlement) inconnu                     | 🟠  | Externe / organisationnel | Hors chemin critique grâce au `MockProvider` permanent ; démarches à lancer **maintenant** (condition H1) ; le Bloc 5 attend cette info pour son contenu, pas le Bloc 0 |
| R2  | **Suivi position livreur en arrière-plan** coupé par OEM Android (Tecno/Infinix/Xiaomi) / permission iOS | 🟠  | Technique                 | Foreground service + repli à l'ouverture ; à **prototyper tôt** sur de vrais téléphones (Bloc 6)                                                                        |
| R3  | **Adressage informel à N'Djamena** (OSM incomplet)                                                       | 🟠  | Contexte                  | Repère + tél en champs de 1er plan (`address_snapshot`) ; base `landmarks` ; `A8` sépare bien ville resto / localité client                                             |
| R4  | **Coût & délivrabilité SMS** (OTP + critique)                                                            | 🟠  | Externe                   | SMS = critique uniquement ; plafond/commande + monitoring coût/jour ; `OtpDeliveryPort` prêt pour WhatsApp/vocal si besoin                                              |
| R5  | **Bug du projecteur ledger** (projections ≠ grand livre)                                                 | 🟠  | Technique                 | Projections écrites dans la **même transaction** que l'`entry_group` ; `ledger-assert` en CI + horaire ; grand livre = vérité, projection reconstructible               |
| R6  | **Lag de settlement / visibilité de trésorerie** (cash chez le PSP non réconcilié)                       | 🟠  | Financier                 | `PSP_CLEARING` explicite ; `settlements` + écarts alertés ; réconciliation semi-manuelle assumée MVP (D6)                                                               |
| R7  | **Discipline des frontières de modules** dans la durée (le DAG dérive si non outillé)                    | 🟠  | Organisationnel           | `eslint-plugin-boundaries` **dès le Bloc 0** ; revue d'archi sur tout nouveau module ; tests de contrat par port                                                        |
| R8  | **Dette multi-devise latente** (1 seule devise réellement testée)                                        | 🟡  | Assumé (D2)               | Modèle générique en place ; ajout d'une 2e devise = data + tests, pas de migration                                                                                      |
| R9  | **Manipulation des frais de livraison** via coordonnées client                                           | 🟡  | Sécurité                  | C23/P2 : frais par **paliers de zone** au MVP + recalcul à l'assignation ; `orders.delivery_zone_id` tracé                                                              |
| R10 | **Gestion du cash livreur** (float, vol, non-reversement)                                                | 🟠  | Business                  | `courier_cash_float_cap_minor` + blocage au-delà ; `CASH_FLOAT` au ledger ; réconciliation quotidienne ; caution/contrat                                                |
| R11 | **Réglementaire** (agrément paiement/monnaie électronique, société, fiscalité)                           | 🔴  | Business / juridique      | Conformité portée par le PSP (KYC/AML) ; conseil juridique local **avant go-live** (condition H4)                                                                       |
| R12 | **Liquidité à double face** restaurants ↔ clients ↔ livreurs                                           | 🔴  | Business                  | Lancement hyper-local (1–2 quartiers, 8–15 restaurants signés, livreurs internes) — hors périmètre technique                                                            |

> Les risques purement techniques du 1er audit (T2 cohérence commande/paiement, T10 intégrité financière) sont **fortement mitigés par conception** (idempotence DB, `webhook_events`, `ledger` écrivain unique, `ledger-assert`) et ne sont plus « importants ».

---

## E. Dette technique assumée (P3 / V2)

| #   | Dette                                                                                | Échéance                   | Coût de remboursement                                                           |
| --- | ------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------- |
| D1  | **Split payment impossible** (`unique(order_id) where succeeded`)                    | V2                         | Retirer la contrainte + `payment_allocations` + adapter le ledger               |
| D2  | **Pas de moteur de change (FX)**                                                     | V2 (multi-pays effectif)   | `fx_rates` + points de conversion (payout/reporting) ; modèle `Money` déjà prêt |
| D3  | **Traduction de contenu** (`products.name_i18n` réservé, non implémenté)             | V2                         | Remplir `name_i18n` + résolveur de langue API/SDK                               |
| D4  | **`capture()` / autorisation-capture** non réalisé (MM = `pending→succeeded` direct) | V2 (carte)                 | Implémenter `capture()` sur `CardProvider` + états `authorized` actifs          |
| D5  | **Payouts manuels** (déclenchés depuis l'admin)                                      | V1.1                       | Worker `payouts` automatique + seuils                                           |
| D6  | **Réconciliation settlement semi-manuelle** (import déclenché)                       | V1.1                       | Ingestion automatisée + rapport d'écarts programmé (dépend du format PSP)       |
| D7  | **`payment_disputes` non câblés** (structure réservée)                               | V2 (carte)                 | Webhook dispute + gel de fonds + issue                                          |
| D8  | **Pas de table `markets`** (Country → City seulement)                                | Si besoin métier           | Ajouter `markets` + FK + migration de paramètres                                |
| D9  | **Dispatch « plus proche disponible »** simple                                       | V2                         | Scoring ETA/charge/équité derrière `DispatchStrategy` (interface déjà prévue)   |
| D10 | **Recherche = FTS PostgreSQL** (`pg_trgm` + `tsvector`)                              | Si latence/qualité l'exige | Extraire vers Meilisearch/OpenSearch                                            |
| D11 | **`wallet_transactions` = table de projection** (redondante avec `ledger_entries`)   | Si incident de cohérence   | Remplacer par une vue                                                           |
| D12 | **Filtrage admin par pays/ville** non implémenté (colonnes présentes)                | Avant le 2e marché         | Brancher le scope dans `common/rbac` (C35)                                      |

---

## F. Bloc 0 readiness

# READY (sous conditions H1–H4)

Le périmètre du Bloc 0 est **précisément défini** (section suivante), **exécutable** par l'équipe, et **ne contient aucune fonctionnalité métier**. Les conditions H1–H4 sont **organisationnelles** (elles n'empêchent pas de commencer le Bloc 0, elles doivent être lancées **en parallèle**).

### Ce que le Bloc 0 doit produire (définition officielle — à implémenter uniquement après feu vert)

**1. Monorepo & outillage**

- `git init` ; **pnpm** workspaces + **Turborepo** ; **TypeScript strict** partagé (`packages/tsconfig`) ; **ESLint** partagé + **`eslint-plugin-boundaries`** (DAG de modules) + règle « aucun champ `*Xaf` / devise dans un nom » ; **Prettier** ; Husky + lint-staged + **commitlint** ; **Changesets**.
- CI GitHub Actions : `lint · typecheck · test · build` (Turborepo, projets affectés) — verte à vide.

**2. Structure `apps/` + `packages/` (squelettes vides, pas de métier)**

- `apps/` : `api` (NestJS/Fastify), `worker` (BullMQ, même code, autre entrypoint), `web` (Next.js — shell + tokens câblés), `mobile` (Expo — bootstrap seul), `admin`/`restaurant` (Next.js — bootstrap).
- `packages/` : `types` (`Money`, `ProviderCapabilities`, enums `OrderStatus`/`PaymentStatus`/`DeliveryStatus`, `LedgerAccountCode`), `validation` (Zod — setup + 1 schéma pilote), `core` (**`Money` + arithmétique testée**, 1 machine à états pilote), `sdk` (client HTTP typé — squelette), `tokens`, `i18n` (FR), `config` (validation env), `eslint-config`, `tsconfig`, `testing`.

**3. Infra locale & exécution**

- `docker-compose` : PostgreSQL 16 **+ PostGIS**, **PgBouncer** (transaction pooling), Redis, MinIO (S3-compatible), **mock-SMS**, **mock-PSP**, Mailhog.
- `@djafat/config` : l'API **refuse de démarrer** si une variable requise manque. `.env.example` par app.
- `ObjectStoragePort` (interface + impl S3-compatible) — **aucun SDK propriétaire** (A6).
- `OtpDeliveryPort` (interface + impl `sms` sur mock-SMS) — (A9).

**4. Socle `common/` de l'API**

- `logging` (pino + `traceId`), `errors` (filtre → `{error:{code,message,details,traceId}}`), `validation` (`ZodValidationPipe` global), `money` (type + garde « 1 devise/ligne »), **`idempotency`** (helper DB-backed + table `idempotency_keys`), `rate-limit` (token bucket Redis), `openapi` (Swagger), `/health` + `/ready`.
- **Observabilité minimale** : pino structuré + `traceId` propagé HTTP→jobs ; hooks Sentry + Prometheus **câblés** (métriques détaillées = plus tard).

**5. Fondation DB + module `platform`** (migrations `0001`–`0006`)

- `0001` extensions + rôle SQL **`djafat_ledger`**.
- `0002` **`currencies`, `countries`, `cities`, `platform_settings`, `feature_flags`** + **seed Tchad / N'Djamena / XAF** + clés `platform_settings` (`unpaid_order_ttl_seconds=900`, `psp_fee_policy=absorb`, `funds_release_policy`, `courier_compensation_policy`, `otp_channels`, `offer_timeout_seconds`, `courier_cash_float_cap_minor`).
- `0003` `roles`, `users` (+ index partiels + anonymisation), `user_roles` (**+ `scope_country_id`/`scope_city_id`**), `sessions` (**token family** + `refresh_hash` unique), `otp_codes`, `phone_auth_locks`, `addresses`.
- `0004` **`outbox` fiabilisé** (`status`/`attempts`/`last_error`/`next_attempt_at`/`processed_at`) + `outbox-relay` (worker, `FOR UPDATE SKIP LOCKED`), `audit_logs` (+ `step_up_verified`), `files`, `idempotency_keys`.
- `0005` **`payment_methods`, `payment_providers`, `payment_provider_configs`** + seed (`cash`/`mock` actifs ; `airtel_money`/`moov_money` **INACTIF**).
- `0006` **`commission_rules`, `tax_rules`** + seed (commission country TD 2000 bps ; tax vide).
- Résolveurs `platform` : `MarketConfigPort`, `PaymentMethodResolverPort`, `CommissionResolverPort`, `TaxResolverPort` (implémentés — ils sont de la **config**, pas du métier).

**6. Architecture initiale des modules**

- Dossiers de modules créés avec le **DAG documenté** (doc 05 §5.3) et le lint de frontières **actif** ; ports déclarés (`OrderAmountPort`, `LedgerPort`, `PaymentPort`, …) même si vides.

**Ne PAS faire au Bloc 0** : auth réelle, catalogue, commande, paiement, livraison, écrans métier, machine à états complète, tout ce qui est ≥ Bloc 1.

---

## G. Bloc 0.5 readiness

# READY

Le flux du Walking Skeleton est **précis, de bout en bout, testable, sans dépendance PSP réelle**.

### Flux minimal (doit réellement fonctionner de bout en bout)

```
Customer (seed)  →  Restaurant (seed, 1)  →  Product (seed, 1)  →  Cart (client)
  → POST /v1/orders (Idempotency-Key DB, AUCUN montant ; pricing minimal : subtotal + frais fixe + commission résolue)
     · methodCode='mock' → order.status = 'awaiting_payment', expires_at
  → POST /v1/payments {orderId, methodCode:'mock', providerCode:'mock'}
     · MockPaymentProvider.getCapabilities() → { async:false, ... }
     · MockPaymentProvider.initiate() → status:'succeeded' (déterministe, synchrone)
  → transaction : payments.status='succeeded'
                  + LedgerService.postEntryGroup('order_accrual', idem='payment:<id>')  [Σdébit = Σcrédit]
                  + projections wallet_balances (resto/livreur pending)
                  + outbox('payment.succeeded')
  → outbox-relay → orders (abonné) : 'awaiting_payment' → 'placed'
  → POST /v1/restaurant/orders/:id/accept   → 'confirmed'  (état ; UI triviale ou curl)
  → POST /v1/courier/offers/:id/accept       → delivery 'assigned'
  → POST /v1/courier/deliveries/:id/picked-up → 'picked_up'
  → POST /v1/courier/deliveries/:id/delivered → 'delivered'
     + LedgerService.postEntryGroup('funds_available', idem='order:<id>:available')  [passif→passif]
  → realtime : order.status poussé sur room order:{id}  (dérivé de l'outbox)
  → order 'delivered' (terminal)

CI : test E2E de ce flux + assertion ledger-assert (Σdébit=Σcrédit sur chaque groupe ;
     wallet_balances == somme des ledger_entries).
```

### `MockPaymentProvider` — contrat

- **Permanent** (jamais retiré) ; vit dans `apps/api/src/modules/payments/providers/mock/`.
- **Déterministe** : succès immédiat par défaut ; comportements pilotables par `metadata` de la requête ou par des `feature_flags` de test (`mock_payment_outcome` ∈ `succeed`/`fail`/`pending_then_succeed`/`timeout`) pour tester `FAILED`, `EXPIRED`, `NEEDS_REVIEW`, webhook différé.
- **Testable** : `getCapabilities()` complet ; `initiate`/`getStatus`/`verifyAndParseWebhook`/`cancel`/`refund` implémentés ; un endpoint de test `POST /v1/payments/webhook/mock` simule un webhook signé.
- **Utilisé dans CI et en dev** ; **jamais activé en `payment_provider_configs` pour un environnement de production**.

---

## H. Conditions de démarrage

À satisfaire **avant / en parallèle** du Bloc 0 (aucune n'est un blocage technique du Bloc 0 lui-même, mais toutes doivent être **lancées** au feu vert) :

| #      | Condition                                                                                                                                                                                    | Responsable       | Échéance                   | Bloque quoi                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------- | ----------------------------------------------- |
| **H1** | **Lancer les démarches d'accès PSP Mobile Money** (≥ 1 opérateur ou agrégateur : compte, sandbox, doc API, format de settlement, conditions commerciales)                                    | Porteur / BizDev  | Dès J0                     | Le **contenu** du Bloc 5 (pas le Bloc 0–4)      |
| **H2** | **Provisionner l'hébergement** : compte Scaleway (Paris), projet, PostgreSQL managé + PgBouncer, Redis managé, Object Storage (bucket), DNS `djafat.com` + sous-domaines, TLS                | Porteur / DevOps  | Avant fin Bloc 0 (staging) | Le **déploiement staging** de fin de Bloc 0     |
| **H3** | **Secret manager** choisi et provisionné (Scaleway Secret Manager / Doppler / Vault) + politique de rotation ; **aucun secret dans le repo** ; `gitleaks` en CI                              | DevOps            | Bloc 0                     | Toute intégration externe (SMS, PSP, storage)   |
| **H4** | **Cadrage juridique/paiement** : statut de l'entité DJAFAT, éligibilité à contracter un PSP, obligations KYC/AML, protection des données, fiscalité (`tax_rules`)                            | Porteur / conseil | Avant go-live (Bloc 13)    | La **mise en production** des paiements réels   |
| **H5** | **Barèmes opérationnels** : frais de livraison par zone, minimum de commande, rémunération livreur, plafond de float — valeurs concrètes pour le seed `delivery_zones` / `platform_settings` | Porteur           | Avant Bloc 6 (pilote)      | Le **pilote** (données, pas schéma)             |
| **H6** | **Comptes stores** : Google Play (25 $ une fois), Apple Developer (99 $/an)                                                                                                                  | Porteur           | Avant Bloc 11              | Publication mobile (post-pilote pour le client) |
| **H7** | **Décision « qui porte les frais de livraison exacts » et politique de réserve payout** (défauts A2/A3 posés ; valeurs fines à confirmer)                                                    | Porteur           | Avant V1.1                 | Payouts automatisés (V1.1)                      |

### Conditions **satisfaites** (rien à faire)

- Décisions A1–A9 : **verrouillées et documentées**.
- Contradictions d'architecture : **corrigées** (C36 inclus).
- Modèle financier, multi-pays, payment provider, DAG backend : **spécifiés et cohérents**.
- Classification P0/P1/P2/P3 : **resserrée** (P0 = socle/schéma uniquement).
- Plan de migration : **ordonné** (`0001`–`0015`), stratégie expand/contract, seed défini.

---

## I. Classification finale P0 / P1 / P2 / P3

> **P0** = doit exister dans le socle/schéma fondateur **avant la 1re migration** (types, tables de référence, règles d'architecture, seed). **Jamais** de logique métier ni de V2.

### P0 — dans le Bloc 0 (schéma + types + règles + seed)

C2 (`Money` générique + `currencies`) · C4 (`countries`/`cities` + `country_id`/`city_id`) · C3-schéma (`payment_methods`/`payment_providers`/`payment_provider_configs` + seed) · C5-schéma (`commission_rules`/`tax_rules` + seed) · C6-schéma (`ledger_*` + grants `djafat_ledger` + révocation UPDATE/DELETE) · C7 (idempotence durable : contraintes + `idempotency_keys` + helper) · C8 (DAG + `eslint-plugin-boundaries` + ports vides) · C20 (`outbox` fiabilisé + relay) · C1-types (`Money`, `ProviderCapabilities`, enums) · C38 (seed `platform_settings`) · C36 (exemple ledger corrigé — doc).

### P0 — dans le Bloc 0.5 (colonne vertébrale)

C6-service (`LedgerService.postEntryGroup` + projections + équilibre + idempotence) · C21 (Walking Skeleton + `MockPaymentProvider` permanent) · C31 (assertion `ledger-assert` en CI).

### P1 — avant le bloc concerné

C1-impl (interface + registry + providers — Bloc 5) · C3-logique (résolveur + `GET /config/payment-methods` — Bloc 5) · C5-logique (résolveur commission/taxe + snapshot — Bloc 4) · C9 (`webhook_events` + `provider_ref` unique — Bloc 5) · C10 (refunds idempotents + garde — Bloc 5) · C11 (`NEEDS_REVIEW` — Bloc 5) · C12 (`awaiting_payment` + TTL `order-expiry` — Bloc 4) · C13 (PSP clearing + settlement — Bloc 5) · C14 (`cancel()` + endpoint — Bloc 5) · C15 (payouts + `payout_attempts` — Bloc 5) · C16 (fuseau horaire horaires resto — Bloc 2) · C17 (token family — Bloc 1) · C18 (`phone_auth_locks` — Bloc 1) · C19 (admin 2FA + step-up — Bloc 1/9) · C22 (PgBouncer — Bloc 0/infra) · C30 (test matriciel RBAC — Bloc 1) · C35-schéma (`user_roles.scope_country_id/city_id` — Bloc 1) · C37 (`orders.delivery_zone_id` + A8 — Bloc 4) · C39 (`ObjectStoragePort`/`OtpDeliveryPort` — Bloc 0/1).

### P2 — avant production (pilote)

C23 (garde manipulation frais de livraison — Bloc 6) · C24 (`payment_disputes` table réservée — Bloc 5) · C25 (anti-stampede cache — Bloc 2) · C26 (OpenTelemetry — Bloc 13) · C27 (runbook DR + RPO/RTO — Bloc 13) · C28 (load tests k6 — Bloc 13) · C29 (soft-delete vs `phone` unique — Bloc 1) · C35-logique (filtrage admin par pays/ville — avant 2e marché).

### P3 — futur (post-pilote / V2)

C32 (traduction de contenu) · C33 (`capture()` réel) · C34 (split payment) · + dette D1–D12 (section E).

---

## J. Confirmation

- **Verdict** : 🟢 **GO WITH CONDITIONS** (conditions H1–H7, aucune n'est une refonte).
- **Bloc 0** : **READY** — périmètre défini (section F), n'inclut aucune fonctionnalité métier.
- **Bloc 0.5** : **READY** — flux de bout en bout défini, `MockPaymentProvider` permanent spécifié.
- **Cohérence** : passe effectuée sur `01`, `05`, `06`, `07`, `08`, `09`, `14`, `15` ; 7 contradictions trouvées, **toutes corrigées** (dont l'équilibre du grand livre — C36).
- **Prochaine action** : **relecture humaine** de ce checkpoint + des documents révisés, puis **décision séparée** de lancer (ou non) le Bloc 0.

**NE PAS démarrer le Bloc 0 sans feu vert explicite du porteur.**
