# 36 — Scénario pilote E2E (prêt à exécuter, jamais simulé)

> Statut à la date de rédaction : **E2E BLOCKED** — Docker indisponible dans cet
> environnement (`docker: command not found`, port 5432/6379 refusés). Ce document est
> la préparation explicitement demandée : un scénario reproductible, câblé sur les
> fixtures réelles du seed, prêt à être rejoué **mot pour mot** dès qu'un environnement
> PostgreSQL/HTTP réel est disponible. Rien ici n'a été exécuté contre une vraie base —
> voir §0.

## 0. Comment l'exécuter réellement (dès que Docker est disponible)

```bash
# 1. Infra (Postgres+PostGIS, PgBouncer, Redis, MinIO, mock-SMS, mock-PSP, Mailhog)
cd infra && docker compose up -d
# 2. API (dans un terminal séparé)
cd apps/api && pnpm prisma migrate deploy && pnpm prisma db seed && pnpm dev
# 3. Les commandes curl de ce document s'exécutent ensuite telles quelles.
```

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

# Lire le code envoyé (mock-sms conserve les 50 derniers messages)
curl -s http://localhost:4020/messages | jq '.messages[0]'
# -> extraire le code à 6 chiffres du corps du message

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
