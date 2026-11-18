# 07 — API (révisé — post-audit)

> **Révision post-audit.** Montants génériques `Money { minor, currency }` (fin des `*Xaf`), **découverte des moyens de paiement** (`GET /v1/config/payment-methods`), **`POST /v1/payments/:id/cancel`**, **`Idempotency-Key` sur le refund**, moyen de paiement **découplé** de la création de commande, **scope/permission documenté par endpoint**, endpoints `settlements` / `ledger`, admin **2FA + step-up**. Traçabilité : `docs/15-audit-corrections.md`.

## 7.1 Conventions

- **Style** : REST/JSON sur HTTPS. Base : `https://api.djafat.com/v1`. Versionné par préfixe (`/v1`). Changement cassant → `/v2` en parallèle, `Deprecation`/`Sunset` headers.
- **Auth** : `Authorization: Bearer <access_jwt>` (15 min). Refresh via `POST /v1/auth/refresh` (rotatif à token family ; web = cookie `HttpOnly`, mobile = SecureStore).
- **Scopes** : chaque endpoint déclare `role(s)` **+ règle de portée** (ci-dessous). Deny par défaut. Endpoints back-office `/v1/admin/*`, restaurant `/v1/restaurant/*`, livreur `/v1/courier/*`.
- **Argent** : jamais de champ portant une devise dans son nom. Type JSON **`Money`** :
  ```json
  { "minor": "1000000", "currency": "XAF" }
  ```
  `minor` **sérialisé en string** (précision entière). Une ressource financière = une seule devise.
- **Idempotence** : `Idempotency-Key: <uuid>` **obligatoire** sur `POST /orders`, `POST /payments`, `POST /payments/:id/retry`, `POST /payments/:id/cancel`, `POST /admin/payments/:id/refund`, `POST /courier/deliveries/:id/*`, `POST /*/payouts`. Garantie = contrainte PostgreSQL (doc 06 §6.11).
- **Pagination** : keyset — `?limit=20&cursor=<opaque>` → `{ data: [...], nextCursor: string|null }`.
- **Erreurs** : `{ "error": { "code", "message", "details", "traceId" } }` + statut HTTP (`400/401/403/404/409/422/429/5xx`). Codes stables documentés (OpenAPI `x-error-codes`) : `VALIDATION_ERROR` (422), `AMOUNT_NOT_ACCEPTED` (422 — un champ monétaire a été soumis sur `POST /orders`), `CURRENCY_MISMATCH` (409), `PAYMENT_METHOD_UNAVAILABLE` (409), `PROVIDER_UNAVAILABLE` (503), `ORDER_EXPIRED` (409), `ORDER_INVALID_TRANSITION` (409), `REFUND_EXCEEDS_PAYMENT` (409), `OFFER_TAKEN` (409), `STEP_UP_REQUIRED` (403), `IDEMPOTENCY_KEY_REUSED` (409). _Il n'existe pas de code de type « prix client ≠ prix serveur » : le client n'envoie jamais de montant._
- **Temps** : ISO 8601 UTC. **i18n** : `Accept-Language` ; messages traduits côté client via `code`.
- **Rate limit** : headers `RateLimit-*` ; `429` + `Retry-After`.
- **Doc** : OpenAPI 3.1 généré depuis NestJS + Zod → SDK `@djafat/sdk` typé, régénéré à chaque release.

### Règles de portée (référencées ci-dessous par un code court)

| Code           | Signification                                                          |
| -------------- | ---------------------------------------------------------------------- |
| `self`         | l'utilisateur agit sur ses propres ressources (`customer_id = me`)     |
| `owns-order`   | `orders.customer_id = me`                                              |
| `resto-scope`  | `restaurant_id ∈ user_roles(me).scope_restaurant_id`                   |
| `courier-self` | `couriers.user_id = me` et (si livraison) `deliveries.courier_id = me` |
| `admin`        | rôle `admin`/`super_admin`                                             |
| `admin+stepup` | `admin` **+ step-up MFA** vérifié (< 10 min)                           |
| `public`       | non authentifié                                                        |

## 7.2 Endpoints — Auth & compte

```text
POST   /v1/auth/otp/request        {phone, purpose}              202   public   (throttlé + phone_auth_locks)
POST   /v1/auth/otp/verify         {phone, code, purpose}        200   public   -> {access, refresh, user}
POST   /v1/auth/refresh            {refresh}|cookie              200   self     (rotation + reuse detection -> revoke family)
POST   /v1/auth/logout                                           204   self
POST   /v1/auth/mfa/setup                                        200   admin    (TOTP enrolment ; aussi `finance`, qui rembourse et enregistre les règlements)
POST   /v1/auth/mfa/verify         {code}                        200   admin    (ouvre une fenêtre step-up ~10 min ; aussi `finance`)
GET    /v1/me                                                    200   self     -> profil + rôles + country
PATCH  /v1/me                      {fullName, email, locale, avatarFileId}  200  self
GET    /v1/me/addresses                                          200   self
POST   /v1/me/addresses            {label, cityId, quartier, street, landmark, instructions, lat?, lng?, recipientPhone}  201  self
PATCH  /v1/me/addresses/:id                                      200   self
DELETE /v1/me/addresses/:id                                      204   self
PUT    /v1/me/addresses/:id/default                              200   self
GET    /v1/me/notifications        ?cursor                       200   self
POST   /v1/me/devices             {platform, pushToken}          201   self
GET    /v1/me/notification-preferences                           200   self
PATCH  /v1/me/notification-preferences                           200   self
```

## 7.3 Endpoints — Configuration publique

```text
GET /v1/config/public            ?cityId                         200 public
    -> { country, city, currency, locales, featureFlags(publics), thresholds,
         minAppVersion{android,ios}, unpaidOrderTtlSeconds }

GET /v1/config/payment-methods   ?cityId&restaurantId&amount.minor&amount.currency   200  self
    -> [ { methodCode, providerCode, displayName,
           capabilities: { requiresPayerPhone, async, refund, partialRefund, cancel, ... },
           minAmount?: Money, maxAmount?: Money } ]
    # résolu via payment_provider_configs (country/city/zone/restaurant, enabled, validité, plage, devise)
```

## 7.4 Endpoints — Découverte / catalogue

```text
GET /v1/home                 ?lat&lng&cityId                     200 public|self
GET /v1/restaurants          ?cityId&lat&lng&category&priceMax&ratingMin&maxDeliveryMin&freeDelivery&openNow&sort&cursor  200 public|self
GET /v1/restaurants/:slug                                        200 public   -> fiche (horaires en tz ville, frais Money, min Money, note, distance, eta)
GET /v1/restaurants/:slug/menu                                   200 public   -> catégories + produits (prix Money) + options
GET /v1/products/:id                                             200 public
GET /v1/search               ?q&cityId&lat&lng&type&filters&cursor  200 public|self
GET /v1/categories           ?cityId                             200 public
```

## 7.5 Endpoints — Panier / devis (indicatif)

```text
POST /v1/carts/quote                                             200  self
  body: { restaurantId, items:[{productId, quantity, optionIds:[], note}], addressId?, promoCode? }
  -> { subtotal: Money, deliveryFee: Money, serviceFee: Money, discount: Money, tax: Money, total: Money,
       currency, etaMinutes, unavailable:[productId], warnings:[] }
  # PUREMENT INDICATIF (affichage). Jamais autoritaire. Le client n'utilise pas ce total pour commander.
```

## 7.6 Endpoints — Commandes (client)

```text
POST /v1/orders                  (Idempotency-Key)               201  self
  body: { restaurantId, items:[{productId, quantity, optionIds:[], note?}],
          fulfillment:'delivery'|'pickup', addressId?,
          promoCode?, customerNote?, scheduledFor?,
          paymentIntent?: { methodCode, providerCode, payerPhone? } }   # optionnel, validé serveur
  # Le client transmet des RÉFÉRENCES et des CHOIX (produits, options, adresse, code promo, moyen
  #   de paiement) — JAMAIS un montant. Tout champ monétaire dans le body -> 422 AMOUNT_NOT_ACCEPTED.
  # Le serveur (pricing) calcule et FIGE : subtotal, deliveryFee, serviceFee, tax, discount,
  #   commission (snapshot), courierFee, total — en résolvant commission_rules / tax_rules / zone.
  # order.city_id = ville du restaurant ; la localité de livraison vient de addressId (geom + repère).
  -> { order, payment? }
     # methodCode='cash_on_delivery' -> order.status='placed', pas de payment async
     # sinon -> order.status='awaiting_payment', order.expiresAt fourni, payment créé 'pending'
GET  /v1/orders                  ?status&cursor                  200  self
GET  /v1/orders/:id                                              200  owns-order  -> détail + statut + livraison + livreur
POST /v1/orders/:id/cancel       {reason}  (Idempotency-Key)     200  owns-order  (libre avant 'preparing' ; sinon règle métier ; refund auto si payé)
     # 0.22.0 (docs/37) : depuis awaiting_payment, placed, confirmed ; 409 ensuite ; reason facultatif ;
     # sans Idempotency-Key (une 2e annulation répond 409, la transition empêche tout double effet)
POST /v1/orders/:id/review       {restaurantRating, courierRating?, comment?}  201  owns-order
GET  /v1/orders/:id/tracking                                     200  owns-order  -> snapshot ; live via WS
```

## 7.7 Endpoints — Paiements

```text
POST /v1/payments                (Idempotency-Key)               201  owns-order
  body: { orderId, methodCode, providerCode, payerPhone? }
  -> { paymentId, status, action?: { type:'ussd_push'|'redirect'|'none', url?, instructions? }, expiresAt? }
GET  /v1/payments/:id                                            200  owns-order|admin  -> { status, amount: Money, provider, attemptNo, needsReviewReason? }
POST /v1/payments/:id/retry      (Idempotency-Key)               201  owns-order  -> nouvelle tentative (nouvelle ligne payment, attemptNo++) ; body {methodCode?, providerCode?, payerPhone?}
POST /v1/payments/:id/cancel     (Idempotency-Key)               200  owns-order|admin  -> { status } ; 409 si déjà 'succeeded'
POST /v1/payments/webhook/:provider   (signé)                    200  public   -> insert webhook_events (dédup) ; 200 < 1 s ; traitement async
```

## 7.8 Endpoints — Restaurant (`/v1/restaurant/*`, `resto-scope`)

```text
GET   /v1/restaurant/orders        ?status                       200   (live via WS restaurant:{id})
POST  /v1/restaurant/orders/:id/accept   {prepMinutes}           200   # uniquement si payée OU cash
POST  /v1/restaurant/orders/:id/reject   {reason}                200   # refund auto si déjà payé
      # 0.22.0 : route réelle POST /v1/orders/:id/reject ; remboursement automatique fait (docs/37)
POST  /v1/restaurant/orders/:id/ready                            200
GET   /v1/restaurant/profile ; PATCH /v1/restaurant/profile      200
GET   /v1/restaurant/hours ; PUT /v1/restaurant/hours            200   # heures en tz de la ville
POST  /v1/restaurant/toggle-open   {open}                        200
GET/POST/PATCH/DELETE /v1/restaurant/categories                        200/201/200/204
GET/POST/PATCH/DELETE /v1/restaurant/products  (prix = Money)          200/201/200/204
PATCH /v1/restaurant/products/:id/availability  {isAvailable}    200
GET/POST/PATCH/DELETE /v1/restaurant/products/:id/option-groups[/options]
GET/POST/PATCH/DELETE /v1/restaurant/promotions
GET   /v1/restaurant/stats         ?from&to                      200
GET   /v1/restaurant/wallet                                      200   -> { pending: Money, available: Money }
GET   /v1/restaurant/wallet/transactions   ?cursor               200
POST  /v1/restaurant/payouts       {amount: Money}  (Idempotency-Key)  201   -> payout 'requested'
POST  /v1/uploads/sign             {contentType, kind}           200
```

## 7.9 Endpoints — Livreur (`/v1/courier/*`, `courier-self`)

```text
POST /v1/courier/online          {online}                        200
POST /v1/courier/location        {points:[{lat,lng,heading,speed,accuracy,recordedAt}]}  202   # batch, throttlé
GET  /v1/courier/offers                                          200   (aussi WS courier:{id})
POST /v1/courier/offers/:id/accept   (Idempotency-Key)           200   # FOR UPDATE ; 409 OFFER_TAKEN
POST /v1/courier/offers/:id/decline                              200
GET  /v1/courier/deliveries/:id                                  200
POST /v1/courier/deliveries/:id/arrived-restaurant               200
POST /v1/courier/deliveries/:id/picked-up      (Idempotency-Key) 200
POST /v1/courier/deliveries/:id/arrived-customer                 200
POST /v1/courier/deliveries/:id/delivered      (Idempotency-Key) 200   {proofPhotoFileId?, customerCode?, note?}
POST /v1/courier/deliveries/:id/failed         {reason}          200
GET  /v1/courier/earnings         ?from&to                       200
GET  /v1/courier/wallet                                          200   -> { pending: Money, available: Money, cashFloat: Money }
POST /v1/courier/payouts          {amount: Money}  (Idempotency-Key)   201
```

## 7.10 Endpoints — Admin (`/v1/admin/*`)

```text
GET   /v1/admin/dashboard                                        200  admin
GET   /v1/admin/orders            ?status&restaurant&courier&from&to&cursor   200  admin
GET   /v1/admin/orders/:id                                       200  admin
POST  /v1/admin/orders/:id/cancel            {reason}            200  admin+stepup   (si commande payée)
      # 0.22.0 (docs/37) : awaiting_payment, puis de placed à courier_assigned ; livraison arrêtée ; remboursement automatique
POST  /v1/admin/orders/:id/reassign-courier  {courierId}         200  admin
GET/POST/PATCH /v1/admin/restaurants                                  200/201/200  admin
POST  /v1/admin/restaurants/:id/suspend|activate                 200  admin+stepup
PATCH /v1/admin/restaurants/:id/commission   {ruleRef|rateBps}   200  admin+stepup
GET/POST/PATCH /v1/admin/users                                        200  admin
POST  /v1/admin/users/:id/suspend                                200  admin+stepup
GET   /v1/admin/couriers                                         200  admin
POST  /v1/admin/couriers/:id/approve|reject|suspend              200  admin+stepup
GET   /v1/admin/payments          ?status&provider&from&to&cursor 200  admin
GET   /v1/admin/payments/:id                                     200  admin
POST  /v1/admin/payments/:id/refund   {amount: Money, reason}  (Idempotency-Key)  201  admin+stepup
GET   /v1/admin/refunds                                          200  admin|finance   (0.22.0 : remboursements à faire à la main ou refusés)
POST  /v1/admin/refunds/:id/complete  {providerRef}              200  admin|finance+stepup   (0.22.0 : argent renvoyé à la main)
GET   /v1/admin/webhook-events     ?provider&status&cursor       200  admin
POST  /v1/admin/webhook-events/:id/replay                        202  admin+stepup
GET   /v1/admin/ledger/accounts   ?ownerType&ownerId             200  admin
GET   /v1/admin/ledger/entries    ?accountId&entryGroup&from&to&cursor  200  admin
GET   /v1/admin/settlements       ?provider&status&cursor        200  admin
GET   /v1/admin/settlements/:id                                  200  admin
POST  /v1/admin/settlements/import {provider, sourceRef}         202  admin+stepup   (déclenche l'ingestion+matching)
GET   /v1/admin/payouts           ?status&cursor                 200  admin
POST  /v1/admin/payouts/:id/approve                              200  admin+stepup
POST  /v1/admin/payouts/:id/retry     (Idempotency-Key)          202  admin+stepup
GET   /v1/admin/disputes          ?status&cursor                 200  admin        (réservé — non câblé MVP)
GET/POST/PATCH /v1/admin/commission-rules ; /v1/admin/tax-rules       200/201/200  admin+stepup
GET/POST/PATCH /v1/admin/payment-provider-configs                     200/201/200  admin+stepup
GET/POST/PATCH /v1/admin/countries ; /v1/admin/cities ; /v1/admin/currencies  200  super_admin
GET   /v1/admin/promotions (CRUD)                                     admin
GET   /v1/admin/support/tickets (CRUD + messages)                     admin
GET   /v1/admin/audit-logs        ?entityType&entityId&actor&cursor   200  admin
GET/PATCH /v1/admin/feature-flags[/:key]                              200  admin+stepup
GET/PATCH /v1/admin/platform-settings                                 200  admin+stepup
```

## 7.11 Système

```text
GET /v1/health ; GET /v1/ready                                   200  public
```

## 7.12 WebSocket (namespace `/rt`, auth JWT à la connexion)

```text
client  -> subscribe { room }        (autorisation serveur : owns-order | resto-scope | courier-self | admin)
server  -> order.status        { orderId, status, at, etaMinutes }
server  -> delivery.status     { deliveryId, status, at }
server  -> courier.location    { deliveryId, lat, lng, heading, at }     # throttle 5–10 s
server  -> order.eta           { orderId, etaMinutes }
server  -> payment.status      { orderId, paymentId, status, at }        # awaiting_payment -> placed / expired
restaurant room: restaurant.order.new / order.updated
courier room:    courier.offer.new { offerId, expiresAt, pickup, dropoffApprox, fee: Money }, courier.offer.expired
admin room:      ops.alert { type, severity, ref }                       # inclut settlement.discrepancy, needs_review
```

Fallback : WS indisponible → polling `GET /v1/orders/:id/tracking` (10–20 s) + `GET /v1/payments/:id`.

## 7.13 Sécurité API (rappel — détail doc 12)

Validation Zod systématique · RBAC + **portée par endpoint (table §7.1)** · **step-up MFA** sur actions financières · rate limit (agressif OTP) · idempotence **DB-backed** · **signature webhook = source de confiance** (+ allowlist IP en défense complémentaire) · pas de données PAN · masquage payloads sensibles en logs · `Money` en string · CORS allowlist · `traceId` sur toute réponse.

## 7.14 Versionnement & compatibilité

- `/v1` préfixe ; `/v2` en parallèle si cassure ; `Deprecation`/`Sunset`.
- `GET /v1/config/public` renvoie `minAppVersion` → l'app force la mise à jour si trop ancienne.
- Ajout d'un nouveau `paymentProvider` = **aucune** évolution d'API (data-driven via `GET /v1/config/payment-methods`).
- Ajout d'un nouveau pays/devise = **aucune** évolution de contrat (Money générique).
