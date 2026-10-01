# Bloc 7 — Realtime + Notifications

> Verdict : 🟢 **GO**, avec une dette explicitement déclarée (adaptateur Redis
> Socket.IO, provider push réel, Docker/PostgreSQL).
>
> Le fait marquant de ce bloc : la chaîne durable que l'architecture promet
> depuis le Bloc 0 **n'était branchée nulle part**, et le suivi de commande du
> client était silencieusement mort.

---

## 1. Audit pré-code

Inspection du code réel avant toute modification (mandat §2), sur `realtime`,
`notifications`, `outbox`, `orders`, `payments`, `deliveries`, `couriers`,
`users`, `auth`, `worker`, le schéma, les migrations et les tests.

### 1.1 La chaîne était rompue en deux endroits

```
AVANT
─────
PostgreSQL → Outbox → Worker relay → Redis PUB/SUB 'domain-events' → ❌ personne
                                                                     (aucun abonné)

service → EventEmitter2 → Gateway → Socket     ← le chemin réellement emprunté
         (in-process, après COMMIT)              exactement ce que le §4 interdit
```

Le relay outbox est pourtant correct : retry, backoff exponentiel, DLQ,
`FOR UPDATE SKIP LOCKED` pour plusieurs workers. Il **publiait dans le vide** :
`PUBLISH` sur un canal sans abonné renvoie `0` et perd le message, puis le relay
marquait la ligne `published`. La chaîne durable se terminait dans un trou noir
et rien dans le système ne pouvait le détecter.

En parallèle, le realtime fonctionnait sur un chemin **in-process** sans aucune
garantie transactionnelle — précisément le motif interdit par le §4
(« UPDATE ; COMMIT ; puis envoyer WebSocket »).

### 1.2 🔴 Le bug : le suivi de commande client était mort

|                            |                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ce que la gateway écoutait | `@OnEvent('order.updated')`                                                                                                                                                                 |
| Ce que `orders` émet       | `order.placed`, `order.confirmed`, `order.preparing`, `order.ready`, `order.courier_assigned`, `order.picked_up`, `order.on_the_way`, `order.delivered`, `order.cancelled`, `order.expired` |
| Qui émet `order.updated`   | **personne**                                                                                                                                                                                |

La room `order:{id}` était correctement autorisée (testée au Bloc 6.1) et ne
recevait **jamais un seul changement de statut de commande**. Seuls les
`payment.updated` y passaient. Le handler était du code mort depuis le Bloc 6.

### 1.3 Matrice des événements constatée

| Domaine                 | Outbox (durable)      | In-process                             | Consommé par                 | Atteignait un client ?         |
| ----------------------- | --------------------- | -------------------------------------- | ---------------------------- | ------------------------------ |
| **Order**               | 10 statuts ✅         | 10 statuts ✅                          | `deliveries` (`order.ready`) | ❌ **non**                     |
| **Payment**             | 5 ✅                  | `payment.succeeded`, `payment.updated` | `orders`, gateway            | ✅ oui                         |
| **Delivery**            | 9 ✅                  | 7 ✅                                   | `orders`, `payments`         | ❌ non (aucun handler gateway) |
| **Courier**             | —                     | `courier.offer.new`                    | gateway → `courier:{id}`     | ✅ oui                         |
| **Wallet / Settlement** | déclarés, jamais émis | —                                      | —                            | —                              |

Hors catalogue : `order.updated`, `payment.updated`, `courier.offer.new` étaient
consommés par la gateway sans figurer dans `DOMAIN_EVENTS`.

### 1.4 État de l'existant

| Composant                          | État constaté                                                   |
| ---------------------------------- | --------------------------------------------------------------- |
| Outbox (table, relay, retry/DLQ)   | ✅ solide — réutilisé tel quel                                  |
| Handshake JWT + autorisation rooms | ✅ Bloc 6.1, default-deny testé                                 |
| Rooms                              | `order:{id}`, `customer:{id}`, `courier:{id}`, `admin:ops`      |
| Rooms `restaurant:*`               | ❌ refusées — dette documentée au Bloc 6.1                      |
| Adapter Redis Socket.IO            | ❌ `IoAdapter` mémoire                                          |
| `notifications`                    | ❌ `@Module({})` vide. Aucune table, aucun provider             |
| Client realtime                    | ❌ aucun. Pas de `socket.io-client`, pas d'`expo-notifications` |
| Payload outbox                     | `aggregate`, `aggregateId`, `eventType`, `payload`, `createdAt` |

---

## 2. Architecture retenue : fermer la chaîne

```
APRÈS
─────
transaction métier
  └─ INSERT outbox            (même transaction, déjà le cas)
       └─ COMMIT
            └─ worker relay (tick 2 s)
                 └─ XADD djafat:domain-events   ← DURABLE
                      └─ ligne marquée 'published' seulement maintenant
                           └─ DomainEventsConsumer (1 par instance API)
                                XREADGROUP realtime-fanout
                                 └─ emitAsync('domain-event.relayed')  ← attendu
                                      ├─ RealtimeGateway → rooms autorisées
                                      └─ NotificationsListener → ligne persistée
                                           └─ XACK (après succès des deux)
```

### 2.1 Pourquoi Redis **Streams** et non Pub/Sub

Le mandat §12 interdit de choisir Pub/Sub sans analyser le comportement
gateway-indisponible. Analyse :

|                              | Pub/Sub                           | Streams                                    |
| ---------------------------- | --------------------------------- | ------------------------------------------ |
| Gateway absente              | message **perdu**                 | entrée conservée jusqu'à l'ACK             |
| Nouvelle instance            | ne reçoit que le futur            | lit le backlog du groupe                   |
| Multi-instance               | tous reçoivent tout (duplication) | une seule par entrée (consumer group)      |
| Crash en cours de traitement | perdu                             | reste _pending_, récupéré par `XAUTOCLAIM` |
| Accusé de réception          | aucun                             | `XACK` explicite                           |

Pub/Sub est incompatible avec l'exigence du §12 (« ne pas considérer traité si
publié vers un transport volatil »). Streams est retenu. `ioredis` était déjà
une dépendance des deux côtés — aucune nouvelle brique d'infrastructure.

### 2.2 Les six questions du §12, répondues précisément

**Quand l'événement est-il marqué traité ?**
La ligne outbox passe à `published` uniquement après que `XADD` ait renvoyé un
id d'entrée. Un `XADD` qui échoue laisse la ligne `pending` avec `attempts + 1`
et un backoff exponentiel.

**Si la gateway est indisponible ?**
L'entrée reste dans le stream, non consommée. Au retour de la gateway, le
consumer group la lit. `MAXLEN ~ 100 000` borne la croissance pendant une
panne longue — au-delà, les entrées les plus anciennes sont évincées, et le
rattrapage se fait par REST côté client (§1 : le realtime n'est jamais la
source de vérité).

**Si le worker tombe après publication mais avant le COMMIT ?**
La transaction entière est annulée : l'entrée **est** dans le stream, la ligne
outbox reste `pending`. Au tick suivant, elle est republiée → **doublon**.
C'est la raison exacte pour laquelle le contrat est _at-least-once_ et non
_exactly-once_. Testé explicitement
(`outbox-relay.processor.spec.ts` → « crash AFTER publish resolves »).

**Comment les doublons sont-ils gérés ?**
Par l'id de ligne outbox, propagé partout comme clé de déduplication :

- côté client : `payload.eventId` — un client peut écarter un doublon ;
- côté notifications : `UNIQUE (user_id, dedup_key)` + `ON CONFLICT DO NOTHING`
  → une notification par (destinataire, événement métier), jamais deux ;
- côté realtime : réémettre le même événement dans une room est idempotent par
  nature (le client refetch).

Aucun composant ne garde un « seen-set » en mémoire : il serait faux après un
redémarrage.

**Comment une nouvelle instance de gateway reçoit-elle les événements ?**
Elle rejoint le consumer group `realtime-fanout` sous son propre nom de
consumer (`hostname-pid`) et `XREADGROUP` lui attribue des entrées. Au
démarrage, elle lance d'abord un `XAUTOCLAIM` pour récupérer les entrées
qu'une instance morte avait lues sans accuser réception.

**Comment le client retrouve-t-il l'état après déconnexion ?**
Par REST. Voir §6.

### 2.3 La limite honnête

La durabilité de Redis est plus faible que celle de PostgreSQL. Si Redis perd
des données (AOF désactivé, failover), des événements realtime sont perdus.

**C'est acceptable uniquement parce que** le realtime est un mécanisme de
diffusion et jamais la source de vérité : chaque client refetch par REST à la
reconnexion. Perdre un événement dégrade l'expérience ; cela ne corrompt jamais
l'état. Cette propriété est ce qui autorise le choix — elle n'est pas une
excuse ajoutée après coup.

### 2.4 La gateway n'écrit jamais d'état métier

`onRelayedDomainEvent` ne fait qu'émettre vers des rooms. Sa seule dépendance
est le serveur Socket.IO — vérifié structurellement par un test dont le
fixture ne fournit aucune dépendance capable d'écrire.

---

## 3. Catalogue canonique des événements

### 3.1 Incohérences traitées

| Incohérence                                          | Traitement                                                                                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `order.updated` consommé, jamais émis                | **Handler supprimé.** Les 10 vrais noms `order.*` sont désormais routés. Aucun renommage de masse : c'est le consommateur qui était faux, pas les producteurs. |
| `payment.updated` hors catalogue                     | Conservé comme ping in-process **non routé** ; les 7 `payment.*` du catalogue sont routés à sa place.                                                          |
| `courier.offer.new` hors catalogue                   | Conservé délibérément comme chemin in-process (voir §3.3).                                                                                                     |
| `wallet.*`, `settlement.*` déclarés, jamais produits | **Aucune route créée.** Router des événements que rien ne publie serait inventer une couverture (§13).                                                         |
| Pas d'identifiant d'événement                        | **Id de ligne outbox réutilisé** — déjà unique, déjà durable, déjà la clé de retry. Aucun champ ajouté.                                                        |
| Version d'événement                                  | **Non ajoutée.** Le §13 l'interdit si cosmétique : aucun payload n'a de second format à distinguer aujourd'hui.                                                |

### 3.2 Table de routage (`domain-event-router.ts`)

Deny-by-default : un type absent de la table n'atteint personne.

| Événement                                                     | `order:{id}` | `courier:{id}` | `restaurant:orders:{id}` | `admin:ops` |
| ------------------------------------------------------------- | ------------ | -------------- | ------------------------ | ----------- |
| `order.placed`                                                | ✅           |                | ✅                       |             |
| `order.awaiting_payment`                                      | ✅           |                |                          |             |
| `order.confirmed`                                             | ✅           |                | ✅                       |             |
| `order.preparing`                                             | ✅           |                | ✅                       |             |
| `order.ready`                                                 | ✅           |                | ✅                       |             |
| `order.courier_assigned`                                      | ✅           |                | ✅                       |             |
| `order.picked_up`                                             | ✅           |                | ✅                       |             |
| `order.on_the_way`                                            | ✅           |                |                          |             |
| `order.delivered`                                             | ✅           |                | ✅                       |             |
| `order.cancelled` / `order.expired`                           | ✅           |                | ✅                       |             |
| `payment.created/succeeded/failed/cancelled/expired/refunded` | ✅           |                |                          |             |
| `payment.needs_review`                                        |              |                |                          | ✅          |
| `delivery.created` / `searching_courier`                      | ✅           |                |                          |             |
| `delivery.searching_no_courier`                               |              |                |                          | ✅          |
| `delivery.assigned` / `accepted`                              | ✅           | ✅             |                          |             |
| `delivery.rejected`                                           |              | ✅             |                          | ✅          |
| `delivery.pickup_in_progress` / `on_the_way`                  | ✅           | ✅             |                          |             |
| `delivery.picked_up` / `delivered` / `cancelled`              | ✅           | ✅             | ✅                       |             |
| `delivery.failed`                                             | ✅           | ✅             |                          | ✅          |
| `courier.status_changed`                                      |              | ✅             |                          |             |

**Délibérément absents :**

- `delivery.code_issued` — porte le code de livraison en clair. In-process
  uniquement, jamais sur un socket (docs/25 §B6.1-7).
- `courier.location_updated` — carte client en direct : périmètre reporté
  (docs/25 §23, §31). Diffuser une position exigerait un throttle et une
  recherche de commande active sur chaque écriture.
- `wallet.*`, `settlement.*` — aucun producteur.

**Décisions de confidentialité notables :**

- Les paiements ne vont **qu'**à la room commande. Le restaurant apprend que la
  commande est confirmée, jamais comment elle a été payée.
- `delivery.rejected` ne va **pas** au client : il voit seulement que la
  recherche continue.
- `delivery.searching_no_courier` va à ops seulement — dire au client « aucun
  livreur » avant qu'ops ait pu agir serait pire que le silence.

### 3.3 Le cas `courier.offer.new`

Seul événement encore diffusé in-process. Une offre expire en 30 s (docs/25
§15) ; un tick de relay de 2 s en consommerait un quinzième. La ligne outbox
`delivery.assigned` porte le même fait par la chaîne durable, donc rien n'est
perdu si ce saut in-process est manqué : c'est une **optimisation de latence
par-dessus** le chemin durable, jamais à sa place.

### 3.4 Payload réellement émis

```ts
{ eventId, eventType, aggregateId, occurredAt, orderId?, deliveryId?, status? }
```

Projection fixe (§11) : un payload métier ne peut pas faire passer un champ
clandestinement. Vérifié par un test qui injecte un téléphone, un montant et un
code dans le payload source et exige qu'aucun n'apparaisse en sortie.

---

## 4. Sécurité des rooms

Réutilise le handshake JWT et l'autorisation du Bloc 6.1, inchangés.
Default-deny conservé.

| Room                     | Qui peut rejoindre                                                     |
| ------------------------ | ---------------------------------------------------------------------- |
| `order:{id}`             | le client propriétaire · le livreur assigné · staff plateforme         |
| `customer:{id}`          | ce client uniquement                                                   |
| `courier:{id}`           | ce livreur uniquement                                                  |
| `restaurant:orders:{id}` | **nouveau** — membre à rôle scopé sur CE restaurant · staff plateforme |
| `admin:ops`              | staff plateforme                                                       |
| tout le reste            | refusé                                                                 |

### 4.1 La room restaurant, enfin autorisée

Le Bloc 6.1 refusait `restaurant:*` faute d'une recherche d'appartenance.
L'inspection a montré que le mécanisme existait déjà :
`user_roles.scope_restaurant_id` (migration 0003). Un `RestaurantMembershipPort`
l'expose à `realtime` sans import direct de `users` (docs/15 AD-09).

Un rôle `restaurant_staff` **sans scope** n'ouvre rien : l'appartenance est la
subvention scopée, pas le nom du rôle. `Restaurant.ownerUserId` n'est
délibérément pas consulté — c'est une métadonnée catalogue, pas une subvention
RBAC.

La room `restaurant:{id}` **nue** reste refusée : aucun producteur, aucune
audience définie.

---

## 5. Notifications persistantes

Migration **0026** (additive) : deux tables.

### 5.1 `notifications`

Une ligne par (destinataire, événement métier). `dedup_key` = id de ligne
outbox, avec `UNIQUE (user_id, dedup_key)` : c'est la **base de données**, pas
le code, qui transforme la livraison at-least-once en « enregistré une fois ».

Clés i18n (`title_key`, `body_key`) et non phrases rendues ; `data` ne porte que
ce qu'un gabarit interpole. Aucune clé étrangère vers `orders`/`deliveries` :
une notification est l'enregistrement durable de « on a dit ceci à l'utilisateur
à ce moment », et doit garder son sens même si la ligne référencée change.

### 5.2 `notification_devices`

Plusieurs appareils par utilisateur. `push_token` est **UNIQUE seul**, pas par
utilisateur : un token identifie une installation, et une réinstallation ou un
changement de compte sur le même appareil re-pointe légitimement `user_id`
plutôt que d'échouer.

### 5.3 Endpoints

| Route                                  | Rôle                                   |
| -------------------------------------- | -------------------------------------- |
| `GET /v1/notifications?page&limit`     | liste paginée de **ses** notifications |
| `GET /v1/notifications/unread-count`   | compteur non lues                      |
| `POST /v1/notifications/:id/read`      | marquer lue (idempotent)               |
| `GET /v1/notifications/devices`        | ses appareils actifs                   |
| `POST /v1/notifications/devices`       | enregistrer un appareil                |
| `DELETE /v1/notifications/devices/:id` | révoquer un appareil                   |

Aucune route ne prend d'identifiant utilisateur : l'identité vient du token, il
n'y a rien à falsifier. La propriété d'une notification ou d'un appareil répond
un **404 identique** qu'elle n'existe pas ou appartienne à autrui (docs/25 §46).

### 5.4 Événements notifiés — six, pas cinquante

`order.confirmed` · `order.delivered` · `order.cancelled` · `order.expired` ·
`payment.failed` · `payment.refunded`

Le realtime dit déjà tout, en direct, à un client qui regarde. Une notification
persistée se justifie seulement pour ce qu'un utilisateur veut savoir **même
sans regarder**.

**Exclus, avec raison :**

- `order.ready`, `order.courier_assigned` — la room commande les montre en
  direct ; une notification par saut serait du bruit sur une livraison de 20 min.
- `delivery.assigned` (offre livreur) — déjà un ping in-process à TTL 30 s ; une
  ligne persistée pour quelque chose de peut-être déjà expiré induirait en erreur.
- Événements restaurant/admin — cette table a **une** colonne destinataire ;
  diffuser à tout le personnel d'un restaurant est un problème de forme
  différente, hors périmètre MVP.

---

## 6. Canaux réellement implémentés

| Canal         | État                         | Détail                                             |
| ------------- | ---------------------------- | -------------------------------------------------- |
| **IN_APP**    | ✅ **opérationnel**          | une ligne en base ; rien d'externe ne peut échouer |
| **WEBSOCKET** | ✅ **opérationnel**          | fan-out vers rooms autorisées                      |
| **PUSH**      | ⚠️ **port + mock seulement** | voir ci-dessous                                    |
| **SMS**       | ❌ non implémenté            | aucun provider ; aucune abstraction inventée       |
| **EMAIL**     | ❌ non implémenté            | idem                                               |

### 6.1 Push : ce qui est livré, ce qui reste à configurer

**Livré :** `PushPort` (`@djafat/types`), `MockPushProvider`, table
`notification_devices`, enregistrement/révocation authentifiés, multi-appareils,
révocation automatique d'un token que le provider déclare mort, rate de retry
(un échec push n'empêche jamais la ligne IN_APP), token jamais loggé (rédaction
comme pour les codes OTP).

**Reste à configurer :** un provider réel. `apps/mobile` n'a **pas**
`expo-notifications`, et aucun credential n'existe dans le dépôt — vérifié par
inspection. Il n'y avait donc rien à appeler. Brancher Expo/FCM/APNs = une
implémentation de `PushPort` + un échange de binding DI ; aucun autre code de ce
bloc ne change, aucune migration.

**Jamais testé sur un appareil physique.**

---

## 7. Intégration frontend

### 7.1 Web client — ✅ livré

`socket.io-client@4.8.1` ajouté à `apps/web` (aucune solution existante
dupliquée : il n'y avait aucun client realtime).

`useRoomRealtime(room, onChange)` — forme délibérée : **il n'applique jamais un
payload d'événement à l'état de l'UI.** Un événement est un signal qui veut dire
« refetch » ; la réponse REST est ce qui s'affiche.

Cette règle unique supprime une classe entière de bug du §9 : un événement
arrivant avant le chargement initial, ou deux événements désordonnés, ne peuvent
pas produire un écran incohérent, puisque l'écran n'est qu'une fonction d'une
lecture REST. Elle rend aussi la reconnexion trivialement correcte : aucun replay
à rattraper, aucun curseur. À chaque (re)connexion, le hook rejoint la room et
appelle `onChange` une fois.

`/commandes/[id]` affiche « Suivi en direct activé » ou, sinon, indique
honnêtement que le rechargement montre le dernier statut — jamais une promesse
de temps réel non tenue.

### 7.2 Restaurant / Courier / Mobile — ❌ non livrés

| App               | Raison                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/restaurant` | la room `restaurant:orders:{id}` est autorisée et alimentée côté serveur ; aucun client n'y est branché                                                |
| `apps/courier`    | n'existe pas comme app séparée                                                                                                                         |
| `apps/mobile`     | squelette Expo sans navigation ; rien à brancher sans construire l'écran d'abord (§17 : « uniquement ce que la structure actuelle permet réellement ») |

Aucune page ni design system des Blocs 2 et 3 n'a été réécrit.

---

## 8. Resynchronisation et reconnexion

Le mécanisme est **le refetch REST**, pas un replay (§18 : « éviter d'inventer
un système complexe de replay si un simple refetch fiable suffit »).

Garanties et limites, explicitement :

- **La gateway ne bufferise rien.** Aucun replay, aucun curseur par client,
  aucune file « événements manqués ». Testé : un événement émis dans une room
  vide est perdu, et rejoindre la room ensuite ne le rejoue pas.
- **Le rattrapage se fait au refetch.** Le hook appelle `onChange` à chaque
  connexion _et reconnexion_, donc ce qui s'est passé pendant la coupure est
  repris par la lecture REST qui suit.
- **Séquence testée** (§18) : lecture → déconnexion → transitions → reconnexion
  → refetch REST → état correct sans transition incohérente.

---

## 9. Observabilité

Logs structurés réutilisés (`pino` côté worker, `Logger` Nest côté API).
Traçable de bout en bout :

| Étape              | Ce qui est loggé                                          |
| ------------------ | --------------------------------------------------------- |
| relay              | id outbox, tentatives, erreur, DLQ à `MAX_ATTEMPTS`       |
| consumer           | `eventType`, `eventId`, durée de traitement, succès/échec |
| entrée illisible   | loggée en `error` avant d'être acquittée                  |
| entrées récupérées | nombre, en `warn`                                         |
| push               | plateforme + token **rédigé**, jamais en clair            |

Aucune donnée sensible : ni token, ni code de livraison, ni montant.
Pas d'infrastructure d'observabilité disproportionnée (§21).

---

## 10. Tests exécutés

| Paquet           | Avant Bloc 7 | Après   | Ajoutés  |
| ---------------- | ------------ | ------- | -------- |
| `@djafat/api`    | 364          | **478** | **+114** |
| `@djafat/worker` | 21           | **34**  | **+13**  |
| `@djafat/core`   | 181          | 181     | 0        |
| Autres paquets   | 82           | 82      | 0        |
| **Total**        | **648**      | **775** | **+127** |

| Fichier                                                     | Tests            | Couvre                                                        |
| ----------------------------------------------------------- | ---------------- | ------------------------------------------------------------- |
| `realtime/domain-event-router.spec.ts`                      | 45               | §13, §14, §19 — table de routage, fuites, deny-by-default     |
| `realtime/courier-location-privacy.spec.ts`                 | 28 (dont **+6**) | §19 — room restaurant, IDOR restaurant A → B                  |
| `realtime/realtime-connection.spec.ts`                      | 16               | §18, §19 — handshake, JWT, resynchronisation                  |
| `realtime/domain-events.consumer.spec.ts`                   | 14               | §5, §20 — ACK, entrée empoisonnée, redelivery                 |
| `worker/outbox-relay.processor.spec.ts`                     | 13               | §12, §20 — crash avant/après publication, DLQ, backoff        |
| `notifications/notifications.service.spec.ts`               | 20               | §15, §16, §19, §20 — persistance, isolation, dédup, appareils |
| `notifications/domain-event-notifications.listener.spec.ts` | 13               | §13, §20 — quels événements, pour qui                         |

### 10.1 Scénarios adversariaux couverts

Publication en double · crash worker avant publication · crash worker après
publication (→ doublon prouvé) · gateway indisponible (→ entrée conservée) ·
DLQ · redémarrage worker · entrée illisible (poison pill) · handler qui jette
(→ non acquitté, rejoué) · JWT absent/invalide/expiré · socket non authentifiée ·
client A → commande B · restaurant A → restaurant B · livreur A → livreur B ·
notification de A lue par B · appareil de A révoqué par B · provider push
défaillant · token push mort · doublon d'événement → une notification.

---

## 11. Tests NON exécutés

| Non exécuté                                                 | Raison                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| **Migrations 0026 contre un vrai PostgreSQL**               | **Docker indisponible** (`docker info` échoue)                   |
| Tests d'intégration `*.int.spec.ts`                         | idem                                                             |
| Contrainte `notifications_dedup_uk` réelle                  | simulée fidèlement dans le faux ; jamais exécutée par PostgreSQL |
| Chaîne complète métier → outbox → worker → Redis → gateway  | nécessite PostgreSQL **et** Redis réels                          |
| `XADD`/`XREADGROUP`/`XAUTOCLAIM` contre un vrai Redis       | aucun Redis disponible                                           |
| Plusieurs instances de gateway                              | nécessite l'adaptateur Redis (non configuré)                     |
| Push sur appareil physique                                  | aucun provider, aucun credential                                 |
| Réseau réellement perdu (Wi-Fi/mobile), app en arrière-plan | nécessite un appareil et un navigateur réels                     |

**Comment les lancer :** `pnpm infra:up` (docker compose : PostgreSQL + PostGIS

- Redis), puis `pnpm db:migrate && pnpm db:seed`, puis
  `pnpm --filter @djafat/worker test:int` et les specs `*.int.spec.ts`. Voir
  `apps/api/test/README.md`.

Cette dette reste **importante avant toute mise en production commerciale**.

---

## 12. Bugs trouvés et corrigés

| #    | Gravité | Bug                                                                                                                           | Correction                                                  |
| ---- | ------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| B-01 | 🔴      | `order.updated` consommé par la gateway, émis par personne → le client ne recevait **aucun** changement de statut de commande | handler supprimé ; les 10 vrais événements `order.*` routés |
| B-02 | 🔴      | le relay publiait en Pub/Sub puis marquait `published` → événement perdu si la gateway était absente, sans trace              | Redis Streams ; `published` seulement après `XADD`          |
| B-03 | 🔴      | aucun abonné au canal `domain-events` → la chaîne durable ne menait nulle part                                                | `DomainEventsConsumer` ajouté                               |

---

## 13. Dette technique et limites connues

| Sujet                                                 | Impact                                                                                                        | Statut                                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Adaptateur Redis Socket.IO absent**                 | avec >1 instance API, un événement reçu par A n'atteint pas un socket tenu par B → fan-out partiel            | `IoAdapter` mémoire conservé. Correct avec une instance. **À faire avant de scaler.**                                                                                         |
| **Migrations jamais appliquées à un vrai PostgreSQL** | 0026 vérifiée par lecture seulement                                                                           | Docker indisponible                                                                                                                                                           |
| **Aucun provider push réel**                          | PUSH non opérationnel                                                                                         | port + mock livrés ; binding DI à échanger                                                                                                                                    |
| **Token expiré pendant une connexion active**         | l'acteur est résolu une fois au handshake, jamais revalidé → un socket long survit à la validité de son token | exposition limitée : il ne peut que _recevoir_ ce qu'il pouvait déjà voir ; toute action métier passe par REST où le token est revalidé. **Testé et documenté, pas corrigé.** |
| Durabilité Redis < PostgreSQL                         | perte Redis = événements realtime perdus                                                                      | acceptable : refetch REST (§2.3)                                                                                                                                              |
| `MAXLEN ~ 100 000`                                    | une panne gateway très longue évince les plus anciens                                                         | rattrapage REST                                                                                                                                                               |
| Rooms restaurant non consommées côté client           | `apps/restaurant` non branché                                                                                 | §7.2                                                                                                                                                                          |
| `payment.updated` hors catalogue                      | ping in-process non routé                                                                                     | conservé tel quel, non étendu                                                                                                                                                 |
| Notifications restaurant/admin                        | absentes                                                                                                      | une seule colonne destinataire ; hors MVP                                                                                                                                     |

---

## 14. Compatibilité (§22)

Aucune décision antérieure cassée. Vérifié : API `/v1` · `Money` · ledger ·
abstraction paiement · `OrderAmountPort` · machine à états order · machine à
états delivery · `COURIER_FEE_POOL` · outbox · idempotence · autorisation
realtime · A1–A9 · ADR-0001.

Le seul changement hors `realtime`/`notifications` : `transitionOrder` lit
`restaurant_id` avec le verrou qu'il prenait déjà et l'ajoute au payload outbox,
pour que le fan-out puisse atteindre le tableau de bord du restaurant. Une
colonne de plus dans un `SELECT ... FOR UPDATE` existant, aucune requête
supplémentaire.

**Compatibilité avec ADR-0001** (`Delivery → Route → Stops → Orders`) : les
événements sont portés par `orderId`, jamais par `deliveryId` seul, pour les
audiences client et restaurant. Une tournée multi-stops produirait un événement
par commande sans changer la table de routage. La room `order:{id}` reste donc
correcte en V2 — un client suit sa commande, pas la tournée du livreur, et ne
doit d'ailleurs jamais voir les autres stops.

---

## 15. Procédure de configuration et de lancement

```bash
# 1. Infrastructure (PostgreSQL + PostGIS + Redis)
pnpm infra:up

# 2. Migrations + seed
pnpm db:migrate
pnpm db:seed

# 3. API (expose /v1 + le namespace Socket.IO /rt)
pnpm --filter @djafat/api dev

# 4. Worker (relay outbox toutes les 2 s)
pnpm --filter @djafat/worker dev

# 5. Web
pnpm --filter @djafat/web dev
```

Variables d'environnement : aucune nouvelle. Le stream, le groupe et la borne
sont des constantes partagées (`@djafat/types`) ; `REDIS_URL` et
`NEXT_PUBLIC_API_BASE_URL` existaient déjà. Le client web dérive l'origine
Socket.IO de `NEXT_PUBLIC_API_BASE_URL` en retirant le préfixe `/v1`, pour
qu'un seul réglage garde les deux transports alignés.

Aucun secret ajouté au dépôt.
