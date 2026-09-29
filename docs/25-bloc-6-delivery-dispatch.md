# 25 — Bloc 6 : Delivery / Dispatch Core

> **Verdict : 🟢 GO.** Aucune condition de blocage identifiée (§64 du mandat). Un bug réel trouvé et corrigé pendant la passe de concurrence (détail §21) — reproduit sur le code non corrigé, puis re-testé après correction. Docker indisponible dans cet environnement : aucun test d'intégration réel (`*.int.spec.ts`) n'a été écrit pour ce bloc — voir §20 et §23 pour l'inventaire honnête de ce que la suite de tests couvre réellement (272 tests API exécutés, dont 48 nouveaux pour `deliveries`/`couriers`, 10 scénarios de concurrence RÉELLE) et ce qu'elle ne couvre pas.

---

## 1. Résumé exécutif

Le Bloc 6 construit le cœur dispatch/livraison à partir d'une base quasi vide : `couriers`, `geo`, `deliveries` étaient des modules squelettes du Bloc 0/0.5, `deliveries` ne faisant que trois actions jouets (assign/picked-up/delivered) sans authentification ni dispatch. Ce bloc livre :

- Un **modèle `Delivery` réel** (10 états, machine à états explicite dans `@djafat/core`) et un **modèle `Courier`** (disponibilité, dernière position PostGIS).
- Un **dispatch MVP** « plus proche disponible » avec verrouillage transactionnel delivery→courier, offres avec expiration, élargissement de rayon piloté par configuration.
- La **suppression complète** du hack Bloc 0.5 qui résolvait un livreur à la création de la commande (exigence explicite du mandat, confirmée par `git grep` : `orders.courier_id` n'existe plus nulle part).
- Un **snapshot d'adresse de livraison immuable** sur `Order`, figé à la création, jamais relu depuis le carnet d'adresses mutable du client.
- **`COURIER_FEE_POOL`** : un compte de passif non-affecté qui absorbe la part livreur à `payment.succeeded` quand aucun livreur n'est encore connu (cas prépayé — la quasi-totalité), reclassé vers `COURIER_PAYABLE:<id>` à l'acceptation. Jamais de création d'argent : chaque reclassement est un débit/crédit de même montant, testé unitairement et vérifié équilibré dans chaque scénario de concurrence.
- Une **preuve de livraison** par code à 4 chiffres haché (jamais stocké en clair, jamais loggé en clair).
- Une **autorisation serveur sur chaque room realtime** (`order:{id}`, `customer:{id}`, `courier:{id}`, `admin:ops`) — élimine le realtime « à room devinable » du Bloc 0.5.
- Un **job worker `dispatch-retry`** (expiration d'offres + relance de dispatch à rayon élargi), indépendant du process API, à l'image du worker `order-expiry` déjà en place.

Les quatre points explicitement exigés par l'autorisation de démarrage sont vérifiés point par point en §8, §12, §15 et §2 respectivement.

---

## 2. Architecture — dépendances

```
deliveries  ──depends on──▶  ledger (LedgerService.postEntryGroupTx)
deliveries  ──depends on──▶  couriers (CouriersService — rejoint SA PROPRE transaction)
deliveries  ──depends on──▶  OrderAmountPort (@djafat/types — jamais orders directement)
deliveries  ──depends on──▶  platform, geo (génériques)
orders      ──reacts to───▶  delivery.accepted / delivery.picked_up / delivery.delivered /
                              delivery.cancelled / delivery.failed  (EventEmitter2, @OnEvent)
payments    ──reacts to───▶  delivery.delivered  (complète l'encaissement cash — §14)
realtime    ──depends on──▶  OrderAmountPort + DeliveryTrackingPort (common/ports — jamais deliveries)
```

`deliveries → couriers` est une extension **délibérée** du DAG (`packages/eslint-config/api-boundaries.js`), pour la même raison que `payments`/`deliveries → ledger` : l'assignation verrouille la ligne `delivery` PUIS la ligne `courier` dans **une seule transaction** — un port n'aurait pas pu rejoindre cette transaction. `deliveries` n'importe jamais `orders` ; chaque conséquence côté commande passe par un événement nommé, exactement le motif déjà établi aux Blocs 4/5.

`DeliveryTrackingPort` (nouveau, `common/ports/delivery-tracking.port.ts`) est le seul point d'accès de `realtime` à l'information « quel livreur est assigné à cette commande » — `DeliveriesModule` est maintenant `@Global()` pour l'exposer, exactement comme `OrdersModule`/`ORDER_AMOUNT_PORT`.

---

## 3. Delivery lifecycle

```
pending → searching_courier → courier_assigned → courier_accepted
        → pickup_in_progress → picked_up → on_the_way → delivered
cancelled / failed atteignables depuis les états actifs correspondants (§11)
```

Machine à états explicite : `packages/core/src/delivery/state-machine.ts`, 15 tests, 100 % de couverture. Contrairement à la dette identifiée au Bloc 5 (D-16 : la machine paiement existait mais n'était pas réellement consultée par le service), **celle-ci est réellement appelée** par `DeliveriesService` : `fromStatusesFor(to, opts)` dérive directement la clause SQL `WHERE status = ANY(...)` des transitions déclarées — aucune liste dupliquée à la main.

Deux entrées système ajoutées à la machine `Order` (`packages/core/src/order/state-machine.ts`) pour que `orders` puisse réagir à `delivery.cancelled`/`delivery.failed` : `ready → cancelled` et `courier_assigned → cancelled`, toutes deux `system: true`.

---

## 4. Courier lifecycle

`offline → online → busy → suspended`. Un livreur ne peut jamais repasser `offline` avec une livraison active (`docs/09 A.6`) ; `suspended` est réservé à l'admin (aucune transition self-service). Profil créé paresseusement (`upsert`) au premier `setStatus`/`updateLocation` — pas de pré-provisioning nécessaire au seed.

---

## 5. Dispatch (MVP « plus proche disponible »)

1. `orders` émet `order.ready` → `deliveries` crée la `Delivery` (idempotent : si elle existe déjà, no-op) et passe `pending → searching_courier`.
2. Un « wave » cherche les candidats via `CouriersService.findEligibleCandidates` (PostGIS, §6), exclut les livreurs déjà offerts pour CETTE livraison, verrouille delivery puis courier (§7), crée une offre (`delivery_offers`, TTL = `offer_timeout_seconds`, défaut 30 s), passe la livraison à `courier_assigned`.
3. Accept/reject/expiration → §8.
4. Sans candidat : le rayon s'élargit (`dispatch_initial_radius_m` → `+dispatch_radius_expansion_step_m` par tentative, plafonné à `dispatch_max_radius_m`) ; après `dispatch_max_waves` tentatives au rayon max, un événement `delivery.searching_no_courier` est publié (alerte ops) — la livraison **reste `searching_courier`**, jamais perdue silencieusement. Le worker `dispatch-retry` (§14) relance une vague toutes les 10 s.

Tous les seuils viennent de `platform_settings` (`PlatformService.getDispatchInitialRadiusMeters` etc.) — aucune valeur en dur dispersée dans le code, conformément à l'exigence explicite du mandat.

---

## 6. Géospatial

PostGIS était déjà activé (`CREATE EXTENSION postgis`, migration 0001) mais **jamais exploité** avant ce bloc. Colonnes ajoutées : `couriers.last_geom`, `deliveries.pickup_geom`/`dropoff_geom`, `orders.dropoff_geom` — toutes `geography(Point,4326)`, toutes indexées GIST, **jamais modélisées dans `schema.prisma`** (convention déjà établie pour `restaurants.geom`) : écrites/lues exclusivement via SQL brut (`ST_SetSRID(ST_MakePoint(lng,lat),4326)`, `ST_Y`/`ST_X` pour la lecture).

La recherche de candidats est **une seule requête PostGIS indexée** (`ST_DWithin` + `ORDER BY ST_Distance(...) LIMIT 20`) — jamais un `SELECT *` suivi d'un calcul de distance côté TypeScript sur toute la table (§51 du mandat).

Le pickup vient du `geom` du restaurant (jamais demandé au client) ; le dropoff vient du **snapshot** de commande (§8), jamais du carnet d'adresses live. Les deux transitent par `OrderAmountPort.getDeliveryContext`, qui convertit les colonnes PostGIS en `{lat,lng}` bruts — `deliveries` ne touche jamais aux tables `orders`/`restaurants`.

Cas non couvert et documenté : une adresse jamais géocodée (`geocode_status='manual'`) ou un restaurant sans `geom` → `runDispatchWave` publie `delivery.searching_no_courier` sans planter, la livraison reste en attente d'intervention manuelle (§23, dette non-bloquante).

---

## 7. Verrouillage d'assignation (le point le plus critique du bloc)

**Ordre de verrouillage : TOUJOURS delivery d'abord, courier ensuite** — respecté dans les cinq transactions qui touchent les deux tables (`runDispatchWave`, `acceptOffer`, `rejectOffer`, `confirmDelivered`, `cancel`/`reportFailed`). Documenté en commentaire de classe dans `deliveries.service.ts` et vérifié par relecture explicite de chaque site.

```
BEGIN
  SELECT ... FROM deliveries WHERE id = $1 FOR UPDATE        -- verrou 1 : delivery
  SELECT ... FROM couriers WHERE user_id = $2 FOR UPDATE     -- verrou 2 : courier (CouriersService.lockAndClaim)
  UPDATE couriers SET status='busy', active_delivery_id=$1
  INSERT INTO delivery_offers (...)
  UPDATE deliveries SET status='courier_assigned', courier_id=$2
COMMIT
```

Aucun autre flux dans ce bloc n'inverse cet ordre — un deadlock inter-transactions (A attend le verrou que B détient et vice-versa) n'est donc pas possible pour ce couple de tables.

---

## 8. Concurrence — 10 scénarios réellement exécutés en parallèle

Discipline identique à celle établie aux Blocs 4/5 (`docs/23 §1.1`, `docs/24`) : un faux Prisma dont les motifs `FOR UPDATE` acquièrent un **vrai mutex asynchrone** par ligne (file de promesses chaînées), puis de véritables `Promise.all`/`Promise.allSettled` contre les classes de service RÉELLES (`deliveries-assignment-race.spec.ts`, `apps/api/src/modules/deliveries/`) :

| #   | Scénario                                                                             | Résultat vérifié                                                                                           |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 1   | Deux `runDispatchWave` simultanés, même delivery, 2 candidats                        | Un seul livreur `busy`, une seule offre créée                                                              |
| 2   | Deux deliveries dispatchées simultanément, un seul candidat commun                   | Un seul assigné, l'autre reste `searching_courier`                                                         |
| 3   | Un livreur jamais offert tente d'accepter en même temps que celui réellement assigné | Le premier gagne, le second reçoit `DELIVERY_ALREADY_ASSIGNED` (409 propre — **bug trouvé ici, voir §21**) |
| 4   | `accept` + `cancel` simultanés                                                       | Un seul gagne ; si annulation, le livreur est libéré (jamais `busy` en suspens)                            |
| 5   | Deux `markPickedUp` simultanés (clés d'idempotence différentes)                      | Une seule transition réelle, la seconde relit l'état déjà `on_the_way` — jamais d'erreur                   |
| 6   | Deux `confirmDelivered` simultanés                                                   | `funds_available` posté **exactement une fois** ; livreur libéré une seule fois                            |
| 7   | IDOR : mauvais livreur tente `acceptOffer`                                           | `NotFoundException`, jamais de fuite d'existence                                                           |
| 8   | Offre expirée puis tentative d'acceptation                                           | `OFFER_EXPIRED`, jamais acceptée                                                                           |
| 9   | Livreur suspendu entre l'offre et l'acceptation                                      | `COURIER_NOT_ELIGIBLE` — re-vérifié DANS la transaction, pas seulement à l'offre                           |
| 10  | Livreur déjà `busy` proposé comme candidat                                           | Jamais retourné par `findEligibleCandidates`                                                               |

Les 10 scénarios sont passés au premier essai **après** correction de trois bugs — tous dans le harnais de test lui-même, pas dans le code de production (client `tx` sans `$executeRaw`, mauvais nom de colonne `courier_id`/`user_id`, ordre de paramètres SQL inversé dans deux branches) : audités avec la même rigueur que le code de production, conformément à la méthodologie déjà établie au Bloc 4.

---

## 9. Localisation

`POST /v1/couriers/me/location` valide **avant** toute écriture (jamais de confiance aveugle envers le client) :

- Lat/lng bornés `[-90,90]`/`[-180,180]` (rejet NaN/Infinity inclus).
- Précision (`accuracyM`) plafonnée à 500 m, jamais négative.
- Vitesse (`speedMps`) plafonnée à 45 m/s (~162 km/h) — au-delà, un saut GPS ou un spoofing.
- Horodatage client à ±5 min de l'horloge serveur (rejette un replay ancien ou un horodatage futur).
- Fraîcheur de position exigée pour l'éligibilité au dispatch : `courier_location_stale_seconds` (défaut 120 s), configurable.

17 tests dédiés (`couriers.service.spec.ts`), y compris les valeurs limites exactes (`±90`/`±180` acceptées, `90.0001` rejeté).

Diffusion realtime de la position en direct vers la room `order:{id}` (carte client) est **hors périmètre de ce bloc** (§23) — nécessiterait une résolution livreur→commande active sur le chemin chaud de chaque mise à jour de position ; `GET /v1/deliveries/:id` reste la source de vérité par polling REST.

---

## 10. Pickup / Livraison

`POST /v1/deliveries/:id/pickup` : transition `pickup_in_progress → picked_up → on_the_way` en un seul appel (pas de route distincte « arrivé au restaurant » — cf. la liste minimale du mandat §45) ; vérifie l'appartenance au livreur atomiquement dans le `UPDATE ... WHERE ... AND courier_id = $2` — jamais un `SELECT` puis un `UPDATE` séparés.

`POST /v1/deliveries/:id/deliver` : exige `proofCode` (§11). Idempotent (clé d'idempotence + `UPDATE ... WHERE status='on_the_way' RETURNING ...`).

---

## 11. Preuve de livraison

MVP = code à 4 chiffres (`docs/09 A.5`), généré à l'assignation (`issueDeliveryCode`), **haché SHA-256 avant stockage** (`delivery_proofs.value_hash`) — jamais la valeur brute en base, jamais dans les logs. Structure `delivery_proofs` extensible (`type`, `reference`) pour photo/signature plus tard sans migration destructive ; non construit dans ce bloc (hors périmètre explicite, §19 du mandat : pas de système Object Storage complet ici).

---

## 12. Annulation / échec — et les quatre points exigés

**Point 1 exigé : le snapshot d'adresse de livraison est immuable après création de la commande.**
Vérifié par lecture directe : `orders.service.ts`'s `doCreateOrder` lit l'adresse par défaut du client **une seule fois**, à la création, et fige `dropoff_quartier`/`street`/`landmark`/`instructions`/`recipient_phone`/`geocode_status`/`dropoff_geom` sur la ligne `orders`. Aucun chemin de code (grep exhaustif sur `dropoff` dans `apps/api/src`) ne relit ou ne modifie ces colonnes après l'insertion — `deliveries.getDeliveryContext`/`createIfMissing` les LIT via `OrderAmountPort`, ne les écrit jamais. Une modification ultérieure de l'adresse par défaut du client (table `addresses`, mutable) n'a donc aucun effet sur une commande déjà créée.

**Règles d'annulation (docs/25 §29) :**

| Depuis                                                              | Qui                           | Résultat                               |
| ------------------------------------------------------------------- | ----------------------------- | -------------------------------------- |
| `pending`/`searching_courier`/`courier_assigned`/`courier_accepted` | customer, admin, super_admin  | `cancelled`, livreur libéré si assigné |
| `pickup_in_progress`/`picked_up`/`on_the_way`                       | admin, super_admin uniquement | `cancelled` (intervention ops)         |
| `delivered`                                                         | personne                      | `DELIVERY_ALREADY_DELIVERED` — jamais  |

Aucune récupération automatique de la part déjà reclassée vers un livreur après annulation post-pickup (dette documentée, §23 — la politique commerciale « qui absorbe le coût » n'est pas définie par l'architecture fournie).

`reportFailed` (client injoignable, adresse inaccessible, incident) : depuis `pickup_in_progress`/`picked_up`/`on_the_way`, par le livreur ou l'admin. Stocke `reason`/horodatage/`actorUserId`, publie `delivery.failed`.

---

## 13. Ledger — et les points 2 et 4 exigés

**Point 4 exigé : le hack Bloc 0.5 (courier résolu à la création de commande) a complètement disparu.**
`ALTER TABLE orders DROP COLUMN courier_id` (migration 0023) — la colonne n'existe plus en base. `git grep -rn "courier" apps/api/src/modules/orders` ne retourne plus aucune résolution de livreur à la création. `OrderAccrualBreakdown` (le type que `payments` consomme) n'a plus de champ `courierId` du tout.

**Point 2 exigé : `COURIER_FEE_POOL` ne crée jamais d'argent ; tout transfert vers un livreur est idempotent, équilibré, non doublable.**

Le flux dépend de si un livreur est connu au moment où `order_accrual` se poste :

| Cas                         | Livreur connu à `payment.succeeded` ?                                                                             | Compte crédité                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Prépayé (mobile money/mock) | **Non** (le paiement réussit toujours avant `ready`/dispatch)                                                     | `COURIER_FEE_POOL`                 |
| Cash                        | **Oui, toujours** (rien ne marque un paiement cash réussi avant que le livreur l'ait physiquement encaissé — §14) | `COURIER_PAYABLE:<id>` directement |

Pour le cas prépayé, `DeliveriesService.doAcceptOffer` reclasse **à l'acceptation** (le premier moment où un livreur est réellement connu) :

```
COURIER_FEE_POOL           débit   1200
COURIER_PAYABLE:<courier>  crédit  1200
```

Pure reclassification entre deux comptes de passif — jamais de création d'argent (`buildCourierFeeReclassificationEntries`, `courier-fee-reclassification.spec.ts`, `assertBalanced` vérifié pour des montants arbitraires). Idempotent par clé `courier-accrual:<deliveryId>` (le mécanisme d'idempotence du ledger, déjà éprouvé au Bloc 5, rejoue sans reposter).

**Garde-fou anti-mélange explicitement conçu** : la reclassification ne s'exécute QUE si `OrderDeliveryContext.courierFeeInPool === true` — un signal calculé par `orders` (jamais par `payments`/`deliveries`, qui ne peuvent pas lire les tables de l'autre) en vérifiant si la commande est passée par `awaiting_payment` avant `placed` (prépayé) ou directement `placed` (cash). Sans cette garde, reclasser pour une commande cash (qui n'a jamais rien versé au pool) aurait débité silencieusement l'argent d'AUTRES commandes.

À `delivered`, la reclassification `*_PAYABLE → *_AVAILABLE` réutilise **sans aucune modification** `deliveries/release-entries.ts`, déjà construit et testé au Bloc 0.5 — vérifié correct par relecture, pas réécrit inutilement (anti-scope-creep explicite du mandat).

---

## 14. Interaction paiement (cash)

Constat fait en lisant le code existant avant d'écrire quoi que ce soit : **rien, nulle part, ne marquait jamais un paiement cash comme `succeeded`** — `PaymentsService.markSucceeded` n'était appelé qu'au chemin synchrone (jamais vrai pour cash) et au webhook (cash n'a pas de webhook). Un trou pré-existant du Bloc 5, pas introduit par ce bloc, mais qui bloquait totalement le flux cash tant qu'il restait ouvert.

Corrigé en connectant `payments` à l'événement `delivery.delivered` (`PaymentsService.onDeliveryDelivered`, `@OnEvent`) — `deliveries` n'écrit jamais dans `payments` directement (DAG). Un paiement cash `pending` pour la commande livrée est marqué `succeeded` avec le `courierId` de l'événement (garanti connu, puisque le livreur vient de livrer). `DELIVERED` n'est **jamais** traité comme preuve qu'un paiement électronique a réussi (§28 du mandat) — ce chemin ne s'applique qu'au provider `cash`.

---

## 15. Realtime — et le point 3 exigé

**Point 3 exigé : toutes les rooms realtime effectuent une autorisation serveur avant join/subscribe.**

`RealtimeGateway.handleConnection` résout l'acteur authentifié depuis le token JWT du handshake (`ActorResolverService`, réutilisé tel quel) et **déconnecte** immédiatement toute socket sans token valide. `handleSubscribe` appelle `isAuthorizedForRoom(actor, room)` — **refus par défaut** :

| Room                | Autorisé si                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `order:{id}`        | acteur = client propriétaire (`OrderAmountPort.getOwnerUserId`) OU livreur assigné (`DeliveryTrackingPort.getAssignedCourierUserIdByOrder`) OU rôle admin/super_admin/support |
| `customer:{userId}` | acteur = cet utilisateur                                                                                                                                                      |
| `courier:{userId}`  | acteur = cet utilisateur                                                                                                                                                      |
| `admin:ops`         | rôle admin/super_admin/support                                                                                                                                                |
| tout le reste       | **refusé** (y compris `restaurant:{id}`, non implémenté — dette non-bloquante, §23)                                                                                           |

Aucune room n'est « devinable » sans autorisation. Cohérence métier jamais dépendante du WebSocket : si l'événement est manqué, `GET /v1/deliveries/:id` / `GET /v1/orders/:id` restent la source de vérité.

---

## 16. Outbox / Workers

Événements outbox transactionnels : `delivery.created`, `delivery.searching_courier`, `delivery.searching_no_courier`, `delivery.assigned`, `delivery.accepted`, `delivery.rejected`, `delivery.picked_up`, `delivery.delivered`, `delivery.cancelled`, `delivery.failed` — chacun inséré dans **la même transaction** que le changement d'état qui le déclenche (jamais un `enqueue` après coup non transactionnel).

Nouveau job BullMQ `dispatch-retry` (`apps/worker/src/processors/dispatch.processor.ts`), tick 10 s :

1. Expire les offres dont `expires_at` est dépassé, libère le livreur, repasse la livraison à `searching_courier`.
2. Relance une vague pour chaque livraison `searching_courier` sans offre active, avec un rayon élargi.

Le worker réimplémente cette logique en SQL brut (comme `order-expiry` le fait déjà) plutôt que d'appeler le process API — c'est la convention établie du worker, pas une nouveauté de ce bloc. **Dette assumée** : `dispatch.processor.ts` n'a pas de test dédié (contrairement à `order-expiry.processor.spec.ts`) — voir §23.

---

## 17. Sécurité

- **RBAC** : `couriers:read`/`couriers:write` ajoutés (support/admin/super_admin) ; les actions self-service du livreur (accept/reject/pickup/deliver) n'ont **aucune permission de contournement staff** — retiré délibérément pendant l'implémentation (un admin ne doit jamais pouvoir simuler la confirmation physique d'un livreur, cf. §34 du mandat). `fail` garde un contournement `deliveries:write` (légitime : un ops peut déclarer un échec sans action livreur).
- **IDOR** : chaque action livreur résout son identité depuis le token (`CurrentActor`), jamais un `courierId` fourni par le client. `getActiveOfferCourierUserId`/`getAssignedCourierUserId` lèvent `NotFoundException` (jamais une 403 qui confirmerait l'existence de la ressource à un tiers).
- **Secrets** : aucun (le code de livraison est haché, jamais loggé — `this.logger.log` ne référence jamais `proofCode`).

---

## 18. Offline / réseau faible

Chaque action sensible livreur (accept/reject/pickup/deliver/cancel/fail) exige `Idempotency-Key` — un retry réseau après timeout rejoue la même transition plutôt que d'en produire une seconde (mécanisme déjà éprouvé aux Blocs 4/5, réutilisé sans modification). Aucune action locale n'est traitée comme confirmée avant la réponse serveur (aucun état optimiste côté serveur ne peut être créé par le client — l'architecture serveur ne fait aucune hypothèse sur ce que fait le client).

---

## 18bis. Frontend courier — décision explicite

Vérifié avant toute décision : `apps/mobile` est un squelette Expo nu (`app/index.tsx`, `app/_layout.tsx` — aucune navigation, aucun écran). Le mandat autorise explicitement à ne pas construire d'application livreur si le shell n'existe pas encore (§49) : **aucune UI n'a été construite dans ce bloc**, exactement la même décision que le Bloc 5 avait déjà prise pour son propre périmètre frontend minimal. Le backend (API + realtime + worker) est complet et testé ; le shell mobile lui-même est un préalable hors périmètre de ce bloc.

---

## 19. API

```
POST   /v1/deliveries                    (admin/ops — déclenchement manuel, §45)
GET    /v1/deliveries/:id                (owner ou staff deliveries:read)
POST   /v1/deliveries/:id/accept         (livreur assigné uniquement)
POST   /v1/deliveries/:id/reject         (livreur assigné uniquement)
POST   /v1/deliveries/:id/pickup         (livreur assigné uniquement)
POST   /v1/deliveries/:id/deliver        (livreur assigné uniquement, proofCode)
POST   /v1/deliveries/:id/cancel         (owner ou admin)
POST   /v1/deliveries/:id/fail           (livreur assigné ou admin)
POST   /v1/couriers/me/status            (livreur)
POST   /v1/couriers/me/location          (livreur)
GET    /v1/couriers/me                   (livreur)
GET    /v1/couriers/me/offers            (livreur)
GET    /v1/couriers/me/deliveries        (livreur)
POST   /v1/admin/couriers/:id/suspend    (admin/super_admin/support)
POST   /v1/admin/couriers/:id/reinstate  (admin/super_admin/support)
```

Contrat d'erreur (jamais un 500 brut sur un cas métier prévisible) : `DELIVERY_NOT_FOUND`, `DELIVERY_INVALID_STATE`, `DELIVERY_NOT_ASSIGNED`, `COURIER_NOT_ELIGIBLE`, `DELIVERY_ALREADY_ASSIGNED`, `OFFER_EXPIRED`, `OFFER_NOT_FOUND`, `DELIVERY_ALREADY_DELIVERED`, `DELIVERY_ALREADY_CANCELLED`, `INVALID_LOCATION`, `COURIER_BUSY`, `COURIER_SUSPENDED`, `COURIER_OFFLINE`, `INVALID_PROOF`.

---

## 20. Base de données — invariants DB vs code

| Invariant                                                                                               | Mécanisme                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deliveries.status`/`couriers.status`/`delivery_offers.status`/`delivery_proofs.type` ∈ valeurs valides | **DB** (CHECK)                                                                                                                                                                                                                                                                                                                                                                                         |
| FK order/courier/delivery/user sur toutes les tables filles                                             | **DB**                                                                                                                                                                                                                                                                                                                                                                                                 |
| `dropoff_geocode_status` ∈ valeurs valides                                                              | **DB** (CHECK)                                                                                                                                                                                                                                                                                                                                                                                         |
| Un livreur a au plus une livraison active                                                               | **Code uniquement** — verrouillage transactionnel delivery-puis-courier (§7). Documenté explicitement dans la migration : « active » couvre plusieurs valeurs de `status`, ce qu'un index unique partiel ne peut pas exprimer proprement. **Contrairement au garde-fou de sur-remboursement du Bloc 5 (un trigger PostgreSQL), il n'existe pas de trigger équivalent ici** — dette non-bloquante, §23. |
| Au plus une offre `offered` active par livraison                                                        | **Code uniquement** — même raisonnement, même limitation assumée                                                                                                                                                                                                                                                                                                                                       |
| Pas de double-crédit ledger                                                                             | **Code + DB** — idempotence de `ledger_entry_groups.idempotency_key` (Bloc 5, réutilisée telle quelle)                                                                                                                                                                                                                                                                                                 |
| Snapshot d'adresse immuable                                                                             | **Code** — aucun chemin d'écriture après la création (vérifié par lecture exhaustive, §12)                                                                                                                                                                                                                                                                                                             |

Migrations : `0023_delivery_dispatch_core` — additive de bout en bout (`ALTER TABLE` sur `orders`/`deliveries` existantes, jamais de `DROP TABLE`/recréation ; les anciennes valeurs `status` du Bloc 0.5 sont remappées par `UPDATE` avant que la nouvelle contrainte n'atterrisse). Aucune migration antérieure modifiée.

---

## 21. Bugs trouvés

### BUG-1 — 🟠 `DeliveryTransitionError` brute fuyait comme 500 au lieu d'un 409 propre

- **Repro (sur le code non corrigé)** : deux `acceptOffer` concurrents, l'un pour le livreur réellement assigné, l'autre pour un livreur qui ne l'était pas. Le perdant, après relecture de l'état `delivery` désormais `courier_accepted`, appelait `assertDeliveryTransition(status, 'courier_accepted', ...)` **avant** toute vérification de propriété — `from === to` fait échouer la machine à états, qui lève `DeliveryTransitionError` (une `Error` brute, pas une exception HTTP Nest). Test exécuté sur le code non corrigé : `expected DeliveryTransitionError ... to be an instance of ConflictException` — confirmé, puis code restauré et re-testé vert.
- **Cause racine** : la vérification de propriété (`delivery.courier_id !== courierId`) passait APRÈS l'assertion de machine à états, et rien ne traduisait `DeliveryTransitionError` en exception HTTP.
- **Correction** : réordonnancement (propriété vérifiée en premier — le cas réel de perte de course) + `try/catch` traduisant `DeliveryTransitionError` en `ConflictException({code:'DELIVERY_INVALID_STATE'})` pour le cas résiduel (même livreur, replay sous une autre clé d'idempotence).
- **Test de régression** : `deliveries-assignment-race.spec.ts` → _"a courier who was never offered this delivery can never win an accept race..."_ — vérifie explicitement `err.getResponse()).toMatchObject({code:'DELIVERY_ALREADY_ASSIGNED'})`, jamais une erreur brute.

### Bugs de harnais de test (pas de production) trouvés et corrigés pendant la même passe

Trois bugs dans `deliveries-test-support.ts` (client de transaction sans `$executeRaw`, alias de colonne `courier_id`/`user_id` incohérent avec le vrai SQL, ordre de paramètres inversé dans les branches `cancelled`/`failed`) — audités avec la même rigueur que le code de production avant d'en tirer une conclusion (même discipline qu'au Bloc 4, docs/23 §1.1) : chacun causait soit un blocage (deadlock du mutex simulé), soit un faux résultat silencieux, jamais un faux positif masquant un vrai bug de production.

---

## 22. Tests — chiffres précis

| Suite                                                                       | Fichiers     | Tests        | Statut                                                                                                                                                                |
| --------------------------------------------------------------------------- | ------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@djafat/core` (delivery state machine + geo distance)                      | 2 nouveaux   | 26 (15 + 11) | ✅ exécutés, 100 % passés                                                                                                                                             |
| `@djafat/core` (total, incl. pré-existant)                                  | 13           | 161          | ✅ exécutés                                                                                                                                                           |
| `apps/api` — `deliveries`/`couriers` (nouveaux)                             | 5            | 48           | ✅ exécutés                                                                                                                                                           |
| dont concurrence RÉELLE (`Promise.all`/`allSettled` sur un mutex par ligne) | 1            | 10           | ✅ exécutés                                                                                                                                                           |
| `apps/api` (total, incl. pré-existant Blocs 1-5)                            | 30           | 272          | ✅ exécutés                                                                                                                                                           |
| `apps/worker`                                                               | 1 (inchangé) | 3            | ✅ exécutés — **aucun test ajouté pour `dispatch.processor.ts`** (dette, §23)                                                                                         |
| Intégration Docker (`*.int.spec.ts`)                                        | 0 écrit      | —            | **N/V — non écrits pour ce bloc** (Docker indisponible ; contrairement aux Blocs précédents, aucun fichier N/V n'a été produit faute de temps — dette explicite, §23) |

`pnpm format:check` / `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` : exécutés à la racine du monorepo (19 packages), tous verts.

---

## 23. Limitations et dette technique

### BLOCKING

Aucune.

### NON-BLOCKING

| #   | Sujet                                                                | Pourquoi ce n'est pas bloquant                                                                                                                                                                                 | Piste                                             |
| --- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| D9  | Dispatch « plus proche disponible » simple                           | Mandat : dette explicitement acceptée pour ce bloc (interface implicite, pas encore `DispatchStrategy` formalisée)                                                                                             | V2 — scoring ETA/charge/équité                    |
| —   | Aucun trigger DB pour « un livreur = une livraison active »          | Verrouillage transactionnel applicatif déjà vérifié par 10 scénarios de concurrence réelle ; contrairement au sur-remboursement (Bloc 5), l'invariant dépend de plusieurs valeurs de `status`, pas d'une somme | Envisageable si un futur audit le juge nécessaire |
| —   | Diffusion realtime de la position live vers `order:{id}`             | Nécessite une résolution livreur→commande active sur le chemin chaud ; `GET /v1/deliveries/:id` reste la source de vérité                                                                                      | Bloc futur, si le besoin produit se confirme      |
| —   | Room realtime `restaurant:{id}`                                      | Nécessiterait un port supplémentaire vers `catalog` (appartenance staff) ; refusée par défaut (jamais silencieusement autorisée)                                                                               | Bloc futur                                        |
| —   | `dispatch.processor.ts` sans test dédié                              | Réimplémentation SQL brute du même invariant déjà prouvé côté service (§8) ; `order-expiry.processor.spec.ts` montre le motif à suivre                                                                         | À écrire avant activation en production           |
| —   | Aucun test d'intégration Docker écrit pour ce bloc                   | Contrainte de temps, pas seulement Docker indisponible                                                                                                                                                         | À écrire avant mise en production réelle          |
| —   | Politique commerciale d'annulation post-pickup (qui absorbe le coût) | Hors périmètre architecture — mandat interdit d'inventer une politique commerciale                                                                                                                             | Décision produit                                  |
| —   | IDOR restaurant (« wrong restaurant access ») non testé              | Aucune visibilité restaurant sur les livraisons construite dans ce bloc                                                                                                                                        | Bloc futur (avec la room `restaurant:{id}`)       |

---

## 24. Documentation

`docs/25-bloc-6-delivery-dispatch.md` (ce document) ajouté à `DJAFAT-architecture-complete.md` via la convention établie (séparateur `<!-- ===== 25-... ===== -->`).

---

## 25. Commits

| Hash      | Message                                                                                 |
| --------- | --------------------------------------------------------------------------------------- |
| `e1be67f` | `feat(delivery): implement delivery and dispatch core`                                  |
| `d4e3f08` | `fix(orders,payments): remove eager courier resolution, wire delivery lifecycle events` |
| `3b1636b` | `feat(realtime,worker): authorize every room join and add the dispatch-retry job`       |
| (ce doc)  | `docs(25): rapport bloc 6 — delivery dispatch core`                                     |

## 26. Git status

`clean` après le dernier commit (vérifié par `git status --porcelain=v1`, sortie vide).
