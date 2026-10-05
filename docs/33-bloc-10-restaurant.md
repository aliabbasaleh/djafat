# Bloc 10 — Restaurant App

> Verdict : 🟢 **PASS WITH DEBT** — `apps/restaurant` passe d'un écran de statut Bloc-0
> ("le tableau arrive au Bloc 10") à une application réelle : login OTP, tableau de
> commandes temps réel (accept/refuse/prêt), historique, gestion de menu (catégories,
> produits, dispo rapide), horaires + fermeture immédiate, profil, relevé wallet en
> lecture, support minimal. Le backend manquant pour que ça fonctionne (liste de
> commandes scopée restaurant, lecture/écriture du profil "moi", lecture du menu complet
> pour la gestion, écriture des horaires) a été ajouté en réutilisant intégralement les
> mécanismes d'autorisation déjà fermés par BUG-10.1.x/Bloc 9.1
> (`UsersService.getRestaurantScope`/`isMemberOfRestaurant`, `isStaffTierFor`) — aucune
> nouvelle surface de risque tenant-isolation n'a été ouverte. Dette assumée et explicite :
> §6.

---

## 1. Contexte et périmètre

`apps/restaurant` existait depuis le Bloc 0 comme coquille Next.js statique
(`layout.tsx` et une page affichant "Shell technique"). Le mandat roadmap (docs/14 §103,
item 33) : _"login (scope resto) ; tableau commandes temps réel et son (kanban ≥ lg) ;
accept (prépa) / reject (motif) / ready ; historique ; menu (catégories/produits/options,
prix `Money`) et dispo rapide ; horaires (tz ville) et « fermer maintenant » ; profil et
upload ; relevé wallet (pending/available, lecture) ; support ; responsive."_

Avant de coder, audit du mandat existant (docs/06 schéma, docs/20 catalogue, docs/27
realtime) : la quasi-totalité du BACKEND métier existait déjà (créé aux Blocs 2/6/7/9)
mais n'était jamais exposé sous une forme que `apps/restaurant` pouvait consommer
directement — voir §2 pour le détail exact de ce qui manquait réellement.

Hors périmètre, non touché : Bloc 11 (livreur), BUG-10.2, les 3 dettes mineures notées en
fin de session précédente (`STAFF_TIER_ROLES` inutilisé ailleurs, absence de typage
forçant les futures routes à passer par `order-access.ts`, flake Redis), MFA Admin UI,
RBAC global, `OwnershipGuard`.

## 2. Ce qui manquait réellement côté API

| Besoin fonctionnel                                           | Existant avant ce bloc                                                                                                             | Ajouté                                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Voir les commandes de SON restaurant (le tableau)            | `GET /orders/:id` (une à la fois), `GET /admin/orders` (admin uniquement)                                                          | `GET /orders` — scope résolu depuis `user_roles`, jamais un `restaurantId` client (§3.1) |
| Agir sur une commande (accepter/prêt/refuser)                | `POST /orders/:id/{confirm,ready,reject}` (Bloc 9)                                                                                 | rien — réutilisé tel quel                                                                |
| Profil "mon restaurant"                                      | `GET /restaurants/me/balance` (Bloc 9) seulement                                                                                   | `GET /restaurants/me` (profil complet + disponibilité calculée)                          |
| Horaires                                                     | lecture pure (`RestaurantAvailabilityService`, Bloc 2) — **aucune écriture n'existait**                                            | `PUT /restaurants/me/hours`                                                              |
| "Fermer maintenant"                                          | `status` self-service (`draft/active/paused`) déjà câblé (Bloc 2/9.1)                                                              | rien — réutilisé (`PATCH /restaurants/:id` avec `status: 'paused'`)                      |
| Menu pour la gestion (voir produits inactifs/indisponibles)  | `GET /restaurants/:slug/menu` — **filtre `isActive`/`isAvailable`**, inutilisable pour une UI d'édition                            | `GET /restaurants/me/menu` (arbre complet, non filtré)                                   |
| Créer/éditer catégories/produits/option-groups, toggle dispo | déjà complet (`CatalogManagementController`, Bloc 2/9.1)                                                                           | rien — réutilisé tel quel                                                                |
| Relevé wallet (pending/available)                            | `GET /restaurants/me/balance` (Bloc 9, `LedgerReadService.getOwnerBalances`)                                                       | rien — réutilisé tel quel                                                                |
| Temps réel sur le tableau                                    | room `restaurant:orders:{id}` déjà autorisée ET déjà alimentée (`domain-event-router.ts`, Bloc 7) — jamais consommée par un client | rien côté API — juste câblé côté frontend                                                |

Quatre endpoints réellement nouveaux, tous additifs, tous construits sur les primitives
d'autorisation déjà prouvées (jamais une nouvelle règle ad hoc) :

- `GET /orders` (`OrdersController`/`OrdersService.listOrdersForRestaurant`)
- `GET /restaurants/me` (`CatalogManagementController`/`RestaurantsManagementService.getMine`)
- `PUT /restaurants/me/hours` (idem, `.replaceHours`)
- `GET /restaurants/me/menu` (idem, `MenuCategoriesService.listForManagement`)

## 3. Sécurité — ce qui est directement pertinent pour ce bloc

### 3.1 Aucun `restaurantId` client pour les routes "moi"

Les quatre nouvelles routes résolvent le restaurant exclusivement via
`UsersService.getRestaurantScope(actor.userId)` — la même primitive, déjà testée, que
`GET /restaurants/me/balance` utilise depuis le Bloc 9 ("single-restaurant-by-construction
grant"). Il n'existe nulle part un paramètre `restaurantId` qu'un appelant pourrait forger
pour ces routes : résoudre le scope EST l'autorisation. C'est structurellement différent
de `listForAdmin`/`OrdersAdminController`, où un `restaurantId` arbitraire est légitime
(un admin interroge N'IMPORTE QUEL restaurant) — les deux formes coexistent sans jamais se
confondre.

### 3.2 Pas de réouverture de BUG-10.1.x

`GET /orders` est un tout nouvel endpoint, pas une modification de `GET /orders/:id`
(déjà fermé, inchangé). Il ne réutilise AUCUNE des quatre routes BUG-10.1.x — il est
construit depuis zéro sur `getRestaurantScope`, avec son propre test suite
(`orders-restaurant-board.spec.ts`, 7 cas incluant fuite cross-restaurant et absence de
scope). `OwnershipGuard` n'a pas été touché.

### 3.3 Permissions — aucune nouvelle, aucune élargie

- `GET /orders` : `@RequireRole('restaurant_owner','restaurant_staff')` — même garde que
  `confirm`/`ready`/`reject` déjà en place.
- `GET /restaurants/me`, `GET /restaurants/me/menu` : même garde (lecture, les deux rôles).
- `PUT /restaurants/me/hours` : `@RequirePermission('restaurants:write')` — SEUL
  `restaurant_owner` le détient (seed docs/19 ; `restaurant_staff` n'a que `menus:write`),
  exactement la même frontière que `UpdateRestaurantSchema.status`/`prepTimeMin` déjà en
  place. Aucune permission n'a été créée, renommée ou réattribuée.

### 3.4 "Fermer maintenant" ne crée pas de nouveau mécanisme

Plutôt que d'ajouter une deuxième notion d'état "ouvert/fermé" en parallèle du `status`
existant, le frontend appelle `PATCH /restaurants/:id` avec `status: 'paused'`/`'active'`
— un chemin self-service déjà autorisé et déjà testé depuis le Bloc 9.1. Zéro nouveau code
serveur, zéro nouvelle surface.

### 3.5 Le trou "produit sans catégorie" n'est pas introduit, il est évité côté UI

`listForManagement` hérite du même parcours "catégorie d'abord" que
`CatalogService.getMenu` (Bloc 2) : un produit `categoryId: null` resterait invisible sur
CETTE page comme sur le menu public. Plutôt que de reproduire silencieusement ce piège
dans une UI neuve, `ProductFormModal` rend `categoryId` obligatoire et chaque action
"+ Produit" part toujours d'une catégorie précise (`defaultCategoryId`). Documenté dans
le code (`menu-categories.service.ts`, `ProductFormModal.tsx`), pas juste constaté.

## 4. Fonctionnel livré

- **Login** (`/login`) — OTP téléphone, refuse côté client tout compte sans
  `restaurant_owner`/`restaurant_staff` (même schéma que `apps/admin`).
- **Tableau de commandes** (`/restaurant`) — 4 colonnes (Nouvelles/En préparation/Prêtes/En
  livraison) en grille ≥ 1024px, empilées en dessous ; accepter/refuser (motif optionnel)/
  marquer prête ; son synthétisé (Web Audio, sans asset) sur une commande RÉELLEMENT
  nouvelle, jamais au premier chargement ; **temps réel** via la room
  `restaurant:orders:{id}` (Bloc 7) — l'événement ne fait que déclencher un refetch REST,
  jamais appliqué directement à l'état (même garantie que `apps/web`).
- **Historique** (`/restaurant/history`) — filtre par statut terminal, pagination.
- **Menu** (`/restaurant/menu`) — créer/modifier catégories et produits, toggle de
  disponibilité instantané, aperçu des groupes d'options (lecture seule — §6).
- **Horaires** (`/restaurant/hours`) — grille des 7 jours, un créneau par jour, fuseau de
  la ville affiché.
- **Profil** (`/restaurant/profile`) — nom/description/téléphone/adresse/logo/couverture
  (URL)/temps de préparation/commande minimum ; bouton "Fermer maintenant"/"Rouvrir" ;
  écrit uniquement pour `restaurant_owner` (`restaurant_staff` voit en lecture).
- **Relevé** (`/restaurant/wallet`) — pending/available par devise, lecture seule.
- **Support** (`/restaurant/support`) — page statique (aucun backend ticket n'existe,
  jamais simulé).

## 5. Tests

**Backend (nouveau, exécuté) :**

- `orders-restaurant-board.spec.ts` — 7 cas : scope résolu depuis l'acteur jamais un
  paramètre, refus sans scope, board = statuts actifs triés FIFO, isolation
  cross-restaurant, mode historique (un statut, tri décroissant), pagination, mapping des
  lignes.
- `restaurants-management.service.spec.ts` — 4 cas ajoutés (`getMine`/`replaceHours`,
  scope résolu, refus sans scope, transaction delete+recreate).
- `menu-categories.service.spec.ts` — 2 cas ajoutés (`listForManagement` renvoie
  catégories/produits inactifs, menu vide → tableau vide).
- SDK : `restaurant.spec.ts` — 2 cas (toutes les routes/méthodes/corps attendus, `reject`
  sans motif envoie un corps vide).
- Frontend : `format.spec.ts` (13 cas) + `order-status.spec.ts` (3 cas) — logique pure
  (conversion montant/minutes, libellés). Un test a immédiatement révélé un bug réel
  (`formatElapsed` arrondissait 30s à "il y a 1 min" — `Math.round` → `Math.floor`, corrigé
  avant de continuer).

**Résultat global** : `apps/api` 58 fichiers / 764 tests ✅, `packages/sdk` 2/9 ✅,
`apps/restaurant` 2/16 ✅. `tsc`/`eslint`/`prettier` verts sur `apps/api`, `packages/sdk`,
`apps/restaurant`, et re-vérifiés sans régression sur `apps/admin`/`apps/web` (consommateurs
du SDK modifié). `next build` de `apps/restaurant` réussit (10 routes prérendues).

**Non exécuté (même dette que tout le reste du projet depuis le Bloc 0.5) :** aucun appel
HTTP réel, aucune requête PostgreSQL réelle — Docker indisponible dans cet environnement.
Jamais contourné par une simulation présentée comme validation réelle.

## 6. Dette restante (ne devient pas un chantier séparé sans autorisation)

- **Groupes d'options** : créés/modifiés uniquement via l'API déjà existante (SDK câblé),
  mais **aucune UI de création/édition** dans `apps/restaurant` — affichés en lecture
  seule sur la fiche produit. Un produit avec options reste pleinement fonctionnel côté
  client final, juste pas éditable depuis ce tableau de bord.
- **Horaires multi-créneaux** : le modèle API (`RestaurantHours`) supporte plusieurs
  créneaux par jour (ex. service midi + soir) ; l'éditeur ne gère qu'un créneau par jour.
- **Upload d'image réel** : `logoUrl`/`coverUrl` restent des champs URL (exactement le
  contrat `UpdateRestaurantSchema` déjà existant) — aucun pipeline de stockage n'existe
  (`ObjectStorageModule` est un placeholder Bloc 0 qui lève une exception sur tout appel,
  **dette héritée, pas introduite ici**).
- **Support** : page statique, aucun backend de tickets (n'a jamais existé, y compris pour
  `apps/admin`).
- **Validation E2E réelle** (HTTP + PostgreSQL) : toujours bloquée par l'absence de Docker
  dans cet environnement — inchangé depuis BUG-10.1.x (docs/32).
- Dettes héritées de la session précédente, toujours ouvertes et non élargies ici :
  `STAFF_TIER_ROLES` exporté mais inutilisé ailleurs, absence de typage forçant les futures
  routes à passer par `order-access.ts`, flake `socket-io-redis-adapter.spec.ts`.
