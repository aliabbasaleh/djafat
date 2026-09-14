# 23 — Bloc 4 : QA adversariale / red team (panier + commande)

> Une passe de validation demandée explicitement en mode « essaie activement de casser le système », pas une simple relecture. Porte sur le diff Bloc 4 déjà livré (docs/22) plus une première correction rapide qui avait précédé cette passe.
> Chaque bug ci-dessous a été **reproduit avant d'être corrigé** — un test qui échoue sur l'ancien code et passe sur le nouveau.

---

## 1. Concurrence / races

| Scénario demandé                                                     | Résultat                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2× `POST /orders` sur le même panier, clés d'idempotence différentes | 🔴 **Cassé, corrigé** — verrou `FOR UPDATE` sur `carts` posé au tout début de la transaction de création de commande. Testé avec une vraie concurrence (`Promise.allSettled`, pas de simulation séquentielle) : exactement 1 commande créée, l'autre reçoit `CART_EMPTY` propre. |
| 2× `POST /orders`, même clé, strictement concurrentes                | 🔴 **Cassé, corrigé** — voir §2.                                                                                                                                                                                                                                                 |
| `addItem` multiple sur panier vide                                   | 🔴 **Cassé, corrigé** — `cart.create()` perdait la course et remontait un P2002 brut. Testé avec 3 appels réellement concurrents sur un utilisateur sans panier : un seul panier créé, les 3 items dessus.                                                                       |
| `updateItem`/`removeItem` simultanés sur le même item                | 🟠 **Cassé, corrigé** — P2025 non capturé → 500. Testé avec vraie concurrence : jamais de 500, état final cohérent (item mis à jour OU absent, jamais les deux à la fois).                                                                                                       |
| Plusieurs `removeItem` simultanés                                    | 🟠 **Cassé, corrigé** — même mécanisme. Testé avec 3 appels concurrents : exactement 1 réussit, les 2 autres 404.                                                                                                                                                                |
| Remplacement/vidage de panier simultané avec une modification        | 🔴 **Cassé, corrigé — le plus profond des 3 bugs de concurrence.** Voir §1.1 ci-dessous.                                                                                                                                                                                         |
| Retry réseau après commit serveur                                    | ✅ Déjà correct — testé (`createOrder` rejoué après un premier succès renvoie exactement la même commande).                                                                                                                                                                      |

### 1.1 — Le bug le plus sérieux : `FOR UPDATE` sur `carts` ne protège pas `cart_items`

**Symptôme reproduit** : `addItem()` et `clearCart()` lancés en vraie concurrence sur le même panier pouvaient laisser un panier avec des articles mais `restaurant_id = NULL` — invisible au checkout (`CART_EMPTY`) alors que `GET /v1/carts` montre encore des articles.

**Cause racine, en deux temps** :

1. _Premier correctif (insuffisant)_ : `addItem` verrouillait la ligne `carts` via `SELECT ... FOR UPDATE` avant d'insérer son item, mais `clearCart()` ne verrouillait rien — il supprimait directement dans `cart_items`.
2. _Pourquoi ça ne suffit pas_ : `FOR UPDATE` sur `carts` verrouille **cette ligne précise**, pas la table `cart_items`. `DELETE FROM cart_items WHERE cart_id = X` ne touche jamais la ligne verrouillée de `carts` — Postgres ne le bloque donc **pas**. Résultat observable : `clearCart()` supprime l'ancien article (non bloqué), `addItem()` insère le nouveau (protégé par son verrou), puis `clearCart()` — qui attendait sur son `UPDATE carts SET restaurant_id = NULL` — se débloque et écrase le lien restaurant, orphelinant le nouvel article.

**Correction** : `clearCart()` verrouille désormais AUSSI la ligne `carts` (`lockOpenCart`, factorisé et réutilisé par `addItem`) avant de toucher `cart_items` — dans la même transaction. Les deux chemins d'écriture qui manipulent le panier comme un tout passent maintenant par le même verrou, dans le même ordre.

**Reproduit avec un vrai harnais de concurrence** (pas une simulation séquentielle) : file d'attente par identifiant de panier basée sur des promesses réelles, verrouillage synchrone pour fermer une fenêtre TOCTOU découverte dans le harnais de test lui-même (`await` sur une promesse déjà résolue cède quand même un tick — largement suffisant pour qu'un acquéreur concurrent s'y engouffre). Stable sur 5 exécutions répétées.

---

## 2. Idempotence

**Garantie fournie par la DB** : `idempotency_keys` a une clé primaire `(scope, key)` — l'`INSERT ... ON CONFLICT DO NOTHING` est atomique pour « qui gagne la réservation ». `orders` a en plus un index UNIQUE `(customer_id, idempotency_key)` — un filet de sécurité indépendant et redondant.

**Garantie qui reposait UNIQUEMENT sur le code (et était fausse)** : `IdempotencyService.run()` ne lisait jamais la colonne `status` (`'reserved'` vs `'completed'`) de la ligne réservée — il traitait toute ligne existante comme un "replay" valide, y compris une ligne encore `'reserved'` (résultat pas encore écrit).

**Bug reproduit** : deux requêtes avec la **même** clé, strictement concurrentes — la seconde arrivant pendant que la première tourne encore. Résultat observé : `{ status: 'replayed', response: null }` — un succès HTTP 201 fabriqué, avec une commande `null`, alors que la vraie commande était toujours en cours de création.

**Correction** : `reserve()` renvoie maintenant `completed: boolean` (lu depuis `status`) ; `IdempotencyService.run()` rejette proprement (409 `IDEMPOTENCY_KEY_REUSED`, « déjà en cours, réessayez ») une ligne réservée mais pas encore complétée, au lieu de la traiter comme un replay.

**Tests** (mêmes clé/payload, clé/payload différents, replay après succès, retry après commit-mais-timeout-client, deux requêtes strictement concurrentes) : tous verts, y compris via le vrai `OrdersService`+`IdempotencyService` (pas seulement `IdempotencyService` isolé).

---

## 3. Invariants de prix

| Cas testé                                                              | Résultat                                                                                                                                                                      |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delta d'option négatif seul                                            | ✅ déjà correct                                                                                                                                                               |
| Plusieurs deltas négatifs qui, **ensemble**, dépassent le prix de base | 🟡 **Trouvé, corrigé** — `computeCartLine` ne vérifiait rien ; ajout de `assertNonNegative(effectiveUnitPrice)` au point unique par lequel passe tout calcul panier/commande. |
| Total exactement à 0                                                   | ✅ autorisé délibérément (option -100%), testé                                                                                                                                |
| Total < 0                                                              | 🟡 impossible désormais — lève une erreur claire (422) plutôt que de produire un montant à facturer négatif                                                                   |
| Quantités/valeurs extrêmes (99 × 999 999 999 XAF)                      | ✅ testé — `BigInt`, aucune perte de précision                                                                                                                                |
| Décimaux / arrondi                                                     | N/A pour XAF (exposant 0) ; l'arithmétique reste de toute façon en entiers `BigInt`, jamais en flottant                                                                       |
| Catalogue modifié entre lecture et checkout                            | ✅ déjà couvert (bloc 4 initial) — le checkout relit toujours le catalogue en direct                                                                                          |

---

## 4. Validation

Couvert par les tests unitaires du schéma Zod (`cart-item.schema.spec.ts`, nouveau) : `selectedOptionIds` vide, doublons (dédupliqués), quantités `0/-1/-99/1.5/2.1/NaN/±Infinity/100/1000` (rejetées), `1` et `99` (bornes acceptées), type non numérique. Côté service (`carts.service.spec.ts`) : options inexistantes, appartenant à un autre produit, indisponibles ; **option devenue indisponible entre l'ajout et le checkout** (nouveau — distinct du cas « produit entier disparu » déjà couvert) ; panier vide ; item supprimé entre validation et mutation ; **panier déjà converti** (nouveau — `addItem` démarre un panier réellement neuf, sans jamais rouvrir l'ancien) ; panier inexistant (traité comme panier vide).

Aucune de ces entrées limites ne remonte de contrainte SQL brute — toujours une erreur métier propre (422/409/404).

---

## 5. Transactions / atomicité

Audit de chaque endroit où plusieurs écritures DB représentent une seule opération métier :

| Opération                                               | Écritures groupées                                                                 | Statut                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `addItem` (résolution panier + création item + options) | verrou `carts` → `cartItem.create` → `cartItemOption.createMany`                   | ✅ une seule transaction, verrouillée                                    |
| `resolveCartForAdd` (branche remplacement)              | `cartItem.deleteMany` → `cart.update`                                              | ✅ dans la transaction verrouillée d'`addItem`                           |
| `clearCart`                                             | verrou `carts` → `cartItem.deleteMany` → `cart.update`                             | ✅ corrigé cette passe (§1.1)                                            |
| `updateItem` (quantité + options)                       | `cartItem.update` → `cartItemOption.deleteMany` → `createMany`                     | ✅ une seule transaction                                                 |
| `removeItem`                                            | `cartItem.delete` (cascade `cart_item_options` en DB)                              | ✅ atomique par construction                                             |
| Création de commande                                    | verrou panier → commande → items → options → historique → outbox → `markConverted` | ✅ une seule transaction verrouillée (docs/22 + corrections précédentes) |

**Aucun des scénarios interdits par le mandat n'est atteignable** : pas de suppression sans mise à jour correspondante, pas de commande créée avec panier non converti (même transaction), pas de panier converti sans commande (`markConverted` n'est appelé que depuis `doCreateOrder`, jamais isolément), pas de vidage partiel (chaque `deleteMany` cible tout le panier en un seul appel), pas d'état intermédiaire visible (verrous + transactions).

---

## 6. La DB comme dernière ligne de défense

| Invariant                                                              | Garanti par                              | Détail                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un panier `open` au plus par utilisateur                               | **DB** (+ code)                          | Index UNIQUE partiel `carts_one_open_per_user`. Le code gère la course (retry sur P2002) mais ne pourrait pas la créer seul.                                                                                                                                                                                                                                    |
| Quantité d'un item entre 1 et 99                                       | **DB** (+ code, plus strict)             | `CHECK` sur `cart_items.quantity`. Le code applique en plus un plafond métier configurable (`platform_settings`), potentiellement inférieur à 99.                                                                                                                                                                                                               |
| Une option n'est jamais sélectionnée deux fois sur le même item        | **DB** (+ code)                          | `UNIQUE(cart_item_id, option_id)`. Le code déduplique en amont désormais (§4) — la contrainte DB devient un filet plutôt que le point de détection.                                                                                                                                                                                                             |
| Une commande n'est créée qu'une fois par `(client, clé d'idempotence)` | **DB, deux fois** (+ code)               | `idempotency_keys` PK `(scope, key)` ET `orders` UNIQUE `(customer_id, idempotency_key)` — redondant, défense en profondeur réelle. ❓ Si ce filet `orders` se déclenchait un jour (ne devrait jamais arriver vu le correctif §2), il remonterait en 500 brut — non capturé. Risque résiduel mineur, non corrigé (la vraie protection est maintenant en amont). |
| `restaurant_id`/`currency` toujours ensemble (jamais un seul des deux) | **Code seulement → corrigé cette passe** | Aucune contrainte DB n'existait. Ajout de `CHECK ((restaurant_id IS NULL) = (currency IS NULL))` sur `carts` — c'était un invariant critique qui ne reposait que sur la discipline de chaque site d'écriture.                                                                                                                                                   |
| Une option sélectionnée appartient bien au produit du panier           | Code seulement                           | Relation multi-tables — non exprimable par une contrainte statique sans trigger ; limitation standard, pas une lacune spécifique à ce bloc.                                                                                                                                                                                                                     |
| Transition `open → converted` jamais inversée / jamais doublée         | Code + verrou (le vrai garant)           | `CHECK` limite le domaine des valeurs, pas les transitions (comme `orders.status`, déjà une machine à états côté `@djafat/core`, jamais en DB).                                                                                                                                                                                                                 |

**Seul invariant critique corrigé cette passe** : `restaurant_id`/`currency` ensemble — ajouté en `CHECK` (§6, ligne ci-dessus). Tout le reste qui dépend du code est soit déjà doublé par une contrainte DB, soit d'une nature qu'une contrainte statique ne peut pas exprimer (cohérence multi-tables, machine à états).

---

## 7. Tests ajoutés (cette passe + la correction rapide qui l'a précédée immédiatement)

| Fichier                                                       | Avant | Après                                                    |
| ------------------------------------------------------------- | ----- | -------------------------------------------------------- |
| `apps/api/src/modules/carts/carts.service.spec.ts`            | 15    | **28** (+13)                                             |
| `apps/api/src/common/idempotency/idempotency.service.spec.ts` | 4     | **5** (+1)                                               |
| `packages/core/src/cart/cart-pricing.spec.ts`                 | 7     | **12** (+5)                                              |
| `apps/api/src/modules/carts/dto/cart-item.schema.spec.ts`     | —     | **16** (nouveau fichier)                                 |
| `apps/api/src/modules/orders/orders-checkout-race.spec.ts`    | —     | **3** (nouveau fichier, concurrence réelle bout-en-bout) |

**Scénarios de concurrence réellement exécutés** (`Promise.all`/`Promise.allSettled`, jamais séquentiels) :

1. 2 créations de commande, clés différentes, même panier.
2. 2 créations de commande, même clé.
3. 3 `addItem` simultanés sur panier vide.
4. 3 `removeItem` simultanés sur le même item.
5. `updateItem`/`removeItem` simultanés sur le même item.
6. `addItem`/`clearCart` simultanés sur le même panier.

Chacun avec un harnais simulant fidèlement le verrouillage `SELECT ... FOR UPDATE` de PostgreSQL (file d'attente par identifiant, pas de raccourci séquentiel) — vérifié en observant que retirer le correctif fait échouer le test correspondant.

---

## 8. Verdict

🔴 **3 bugs bloquants trouvés et corrigés** : double commande sur panier partagé ; idempotence donnant une fausse réussite sous concurrence ; panier orphelin (`clearCart` + `addItem` concurrents).
🟠 **3 bugs importants trouvés et corrigés** : doublons d'options → 500 ; courses sur `addItem` (création de panier) → 500 ; courses sur `updateItem`/`removeItem` → 500.
🟡 **2 problèmes mineurs trouvés et corrigés** : delta de prix négatif combiné pouvant rendre un montant négatif ; invariant `restaurant_id`/`currency` non garanti par la DB.
🟢 **Points solides confirmés** : idempotence après commit (replay correct) ; revalidation catalogue au checkout (prix ET disponibilité) ; IDOR-safe par construction ; atomicité de la création de commande ; arithmétique monétaire exacte aux valeurs extrêmes.
❓ **Question ouverte, non corrigée** : le filet `orders_customer_idem_uk` (backstop DB) remonterait en 500 brut s'il se déclenchait — ne devrait plus jamais arriver vu le correctif d'idempotence, donc laissé tel quel plutôt que sur-corrigé.

**Tests ajoutés** : 38 (dont 6 scénarios de concurrence réellement exécutés en parallèle). **Gauntlet complet repassé après tous les correctifs** : format ✓, 19/19 lint, 19/19 typecheck, **405/405 tests unitaires**, 15/15 build.

**Verdict final : 🟢 GO pour commit.** Tous les bugs trouvés ont été reproduits avant correction et sont verrouillés par un test qui aurait échoué sur l'ancien code. Rien n'est resté "probablement corrigé" sans preuve exécutable.
