# Bloc 8 — Customer Experience + Address / Checkout Readiness

> Verdict : 🟢 **PASS** — le blocage identifié par l'audit pré-Bloc 8 (aucune gestion
> d'adresse, impossible pour un client réel non seedé de commander) est fermé de bout en
> bout : backend, API, checkout, frontend. Dette Docker/PostgreSQL inchangée (jamais
> exécuté contre une infrastructure réelle ici) — déclarée explicitement, jamais
> contournée. Notifications web et profil client : audités, délibérément non construits
> ce bloc (raisons ci-dessous), pas une omission silencieuse.

---

## 1. Contexte

L'audit pré-Bloc 8 a identifié un seul blocage **bloquant** (🔴) pour qu'un client réel
puisse utiliser DJAFAT de bout en bout : `OrdersService.createOrder` a toujours lu une
adresse `is_default = true` dans `addresses`, mais **aucune route n'a jamais existé**
pour qu'un client crée, lise, modifie ou choisisse une adresse. Seuls les comptes seedés
(avec une adresse déjà insérée en base) pouvaient commander. Ce bloc ferme exactement ce
blocage — rien de plus.

**Hors périmètre** (rappel du mandat, respecté intégralement) : marketplace fournisseur,
inventaire, supply chain, livestock, ERP, dispatch intelligent, multi-commandes/Stops,
géocodage avancé, navigation GPS, nouvelle architecture paiement/livraison, refonte
realtime, payout réel, admin complet, dashboards restaurant/livreur complets.

## 2. Ce qui existait déjà (RÈGLE CTO N°1 — inspection avant code)

- La table `addresses` existe depuis la migration 0003 et le modèle Prisma `Address`
  depuis le Bloc 6 — mais en lecture seule : seul `orders.service.ts` la lisait
  (`SELECT ... WHERE is_default = true`), rien ne l'écrivait jamais côté client.
- L'adressage N'Djamena est déjà "landmark-first" (docs/09 §B.1) :
  `quartier`/`street`/`landmark`/`instructions` sont des colonnes séparées, jamais un
  champ texte libre fusionné.
- Le snapshot d'adresse de commande (`orders.dropoff_*`) est **déjà** structurellement
  autonome depuis le Bloc 6.1 (migration 0025) : colonnes scalaires figées à la création,
  `dropoffAddressId` en `ON DELETE SET NULL`. Ce bloc n'a **rien eu à modifier** ici — la
  garantie d'immuabilité préexistait, elle a seulement été mise à l'épreuve par de
  nouveaux tests.
- Le moteur de remboursement (Bloc 5) était déjà protégé par une garde applicative ET un
  trigger DB — voir §7.
- `pricing.priceOrder` utilise `restaurant.cityId`, jamais une ville liée à l'adresse
  client — confirmé par lecture du code avant toute décision de conception.

## 3. Domaine adresse

### 3.1 Schéma

Aucune nouvelle colonne. `addresses` (migration 0003 + Prisma `Address`, Bloc 6) a déjà
exactement les champs du mandat : `id, user_id, label, recipient_phone, city_id,
quartier, street, landmark, instructions, geocode_status, is_default, created_at,
updated_at`, plus `geom geography(Point,4326)` — jamais modélisé dans `schema.prisma`
(convention PostGIS, docs/17 D-02), lu/écrit en SQL brut (`ST_Y`/`ST_X` /
`ST_SetSRID(ST_MakePoint(...))`), exactement comme `couriers.last_geom` et
`orders.dropoff_geom`.

**Migration 0027** (additive uniquement) :

```sql
CREATE UNIQUE INDEX addresses_one_default_per_user ON addresses (user_id) WHERE is_default = true;
CREATE TRIGGER addresses_set_updated_at BEFORE UPDATE ON addresses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

L'invariant "un seul défaut par utilisateur" est posé **par la base**, pas seulement par
l'application — même précédent que `carts_one_open_per_user` (migration 0019).

### 3.2 Module (`apps/api/src/modules/addresses/`)

Nouveau module top-level — **pas** replié dans `users`, qui reste une couche de base pure
("`users` reaches nothing", `AuthModule.imports:[UsersModule]` existe déjà ; y adjoindre
les routes d'adresses aurait créé un cycle). DAG (`api-boundaries.js`) :
`addresses → {auth, users}`, même palier que `couriers`.

- `AddressesService` — ownership-in-service (même discipline que `NotificationsService`,
  Bloc 7) : chaque méthode prend `userId` en premier argument, filtre ses propres
  requêtes, répond un **404 identique** pour "n'existe pas" et "appartient à
  quelqu'un d'autre" — zéro IDOR par construction.
  - `create` : la première adresse d'un utilisateur devient son défaut automatiquement
    (sinon `createOrder` ré-expose aussitôt sa garde "pas d'adresse").
  - `update` : construit `Prisma.AddressUpdateInput` champ par champ (pas un spread) —
    `exactOptionalPropertyTypes` distingue "absent" de "présent et `undefined`".
  - `setDefault` : transaction unset-puis-set en deux temps ; le verrou de ligne
    Postgres sur la rangée "défaut actuelle" sérialise deux appels concurrents ; l'index
    unique partiel est le filet de secours, traduit en erreur métier propre (jamais un
    500 brut).
  - `remove` : supprimer le défaut **auto-promeut** l'adresse restante la plus récente
    (décision documentée — interdire la suppression créerait une ligne définitivement
    non supprimable, un piège pire que l'état "pas de défaut" déjà géré). Supprimer la
    dernière adresse d'un utilisateur est autorisé (retour à l'état déjà testé "ajoutez
    une adresse avant de commander").
  - `get`/`requireOwned` acceptent un client Prisma optionnel
    (`PrismaService | Prisma.TransactionClient`, défaut `this.prisma`) — même pattern que
    `CartsService.findOpenCart` — pour pouvoir s'exécuter DANS la transaction d'un autre
    module (voir §4).
- Aucune donnée redondante introduite : le nom de ville est joint à la lecture
  (`LEFT JOIN cities`), jamais dupliqué sur `addresses`.

### 3.3 API (`AddressesController`, `@Controller('users/me/addresses')`)

| Méthode | Route          |                                          |
| ------- | -------------- | ---------------------------------------- |
| GET     | `/`            | liste les adresses du client authentifié |
| GET     | `/:id`         | une adresse — 404 si étrangère           |
| POST    | `/`            | création                                 |
| PATCH   | `/:id`         | mise à jour partielle                    |
| POST    | `/:id/default` | définit comme défaut                     |
| DELETE  | `/:id`         | suppression (204)                        |

Chaîne de sécurité identique à tout le reste du dépôt : JWT → `@CurrentActor()` →
`AddressesService` (ownership) → Prisma. **Aucun `userId` en paramètre de route nulle
part** — rien à falsifier. Erreurs jamais brutes (`P2002` → `ConflictException` propre).

## 4. Checkout — intégration avec le snapshot d'adresse existant

Le client sélectionne un `addressId` (optionnel) ; **jamais** un prix, des frais de
livraison, une commission, une ville ou une devise.

```
POST /v1/orders  { addressId?: string }   // .strict() — tout autre champ est rejeté
```

`OrdersService.doCreateOrder` :

1. Si `addressId` fourni → `AddressesService.requireOwned(customerId, addressId, tx)`,
   **avec le `tx` de la transaction de création d'order elle-même** — l'ownership check
   et le snapshot commitent comme une seule unité atomique, aucune fenêtre où l'adresse
   pourrait changer entre les deux.
2. Sinon → fallback **inchangé, octet pour octet**, sur l'ancienne requête
   `is_default = true` (extraite dans `loadDefaultDropoff`, zéro régression).
3. `UserAddress ≠ OrderAddressSnapshot` : le mapping (`toDropoffSnapshot`) copie des
   scalaires dans les colonnes `orders.dropoff_*`, déjà figées et autonomes depuis le
   Bloc 6.1 — modifier ou supprimer l'adresse APRÈS création n'atteint jamais l'historique
   (`dropoffAddressId` en `ON DELETE SET NULL`, vérifié par absence, pas une nouvelle
   garde).
4. La clé d'idempotence inclut désormais `addressId` dans son empreinte — rejouer la même
   clé avec une adresse différente est un conflit (`IDEMPOTENCY_KEY_REUSED`), jamais une
   ré-résolution silencieuse.

`orders` importe désormais `addresses` dans son DAG (`api-boundaries.js`) — édge
documenté, `payments` reste absent du graphe `orders` (inchangé).

## 5. Frontend client (`apps/web`)

- **`/adresses`** — liste, ajout/édition (formulaire partagé), suppression, "définir par
  défaut". États loading/ready/error/empty, redirection `/connexion` si non authentifié
  — même squelette que `/panier`. Aucun composant UI dupliqué : `Input`/`Textarea`/
  `Badge`/`Alert`/`EmptyState`/`ErrorState`/`Skeleton` de `@djafat/ui` uniquement.
- **`/panier`** — nouvelle section "Adresse de livraison" (radios) avant "Commander" ;
  "Commander" désactivé tant qu'aucune adresse n'est sélectionnée ; alerte + lien si le
  client n'a aucune adresse.
- Navigation : l'entrée "Compte (bientôt)" — un lien mort — est remplacée par "Adresses"
  (lien réel), dans le header desktop et la barre mobile.
- **`packages/sdk/src/addresses.ts`** (nouveau) — client CRUD complet ; `orders.ts::create`
  accepte un `addressId` optionnel.
- Pas de sélecteur de ville, pas de carte/géocodage — décision délibérée (hors périmètre,
  et `pricing` ne dépend jamais de la ville de l'adresse client, vérifié §2).

## 6. Sécurité

- **IDOR** : testé explicitement — un client ne peut ni lire, ni modifier, ni supprimer,
  ni définir par défaut l'adresse d'un autre (404 identique à "inconnu"), et ne peut pas
  l'utiliser pour passer une commande (même 404, aucune commande créée).
- **Falsification de prix** : structurellement impossible — `CreateOrderSchema` n'expose
  que `addressId`, `.strict()` rejette tout le reste (10 tentatives testées :
  `total`/`deliveryFee`/`commission`/`currency`/`cityId`/etc.).
- **Falsification de ville/devise** : la ville et la devise de la commande viennent
  toujours du restaurant, jamais de l'adresse — prouvé par deux commandes identiques avec
  des adresses dans deux villes différentes donnant un prix/ville/devise strictement
  identiques.

## 7. Finance — durcissement du remboursement (audit, pas de réécriture)

Mécanisme existant depuis le Bloc 5, déjà protégé à deux niveaux : garde applicative
(`remaining = amountMinor − Σ refunds.succeeded`) **+** trigger DB
`refunds_guard_over_refund` (migration 0021) comme filet anti-race. Décision : **ne pas
réécrire**, conformément à l'instruction explicite du mandat. Un seul gap réel identifié
et fermé — le remboursement ne réaffirmait pas explicitement le comportement de rejeu
d'Idempotency-Key (le mécanisme générique `IdempotencyService.run` était déjà prouvé pour
`cancelPayment`, pas spécifiquement pour `refundPayment`) : deux tests ajoutés
(`payments.service.spec.ts`) — rejeu de la même clé → même remboursement, jamais un
second crédit ; même clé avec un montant différent → `IDEMPOTENCY_KEY_REUSED`.

## 8. Parties explicitement non construites (audit, décision documentée)

- **Profil client** : aucun besoin fonctionnel identifié — `recipientPhone` est propre à
  l'adresse (jamais `users.fullName`), le téléphone de compte vient déjà du JWT, le nom
  déjà affiché vient déjà de la réponse de connexion. Construire un écran profil ici
  aurait été hors périmètre.
- **Notifications web** (**dette D-12**, futur bloc) : le backend
  (`GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/:id/read`)
  existe intégralement depuis le Bloc 7, mais **aucun binding SDK n'existe**. Une
  intégration minimale non temps-réel serait un recul par rapport à l'investissement
  realtime du Bloc 7 ; une intégration réellement temps réel dépasserait "minimal" et
  toucherait la refonte realtime, explicitement hors périmètre. Différé plutôt que livré
  en dégradé.

## 9. Tests

**Nouveaux, tous EXECUTED** (554 tests `@djafat/api` au total après ce bloc, zéro
régression) :

| Fichier                                     | Tests | Portée                                                                                                                                                                                                                            |
| ------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addresses.service.spec.ts`                 | 27    | CRUD, IDOR, invariant défaut (concurrence réelle), suppression/promotion                                                                                                                                                          |
| `dto/addresses.schema.spec.ts`              | 14    | validation Zod, `.strict()`, bornes                                                                                                                                                                                               |
| `orders/dto/create-order.schema.spec.ts`    | 13    | `addressId` seul champ accepté, 10 tentatives de falsification rejetées                                                                                                                                                           |
| `orders/checkout-address-selection.spec.ts` | 9     | sélection vs défaut, fallback inchangé, IDOR, prix/ville/devise indépendants de l'adresse, rejeu idempotency + adresse différente, **concurrence réelle** (suppression/édition de l'adresse pendant la lecture de la transaction) |
| `payments.service.spec.ts` (+2)             | 23    | rejeu refund, conflit clé+montant différent                                                                                                                                                                                       |
| `packages/sdk/src/sdk.spec.ts` (+3)         | 7     | forme du corps `orders.create`, routes `addresses`                                                                                                                                                                                |

**WRITTEN_NOT_EXECUTED** (Docker/PostgreSQL indisponibles dans cet environnement —
`docker version` échoue, confirmé à nouveau avant ce rapport) :

- `apps/api/test/addresses.int.spec.ts` (17 tests) — HTTP réel, deux comptes OTP réels,
  IDOR sur le fil, jamais contourné par un faux positif.

**NOT_WRITTEN** : aucun — toute la liste adversariale du mandat (ADDRESS/ORDER/CHECKOUT/
REFUND/AUTH) est couverte par les fichiers ci-dessus ou par des fichiers déjà existants
avant ce bloc (`order-snapshot-immutability.spec.ts`, `payments-refund-race.spec.ts`,
`orders-checkout-race.spec.ts`).

## 10. Observabilité

Aucun nouveau mécanisme introduit — vérifié, pas implémenté : `AddressesController`/
`OrdersController` passent par le même `AllExceptionsFilter`/`traceId` que tout le reste
de l'API (zéro code de logging nouveau écrit ce bloc). Un système de métriques complet
reste hors périmètre — pointeur **D-09** (Production Readiness, bloc futur), inchangé.

## 11. Limitations assumées

- Pas de géocodage automatique — une adresse sans coordonnées reste `geocode_status =
'manual'`, cohérent avec l'adressage landmark-first existant.
- Pas de sélecteur de ville dans l'UI web (`cityId` reste un champ optionnel
  validé-si-fourni) — aucune dépendance fonctionnelle de `pricing` à la ville de
  l'adresse aujourd'hui.
- Vérification visuelle web : aucun outil de capture d'écran/navigateur disponible dans
  cet environnement — `next build` (génération statique réelle) et la lecture du code
  sont les seules garanties ; déclaré explicitement plutôt que simulé.

## 12. Dette restante (mise à jour)

Inchangé depuis l'audit pré-Bloc 8, sauf :

- **D-01** (gestion d'adresse) → **fermé** par ce bloc.
- **D-07** (CI ne lance pas `apps/worker`'s `test:int`) → inchangé, hors périmètre.
- **D-09** (observabilité/métriques Production Readiness) → inchangé, pointeur conservé.
- **D-12** (nouveau) : notifications web — SDK bindings + UI minimale, différé.
