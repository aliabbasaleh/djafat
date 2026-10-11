# 36 — Scénario pilote E2E (prêt à exécuter, jamais simulé)

> **Mise à jour — pilote réel exécuté.** Docker a été installé et l'environnement
> complet (Postgres+PostGIS, PgBouncer, Redis, API, worker, web, restaurant) a réellement
> tourné. Ce scénario a été rejoué mot pour mot ; 8 bugs P0 réels ont été trouvés et
> corrigés en cours de route (jamais exécuté avant — voir le rapport du pilote pour le
> détail et le verdict). §0 reste la procédure de démarrage exacte utilisée ; deux
> lacunes produit réelles (hors bug) ont stoppé le parcours avant la fin — voir le
> rapport.

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

Quatre secrets du `.env.example` sont des placeholders littéraux et DOIVENT être
remplacés avant de démarrer l'API (sinon échec au démarrage ou au premier flux MFA) :
`JWT_ACCESS_SECRET`, `REFRESH_TOKEN_HASH_SECRET`, `OTP_HASH_SECRET` (chaîne aléatoire,
32+ caractères) et `MFA_ENCRYPTION_KEY` (doit décoder en **exactement 32 octets** —
`apps/api/src/modules/auth/crypto.util.ts` lève un `RangeError` sinon, au premier usage
MFA). Générer chaque valeur avec :

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

Dette connue, non ré-investiguée (docs/34 §dette, docs/35 §dette) : `expo
export`/`expo start` échoue sur `expo-modules-core` non résolu dans cet environnement
pnpm. Non bloquant pour ce pilote : le parcours client (étapes 1-9, 17-19) reste
entièrement couvert par `apps/web`. Le livreur (étapes 14-16) nécessite `apps/courier`
réellement démarré — si Expo ne démarre pas sur la machine d'exécution, ces 3 étapes
précises restent `BLOCKED` même avec Docker up ; le reste du scénario ne l'est pas.

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

| #   | Action                  | Appel                                                                           | Vérifier                                                                                |
| --- | ----------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 14  | Offre + prise en charge | `GET /couriers/me/offers` puis `POST /deliveries/<id>/accept` (Idempotency-Key) | `context.restaurantName`/`dropoffAddress` lisibles (Bloc 11)                            |
| 15  | Progression             | `POST /deliveries/<id>/pickup` → `POST /deliveries/<id>/deliver` `{proofCode}`  | le `proofCode` est celui réellement généré côté serveur à l'assignation (jamais deviné) |
| 16  | Livrée                  | statut final                                                                    | `delivery.status === 'delivered'`, `order.status === 'delivered'`                       |

**Isolation à vérifier** : un autre livreur seedé ne doit pouvoir ni accepter
(`403`/`409` selon l'état), ni voir cette livraison dans `GET /couriers/me/deliveries`.

### Client (étapes 17-19)

| #   | Action     | Appel                                                                              | Vérifier                                                                             |
| --- | ---------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 17  | État final | `GET /orders/<id>`                                                                 | `status:'delivered'`, montants identiques à l'étape 7 (jamais recalculés après coup) |
| 18  | Historique | `GET /orders` côté mobile (ou web `/commandes`)                                    | la commande apparaît                                                                 |
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
