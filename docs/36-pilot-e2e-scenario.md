# 36 — Scénario pilote E2E (prêt à exécuter, jamais simulé)

> **Second pilote réel : 19/19 PASS.** Docker installé, environnement complet
> (Postgres+PostGIS, PgBouncer, Redis, worker, API, web, restaurant) réellement en
> marche, scénario rejoué mot pour mot et reproduit trois fois de suite. Le parcours
> métier complet aboutit : commande payée, préparée, prise en charge, **livrée**,
> commande finale `delivered`, historique client accessible, wallets cohérents
> (+4800 XAF restaurant / +1000 XAF livreur par commande, vérifiés en base).
>
> Chemin parcouru :
>
> - **1er pilote** → `PILOT NO-GO`. 8 bugs P0 d'infrastructure/câblage trouvés et
>   corrigés (commit `91fb908`) — tous invisibles aux tests unitaires parce qu'aucun
>   ne portait sur le câblage réel Nest/Prisma/PgBouncer. Deux lacunes produit ont
>   ensuite stoppé le parcours : le **code de preuve de livraison n'atteignait
>   personne** et il n'existait **aucun historique client**.
> - **Clôture technique** → les deux lacunes construites, la cause réelle du
>   non-fonctionnement du temps réel trouvée et corrigée (course
>   d'authentification du socket), les `:id` malformés reclassés 400 au lieu de
>   500 sur toute l'API, et des régressions ajoutées là où leur absence avait
>   laissé passer les bugs P0. Détail et dette résiduelle : §6.
>
> §0 reste la procédure de démarrage exacte utilisée.

## 0. Runbook — comment l'exécuter réellement (dès que Docker est disponible)

Tout ce qui suit réutilise les scripts déjà présents dans le dépôt (`package.json` racine,
`apps/api/package.json`) — rien de nouveau n'a été écrit pour cette préparation.

### 0.0 Prérequis

Node ≥ 20, pnpm ≥ 9 (`corepack enable`), Docker + Docker Compose v2. Sous Windows sans
Docker Desktop natif : Docker à l'intérieur de WSL2 fonctionne aussi — mais aucune
distribution WSL n'était installée au moment de la rédaction (voir rapport).

### 0.1 Variables d'environnement

```bash
cp .env.example .env
```

Cinq secrets du `.env.example` sont des placeholders littéraux et DOIVENT être
remplacés avant de démarrer l'API (sinon échec au démarrage, au premier flux MFA, ou à
la première lecture d'un code de livraison) : `JWT_ACCESS_SECRET`,
`REFRESH_TOKEN_HASH_SECRET`, `OTP_HASH_SECRET` (chaîne aléatoire, 32+ caractères), puis
`MFA_ENCRYPTION_KEY` et `DELIVERY_CODE_ENCRYPTION_KEY` — ces deux dernières doivent
décoder en **exactement 32 octets** (AES-256) et rester **distinctes** : une fuite ou
une rotation ne doit jamais couvrir deux domaines de secrets. Générer chaque valeur
avec :

```bash
openssl rand -base64 32
```

### 0.2 Infrastructure (Postgres 16+PostGIS 3.5, PgBouncer, Redis 7, MinIO, Mailpit, mock-psp, mock-sms)

```bash
pnpm install
pnpm infra:up                                        # = docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml ps        # attendre "healthy" sur postgres/pgbouncer/redis/minio
```

### 0.3 Migrations + seed

```bash
pnpm db:migrate     # prisma migrate deploy (passe par DIRECT_DATABASE_URL, port 5432)
pnpm db:seed        # apps/api/prisma/seed.ts — comptes/fixtures du §1 ci-dessous
```

### 0.4 API

```bash
pnpm --filter @djafat/api dev     # nest start --watch — http://localhost:3001
curl -s http://localhost:3001/v1/ready
# -> {"status":"ready","checks":{"postgres":{"ok":true},"redis":{"ok":true}}}
```

Ne pas démarrer les applications ni dérouler le scénario avant que `/v1/ready`
renvoie `"ready"` pour `postgres` **et** `redis`.

### 0.5 Applications web (web :3000, admin :3002, restaurant :3003)

```bash
pnpm dev     # turbo run dev --parallel — démarre api+web+admin+restaurant ensemble
             # (remplace 0.4 si lancé seul ; sinon pnpm --filter @djafat/web dev, etc.)
```

### 0.6 Courier / Mobile — Expo (optionnel pour ce pilote)

```bash
pnpm --filter @djafat/courier start
pnpm --filter @djafat/mobile start
```

Dette connue (§6.3) : le bundling Expo échoue parce que le résolveur Metro parcourt
les `node_modules` physiques, incompatible avec l'isolation pnpm. **Non bloquant pour
ce pilote** : les étapes 1-19 s'exécutent toutes contre l'API réelle, et le parcours
client est aussi couvert par `apps/web`. Le mobile n'est PAS production-ready tant que
son chemin de build réel (`eas build`) n'a pas été validé.

### 0.7 Exécuter le scénario

Une fois `/v1/ready` à `"ready"` et les applications nécessaires démarrées, dérouler
la §3 ci-dessous **mot pour mot**, dans l'ordre, en vérifiant chaque critère listé —
jamais en supposant qu'une étape a réussi parce que la requête précédente a réussi.

Base URL API : `http://localhost:3001/v1`. Mock SMS (pour lire l'OTP envoyé) :
`http://localhost:4020/messages`.

## 1. Fixtures réelles utilisées (seed, `apps/api/prisma/seed.ts`)

| Rôle             | Téléphone      | Détail                                                                   |
| ---------------- | -------------- | ------------------------------------------------------------------------ |
| Client           | `+23566000001` | "Client Test" — a déjà une adresse par défaut géocodée (Klemat, Rue 42)  |
| Livreur          | `+23566000002` | "Livreur Test" — déjà `online`, position fraîche près du restaurant test |
| Restaurateur     | `+23566000003` | "Restaurateur Test" — `restaurant_owner` sur `chez-fatime`               |
| Staff restaurant | `+23566000004` | "Staff Restaurant Test"                                                  |

Restaurant : slug `chez-fatime` (téléphone `+23566100001`), actif, avec menu seedé.

## 2. Authentification (mécanique commune à chaque acteur)

```bash
# Demander un code OTP
curl -s -X POST http://localhost:3001/v1/auth/otp/request \
  -H 'content-type: application/json' \
  -d '{"phone":"+23566000001","purpose":"login"}'

# Lire le code — en développement, MockOtpDeliveryProvider le stocke
# directement dans Redis (il n'appelle JAMAIS mock-sms malgré SMS_MOCK_URL ;
# découvert en exécution réelle, corrigé ici — voir rapport du pilote).
docker exec djafat-dev-redis-1 redis-cli GET "otp:mock:+23566000001"

# Vérifier — renvoie {access, refresh, user}
curl -s -X POST http://localhost:3001/v1/auth/otp/verify \
  -H 'content-type: application/json' \
  -d '{"phone":"+23566000001","code":"<CODE_LU>","purpose":"login"}'
```

À rejouer pour chaque acteur (`+23566000001` client, `...002` livreur, `...003`
restaurateur) — chacun obtient son propre `access` token, utilisé en
`Authorization: Bearer <token>` pour tout ce qui suit.

## 3. Scénario — étape par étape

### Client (étapes 1-9)

| #   | Action                | Appel                                                                                                       | Vérifier                                                                                                     |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | Login                 | §2 avec `+23566000001`                                                                                      | `user.roles` contient `customer`                                                                             |
| 2   | Choix restaurant      | `GET /restaurants` puis `GET /restaurants/chez-fatime`                                                      | `availability` cohérent avec les horaires seedées                                                            |
| 3   | Menu                  | `GET /restaurants/chez-fatime/menu`                                                                         | au moins 1 catégorie avec produits `isAvailable:true`                                                        |
| 4   | Ajout produit+options | `POST /carts/items` `{productId, quantity:2, selectedOptionIds:[...]}`                                      | `cart.items[0].quantity === 2`                                                                               |
| 5   | Panier                | `GET /carts`                                                                                                | items présents                                                                                               |
| 6   | Adresse               | `GET /users/me/addresses` (déjà 1 par défaut seedée)                                                        | `isDefault:true` sur une adresse                                                                             |
| 7   | Checkout (quote)      | `POST /carts/quote`                                                                                         | `total === subtotal + deliveryFee` (± frais/remise à 0 sur ce seed)                                          |
| 8   | Création commande     | `POST /orders` header `Idempotency-Key: <uuid>` body `{}` (adresse par défaut)                              | **rejouer avec la MÊME clé** → doit renvoyer `status:"replayed"`, le MÊME `order.id`, jamais une 2ᵉ commande |
| 9   | Suivi temps réel      | WebSocket `wss://localhost:3001/rt` namespace, `auth:{token}`, puis `emit('subscribe',{room:'order:<id>'})` | un événement arrive à chaque transition ci-dessous                                                           |

**Double-submit à tester explicitement à l'étape 8** : envoyer la requête `POST /orders`
DEUX FOIS en parallèle avec la MÊME `Idempotency-Key` (ex. `curl ... & curl ... & wait`)
— les deux réponses doivent porter le même `order.id`, et `SELECT count(*) FROM orders
WHERE idempotency_key = '<key>'` doit valoir **1**.

### Restaurant (étapes 10-13, acteur `+23566000003`)

| #   | Action      | Appel                                         | Vérifier                                                                                                                                                               |
| --- | ----------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | Réception   | `GET /orders` (scope restaurant)              | la commande de l'étape 8 apparaît, statut `placed`                                                                                                                     |
| 11  | Acceptation | `POST /orders/<id>/confirm`                   | statut → `confirmed` ; le client reçoit l'event realtime                                                                                                               |
| 12  | Préparation | (transition automatique via `ready`, voir 13) | —                                                                                                                                                                      |
| 13  | Prêt        | `POST /orders/<id>/ready`                     | `markReady` applique DEUX transitions séquentielles (`preparing` puis `ready`, deux lignes dans `orderStatusHistory`) en un seul appel ; déclenche le dispatch livreur |

**Isolation à vérifier à l'étape 10** : avec le token du restaurateur d'un AUTRE
restaurant seedé (ex. `le-sahel-grill`), `GET /orders` ne doit JAMAIS renvoyer la
commande de `chez-fatime` ; `GET /orders/<id>` sur cette commande doit renvoyer **404**
(jamais 403 — ne révèle pas l'existence).

### Livreur (étapes 14-16, acteur `+23566000002`)

| #   | Action                  | Appel                                                                                       | Vérifier                                                                                                                     |
| --- | ----------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 14  | Offre + prise en charge | `GET /couriers/me/offers` puis `POST /deliveries/<id>/accept` (Idempotency-Key)             | `context.restaurantName`/`dropoffAddress` lisibles (Bloc 11)                                                                 |
| 15  | Progression             | `POST /deliveries/<id>/pickup`, puis le CLIENT lit son code via `GET /deliveries/<id>/code` | le code vient du serveur, jamais deviné ; le livreur qui le demande est refusé ; un mauvais code renvoie 409 `INVALID_PROOF` |
| 16  | Livrée                  | statut final                                                                                | `delivery.status === 'delivered'`, `order.status === 'delivered'`                                                            |

**Isolation à vérifier** : un autre livreur seedé ne doit pouvoir ni accepter
(`403`/`409` selon l'état), ni voir cette livraison dans `GET /couriers/me/deliveries`.

### Client (étapes 17-19)

| #   | Action     | Appel                                                                              | Vérifier                                                                             |
| --- | ---------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 17  | État final | `GET /orders/<id>`                                                                 | `status:'delivered'`, montants identiques à l'étape 7 (jamais recalculés après coup) |
| 18  | Historique | `GET /orders/mine` (§6.1 — créé par la clôture du pilote)                          | la commande apparaît ; un autre client ne la voit JAMAIS                             |
| 19  | Wallet     | `GET /restaurants/me/balance` (restaurateur), `GET /couriers/me/balance` (livreur) | `pending`/`available` reflètent la commission/le `courierFee` de l'étape 7           |

## 4. Points de vigilance transverses (à vérifier à CHAQUE étape, pas seulement listés une fois)

- **Idempotence** : toute mutation (`accept`, `pickup`, `deliver`, `confirm`, `ready`,
  `orders.create`) rejouée avec la même clé ne doit jamais dupliquer ni régresser l'état.
- **Isolation utilisateur** : échanger un `id` (commande, adresse, livraison) contre
  celui d'un autre acteur doit toujours produire 404 (jamais 403, jamais les données).
- **Cohérence des montants** : le total facturé (étape 7) doit être celui affiché à
  l'étape 17 — aucun recalcul silencieux en cours de route.
- **Erreurs réseau/retry** : couper la connexion juste après un `POST` dont la requête
  a atteint le serveur, puis rejouer avec la même clé — doit converger, jamais dupliquer.

## 5. Ce qui a été vérifié SANS exécution réelle (statique, légitime)

- Chaque route listée ci-dessus a un test unitaire/d'intégration correspondant déjà
  vert (`apps/api` 773/773 au moment de la rédaction) couvrant exactement les
  comportements d'isolation/idempotence énumérés en §4 — voir docs/32/33/34 pour le
  détail par famille de bug.
- `tsc`/`eslint`/`prettier`/`next build` verts sur `apps/web`, `apps/admin`,
  `apps/restaurant` ; `tsc`/`eslint`/tests unitaires verts sur `apps/courier`,
  `apps/mobile`.

Rien de ce qui précède ne remplace l'exécution réelle de ce scénario — c'est la
préparation, pas la validation.

## 6. Clôture technique du pilote

### 6.1 Ce que le pilote réel a trouvé, et ce qui a été corrigé

| Trouvé en exécution réelle                                                                                                                                                                                                                                                                                                                         | Sévérité           | Correction                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8 bugs d'infrastructure/câblage (PgBouncer `LISTEN_PORT`/`search_path`, `pgbouncer=true`, `PRIMARY KEY` avec `COALESCE` en migration 0003, `USAGE` manquant sur le schéma pour `djafat_ledger`, `COURIER_FEE_POOL` non seedé, 8 modules sans `AuthModule`, `@fastify/static`, parser JSON en doublon)                                              | P0                 | commit `91fb908`                                                                                                                                                      |
| Code de preuve de livraison généré, haché, **émis sur un événement sans aucun écouteur** — aucun client ne pouvait jamais l'obtenir, donc `confirmDelivered` ne pouvait que répondre `INVALID_PROOF`                                                                                                                                               | P0                 | stocké **chiffré** (AES-256-GCM, `DELIVERY_CODE_ENCRYPTION_KEY`, colonne `delivery_proofs.reference`) + `GET /v1/deliveries/:id/code`, réservé au client propriétaire |
| Aucun endpoint d'historique client (`GET /orders` est le tableau cuisine, restaurant-only)                                                                                                                                                                                                                                                         | P0                 | `GET /v1/orders/mine`, scoped sur `actor.userId` uniquement, + binding SDK                                                                                            |
| Temps réel jamais reçu côté client : Socket.IO ne bloque la livraison des messages que sur un middleware (`server.use`), jamais sur `handleConnection` — un `subscribe` immédiat après `connect` arrivait pendant la résolution de l'acteur et était **silencieusement ignoré** (socket connectée mais sourde, sans erreur visible pour réessayer) | P1                 | authentification déplacée dans `afterInit`'s `server.use` ; `handleConnection` intact                                                                                 |
| `:id` malformé → 500 sur ~40 routes (aucune ne valide le format)                                                                                                                                                                                                                                                                                   | sécurité/fiabilité | reclassé 400 `VALIDATION_ERROR` centralement dans `AllExceptionsFilter` (Prisma `P2023` **et** `P2010`/Postgres `22P02` pour les requêtes brutes)                     |
| Exclusion de dispatch : tout livreur jamais sollicité était exclu **à jamais**, expiration comprise — avec un seul livreur en ligne, le dispatch se bloquait dès la première offre expirée                                                                                                                                                         | P0                 | `offered`/`rejected` exclus, `expired` seulement pendant un cooldown d'une fenêtre d'offre ; corrigé **dans les deux copies** (API + worker)                          |
| `context` brut (bigint) sérialisé en réponse HTTP → crash Fastify sur les deux endpoints livreur                                                                                                                                                                                                                                                   | P0                 | `toJsonSafeContext`                                                                                                                                                   |

### 6.2 Régressions ajoutées là où leur absence avait laissé passer les bugs

- Le mock SQL du worker **ignorait la clause `WHERE`** de la requête d'exclusion : il
  ne pouvait donc pas échouer sur une clause fausse. Rendu fidèle, puis deux tests
  pinnent le scénario exact du pilote (livreur unique re-sollicité après cooldown ;
  livreur ayant refusé jamais re-sollicité).
- `delivery-code-retrieval.spec.ts` : 11 tests, dont le refus du **livreur assigné**
  et le round-trip `getCode → confirmDelivered → delivered`.
- `orders-customer-history.spec.ts` : 8 tests d'isolation (portée, total, filtre).
- `all-exceptions.filter.spec.ts` : les deux formes de `:id` malformé, et le fait
  qu'une autre erreur Prisma reste un 500.
- `realtime-connection.spec.ts` : 5 tests sur l'ordre d'authentification du socket.
- `courier-listings-context.spec.ts` : absence de bigint dans les payloads HTTP.

### 6.3 Dette résiduelle assumée (connue, non bloquante)

| Dette                                                                                                                                                                    | Pourquoi elle reste                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Déclencheur                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `apps/courier`/`apps/mobile` : `expo export` ne bundle pas                                                                                                               | Cause désormais **précise** : le résolveur Metro parcourt les `node_modules` physiques, incompatible avec l'isolation pnpm (après `expo-modules-core`, c'est `invariant`, transitif de react-native). Le correctif réel est un changement de linker à l'échelle du monorepo (`node-linker=hoisted`) ou une config résolveur Metro — risque direct sur web/admin/restaurant, disproportionné hors pilote. Le script `build` cible désormais ios+android (ce que ces apps livrent réellement), et `expo-modules-core` est déclaré. **Le mobile n'est PAS production-ready : son chemin de build réel (`eas build`) n'a jamais été validé.** | avant toute livraison mobile                                    |
| MinIO / `ObjectStoragePort` placeholder                                                                                                                                  | Image `minio/minio` fermée côté Docker Hub **et** Quay (politique amont, vérifié). Aucun appel réel dans le code (toute méthode lève). Aucun impact sur le parcours pilote.                                                                                                                                                                                                                                                                                                                                                                                                                                                               | premier besoin d'upload réel (photo de preuve, logo restaurant) |
| Mobile Money réel (Airtel/Moov), réconciliation PSP automatisée, webhook de remboursement asynchrone                                                                     | Hors parcours pilote ; `cash`+`mock` suffisent à valider la chaîne paiement→ledger→commande. Chantiers produit, pas des bugs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | accès PSP obtenu                                                |
| Notifications : aucun binding SDK/frontend, pas de canal SMS/EMAIL, push en mock                                                                                         | Backend complet depuis Bloc 7 mais jamais consommé. Nouveau travail fonctionnel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | besoin produit explicite                                        |
| Adaptateur Socket.IO Redis non prouvé **multi-instances**                                                                                                                | Configuré et actif, mais le pilote n'a fait tourner qu'UNE instance API. Le fan-out cross-instance reste donc raisonné, pas démontré.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | premier déploiement à ≥2 instances                              |
| Observabilité : `SENTRY_DSN`/`OTEL_*` validés au boot mais aucun SDK installé                                                                                            | Donne l'illusion d'un pipeline en place. Intégration = nouveau chantier.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | avant mise en production                                        |
| Dettes MFA/step-up du Bloc 9.1 (suspend/block/reactivate sans step-up, 428 non audité, `reactivate` d'un compte `deleted`, grants survivant à un blocage)                | Explicitement acceptées en Bloc 9.1, non rouvertes ici (hors mandat de clôture)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | durcissement admin                                              |
| Pas de trigger DB pour « 1 livreur = 1 livraison active » / « 1 offre vivante par livraison »                                                                            | Contrôle applicatif + index partiels de la migration 0024 ; dette déjà assumée docs/25 §22                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | incident réel de concurrence                                    |
| Un code de preuve émis AVANT ce correctif est irrécupérable (seul son hash existe) ; seul `POST /deliveries/:id/fail` débloque la livraison, il n'y a pas de ré-émission | Impossible dans un environnement neuf (tout code est désormais stocké chiffré). A été utilisé une fois, par le chemin produit, pour libérer la livraison bloquée du 1er pilote.                                                                                                                                                                                                                                                                                                                                                                                                                                                           | besoin ops de ré-émettre un code                                |
| `test:int` exige d'exporter `.env` à la main (aucun chargeur dotenv dans le dépôt)                                                                                       | `@djafat/config` lit `process.env` nu, par conception. Contournement connu : `set -a && source .env && set +a`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | industrialisation CI                                            |
| `socket-io-redis-adapter.spec.ts` échoue parfois sous charge parallèle (passe isolé)                                                                                     | Test sensible au temps, pas un défaut produit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | instabilité CI récurrente                                       |

### 6.4 Comment rejouer le pilote

Les deux harnais utilisés (parcours 19 étapes et revue de sécurité ciblée) vivent dans
le scratchpad de session et ne sont pas versionnés : ce document reste la source de
vérité du scénario. Points à connaître pour le rejouer :

- le limiteur de débit OTP est **réel** et se déclenche après quelques dizaines de
  connexions (429 `RATE_LIMITED`) — le purger côté environnement de test, jamais
  l'affaiblir côté produit ;
- l'environnement seed ne contient **qu'un seul livreur** : une livraison laissée en
  `searching_courier` par un run précédent sera offerte avant la nouvelle. Sélectionner
  l'offre dont `context.orderId` correspond, et rejeter les autres ;
- la commande suit sa livraison via outbox → stream Redis → `@OnEvent` (relais toutes
  les 2 s) : attendre l'état `delivered` en boucle, ne pas supposer un délai fixe.
