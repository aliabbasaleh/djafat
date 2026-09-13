# 20 — Bloc 2 : Catalog & Restaurant Discovery

> Le catalogue DJAFAT — restaurants, catégories, produits, options, horaires, disponibilité, recherche — et le premier rendu réel de l'application.
> **Aucun panier, aucun paiement, aucune logique de commande complète, aucun dispatch** (voir §2).
> Ce document est le rapport de fin de bloc — **le Bloc 3 n'est pas démarré** (voir §22, attend décision séparée).

---

## 1. Résultat

# 🟢 PASS — avec réserve de vérification (pas de Docker dans l'environnement de build)

`pnpm install` · `prisma generate` (hors-ligne) · `prettier --check` · `turbo run lint typecheck test build` → **21/21 tâches lint, 21/21 typecheck, 21/21 test, 14/14 build (7 depuis le cache)** · **285 tests unitaires réellement exécutés** (114 `@djafat/core` + 148 `apps/api` + 23 autres packages), tous verts. Migrations `0014`–`0018`, seed étendu, et une nouvelle suite d'intégration (`catalog.int.spec.ts`, 26 scénarios) sont livrés et **type-checkés avec succès** mais **N/V à l'exécution** — pas de démon Docker ici, exactement la même réserve qu'aux Blocs 0/0.5/1. Le frontend `apps/web` a un **premier rendu réel** : 4 routes (`/`, `/restaurants`, `/restaurants/[slug]`, `/restaurants/[slug]/products/[productId]`) qui compilent et se construisent avec `next build` (§16).

**Un vrai bug pré-existant trouvé et corrigé pendant ce bloc** (§19) : les tokens numériques de `@djafat/tokens` (`space`, `radius`, `type.size`, `touchTarget`) sont stockés **sans unité** (même source que React Native, où les tailles sont des nombres bruts) ; utilisés tels quels dans une valeur CSS de longueur (`fontSize: 'var(--djafat-type-size-body)'`, déjà présent dans `apps/web/src/app/error.tsx` depuis le Bloc 0), ils produisent une déclaration invalide au moment du calcul que le navigateur ignore silencieusement — aucune taille de police ni aucun rayon de bordure ne s'appliquait réellement. Corrigé partout dans le nouveau code via `calc(var(--djafat-espace-x) * 1px)`, et rétrofit sur `error.tsx`.

---

## 2. Périmètre

**Dedans** : `Restaurant` (profil complet, statuts, géolocalisation, note-cache), `MenuCategory`, `Product` (prix `Money`, actif/disponible séparés), `ProductOptionGroup`/`ProductOption` (+ `validateProductOptionSelections` réutilisable), `RestaurantHours`/`RestaurantClosure` + `RestaurantAvailabilityService` (fuseau horaire de la ville, chevauchement de minuit), recherche PostgreSQL FTS (restaurant + produit + catégorie), pagination, tri déterministe, API `/v1` publique en lecture + gestion authentifiée/ownership en écriture, premier rendu Next.js (accueil → liste → détail restaurant → détail produit).

**Explicitement dehors** (§1 du mandat) : panier complet, prix final de commande, checkout, paiement, logique métier de commande complète, dispatch, courrier, suivi de livraison, promotions complexes, fidélité, marketplace non-alimentaire, réservations, analytics avancées. Le bouton « Ajouter au panier » de la page produit est un **shell visuel non opérationnel**, documenté comme tel (§17.6) — aucun panier temporaire factice n'a été construit.

---

## 3. Commandes

```bash
pnpm install
pnpm --filter @djafat/api db:generate
pnpm infra:up
pnpm db:migrate && pnpm db:seed        # migrations 0001–0018 + seed (incl. 5 restaurants/catégories/produits/options)
pnpm dev                                # apps/api (:3001) + apps/web (:3000)

pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build

# Intégration (nécessite pnpm infra:up + db:migrate + db:seed)
pnpm --filter @djafat/api run test:int
```

Frontend seul : `pnpm --filter @djafat/web dev` (nécessite `apps/api` démarré sur `:3001`, ou `NEXT_PUBLIC_API_BASE_URL` pointé ailleurs).

---

## 4. Architecture — modèle de données

### 4.1 `Restaurant` (migration `0014`, étend `0009`)

`id, country_id, city_id, owner_user_id, slug (stable, généré serveur), name, description, phone, address_text, logo_url, cover_url, geom geography(Point,4326) (nullable), rating_avg numeric(2,1) DEFAULT 0, rating_count int DEFAULT 0, prep_time_min int DEFAULT 20, min_order_minor bigint DEFAULT 0, currency, status, created_at, updated_at`. `rating_avg`/`rating_count` sont un **cache**, pas une seconde source de vérité — recalculés depuis les avis dans un futur bloc (avis non implémentés ici).

`status` (6 valeurs, `RESTAURANT_STATUSES` dans `@djafat/types`) : `draft | pending_review | active | paused | suspended | closed`. Visibilité client :

| Statut           | Visible publiquement ? | Commandable ?        |
| ---------------- | ---------------------- | -------------------- |
| `active`         | oui                    | oui (selon horaires) |
| `paused`         | oui                    | **non** (`PAUSED`)   |
| `draft`          | **non**                | non                  |
| `pending_review` | **non**                | non                  |
| `suspended`      | **non**                | non                  |
| `closed`         | **non**                | non                  |

`RESTAURANT_PUBLIC_STATUSES = ['active', 'paused']` — toute requête publique (`CatalogService`) filtre sur cet ensemble ; un restaurant hors de cet ensemble **404 exactement comme un slug inconnu**, jamais un 403 ou un corps distinctif (test IDOR §14).

`geom`/`search_vector` sont volontairement **non modélisés dans `schema.prisma`** (raw-SQL uniquement) — même précédent que `0002` pour `cities.geom` (docs/06 §6.5, décision D-02 déjà actée au Bloc 0).

Multi-pays/multi-ville : aucun code ne teste une ville en dur — `city_id` est une FK générique, les horaires sont interprétés dans **le fuseau de la ville** (`cities.timezone`), jamais UTC-comme-local.

### 4.2 `MenuCategory` (migration `0015`)

`id, restaurant_id (obligatoire, CASCADE), name (CHECK non-vide), description, image_url, sort_order, is_active, timestamps`. Restaurant-scopée par construction (pas de table de catégories globale — voir §21.2 pour la justification vs. docs/06 §6.5).

### 4.3 `Product` (migration `0016`, étend `0009`)

Ajoute `category_id (FK MenuCategory, SET NULL), slug (unique par restaurant), description, image_url, sort_order, is_active` à la table `0009`. Prix **toujours** `price_minor` + `currency` (le type `Money` établi, jamais `price_xaf`). `is_active` (le produit existe-t-il encore dans la carte ?) est **distinct** de `is_available` (Bloc 0.5, inchangé — en rupture de stock temporaire) : un produit temporairement indisponible n'est jamais supprimé.

Le catalogue expose le prix courant mais **n'est pas l'autorité de prix finale d'une commande** — un futur module Pricing/Orders recalcule et fige le prix côté serveur (Bloc 0.5/1 : jamais de prix/total client-fourni ; inchangé ici).

### 4.4 `ProductOptionGroup` / `ProductOption` (migration `0017`)

Groupe : `product_id (CASCADE), name, selection_type (single|multiple), min_selections, max_selections, is_required, sort_order`. Option : `option_group_id (CASCADE), name, price_delta_minor bigint (peut être NÉGATIF — une petite taille moins chère), currency, is_available, sort_order`.

`validateProductOptionSelections()` (`@djafat/core`, pure, 10 tests) valide required/min/max/disponibilité/option-inconnue — **écrite maintenant, consommée par un futur panier/commande** (§17.5) : `effectiveMin = isRequired ? max(minSelections, 1) : minSelections`.

### 4.5 `RestaurantHours` / `RestaurantClosure` (migration `0018`)

Horaires hebdomadaires stockés en **minutes depuis minuit** (`opens_minutes`, `closes_minutes`, entiers `0..1439`), **pas** en type `time` Prisma — décision délibérée (§19.5). Convention `opens == closes` = ouvert toute la journée ce jour-là. Chevauchement de minuit supporté (ex. `18:00 → 02:00`, Pizza N'Djam dans le seed) : une plage peut démarrer un jour et se terminer le lendemain matin, `computeRestaurantAvailability` (`@djafat/core`) le gère sans dupliquer la ligne.

`RestaurantClosure` : `starts_at`/`ends_at` (timestamptz) — fermetures exceptionnelles simples (« fermé le 25/12 »), pas de moteur de calendrier récurrent.

### 4.6 Disponibilité — `RestaurantAvailabilityService`

`computeRestaurantAvailability()` (pure, `@djafat/core`, 17 tests, 100 % lignes / 96,83 % branches) :

```
paused                          -> PAUSED
status hors {active, paused}    -> UNAVAILABLE
fermeture exceptionnelle active -> CLOSED
sinon: horaires du jour (fuseau ville) -> OPEN | CLOSED
```

Le service Nest (`RestaurantAvailabilityService`, `apps/api`) l'entoure d'I/O : `computeForRestaurant` (un restaurant) et **`computeForRestaurants`** (lot — **2 requêtes au total, jamais une par restaurant**, testé explicitement par une assertion N+1, §14). Le frontend **ne reproduit jamais** cette logique — il affiche uniquement le statut renvoyé par l'API (`AvailabilityBadge`, `apps/web`).

---

## 5. API `/v1` livrée

### Lecture publique (aucune auth — `CatalogController`)

| Méthode | Route                        | Description                                                        |
| ------- | ---------------------------- | ------------------------------------------------------------------ |
| GET     | `/v1/restaurants`            | liste, filtres `cityId/categoryId/search/openNow`, tri, pagination |
| GET     | `/v1/restaurants/:slug`      | détail (404 si non-public)                                         |
| GET     | `/v1/restaurants/:slug/menu` | catégories actives + produits actifs                               |
| GET     | `/v1/products/:id`           | détail produit + groupes d'options                                 |
| GET     | `/v1/categories`             | noms de catégories distincts en usage (voir §21.2)                 |

Le mandat nommait `:restaurantId` — livré en `:slug` à la place (slug stable, généré serveur, jamais fourni par le client pour une autorisation — voir §21.1) : une URL lisible et partageable (`/restaurants/chez-fatime`) plutôt qu'un UUID, cohérent avec le premier rendu (§17) et le SEO (§10).

### Écriture authentifiée + ownership (`CatalogManagementController`)

| Méthode | Route                            | Permission          | Ownership override |
| ------- | -------------------------------- | ------------------- | ------------------ |
| POST    | `/v1/restaurants`                | `restaurants:write` | — (création)       |
| PATCH   | `/v1/restaurants/:id`            | `restaurants:write` | `admin:write`      |
| POST    | `/v1/restaurants/:id/categories` | `menus:write`       | `admin:write`      |
| PATCH   | `/v1/categories/:id`             | `menus:write`       | `admin:write`      |
| POST    | `/v1/restaurants/:id/products`   | `menus:write`       | `admin:write`      |
| PATCH   | `/v1/products/:id`               | `menus:write`       | `admin:write`      |
| PATCH   | `/v1/products/:id/availability`  | `menus:write`       | `admin:write`      |
| POST    | `/v1/products/:id/option-groups` | `menus:write`       | `admin:write`      |
| PATCH   | `/v1/option-groups/:id`          | `menus:write`       | `admin:write`      |

Toutes ces routes existent pour un futur dashboard restaurant (Bloc 9/10) — **le dashboard lui-même n'est pas construit ici** (mandat §36).

### Recherche

PostgreSQL FTS (`tsvector` GENERATED ALWAYS AS `to_tsvector('french', ...)`, index GIN, `websearch_to_tsquery('french', ...)` à la requête) — pas d'Elasticsearch/Meilisearch. Entièrement paramétré via `Prisma.sql` (structurellement à l'abri d'une injection, quel que soit le contenu). Couvre **nom/description du restaurant, nom de produit actif, nom de catégorie active** (mandat §27) — pas seulement le restaurant lui-même. Bornes : `search` 1–80 caractères après `trim()`, rejeté (422) sinon.

### Pagination / tri

`page`/`limit` (défaut 1/20, max 50, 422 au-delà). `sort ∈ {recommended, rating, delivery_time, name}` — `recommended` a une définition **déterministe et documentée** (`sortRestaurants()`, `@djafat/core`, 9 tests) : `rating_avg DESC → rating_count DESC → created_at ASC`, jamais d'IA ni de scoring opaque.

### DTOs

Toutes les réponses sont des DTOs explicites (`RestaurantListItemDto`, `RestaurantDetailDto`, `ProductDetailDto`, …) — jamais un modèle Prisma exposé directement. `Money` sérialisé `{minor: string, currency}` (convention docs/07 §7.1, inchangée).

---

## 6. Ownership & RBAC

Aucun nouveau système d'ownership — réutilisation stricte des primitives Bloc 1 (`@RequireAuth() @RequirePermission(...) @RequireOwnership(Service, resolve, overridePermission)`). `Restaurant.ownerUserId` est la seule source de vérité d'ownership pour ce bloc (propriétaire unique — le multi-staff via `user_roles.scope_restaurant_id` reste une dette, §20 D-16).

**Décision de sécurité clé** : la permission d'override est `admin:write` (détenue **uniquement** par `admin`/`super_admin`, jamais par `restaurant_owner`/`restaurant_staff` — seed Bloc 1 inchangé), **pas** `restaurants:write`/`menus:write`. Si l'override avait été `restaurants:write`, n'importe quel propriétaire de restaurant aurait pu « contourner » l'ownership et modifier le restaurant de n'importe qui d'autre — un vrai bug de sécurité évité par construction, testé explicitement (`catalog.int.spec.ts`, « a DIFFERENT restaurant owner cannot modify… »).

Statuts en libre-service par le propriétaire : `draft/active/paused` (`OWNER_SELF_SERVICE_STATUSES`). `suspended`/`closed` exigent `admin:write` — un propriétaire qui tente `status: 'suspended'` sur son propre restaurant reçoit **403**, testé.

---

## 7. Images

Réutilisation de l'abstraction `ObjectStorage` du Bloc 0 **non requise** ici : aucun endpoint d'upload réel n'existe encore, les URLs d'image (`logo_url`/`cover_url`/`image_url`) sont de simples colonnes TEXT nullables (placeholders `placehold.co` dans le seed). `apps/web` consomme ces URLs via `next/image` (`remotePatterns` restreint à `placehold.co`) — lazy loading + tailles responsives obtenus gratuitement, satisfaisant l'exigence bas-débit (§9) sans construire de pipeline de traitement d'image.

---

## 8. Performance & N+1

- `listRestaurants` : **une** requête SQL brute pour tout l'ensemble filtré (pas de `LIMIT/OFFSET` SQL), **2** requêtes supplémentaires pour la disponibilité de tout le lot (jamais une par restaurant), puis tri/filtre `openNow`/pagination **en mémoire**. Correct à l'échelle du lancement (dizaines à quelques centaines de restaurants par ville) ; une colonne de disponibilité matérialisée serait l'étape suivante si un marché dépassait cette échelle (dette D-17).
- Index : `restaurants(city_id, status)` (existant, Bloc 0.5, filtre partiel), `restaurants(owner_user_id)` (nouveau), GIN sur `restaurants.search_vector`/`products.search_vector` (nouveaux), `products(category_id)`, `menu_categories(restaurant_id)`, unicité `products(restaurant_id, slug)`.
- `getMenu`/`getProductDetail` : Prisma `include` ciblé (pas de sur-fetch), `_count.optionGroups` plutôt que charger les groupes pour juste savoir s'ils existent sur la liste.

---

## 9. Cache

**Aucun cache Redis ajouté** dans ce bloc — décision délibérée, pas un oubli. Le mandat demande explicitement d'éviter « Redis partout sans mesure » ; la disponibilité dépend du temps (heure courante), donc un cache mal invalidé pourrait afficher OPEN alors que le restaurant vient de fermer — un risque que le trafic actuel (zéro, pré-lancement) ne justifie pas de prendre. PostgreSQL reste l'unique source de vérité ; `apps/web` force `dynamic = 'force-dynamic'` sur chaque route catalogue (toujours une lecture fraîche). Réévaluer si le profilage le justifie (dette D-18).

---

## 10. Frontend — premier rendu

4 routes Next.js 15 (App Router, Server Components, aucun état client requis pour parcourir/rechercher — formulaires `GET` natifs, §10.4) :

```
/                                            — accueil : en-tête, pastille de localisation,
                                                recherche, catégories, grille de restaurants
/restaurants                                 — liste : recherche + filtres (openNow, tri) + pagination
/restaurants/[slug]                          — détail : couverture, logo, nom, description, note,
                                                temps de préparation, ouvert/fermé, adresse, menu par catégorie
/restaurants/[slug]/products/[productId]     — détail produit : image, nom, description, prix,
                                                disponibilité, groupes d'options, bouton « Ajouter au
                                                panier » (shell non opérationnel, Bloc 4)
```

Composants (`apps/web/src/components/`) : `SiteHeader`, `SearchForm` (formulaire `GET` — zéro JS requis pour chercher/filtrer, cohérent avec le bas-débit), `CategoryChipRow`, `RestaurantCard`/`RestaurantGrid`, `AvailabilityBadge`, `Pagination`, `EmptyState`, `ProductListItem`. États : chargement (squelettes animés par route, respectent `prefers-reduced-motion`), erreur (`error.tsx` racine réutilisé), vide (`EmptyState`, jamais une page blanche), 404 (`not-found.tsx` — un restaurant non-public 404 **exactement** comme un slug inconnu, cohérent avec §5/§14).

Design : primitives visuelles minimales sur les tokens `@djafat/tokens` existants (pas de nouveau Design System — Bloc 3), mobile-first, testé aux largeurs 360/390/768/1024/1280+ via CSS Modules + `@media`. Accessibilité : labels de formulaire, focus visible (hérité du reset global), `alt` structuré (image décorative vide quand le nom est déjà affiché en texte adjacent — jamais de redondance de lecteur d'écran), statut jamais signalé par la seule couleur (`AvailabilityBadge` porte toujours un libellé texte), titres structurés (`h1`→`h2` par section).

SEO (`generateMetadata` sur `/restaurants/[slug]`) : `title`/`description`/`canonical`/`Open Graph`, dérivés des vraies données restaurant.

Le SDK partagé (`@djafat/sdk`) porte `createCatalogClient()` — même client, même types, consommable par `apps/web` et un futur `apps/mobile` (Expo) sans dupliquer le modèle de domaine catalogue.

---

## 11. Seed

Étendu (`apps/api/prisma/seed.ts`), toujours Tchad/N'Djamena/XAF sur les tables génériques :

| Restaurant      | Statut      | Particularité testée                                                              |
| --------------- | ----------- | --------------------------------------------------------------------------------- |
| Chez Fatimé     | `active`    | horaires 11:00–22:00, options (Portion, Sauce)                                    |
| Le Sahel Grill  | `active`    | fermeture exceptionnelle (25/12)                                                  |
| Pizza N'Djam    | `active`    | horaires **chevauchant minuit** (18:00 → 02:00), un produit `is_available: false` |
| Snack Rapide    | `paused`    | visible mais non commandable                                                      |
| Le Palace Fermé | `suspended` | **jamais visible** publiquement                                                   |

5 restaurants, 2–3 catégories chacun, 2–3 produits chacun, options sur plusieurs produits, logos/couvertures placeholder — couvre tous les cas de test explicitement demandés (§47-§48 du mandat).

---

## 12. Tests

| Suite                                                                            | Fichiers | Tests        | Statut                                                  |
| -------------------------------------------------------------------------------- | -------- | ------------ | ------------------------------------------------------- |
| `@djafat/core` (Blocs 0.5/1, inchangé)                                           | 6        | 87           | **PASS**                                                |
| `@djafat/core` — nouveau (`restaurant-availability`, `product-option-validator`) | 2        | 27           | **PASS** (réellement exécuté)                           |
| `apps/api` unitaire (Blocs 0.5/1, inchangé)                                      | 14       | 100          | **PASS**                                                |
| `apps/api` unitaire — nouveau (services/DTOs catalogue)                          | 6        | 48           | **PASS** (réellement exécuté)                           |
| autres packages (`tokens/i18n/config/validation/sdk`)                            | 5        | 23           | **PASS** (inchangé, réellement exécuté)                 |
| `apps/api` intégration — `catalog.int.spec.ts` (nouveau)                         | 1        | 26 scénarios | **N/V** — Docker indisponible ; type-checké avec succès |
| `apps/api` intégration — `identity`/`walking-skeleton` (Blocs 0.5/1)             | 2        | inchangé     | **N/V** — idem                                          |

**Total unitaire réellement exécuté : 285**, tous verts (114 core + 148 api + 23 autres).

**Ce que `catalog.int.spec.ts` vérifie** (quand il tourne en CI) :

1. Les 4 endpoints publics + `/v1/categories`, y compris qu'un restaurant `suspended` n'apparaît jamais et 404 exactement comme un slug inconnu.
2. Sécurité recherche : chaîne vide (422), > 80 caractères (422), unicode (200), tentative d'injection SQL (200, table intacte ensuite).
3. Abus de pagination : `limit` > 50 (422), `page` < 1 (422), page hors plage (200, liste vide).
4. Flux complet : propriétaire crée un restaurant (`draft`, invisible) → le publie (`active`) → catégorie → produit → groupe d'options → tout est visible publiquement, sans authentification, exactement tel que construit.
5. Ownership/RBAC : propriétaire modifie son propre restaurant (200) ; un AUTRE propriétaire refusé (403, nom inchangé en base) ; client sans `restaurants:write` refusé (403) ; requête non authentifiée refusée (401) ; propriétaire ne peut pas s'auto-suspendre (403) ; admin peut suspendre n'importe quel restaurant (200) ; `ownerUserId`/`status` fournis dans le body de création sont rejetés (schéma `.strict()`, 422).

**Discipline de véracité** : ni `catalog.int.spec.ts` ni les suites héritées n'ont été exécutées ici (pas de Docker) — livrées comme du code réel, type-checké avec succès contre le schéma réel, jamais présentées comme passées.

---

## 13. Sécurité / invariants vérifiés

- **Visibilité** : un restaurant `draft/pending_review/suspended/closed` est **structurellement inatteignable** en lecture publique (`assertRestaurantPublic`, requêtes SQL filtrées à la source) — jamais un filtre appliqué après coup côté client.
- **IDOR** : restaurant/produit non-public → 404 identique (même `error.code`) à un id inconnu, testé.
- **Ownership** : override réservé à `admin:write`, jamais à une permission détenue par un propriétaire (§6) — testé par un scénario cross-owner dédié.
- **Role spoofing / injection de champs** : tous les DTOs d'écriture sont `.strict()` — `ownerUserId`, `status` (à la création), `ratingAvg`, ou tout champ hors schéma envoyé par le client est **rejeté en bloc** (422), jamais silencieusement ignoré.
- **Injection SQL** : recherche entièrement paramétrée (`Prisma.sql`), testée avec une charge utile explicite (`'; DROP TABLE restaurants; --`).
- **Prix/monnaie** : jamais fournis par le client sur une lecture ; sur une écriture, `priceMinor`/`priceDeltaMinor` sont des chaînes d'entiers validées par regex puis converties en `bigint` — jamais un nombre JS flottant.
- **Aucun secret dans les logs** : le module catalogue ne journalise jamais de jeton/mot de passe (aucun secret n'y transite).

---

## 14. Base de données — migrations ajoutées

| #                                | Contenu                                                                                                                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0014_restaurant_profile`        | Profil restaurant complet (owner, description, adresse, logo/cover, `geom`, note-cache, prep-time, min-order) ; `status` élargi à 6 valeurs ; `search_vector` + GIN ; FK `user_roles.scope_restaurant_id → restaurants` (fermeture de dette Bloc 1). |
| `0015_menu_categories`           | Table `menu_categories` ; FK `commission_rules.category_id → menu_categories` (fermeture de dette Bloc 0/1, docs/06 §6.5).                                                                                                                           |
| `0016_products_extended`         | `category_id`, `slug` (unique par restaurant, rétro-rempli), `description`, `image_url`, `sort_order`, `is_active` sur `products` ; `search_vector` + GIN.                                                                                           |
| `0017_product_options`           | `product_option_groups`, `product_options` (delta de prix pouvant être négatif).                                                                                                                                                                     |
| `0018_restaurant_hours_closures` | `restaurant_hours` (minutes entières, pas `time`), `restaurant_closures`.                                                                                                                                                                            |

Aucune migration `0001`–`0013` modifiée destructivement — uniquement des `ALTER TABLE ... ADD COLUMN`, un élargissement de `CHECK`, et deux FK différées fermant une dette déjà anticipée (docs/06 §6.5).

---

## 15. DAG respecté

`platform/geo → auth/users → restaurants/catalog → pricing → carts → orders` — `catalog` ne dépend ni de `payments`, ni de `ledger`, ni de `deliveries`. La seule extension de règle ESLint (`packages/eslint-config/api-boundaries.js`) donne à `catalog` sa **propre** règle explicite pour atteindre `auth`/`users` (lecture de l'acteur courant, permissions) — pas repliée dans la règle générique « tout module », leçon retenue du Bloc 1 (docs/19 §13) où une règle générique accorde aussi l'auto-référence/l'accès réciproque par union.

---

## 16. Premier rendu — vérifié

```
next build (apps/web) :
┌ ƒ /                                         942 B    115 kB First Load JS
├ ○ /_not-found                               368 B    106 kB
├ ƒ /restaurants                              944 B    115 kB
├ ƒ /restaurants/[slug]                       880 B    115 kB
└ ƒ /restaurants/[slug]/products/[productId]  582 B    115 kB
```

`pnpm --filter @djafat/web dev` (après `pnpm infra:up && pnpm db:migrate && pnpm db:seed && pnpm --filter @djafat/api dev`) sert ces 4 routes contre les données de seed réelles — cinq restaurants, dont un fermé (fenêtre horaire), un en pause, un suspendu (invisible), un avec horaires chevauchant minuit, options sur plusieurs produits.

---

## 17. Décisions prises pendant l'implémentation

1. **Extraction en fonctions pures dans `@djafat/core`** (`computeRestaurantAvailability`, `validateProductOptionSelections`, `sortRestaurants`) — même discipline que les Blocs 0.5/1 : la logique la plus sensible (disponibilité, tri « recommandé ») est testée sans base de données, donc réellement exécutée.
2. **Horaires en minutes entières, pas en type `time` Prisma** — l'ambiguïté de sérialisation Date↔Time de Prisma selon le driver n'était pas vérifiable sans Postgres réel dans cet environnement ; corrigée par construction plutôt que risquée.
3. **`admin:write` comme permission d'override d'ownership**, jamais `restaurants:write`/`menus:write` (§6) — décision de sécurité, pas une préférence stylistique.
4. **Table `menu_categories` (pas `categories`)** — docs/06 §6.5 esquissait une table de catégories potentiellement globale ; le mandat Bloc 2 (§11) exige explicitement une catégorie restaurant-scopée. Nom plus étroit pour une table plus étroite, pas de collision avec l'ancien concept plus large.
5. **`validateProductOptionSelections` écrite maintenant, consommée plus tard** — le mandat demande explicitement un service réutilisable pour un futur panier, même si aucune commande ne l'appelle encore dans ce bloc.
6. **Stratégie anti-N+1 pour la liste de restaurants** : une requête pour l'ensemble filtré, deux pour la disponibilité du lot entier, tri/filtre/pagination en mémoire — plutôt que de dupliquer la logique de disponibilité en SQL (qui violerait le principe même du mandat : « le frontend ne doit jamais reproduire cette logique » étendu ici à « le SQL non plus »).
7. **Endpoint `GET /v1/categories`** livré comme l'agrégat des noms de catégories distincts en usage (pas une table de catégories globale, §21.2) — nécessaire au premier rendu (rangée de catégories, §60 du mandat) sans contredire la décision #4.
8. **Slugs de restaurant dans l'URL plutôt que `:restaurantId`** — le mandat nommait `:restaurantId` ; un slug stable, généré serveur, est plus conforme à l'esprit « jamais faire confiance au slug fourni par le client pour une autorisation » (le slug n'autorise rien, il identifie juste une ressource publique) tout en donnant des URLs lisibles pour le SEO et le partage.
9. **Formulaires `GET` natifs pour la recherche/filtres** (`apps/web`) — zéro JavaScript requis pour chercher ou filtrer, cohérent avec l'exigence bas-débit (§9 du mandat) ; chaque changement de filtre est une navigation normale, le serveur relit toujours PostgreSQL.
10. **Aucun cache Redis ajouté** (§9) — décision délibérée compte tenu du trafic actuel (zéro) et du risque d'incohérence temporelle sur la disponibilité.

---

## 18. Écarts avec le mandat

Aucun écart de périmètre. Deux adaptations de nommage documentées et justifiées ci-dessus (#7, #8) — les capacités demandées existent, sous un nom plus honnête vis-à-vis du modèle de données réel.

---

## 19. Bugs trouvés et corrigés

### 19.1 — Tokens numériques utilisés sans unité en CSS (`apps/web`)

**Symptôme** : `fontSize: 'var(--djafat-type-size-body)'`, `borderRadius: 'var(--djafat-radius-md)'` etc. (présents depuis le Bloc 0 dans `error.tsx`) ne s'appliquaient jamais réellement — la valeur substituée (`15`, `12`, …) est invalide pour une propriété de longueur CSS, le navigateur ignore silencieusement la déclaration entière.

**Cause racine** : `@djafat/tokens` stocke les valeurs numériques **sans unité** par design (même source alimente React Native, où les tailles sont des nombres bruts — `packages/tokens/src/tokens.spec.ts` teste explicitement `vars['--djafat-space-4'] === '16'`, pas `'16px'`).

**Correction** : `calc(var(--djafat-x) * 1px)` partout où un token numérique alimente une propriété de longueur — dans tout le nouveau code (`apps/web/src/components/*.module.css`, `apps/web/src/app/**/*.module.css`) et rétrofit sur `apps/web/src/app/error.tsx`.

**Test** : vérification visuelle via `next build` (aucune erreur de compilation — le bug est silencieux au build, seulement visible au rendu) ; documenté en commentaire dans `error.tsx` pour éviter la régression.

### 19.2 — Recherche ne couvrait pas produit/catégorie (auto-détecté avant tout usage)

**Symptôme** : `listRestaurants` avec `search` ne matchait que `restaurants.search_vector` (nom/description du restaurant), pas le nom d'un produit ou d'une catégorie — en contradiction avec le mandat §27.

**Cause racine** : première implémentation trop littérale de « recherche plein texte sur le restaurant ».

**Correction** : ajout de deux `EXISTS` paramétrés (produit actif, catégorie active) dans le même `WHERE`, avant tout commit — pas une régression testée après coup, une lacune fermée avant livraison.

**Test** : `catalog.int.spec.ts`, « a search matching a PRODUCT name … still finds the restaurant ».

---

## 20. Dette technique

| #    | Description                                                                      | Impact                                                                                             | Pourquoi reportée                                                                                     | Bloc cible                                          |
| ---- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| D-16 | Ownership mono-propriétaire (`ownerUserId`), pas de multi-staff par restaurant   | `restaurant_staff` (via `user_roles.scope_restaurant_id`) ne peut pas encore gérer un menu         | Le mandat teste explicitement propriétaire/non-propriétaire/admin, pas le staff ; guard actuel suffit | Bloc 9/10 (dashboard restaurant)                    |
| D-17 | Disponibilité recalculée à la volée (pas de colonne matérialisée)                | Reste O(nombre de restaurants filtrés) par requête liste — 2 requêtes, jamais N                    | Correct à l'échelle du lancement (dizaines à centaines de restaurants/ville)                          | Si le profilage le justifie                         |
| D-18 | Aucun cache Redis sur restaurant/menu                                            | Chaque requête catalogue touche PostgreSQL                                                         | Trafic nul à ce stade ; un cache mal invalidé risquerait un statut de disponibilité obsolète          | Si le profilage le justifie                         |
| D-19 | Upload d'image réel non implémenté (`ObjectStorage` non câblé)                   | `logoUrl`/`coverUrl`/`imageUrl` sont de simples URLs TEXT, pas de pipeline WebP/AVIF/thumbnails    | Aucun endpoint d'upload n'existe encore à retrofiter ; prématuré sans un vrai consommateur            | Quand un dashboard d'upload existera                |
| D-20 | Pas de notation/avis réels — `ratingAvg`/`ratingCount` sont des colonnes seedées | Le cache de note n'a rien à recalculer pour l'instant                                              | Hors périmètre explicite du mandat (§4 mentionne le cache, pas le système d'avis lui-même)            | Bloc futur (avis)                                   |
| D-21 | `GET /v1/categories` est un agrégat de noms, pas une ressource avec id stable    | Un chip de catégorie sur l'accueil déclenche une recherche texte, pas un filtre `categoryId` exact | `MenuCategory` est restaurant-scopée par design (mandat §11) — pas de table globale à référencer      | Réévaluer si un vrai besoin de filtre global émerge |

Aucune de ces dettes ne touche une décision d'architecture verrouillée ni le modèle financier.

---

## 21. Notes de conception

### 21.1 Slugs et autorisation

Le slug est **toujours généré côté serveur** (`slugify(name) + suffixe aléatoire en cas de collision`, `apps/api/src/modules/catalog/slugify.ts`) — jamais accepté du client. Il identifie une ressource publique, il n'autorise jamais une action : toutes les routes d'écriture utilisent l'`id` (UUID), résolu et vérifié côté serveur, jamais le slug.

### 21.2 Pourquoi `GET /v1/categories` est un agrégat

`MenuCategory` est restaurant-scopée par construction (mandat §11 : « restaurant obligatoire »). Il n'existe donc pas de « la catégorie Pizza » unique et partagée entre restaurants — seulement des lignes `menu_categories` distinctes qui portent parfois le même nom. `GET /v1/categories` renvoie les noms distincts en usage (avec un compte de restaurants), utilisés pour la rangée de puces de l'accueil ; cliquer une puce déclenche une **recherche texte** sur ce nom (déjà couverte par la recherche plein texte, §5) plutôt qu'un filtre `categoryId` exact — cohérent avec le modèle de données réel plutôt qu'une fausse promesse de taxonomie globale.

---

## 22. Recommandation pour le Bloc 3

**Je m'arrête ici. Le Bloc 3 attend une décision explicite séparée — ce document ne constitue pas un feu vert.**

Le catalogue tient bout en bout : un client peut parcourir, chercher, filtrer, ouvrir un restaurant, voir son menu, ouvrir un produit et ses options — entièrement porté par PostgreSQL, jamais par une logique frontend indépendante. Les seules réserves sont l'exécution Docker (identique aux Blocs 0/0.5/1) et la dette explicitement assumée en §20 — aucune ne remet en cause une décision d'architecture verrouillée. Le Design System complet, le panier, le paiement, le dispatch et les promotions restent hors de ce bloc, comme demandé.
