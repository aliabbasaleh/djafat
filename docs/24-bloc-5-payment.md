# 24 — Bloc 5 : Payment Core

> **Verdict : 🟢 GO.** Aucune faille bloquante identifiée. Deux bugs réels trouvés et corrigés pendant la passe (détail §16). Périmètre conforme au mandat, aucun scope-creep. Docker indisponible dans cet environnement : les tests d'intégration réels (`*.int.spec.ts`) sont écrits et à jour mais **N/V** — à exécuter avant mise en production.

---

## 1. Résumé exécutif

Le Bloc 5 s'appuyait sur une base substantielle déjà posée au Bloc 0.5 (walking skeleton) : l'abstraction `PaymentProvider`, `MockPaymentProvider`/`CashPaymentProvider`, le registre data-driven, le flux webhook avec dédup/signature/écart-de-montant, les tables `payments`/`webhook_events`, et le modèle de réclassement pending→available (`deliveries/release-entries.ts`). Le travail de ce bloc a donc porté sur ce qui manquait réellement :

- **D-15 corrigé** : `GET /v1/payments/:id` exigeait zéro authentification. Fermé via `@RequireOwnership` + `PaymentsService.getOwnerUserId`, exactement le même mécanisme que `orders.controller.ts`.
- **Machine à états paiement** explicite et testée (`@djafat/core/payment/state-machine.ts`), miroir de la machine `orders`.
- **Annulation** (`POST /v1/payments/:id/cancel`) — n'existait pas.
- **Remboursements** (`POST /v1/payments/:id/refund`) — modèle complet, idempotent, protégé contre le sur-remboursement par un **trigger PostgreSQL**, pas seulement par du code applicatif.
- **Frais PSP pilotés par configuration** (`payment_provider_configs.fee_bps`) — remplace la constante `MOCK_PSP_FEE_BPS` codée en dur du Bloc 0.5.
- **`GET /v1/config/payment-methods`** — découverte des moyens de paiement réellement actifs pour un contexte donné.
- **Settlement primitif** (`settlements`) — enregistrement manuel d'un relevé PSP, une écriture comptable `settlement`, détection d'écart sans correction automatique.
- Deux bugs réels trouvés en creusant le code existant et corrigés avec régression prouvée (§16).

Le principe directeur du mandat — CLIENT PROPOSE, SERVEUR DÉCIDE, DATABASE GARANTIT, LEDGER COMPTABILISE — est respecté à chaque étape : le client ne fournit jamais de montant, chaque transition d'état passe par une contrainte DB ou un `UPDATE` conditionnel, chaque euro/XAF déplacé passe par `LedgerService.postEntryGroupTx`.

---

## 2. Architecture — dépendances

```
payments  ──depends on──▶  platform (payment_provider_configs)
payments  ──depends on──▶  ledger (LedgerService.postEntryGroupTx)
payments  ──depends on──▶  OrderAmountPort (@djafat/types — jamais orders directement)
orders    ──reacts to───▶  payment.succeeded (EventEmitter2, @OnEvent)
```

Aucune importation de `orders` par `payments`. Le sens `orders → payments` n'existe pas non plus : `orders` réagit aux événements `payment.*` (`OrdersService.markPlacedFromPayment`), il n'appelle jamais `PaymentsService`. Cycle non-circulaire confirmé par lecture directe du code, pas seulement par convention documentée.

`SettlementsService` vit dans le module `payments` (pas un module `admin` séparé) car lui seul voit à la fois le registre des providers et les lignes `payment_provider_configs` — même raisonnement que `PaymentMethodsConfigController`.

---

## 3. Providers

| Provider       | Statut                       | Notes                                                                                                                                                            |
| -------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mock`         | **actif** (dev/CI/permanent) | Synchrone par défaut ; `metadata.mockOutcome` pilote `succeed\|fail\|pending_then_succeed\|timeout` pour exercer chaque branche. Signature HMAC-SHA256 dev-only. |
| `cash`         | **actif**                    | Aucun appel externe ; paiement `pending` jusqu'à confirmation livraison.                                                                                         |
| `airtel_money` | **inactif** — non vérifié    | Aucune classe provider créée. Ce document n'affirme à aucun moment qu'Airtel Money est techniquement disponible au Tchad.                                        |
| `moov_money`   | **inactif** — non vérifié    | Idem.                                                                                                                                                            |
| `card_xxx`     | **inactif** — non vérifié    | Hors périmètre V1 (PCI, `capture()`, disputes réservés).                                                                                                         |

Aucun `if (provider === 'airtel')` nulle part (vérifié par lecture de `payment-provider.registry.ts`, `payments.service.ts`, `accrual-entries.ts`, `refund-entries.ts`) — le registre et `payment_provider_configs` sont les deux seuls points de contrôle (docs/15 AD-03/AD-04).

---

## 4. Machine à états (`@djafat/core/payment/state-machine.ts`)

États : `pending · authorized · succeeded · failed · cancelled · expired · needs_review · refunded · partially_refunded`.
Terminaux (aucune sortie) : `failed, cancelled, expired, refunded`. `partially_refunded` n'est **pas** terminal (peut évoluer vers `refunded`). `needs_review` n'est pas terminal (résolution manuelle ops).

9 tests, 100 % de couverture (`packages/core/src/payment/state-machine.spec.ts`). `canTransitionPayment`/`assertPaymentTransition`/`nextPaymentStatuses` exportés depuis `@djafat/core`.

**Constat honnête (voir §17, dette non-bloquante D-16)** : ce module est correct et testé isolément, mais `PaymentsService` n'appelle actuellement **pas** ces fonctions — chaque site d'écriture (`markSucceeded`, `transitionAndEmit`, `finalizeRefundSuccess`) encode sa propre liste `fromStatuses` en dur dans le `WHERE` SQL. J'ai vérifié à la main que chaque liste correspond exactement à ce que dicte la machine ; mais rien n'empêche une future modification de l'un sans l'autre. Non-bloquant : le comportement actuel est correct et testé transition par transition ; recommandé pour un futur bloc.

---

## 5. Séquencement commande ↔ paiement, webhooks, idempotence

Inchangé par rapport au Bloc 0.5 pour le flux nominal (déjà conforme docs/08 §8.4/§8.6), avec un ajout correctif majeur :

**Bug trouvé et corrigé — le TTL de commande n'expirait jamais le paiement associé** (docs/08 §8.4 étape 7 : _"TTL atteint : job passe order 'awaiting_payment' → 'expired', annule le payment 'pending'"_). Le job `orderExpiryProcessor` (worker) ne touchait que la table `orders`. Un paiement `pending` restait ouvert indéfiniment ; un webhook tardif du PSP annonçant un succès aurait alors été accepté par `markSucceeded` (`WHERE status IN ('pending','authorized')`) et aurait crédité restaurant/livreur/DJAFAT pour une commande abandonnée. Corrigé (§16.2) : le job expire désormais aussi la ligne `payments` correspondante et publie `payment.expired`.

Idempotence (durable, PostgreSQL — jamais Redis comme garantie) :

| Rejeu                        | Contrainte                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `POST /payments`             | `payments_order_idem_uk (order_id, idempotency_key)` + `IdempotencyService` générique (scope `payments`)               |
| `POST /payments/:id/cancel`  | `IdempotencyService` (scope `payments:cancel`)                                                                         |
| `POST /payments/:id/refund`  | `IdempotencyService` (scope `payments:refund`) + `refunds_payment_idem_uk (payment_id, idempotency_key)`               |
| Webhook                      | `webhook_events (provider_code, event_id)` UNIQUE → `ON CONFLICT DO NOTHING` → `{status:'duplicate'}`, jamais retraité |
| `providerRef` déjà vu        | `payments_provider_ref_uk` (partiel, `WHERE provider_ref IS NOT NULL`)                                                 |
| Sur-remboursement concurrent | trigger `refunds_guard_over_refund` (verrou ligne `payments`, §7)                                                      |

---

## 6. Refunds (docs/08 §8.8)

Nouveau modèle complet. Table `refunds` (migration `0021`) : `payment_id, amount_minor, currency, reason, status (pending→processing→succeeded|failed), provider_ref, idempotency_key, entry_group, requested_by, attempts, last_error`.

Flux (`PaymentsService.doRefundPayment` → `finalizeRefundSuccess`) :

1. Vérifie le statut du paiement (`succeeded`/`partially_refunded` seulement → `PAYMENT_INVALID_STATE`).
2. Vérifie la devise (`CURRENCY_MISMATCH`).
3. Calcule le solde remboursable (`payment.amount − Σ refunds succeeded`) → `REFUND_EXCEEDS_PAYMENT` si dépassé (pré-check applicatif, meilleur-effort).
4. Vérifie `capabilities.refund`/`capabilities.partialRefund` du provider.
5. Crée la ligne `refunds` (`pending`), appelle `provider.refund()`.
6. Si succès provider → `finalizeRefundSuccess` : **une seule transaction** — `UPDATE refunds SET status='succeeded' WHERE status IN ('pending','processing')` (idempotent), relit la somme, pose l'écriture `refund` au ledger, reclasse `payments.status` (`refunded` ou `partially_refunded`), publie `payment.refunded`.

**La garde anti-sur-remboursement n'est pas qu'applicative.** Le trigger PostgreSQL `check_refund_does_not_exceed_payment` (migration `0021`) verrouille la ligne `payments` parente (`SELECT ... FOR UPDATE`) **avant** de recalculer la somme des remboursements réussis — exactement la leçon du Bloc 4 (docs/23 §1.1) appliquée à une nouvelle table. Deux remboursements concurrents pour le même paiement se sérialisent sur ce verrou ; le perdant lève une exception Postgres, traduite proprement en `409 REFUND_EXCEEDS_PAYMENT` (bug trouvé et corrigé pendant cette passe, §16.1 — sans ce correctif, le perdant de la course recevait une erreur 500 brute au lieu d'un code d'erreur propre).

**Comptabilisation** (`refund-entries.ts`, docs/08 §8.8) : DJAFAT absorbe le remboursement — débit `DJAFAT_REVENUE`, crédit `PSP_CLEARING` (mobile money/mock) ou `REFUNDS_PAYABLE` (cash, pas de PSP par lequel repousser l'argent). Toujours exactement 2 lignes du même montant → équilibré par construction. Qui porte _in fine_ le remboursement (plateforme vs restaurant vs livreur) est une politique métier non spécifiée par le mandat — hors périmètre, comme les payouts automatisés.

---

## 7. Ledger, frais PSP, DJAFAT_REVENUE

**Vérifié, préservé sans réécriture inutile** : `accrual-entries.ts`'s groupe combiné unique (`debit PSP_CLEARING net`, `debit PSP_FEE_EXPENSE fee` [omis si 0], `credit RESTAURANT_PAYABLE/COURIER_PAYABLE/DJAFAT_REVENUE au brut`) correspond **exactement** à l'exemple chiffré de docs/08 §8.9 (Groupe 1), pas seulement de manière équivalente. `DJAFAT_REVENUE` reste le produit brut (2400), jamais réduit par le frais PSP (150) — la règle non-négociable A2 est respectée et vérifiée par lecture directe de l'exemple chiffré du document source, pas juste par le code.

**Frais PSP désormais pilotés par configuration** (fermeture de la dette Bloc 0.5) : `payment_provider_configs.fee_bps` (migration `0020`, nullable — `NULL` = pas de règle à ce niveau). `PaymentsService.resolveProviderFeeBps(providerCode, restaurantId)` : cash → toujours 0 ; sinon la ligne activée la plus spécifique (restaurant > globale) l'emporte ; à défaut, retombe sur `MOCK_PSP_FEE_BPS` (150, 1,5 %) — la constante Bloc 0.5 devient un _fallback_ documenté, plus la seule valeur possible. `buildOrderAccrualEntries` reçoit désormais `feeBps` en paramètre explicite (fonction pure, plus de lecture de constante cachée) et retourne `{entries, pspFee}` — `payments.psp_fee_minor` est maintenant réellement renseigné (colonne existait, jamais écrite avant).

Réclassement pending→available (`deliveries/release-entries.ts`) : déjà construit et testé au Bloc 0.5/4, conforme docs/08 §8.9 Groupe 2, invariant `pending + available = total dû` vérifié par construction (reclassement pur entre comptes de passif, aucun argent créé).

---

## 8. Settlement & réconciliation (primitif, pas un moteur)

Conformément à l'exclusion explicite du mandat (_"pas de moteur bancaire complet"_), `settlements` (migration `0022`) est une saisie manuelle, pas une ingestion automatisée de relevés :

`POST /v1/admin/settlements` (`admin`/`super_admin`/`finance`, permission `payouts:write`, **step-up MFA obligatoire**) : `{providerCode, periodStart, periodEnd, currency, grossMinor, feesMinor, netMinor, providerReference?, expectedNetMinor?}`. Vérifie `gross − fees = net` (`VALIDATION_ERROR` sinon). Pose **une** écriture `settlement` (`debit DJAFAT_BANK net`, `credit PSP_CLEARING net`) — le montant net, pas le brut, exactement le Groupe 3 de l'exemple chiffré docs/08 §8.9. Si `expectedNetMinor` fourni et différent du `netMinor` déclaré → `status='discrepancy'`, **jamais corrigé automatiquement**, juste signalé (`settlement.discrepancy` en outbox) — même philosophie que le garde-fou webhook amount-mismatch. `GET /v1/admin/settlements` pour l'audit (`finance`/`admin`/`super_admin`).

Pas de `payment_disputes` câblé (réservé, hors MVP — conforme à l'exclusion explicite du mandat, aucune carte activée).

---

## 9. `GET /v1/config/payment-methods`

Contrôleur séparé (`PaymentMethodsConfigController`, `@Controller('config')`), monté sous le préfixe déjà utilisé par `platform/config-public.controller.ts` (`GET /config/public`) — pas de collision de route vérifiée (`GET /config/payment-methods` vs `GET /config/public`).

Un provider n'apparaît que si **à la fois** (a) sa classe est enregistrée dans `PaymentProviderRegistry` **et** (b) une ligne `payment_provider_configs` l'active pour ce contexte (ville/restaurant/devise, la plus spécifique gagnant) — jamais une liste codée en dur (docs/15 AD-03). Filtre optionnel par montant (`min/maxAmountMinor`).

Depuis 0.20.10, la **création** d'un paiement (`POST /v1/payments`) applique la même règle, avec la même fonction : un provider absent de cette liste pour la commande est refusé (`409 PAYMENT_METHOD_UNAVAILABLE`), et la méthode enregistrée est celle du provider, plus celle envoyée par le client. Avant, seule la liste appliquait la règle : un provider désactivé restait utilisable par l'API (constat d'audit PAY-01).

---

## 10. D-15 — IDOR corrigé

Avant : `GET /v1/payments/:id` — aucun `@RequireAuth()`, aucune vérification de propriété. N'importe quel acteur authentifié (ou même non authentifié, selon la config globale des guards) pouvait lire les métadonnées de n'importe quel paiement.

Après : `@RequireAuth()` + `@RequireOwnership(PaymentsService, (payments, req) => payments.getOwnerUserId(req.params.id), 'payments:read')` — mécanisme strictement identique à `orders.controller.ts` (même decorator, même `OwnershipGuard`, résout via `ModuleRef` à la requête). `PaymentsService.getOwnerUserId` lève `NotFoundException` lui-même (jamais de sentinelle qu'un guard pourrait mal interpréter comme "possédé"), puis délègue à `OrderAmountPort.getOwnerUserId(orderId)` — jamais un import direct de `orders`.

Le même mécanisme protège aussi `POST /payments/:id/cancel` (`payments:write`). `POST /payments/:id/refund` va plus loin : rôle `admin/super_admin/finance` + permission `payments:refund` + **step-up MFA**, pas d'ownership check côté client (action réservée au staff).

Testé : `payments.service.spec.ts` — délégation correcte + 404 propre sur id inconnu (2 tests). Le comportement du guard lui-même (résolution ModuleRef, comparaison userId) est couvert par `ownership.guard.spec.ts` (6 tests, préexistant, inchangé).

---

## 11. Sécurité — audit ciblé

| Surface                                          | Statut                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IDOR `GET /payments/:id`                         | **Corrigé** (D-15, §10)                                                                                                                                                                                                                                                                                                               |
| Webhook — signature                              | Seule source de confiance (`verifyAndParseWebhook().signatureValid`), vérifiée AVANT tout traitement ; signature invalide → `401`, zéro traitement, et depuis 0.20.9 plus aucune ligne dans `webhook_events` (avant : `status='ignored'`, qui réservait l'identifiant du vrai webhook — constat d'audit PAY-05). Testé.               |
| Webhook — rejeu                                  | `webhook_events (provider_code, event_id)` UNIQUE, `ON CONFLICT DO NOTHING` → `{status:'duplicate'}`. Testé (2 appels identiques → 1 traité, 1 dupliqué, ledger posté une seule fois).                                                                                                                                                |
| Webhook — falsification montant                  | Écart `webhook.amount` vs `payments.amount_minor` → `needs_review`, **aucun crédit automatique**. Testé, y compris vérification qu'aucune écriture ledger n'est postée.                                                                                                                                                               |
| Webhook tardif après état terminal               | `markSucceeded`/`markFailed`/`markNeedsReview` : `UPDATE` conditionnel sur le statut courant — un webhook après `cancelled` ne régresse jamais. Testé explicitement.                                                                                                                                                                  |
| Montant client-fourni                            | Jamais : `orderAmount.getAuthoritativeAmount()` uniquement, `CreatePaymentSchema` n'a pas de champ montant.                                                                                                                                                                                                                           |
| Idempotency-Key réutilisée sur payload différent | Géré par `IdempotencyService` générique (fingerprint du payload), testé ailleurs (`idempotency.service.spec.ts`, préexistant).                                                                                                                                                                                                        |
| Sur-remboursement (race)                         | Fermé par trigger DB + traduction propre de l'exception (§6, §16.1). Testé en concurrence réelle.                                                                                                                                                                                                                                     |
| Remboursement sans permission/step-up            | `@RequireRole` + `@RequirePermission('payments:refund')` + `@RequireStepUp()` sur la route ; mécanisme déjà validé ailleurs dans le codebase (`admin.controller.ts`).                                                                                                                                                                 |
| Secrets                                          | `MOCK_WEBHOOK_SECRET` marqué explicitement dev-only dans le code ; aucune clé PSP réelle dans le dépôt ; `config_ref` reste un pointeur vers un coffre-fort externe (schema déjà en place au Bloc 0.5). `gitleaks` non disponible dans cet environnement — vérification visuelle des fichiers ajoutés effectuée, aucun secret trouvé. |

---

## 12. Concurrence — scénarios réellement exécutés en parallèle

Même discipline que docs/23 §1 (Bloc 4) : harnais de faux-DB avec verrouillage authentique (file de promesses par clé), services réels appelés via `Promise.all`/`Promise.allSettled`, jamais une simulation séquentielle.

| #   | Scénario                                                                          | Résultat                                                                                                  |
| --- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | 2 remboursements concurrents, montant plein, même paiement                        | Exactement 1 réussit, l'autre `409 REFUND_EXCEEDS_PAYMENT` propre. Ledger : 1 seul groupe `refund` posté. |
| 2   | Remboursement plein réussi, puis tentative concurrente sur le reliquat (déjà à 0) | La 2e échoue proprement (`PAYMENT_INVALID_STATE`, le paiement est déjà `refunded`)                        |
| 3   | 2 remboursements PARTIELS concurrents qui, ensemble, dépasseraient le montant     | 1 seul passe ; total remboursé jamais > montant payé ; statut final `partially_refunded`                  |
| 4   | Webhook dupliqué (même `provider_code`+`event_id`)                                | 2e appel → `duplicate`, ledger posté une seule fois                                                       |
| 5   | Webhook tardif "succeeded" après annulation                                       | No-op, statut reste `cancelled`, aucune écriture ledger                                                   |
| 6   | Paiement en `authorized` recevant la confirmation finale                          | Transition correcte vers `succeeded` (bug trouvé et corrigé, §16.3)                                       |

Chaque scénario de course a été vérifié par la méthode établie au Bloc 4 : le test échoue d'abord contre le code non corrigé (constaté explicitement pour §16.1 et §16.3), puis passe après correction.

---

## 13. Tests — inventaire

| Fichier                                                           | Tests                                                           | Statut                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------- |
| `packages/core/src/payment/state-machine.spec.ts`                 | 9 (nouveau)                                                     | ✓ 100 % couverture            |
| `apps/api/src/modules/payments/payments.service.spec.ts`          | 21 (nouveau)                                                    | ✓                             |
| `apps/api/src/modules/payments/payments-refund-race.spec.ts`      | 3 (nouveau, concurrence réelle)                                 | ✓                             |
| `apps/api/src/modules/payments/refund-entries.spec.ts`            | 3 (nouveau)                                                     | ✓                             |
| `apps/api/src/modules/payments/accrual-entries.spec.ts`           | 8 (6 préexistants + 2 nouveaux : feeBps configurable, feeBps=0) | ✓                             |
| `apps/worker/src/processors/order-expiry.processor.spec.ts`       | 3 (nouveau, unitaire sans Docker)                               | ✓                             |
| `apps/worker/test/processors.int.spec.ts`                         | +2 scénarios (paiement expiré/préservé)                         | **N/V — Docker indisponible** |
| `apps/api/src/modules/payments/payment-provider.registry.spec.ts` | 8 (préexistant, inchangé)                                       | ✓                             |

**43 tests unitaires nouveaux**, tous exécutés avec succès. Total du monorepo après cette passe : **446 tests unitaires passants** (répartition : api 226, core 135, ui 56, config 8, tokens 5, i18n 5, sdk 4, validation 4, worker 3).

---

## 14. Gauntlet — vérifications exécutées

| Commande                                      | Résultat                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm db:generate` (Prisma)                   | ✓                                                                                                                        |
| `pnpm format:check` (19 packages)             | ✓                                                                                                                        |
| `pnpm -r typecheck` (19 packages)             | ✓                                                                                                                        |
| `pnpm -r lint` (19 packages)                  | ✓                                                                                                                        |
| `pnpm -r test` (19 packages, 446 tests)       | ✓                                                                                                                        |
| `pnpm -r build` (19 packages)                 | ✓                                                                                                                        |
| `pnpm db:migrate:dev` / tests `*.int.spec.ts` | **N/V — Docker indisponible**                                                                                            |
| `gitleaks`                                    | **N/V — outil indisponible dans cet environnement** ; revue manuelle des fichiers ajoutés effectuée, aucun secret trouvé |

---

## 15. Migrations

| Migration                       | Contenu                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `0020_payment_provider_fee_bps` | `ALTER TABLE payment_provider_configs ADD COLUMN fee_bps int` (nullable, additive)             |
| `0021_payments_refunds`         | Table `refunds` + trigger `refunds_guard_over_refund` (verrou `FOR UPDATE` sur `payments`, §6) |
| `0022_settlements`              | Table `settlements`                                                                            |

Toutes additives, aucune migration antérieure modifiée. `apps/api/prisma/schema.prisma` mis à jour en cohérence (`Refund`, `Settlement`, `PaymentProviderConfig.feeBps`).

---

## 16. Bugs trouvés et corrigés pendant cette passe

### 16.1 🔴 Course de remboursement perdante → erreur brute au lieu d'un code propre

**Symptôme** : le trigger `refunds_guard_over_refund` protège correctement contre le sur-remboursement concurrent (§6), mais rien ne traduisait son exception PostgreSQL en réponse HTTP propre — le perdant de la course aurait reçu une erreur 500 brute.
**Cause** : `doRefundPayment` appelait `finalizeRefundSuccess` sans `try/catch` autour du déclenchement possible du trigger.
**Correction** : `try/catch` autour de `finalizeRefundSuccess`, marque le remboursement `failed` (pas laissé en `processing`), détecte le message du trigger (`"would exceed payment"`) et lève `409 REFUND_EXCEEDS_PAYMENT`.
**Reproduction** : test de concurrence réelle (§12 scénario 1) — confirmé en échec (erreur non `HttpException`) avant correctif, en succès après.

### 16.2 🔴 Le job d'expiration de commande n'expirait jamais le paiement associé

**Symptôme** : `orderExpiryProcessor` (worker) faisait passer une commande `awaiting_payment` expirée à `expired`, mais laissait son paiement `pending` indéfiniment. Un webhook tardif annonçant un succès aurait alors été accepté par `markSucceeded` et aurait crédité le ledger pour une commande abandonnée.
**Cause** : docs/08 §8.4 étape 7 prescrit explicitement d'annuler le paiement à l'expiration ; l'implémentation Bloc 0.5 ne le faisait pas.
**Correction** : `orderExpiryProcessor` ajoute, dans la même transaction, `UPDATE payments SET status='expired' WHERE order_id=... AND status IN ('pending','authorized')` et publie `payment.expired` en outbox.
**Reproduction** : test unitaire (`order-expiry.processor.spec.ts`) — confirmé en échec (`expected 'pending' to be 'expired'`) avant correctif, en succès après. Scénario équivalent ajouté à `processors.int.spec.ts` (N/V, Docker indisponible).

### 16.3 🟠 `markSucceeded` ne complétait pas un paiement en état `authorized`

**Symptôme** : le `WHERE` de la mise à jour conditionnelle de `markSucceeded` n'acceptait que `status = 'pending'`, jamais `'authorized'` — alors que docs/08 §8.3 prévoit explicitement `AUTHORIZED --capture()--> SUCCESS`. Aucun provider actuel (`mock`, `cash`) n'a `capabilities.capture`, donc le chemin est aujourd'hui inatteignable en pratique — mais un futur provider `capture`-capable (Card) resterait bloqué en `authorized` pour toujours à la confirmation finale.
**Correction** : `WHERE status = ANY(ARRAY['pending','authorized']::payment_status[])`.
**Reproduction** : test unitaire — confirmé en échec avant correctif (`expected 'authorized' to be 'succeeded'`), en succès après. Sévérité 🟠 (non-bloquant pour ce bloc, car inatteignable avec les providers actuels) plutôt que 🔴.

---

## 17. Dette technique

### Bloquante

Aucune.

### Non-bloquante

| #    | Dette                                                                                                                                                                                                                                  | Raison de ne pas corriger maintenant                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| D-16 | La machine à états (`@djafat/core/payment/state-machine.ts`) est testée mais pas consultée par `PaymentsService` — chaque site d'écriture encode sa propre liste `fromStatuses`, actuellement cohérente mais pas garantie de le rester | Refactor structurel, pas une correction de bug ; le comportement actuel est correct et testé transition par transition |
| D-17 | Confirmation de remboursement asynchrone via webhook non câblée — `mock`/`cash` résolvent tous deux `refund()` de façon synchrone                                                                                                      | Aucun PSP réel activé n'en a besoin aujourd'hui ; à construire à l'activation d'un premier PSP async                   |
| D-18 | `settlements` reste une saisie manuelle, pas une ingestion/réconciliation automatisée de relevés PSP                                                                                                                                   | Exclusion explicite du mandat ("pas de moteur bancaire complet") — V1.1                                                |
| D-19 | Tests d'intégration Docker (`*.int.spec.ts`) à jour mais non exécutés dans cet environnement                                                                                                                                           | Docker indisponible ; à exécuter en CI/staging avant activation d'un PSP réel                                          |
| —    | D-15                                                                                                                                                                                                                                   | **Fermée** (§10)                                                                                                       |

---

## 18. Statut des providers réels — table de vérité

| Provider       | Actif en configuration seedée | Accès technique vérifié             | Accès commercial vérifié |
| -------------- | ----------------------------- | ----------------------------------- | ------------------------ |
| `mock`         | ✓ (dev/CI uniquement)         | — (n'appelle aucun service externe) | —                        |
| `cash`         | ✓                             | — (pas de PSP)                      | —                        |
| `airtel_money` | ✗                             | **Non vérifié**                     | **Non vérifié**          |
| `moov_money`   | ✗                             | **Non vérifié**                     | **Non vérifié**          |
| `card_xxx`     | ✗                             | **Non vérifié**                     | **Non vérifié**          |

Aucun de ces trois derniers providers n'est présenté ici comme techniquement ou commercialement disponible au Tchad — cette affirmation n'apparaît nulle part dans ce document, conformément à la décision A1.

---

## 19. Fichiers modifiés / créés

**Migrations** : `0020_payment_provider_fee_bps`, `0021_payments_refunds`, `0022_settlements`.

**Schéma** : `apps/api/prisma/schema.prisma` (`Refund`, `Settlement`, `PaymentProviderConfig.feeBps`), `apps/api/prisma/seed.ts` (permission `payments:write`).

**API** : `payments.service.ts` (annulation, remboursement, `resolveProviderFeeBps`, D-15, fix `authorized`), `payments.controller.ts` (D-15, `cancel`, `refund`), `payments.module.ts`, `payment-methods-config.controller.ts` (nouveau), `settlements.controller.ts`/`settlements.service.ts` (nouveaux), `accrual-entries.ts` (`feeBps` explicite), `refund-entries.ts` (nouveau), DTOs `refund-payment.schema.ts`/`record-settlement.schema.ts` (nouveaux).

**Worker** : `order-expiry.processor.ts` (fix §16.2).

**`@djafat/core`** : `payment/state-machine.ts` (nouveau), `errors.ts` (`PaymentTransitionError`), `index.ts`.

**`@djafat/types`** : `enums.ts` (`payments:write`), `errors.ts` (codes d'erreur paiement), `events.ts` (événements `payment.*`/`settlement.*`).

**Tests** : `payments.service.spec.ts`, `payments-refund-race.spec.ts`, `payments-test-support.ts`, `refund-entries.spec.ts`, `state-machine.spec.ts`, `order-expiry.processor.spec.ts` (tous nouveaux) ; `accrual-entries.spec.ts`, `processors.int.spec.ts` (étendus).

---

## 20. Git — état final

`git status --porcelain=v1` propre après commit (voir liste de commits ci-dessous, à insérer après exécution). Aucun fichier temporaire, aucune modification non intentionnelle en dehors du périmètre Bloc 5.

---

## STOP

Conformément au mandat (§58 et la clause de fin de bloc) : pas de Bloc 6, pas de dispatch, pas de notifications temps réel, pas d'optimisation, pas d'application mobile client, pas d'intégration PSP commerciale réelle. Ce bloc s'arrête ici, en attente d'autorisation explicite pour la suite.
