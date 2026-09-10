# 08 — Architecture paiement (révisé — post-audit)

> **Révision post-audit.** Le paiement est **provider-agnostic dès la conception** : jamais construit autour d'Airtel Money. Le cœur métier `orders` **ne dépend jamais d'un PSP**, seulement de l'abstraction `PaymentProvider`. Ajouts : `getCapabilities()` + `ProviderCapabilities`, `cancel()`, `capture()` optionnel, séparation `getStatus()` / `verifyAndParseWebhook()`, état `NEEDS_REVIEW`, séquencement `awaiting_payment` + TTL, module `ledger` écrivain unique, plan comptable explicite, frais PSP + settlement, refunds idempotents, payouts corrigés, disputes réservés. Traçabilité : `docs/15-audit-corrections.md`.

---

## 8.1 Objectifs & décision verrouillée

1. **Provider-agnostic** : ajouter/retirer Cash, Mock, Airtel Money, Moov Money, Card, futur PSP **sans toucher** `orders`, `carts`, `pricing`, ni l'UI.
2. **Serveur = source de vérité** : aucun montant ni statut « payé » accepté du frontend. Le client n'envoie même **aucun montant**.
3. **Cohérence financière** : chaque unité monétaire tracée dans le grand livre (`ledger_entries`), à **écrivain unique** (module `ledger`), réconciliée avec le PSP (`settlements`).
4. **Multi-devise structurel** : montants `Money { minor: bigint; currency: string }`. Pas de moteur de change au MVP.
5. **Résilience réseau** (contexte Tchad) : webhooks + polling + idempotence **durable** (contraintes PostgreSQL) → jamais de double débit, jamais de commande payée « perdue ».

> **Décision A1 (verrouillée).** DJAFAT **supporte plusieurs providers dès la conception** et n'**active** (`payment_provider_configs.enabled`, `payment_providers.active`) que ceux dont **l'accès technique (API/sandbox) ET commercial (contrat) est effectivement disponible et vérifié**. Ce document **n'affirme pas** qu'Airtel Money ou Moov Money sont techniquement disponibles au Tchad : leurs providers sont **prévus mais `inactif`** dans le seed tant que la vérification n'est pas faite. Le MVP démarre avec `cash` + `mock` ; **au moins un** Mobile Money réel est activé au Bloc 5 selon la disponibilité constatée. `MockProvider` reste **permanent** (dev, CI, tests, filet).

---

## 8.2 Abstraction — `PaymentProvider`

```text
Domaine (orders / carts / pricing)  ──►  ne connaît QUE ceci :
                                         PaymentService  (module payments)
                                            │
     ┌──────────────────────────────────────┼───────────────────────────────────────┐
     │ resolveMethods(ctx)  ── via `platform` (payment_provider_configs)             │
     │ registry: Map<providerCode, PaymentProvider>  ── data-driven, aucun switch    │
     │ orchestration: initiate / getStatus / handleWebhook / cancel / capture? / refund
     └──────────────────────────────────────┬───────────────────────────────────────┘
                                            ▼
                                   interface PaymentProvider
        ┌───────────────┬───────────────┬───────────────┬───────────────┬───────────────┐
   CashProvider     MockProvider   AirtelMoneyProvider  MoovMoneyProvider  CardProvider   …FutureProvider
   (COD, pas       (auto-success,  (mobile money)      (mobile money,     (V2, redirect/
    d'appel externe) permanent, CI)                     Flooz)             hosted fields)
```

- **Un provider = un fichier** + sa `config_ref` (clés dans le secret manager, **jamais** en base) + ses **tests contractuels** contre un mock conforme.
- **Aucun `if (provider === 'airtel')` nulle part.** La sélection passe par `payment_provider_configs` (données) et par `getCapabilities()`.
- `MockProvider` est un **artefact permanent** : utilisé en dev, en CI, dans le Walking Skeleton (Bloc 0.5), et comme filet si un PSP réel est indisponible.

### Interface (conceptuelle)

```ts
type Money = { minor: bigint; currency: string }; // ex. { minor: 1000000n, currency: "XAF" }

interface ProviderCapabilities {
  initiate: boolean;
  webhook: boolean;
  polling: boolean; // getStatus() fiable
  cancel: boolean;
  refund: boolean;
  partialRefund: boolean;
  capture: boolean; // flux autorisation/capture séparés
  requiresPayerPhone: boolean;
  async: boolean; // true = confirmation via webhook/poll ; false = résultat synchrone (Cash, Mock)
  currencies: string[]; // devises supportées
  minAmount?: Money;
  maxAmount?: Money;
}

interface PaymentProvider {
  readonly code: string; // 'cash' | 'mock' | 'airtel_money' | 'moov_money' | 'card_xxx'
  getCapabilities(): ProviderCapabilities;

  initiate(input: {
    paymentId: string;
    amount: Money;
    orderCode: string;
    payerPhone?: string;
    idempotencyKey: string;
    returnUrl?: string;
  }): Promise<{
    providerRef: string;
    status: PaymentStatus; // 'pending' | 'authorized' | 'succeeded' | 'failed'
    action?: { type: 'ussd_push' | 'redirect' | 'none'; url?: string; instructions?: string };
    expiresAt?: string;
  }>;

  getStatus(providerRef: string): Promise<{ status: PaymentStatus; raw: unknown }>; // polling pur

  verifyAndParseWebhook(rawReq: RawRequest): Promise<{
    eventId: string; // id du PSP, ou sha256(body) si absent
    providerRef: string;
    status: PaymentStatus;
    signatureValid: boolean; // signature = SOURCE DE CONFIANCE
    amount?: Money;
    raw: unknown;
  }>;

  cancel(input: {
    providerRef: string;
    idempotencyKey: string;
  }): Promise<{ status: PaymentStatus }>;

  capture?(input: {
    providerRef: string;
    amount: Money;
    idempotencyKey: string;
  }): Promise<{ status: PaymentStatus }>; // présent seulement si capabilities.capture

  refund(input: {
    providerRef: string;
    amount: Money;
    idempotencyKey: string;
  }): Promise<{ status: 'succeeded' | 'processing' | 'failed'; providerRef: string }>;
}
```

### Capabilities par provider (indicatif)

| Provider        | async         | webhook      | polling | cancel    | refund                 | partialRefund | capture | requiresPayerPhone |
| --------------- | ------------- | ------------ | ------- | --------- | ---------------------- | ------------- | ------- | ------------------ |
| `cash`          | non           | non          | non     | oui       | oui (geste commercial) | oui           | non     | non                |
| `mock`          | non (config.) | oui (simulé) | oui     | oui       | oui                    | oui           | non     | non                |
| `airtel_money`  | oui           | oui          | oui     | oui       | selon API              | selon API     | non     | oui                |
| `moov_money`    | oui           | oui          | oui     | selon API | selon API              | selon API     | non     | oui                |
| `card_xxx` (V2) | oui           | oui          | oui     | oui       | oui                    | oui           | oui     | non                |

Le `PaymentService` lit `getCapabilities()` pour décider : proposer `cancel` ? autoriser un refund partiel ? attendre un webhook ou renvoyer un résultat synchrone ? → **zéro connaissance PSP hors du provider**.

---

## 8.3 Machine à états `PaymentStatus`

```text
États : PENDING · AUTHORIZED(opt) · SUCCESS(succeeded) · FAILED · CANCELLED · EXPIRED
        · REFUNDED · PARTIALLY_REFUNDED · NEEDS_REVIEW

                 initiate
   (create) ───────────────► PENDING
                               │
     ┌───────────────┬─────────┼───────────────┬─────────────────┐
     │ webhook/poll  │ webhook │ webhook/poll  │ cancel()        │ TTL / expires_at
     │  = ok (sync   │  = auth │  = refus      │                 │
     │  ou async)    │ (capture│               │                 │
     ▼               │  requis)▼               ▼                 ▼
  SUCCESS       AUTHORIZED ──capture()──► SUCCESS   FAILED    CANCELLED        EXPIRED
     │               │ (si capabilities.capture)
     │               └──► (pas de capture) ──► SUCCESS
     │
     │ écart montant / signature douteuse / incohérence
     ▼
  NEEDS_REVIEW ──(ops tranche)──► SUCCESS | FAILED | CANCELLED
     │
     │ refund total / partiel
     ▼
  REFUNDED / PARTIALLY_REFUNDED
```

- **`NEEDS_REVIEW`** remplace l'ancien `flagged` (inexistant) : écart entre `webhook.amount` et `payments.amount_minor`, devise incohérente, signature valide mais données suspectes, double `providerRef` sur deux `order_id`. → **aucun crédit automatique**, alerte ops, résolution manuelle tracée (`audit_logs`).
- **`AUTHORIZED` / `capture()`** : **optionnels**, activés seulement si `capabilities.capture`. Le Mobile Money va en général `PENDING → SUCCESS/FAILED` directement. L'architecture les prévoit sans les imposer.
- **Transitions monotones** : jamais `SUCCESS → PENDING`. Toute transition journalisée dans `payment_transactions` + `outbox`.
- Passage à `SUCCESS` = update conditionnel `WHERE status IN ('pending','authorized')` **dans la même transaction** que `LedgerService.postEntryGroup(...)` → deux confirmations concurrentes n'écrivent qu'une fois.

---

## 8.4 Séquencement commande ↔ paiement

### Prépayé (Mobile Money, Card)

```text
1. POST /v1/orders (Idempotency-Key, AUCUN montant client)
     -> pricing calcule tout (commission/taxe résolues + snapshotées)
     -> order.status = 'awaiting_payment', order.expires_at = now() + TTL (platform_settings, défaut 900 s)
     -> AUCUNE notification restaurant
2. GET /v1/config/payment-methods?cityId&restaurantId&amount  -> méthodes réellement disponibles
3. POST /v1/payments (Idempotency-Key) { orderId, methodCode, providerCode, payerPhone? }
     -> PaymentService valide (provider_config actif, devise, plage montant, capabilities)
     -> provider.initiate() -> { providerRef, action:{type:'ussd_push'|'redirect'}, expiresAt }
     -> payment.status='pending', payment_transactions(direction:'request')
4. Client : écran d'attente + GET /v1/payments/:id (polling backoff 3->10 s, plafond 2–3 min)
5a. Webhook PSP -> POST /v1/payments/webhook/:provider
      -> insert webhook_events (unique(provider,event_id) : rejeu = no-op, réponse 200 immédiate)
      -> provider.verifyAndParseWebhook() : signature = source de confiance (+ horodatage ±5 min)
      -> job : recoupe amount/currency ; si écart -> NEEDS_REVIEW ; sinon transition PENDING->SUCCESS
      -> même tx : payment.status, LedgerService.postEntryGroup('order_accrual'), order.payment_status
      -> order.status 'awaiting_payment' -> 'placed'  (éligible au restaurant)
      -> outbox: payment.succeeded  ->  WS + notif client + notif restaurant ("à préparer")
5b. Pas de webhook : worker payments-reconcile appelle provider.getStatus() (30–60 s)
6. FAILED / EXPIRED : order reste 'awaiting_payment' (si TTL non atteint) ; le client peut
      POST /v1/payments/:id/retry  (nouvelle ligne payment, attempt_no++)  OU changer de methodCode/providerCode.
7. TTL atteint : job passe order 'awaiting_payment' -> 'expired', annule le payment 'pending'.
```

**Règle absolue** : le restaurant n'est notifié « à préparer » **que** sur `payment.succeeded` (prépayé) **ou** `methodCode = 'cash_on_delivery'`.

### Paiement à la livraison (Cash)

```text
POST /v1/orders { ... methodCode:'cash_on_delivery', providerCode:'cash' }
  -> order.status = 'placed' directement (CashProvider.getCapabilities().async = false)
  -> payment.status = 'pending' jusqu'à la livraison
  -> à delivery 'delivered' + preuve validée : payment.status = 'succeeded'
  -> LedgerService.postEntryGroup('order_accrual') + gestion du float livreur (§8.9)
```

---

## 8.5 Idempotence & anti-double-débit (durable — PostgreSQL)

| Mécanisme                         | Contrainte                                                                                                                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rejeu `POST /orders`              | `orders(customer_id, idempotency_key)` unique                                                                                                                                                                                             |
| Rejeu `POST /payments`            | `payments(order_id, idempotency_key)` unique → renvoie le paiement existant                                                                                                                                                               |
| Rejeu webhook                     | `webhook_events(provider_code, event_id)` unique → no-op                                                                                                                                                                                  |
| `providerRef` déjà vu             | `payments(provider_code, provider_ref)` unique partiel                                                                                                                                                                                    |
| Double confirmation concurrente   | update conditionnel `WHERE status IN ('pending','authorized')` + `ledger_entry_groups(idempotency_key)` unique                                                                                                                            |
| Rejeu `POST /payments/:id/refund` | `refunds(payment_id, idempotency_key)` unique                                                                                                                                                                                             |
| Rejeu payout                      | `payouts(idempotency_key)` unique                                                                                                                                                                                                         |
| `retry`                           | **nouvelle** ligne `payments` (nouveau `idempotency_key`, `attempt_no++`, nouveau `provider_ref`) ; l'ancienne → `FAILED/EXPIRED/CANCELLED`. Au plus **un** `succeeded` par `order_id` (contrainte partielle ; split payment = dette V2). |

Redis peut servir de fast-path (lock court, cache de réponse), mais **la garantie est la contrainte DB**.

---

## 8.6 Webhooks — règles

- Endpoint public par provider : `POST /v1/payments/webhook/:provider`.
- **Ordre** : (1) insérer `webhook_events` (unique → dédup) ; (2) `verifyAndParseWebhook()` — **la signature cryptographique est la seule source de confiance** ; (3) répondre `200` en < 1 s ; (4) traiter dans un **job** (transactionnel, retryable via `webhook_events.attempts`/`status`).
- Fenêtre d'horodatage ±5 min (anti-rejeu). Signature invalide → `401` + alerte sécurité, `status='ignored'`, **aucun** traitement.
- **Allowlist d'IP source** = défense **complémentaire**, jamais un substitut à la signature.
- Recoupement obligatoire `webhook.amount/currency` vs `payments.amount_minor/currency` → écart → `NEEDS_REVIEW`, pas de crédit.
- Rate-limit par `:provider`.

---

## 8.7 Annulation

- `POST /v1/payments/:id/cancel` (Idempotency-Key) — **customer** (propriétaire de la commande, paiement `pending`) ou **admin**.
- Si `capabilities.cancel` : `provider.cancel(providerRef)` → `CANCELLED`. Sinon : marquer `CANCELLED` en interne + laisser le `getStatus`/webhook confirmer (si le PSP finalise quand même → `NEEDS_REVIEW` → refund).
- Un `cancel` sur un paiement déjà `SUCCESS` → `409` (utiliser `refund`).
- Journalisé `payment_transactions(direction:'cancel')` + `outbox: payment.cancelled`.

---

## 8.8 Remboursements

- `POST /v1/admin/payments/:id/refund` — **`Idempotency-Key` obligatoire**, rôle `admin` + **step-up MFA**, body `{ amount: Money, reason }`.
- Contrôles : `refunds(payment_id, idempotency_key)` unique ; devise = celle du paiement ; **garde de sur-remboursement** (trigger `∑ refunds actifs ≤ payments.amount_minor`) ; refund partiel autorisé seulement si `capabilities.partialRefund`.
- Flux : `refunds` (`pending`) → `provider.refund()` (idempotent) → `processing` → webhook/poll → `succeeded|failed` (retry sûr via `attempts`/`last_error`).
- **Lien ledger obligatoire** : à `succeeded`, `LedgerService.postEntryGroup('refund', ...)` (contre-écritures) et `refunds.entry_group` renseigné.
- `payment.status` → `refunded` (total) ou `partially_refunded`.
- Cash : « remboursement » = avoir/wallet client **ou** remise d'espèces, tracé au ledger (`REFUNDS_PAYABLE`).
- Mobile Money : API si supportée, sinon `payout` manuel vers le numéro du client (tracé, `payout_attempts`).

---

## 8.9 Grand livre, frais PSP & settlement (module `ledger` — écrivain unique)

### Principe

**Une seule voie d'écriture** : `LedgerService.postEntryGroup(entries[], { kind, idempotencyKey, currency, refs, memo })`.

- valide `∑debit = ∑credit` par devise ;
- insère `ledger_entry_groups` (+ `idempotency_key` unique) et `ledger_entries` (immuables) ;
- met à jour les **projections** `wallet_balances` + `wallet_transactions` **dans la même transaction** ;
- rejeu de la même `idempotencyKey` → no-op.
  Les `wallets`/soldes ne sont **jamais** une source financière indépendante : ce sont des **read-models** du grand livre. Correction = nouveau groupe `adjustment` (contre-écriture), jamais un `UPDATE`.

### Plan comptable minimal (`ledger_accounts.code`)

| Code                                                  | Type      | Rôle                                              |
| ----------------------------------------------------- | --------- | ------------------------------------------------- |
| `PSP_CLEARING` (par provider)                         | asset     | argent chez le PSP, pas encore en banque          |
| `DJAFAT_BANK`                                         | asset     | compte bancaire DJAFAT                            |
| `CASH_FLOAT` (par courier)                            | asset     | espèces détenues par un livreur, non reversées    |
| `DJAFAT_REVENUE`                                      | revenue   | commission + frais de service − subventions       |
| `PSP_FEE_EXPENSE`                                     | expense   | frais prélevés par le PSP                         |
| `PROMO_EXPENSE`                                       | expense   | coût des remises DJAFAT                           |
| `RESTAURANT_PAYABLE` (par resto)                      | liability | dû au restaurant, **non encore libéré** (pending) |
| `RESTAURANT_AVAILABLE` (par resto)                    | liability | dû au restaurant, **libéré** (available, virable) |
| `COURIER_PAYABLE` / `COURIER_AVAILABLE` (par courier) | liability | idem livreur                                      |
| `REFUNDS_PAYABLE`                                     | liability | remboursements dus non encore versés              |
| `CUSTOMER_CLEARING`                                   | liability | encaissements clients en transit                  |

`wallet_balances.pending_minor` = solde `*_PAYABLE:<id>` ; `available_minor` = solde `*_AVAILABLE:<id>`.

> **Convention comptable** : `DJAFAT_REVENUE` enregistre le **produit brut** de DJAFAT sur la commande (commission + frais de service + frais de livraison collectés − rémunération livreur). Les **frais PSP** sont une **charge séparée** (`PSP_FEE_EXPENSE`), **jamais** nette du revenu dans le grand livre (décision **A2**). La marge nette = `DJAFAT_REVENUE − PSP_FEE_EXPENSE`, calculée au **compte de résultat**, pas par une écriture. La politique « qui porte les frais PSP » est **configurable** : `platform_settings['psp_fee_policy']` ∈ `absorb` (défaut MVP) | `pass_through` (ligne client visible) | `split`.

### Exemple chiffré — commande **10 000 XAF**, Mobile Money prépayé

```text
Décomposition (calculée serveur, figée sur orders.*_minor) :
  sous-total plats ............ 8 000
  frais de livraison (client) . 1 500
  frais de service (client) ...   500
  TOTAL payé par le client ... 10 000
  commission DJAFAT (20 % × 8 000) ... 1 600
  rémunération livreur .............. 1 200   (= delivery fee, décision A5, configurable)
  frais PSP (1,5 % × 10 000) ........   150   (absorbés par DJAFAT — A2)
Cibles : restaurant 6 400 · livreur 1 200 · DJAFAT produit brut 2 400 · charge PSP 150
         => marge nette DJAFAT = 2 400 − 150 = 2 250   (compte de résultat, pas une écriture)

Groupe 1 — payment.succeeded   kind='order_accrual'  idem='payment:<id>'
  DÉBIT                                     CRÉDIT
  PSP_CLEARING:<provider> ...... 9 850      RESTAURANT_PAYABLE:<rid> ...... 6 400
  PSP_FEE_EXPENSE .............     150      COURIER_PAYABLE:<cid> ......... 1 200
                                            DJAFAT_REVENUE ............... 2 400
  Σ débit = 10 000                          Σ crédit = 10 000            ✔ équilibré
  -> projections : resto pending +6 400 ; livreur pending +1 200

Groupe 2 — order.delivered     kind='funds_available'  idem='order:<id>:available'
  DÉBIT                                     CRÉDIT
  RESTAURANT_PAYABLE:<rid> ..... 6 400      RESTAURANT_AVAILABLE:<rid> .... 6 400
  COURIER_PAYABLE:<cid> ........ 1 200      COURIER_AVAILABLE:<cid> ....... 1 200
  Σ débit = 7 600                           Σ crédit = 7 600            ✔ équilibré
  -> RECLASSEMENT PUR entre comptes de PASSIF : aucun argent créé.
     resto : pending −6 400 / available +6 400 ; livreur idem. Total passif inchangé.
     Déclenchement configurable : platform_settings['funds_release_policy']
       = { trigger:'delivered', delay_hours:0, reserve_percent:0 }  (défaut MVP — A3)

Groupe 3 — settlement PSP -> banque   kind='settlement'  idem='settlement:<id>'
  DÉBIT                                     CRÉDIT
  DJAFAT_BANK ................. 9 850       PSP_CLEARING:<provider> ....... 9 850
  Σ = 9 850 = 9 850                                                     ✔ équilibré
  (le lot réel agrège N paiements ; ici 1 seul pour l'exemple)

Groupe 4 — payout restaurant   kind='payout'  idem='payout:<id>'
  DÉBIT                                     CRÉDIT
  RESTAURANT_AVAILABLE:<rid> ... 6 400      DJAFAT_BANK .................. 6 400
  Σ = 6 400 = 6 400                                                     ✔ équilibré

Contrôle global (après G1..G4) :
  DJAFAT_BANK           = +9 850 − 6 400 = +3 450
  PSP_CLEARING          = +9 850 − 9 850 =      0
  RESTAURANT_PAYABLE    = +6 400 − 6 400 =      0
  RESTAURANT_AVAILABLE  = +6 400 − 6 400 =      0
  COURIER_PAYABLE       = +1 200          = +1 200   (course livrée, payout livreur non encore émis)
  DJAFAT_REVENUE        =                 = +2 400   (produit)
  PSP_FEE_EXPENSE       =                 = +  150   (charge)
  Σ actifs (3 450) = Σ passifs (1 200) + Σ (produits 2 400 − charges 150)  => 3 450 = 3 450  ✔
```

### Variante Cash (encaissement livreur)

```text
Groupe 1 — delivered   kind='order_accrual'
  DÉBIT                                     CRÉDIT
  CASH_FLOAT:<cid> ........... 10 000       RESTAURANT_PAYABLE:<rid> ...... 6 400
                                            COURIER_PAYABLE:<cid> ......... 1 200
                                            DJAFAT_REVENUE ............... 2 400   (aucun frais PSP en cash)
  Σ = 10 000 = 10 000                                                    ✔ équilibré
Groupe 2 — funds_available (identique au cas MM)
Groupe 3 — reversement d'espèces du livreur   kind='cash_reconciliation'
  DÉBIT  DJAFAT_BANK 10 000                 CRÉDIT  CASH_FLOAT:<cid> 10 000        ✔
Plafond de float : platform_settings['courier_cash_float_cap_minor'] ; au-delà,
l'app livreur bloque les nouvelles courses cash jusqu'à régularisation.
```

> **Invariant vérifié en CI (Bloc 0.5) et par le job `ledger-assert` (horaire)** : pour tout `entry_group` et toute devise, `Σ débit = Σ crédit` ; et pour tout compte, `solde projeté (wallet_balances) == Σ des ledger_entries`. Une divergence bloque le build / lève une alerte ops.

### Settlement & réconciliation

- `settlements` + `settlement_items` : le worker `payments-reconcile` **ingère les relevés PSP** (API/fichier), crée le lot, **matche** chaque ligne à un `payments`/`refunds`, calcule `expected_net_minor`, poste le groupe `settlement`, marque `reconciled` ou `discrepancy` (alerte ops).
- Objectif : **jamais** « payment = success » sans piste de réconciliation banque.
- `GET /v1/admin/settlements`, `GET /v1/admin/ledger/entries` pour l'audit et la comptabilité.

---

## 8.10 Payouts (reversements partenaires)

- `payouts` : lien vers `beneficiary_type/id`, `ledger_account_id` (compte `*_AVAILABLE` ponctionné), `amount`/`currency`, `idempotency_key` unique, `provider_ref`, `entry_group`, `fee_minor`, `status` (`requested→approved→processing→paid|failed|cancelled`), `requested_by`/`approved_by`, timestamps.
- `payout_attempts` : chaque tentative (provider_ref, statut, erreur, refs payload) → **retry sûr et auditable**.
- Approbation admin avec **step-up MFA** ; poste le groupe `payout` seulement à `paid`.
- MVP : déclenchement **manuel** (relevé + validation) ; automatisation V1.1.

---

## 8.11 Disputes / chargebacks

- `payment_disputes` : structure **réservée** (chargeback, fraud, retrieval, complaint ; statut `open→under_review→won|lost|cancelled` ; `entry_group` pour les contre-écritures).
- **Non câblé au MVP** (pas de Card). L'architecture ne bloque pas l'ajout : à l'activation de `CardProvider`, brancher le webhook de dispute → créer `payment_disputes` → geler les fonds concernés (`RESTAURANT_PAYABLE` → compte de réserve) → issue `won/lost` → contre-écriture.

---

## 8.12 Sécurité & conformité

- **Aucune donnée de carte** stockée (pas de PAN/CVV) ; `CardProvider` = champs hébergés / redirection PSP (hors périmètre PCI-DSS pour DJAFAT).
- Clés PSP dans le **secret manager** (`payment_provider_configs.config_ref` = pointeur), jamais en base ni dans le frontend.
- Montants figés sur `orders.*_minor` ; `initiate()` reçoit ce montant, jamais un montant recalculé côté client.
- Toute action financière privilégiée (refund, payout, ajustement ledger, changement de commission) : rôle `admin` + **step-up MFA** + `audit_logs.step_up_verified`.
- `ledger_entries` : `UPDATE/DELETE` révoqués au niveau SQL ; écriture réservée au rôle `djafat_ledger`.

---

## 8.13 Roadmap paiement

| Étape            | Contenu                                                                                                                                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bloc 0.5**     | `MockProvider` (permanent, CI) + `LedgerService.postEntryGroup` + groupes `order_accrual`/`funds_available`                                                                                                                                                                              |
| **Bloc 5 (MVP)** | `CashProvider` + **1** `MobileMoneyProvider` réel · `webhook_events` · `getStatus` reconcile · `cancel` · refunds idempotents · `NEEDS_REVIEW` · frais PSP + `PSP_CLEARING` + `settlements` (ingestion + matching) · `wallet_balances` pending/available · revue sécurité en fin de bloc |
| **V1.1**         | 2e opérateur Mobile Money · payouts automatisés · réconciliation PSP automatisée (rapport d'écarts) · wallet/avoirs client                                                                                                                                                               |
| **V2**           | `CardProvider` (+ `payment_disputes` câblés) · `capture()` réel · split payment · paiement programmé · pourboire livreur                                                                                                                                                                 |
