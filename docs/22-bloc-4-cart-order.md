# 22 — Bloc 4 : Panier + Commande cœur

> Un panier fonctionnel (Restaurant → Produit → Options → Panier → Quote serveur → Création de commande) porté de bout en bout par le backend, exposé au frontend via un pont d'authentification minimal.
> **Aucun paiement réel, aucun dispatch réel, aucune notification métier complète, aucun règlement/wallet, aucun panier multi-restaurant** (voir §2).
> Ce document est le rapport de fin de bloc — **le Bloc 5 n'est pas démarré**.

---

## 0. Note sur le mandat reçu

Le mandat « BLOC 4 — CART + CORE ORDER » a été reçu **tronqué deux fois de suite au même endroit** (milieu de la §9 « Snapshot de commande », juste après l'exemple « Burger… 5000 XAF »), y compris après une demande explicite de renvoi — signe d'une limite de longueur côté plateforme plutôt que d'une erreur de copier-coller. Après en avoir informé l'utilisateur, l'implémentation a procédé avec les sections reçues (§0 à §9, contexte compris) et a comblé les points non couverts par la partie tronquée (nommage exact des routes API, checklist de definition-of-done, format du rapport de fin de bloc) avec les conventions déjà établies aux Blocs 2/3 — décision communiquée avant de commencer, pas prise en silence.

---

## 1. Résultat

# 🟢 PASS — avec réserve de vérification (pas de Docker dans l'environnement de build)

`pnpm install` · `prettier --check` · `turbo run lint typecheck test build` → **19/19 packages lint, 19/19 typecheck, 19/19 test, 19/19 build**. **367 tests unitaires réellement exécutés**, tous verts (`packages/core` 121, dont 7 nouveaux `cart-pricing.spec.ts` ; `apps/api` 164, dont 15 nouveaux `carts.service.spec.ts` + 1 régression sur `all-exceptions.filter.spec.ts` ; `@djafat/ui` 56 inchangé ; 26 autres tests répartis sur `config`/`tokens`/`i18n`/`sdk`/`validation`). **46 scénarios d'intégration** répartis sur 4 fichiers (`catalog.int.spec.ts` 26, `cart.int.spec.ts` 12 nouveau, `identity.int.spec.ts` 5, `walking-skeleton.int.spec.ts` 3) restent **N/V** (pas de Docker ici, comme à chaque bloc précédent).

**Un vrai bug de correctness trouvé et corrigé** (§16.1) : les nouveaux codes d'erreur du panier (`CART_RESTAURANT_MISMATCH`, `CART_ITEM_UNAVAILABLE`, `CART_EMPTY`, `CART_ITEM_INVALID_OPTIONS`) n'étaient pas enregistrés dans l'union `ApiErrorCode` partagée (`@djafat/types`) — le filtre d'exceptions global les rejetait silencieusement et retombait sur un code générique dérivé du statut HTTP (un 409 `CART_RESTAURANT_MISMATCH` sortait en `IDEMPOTENCY_KEY_REUSED`). Deux autres bugs mineurs trouvés et corrigés pendant l'implémentation : un ordre de validation service qui faisait échouer un item sur une erreur d'option non pertinente avant de signaler le vrai problème (mismatch de restaurant, §16.2), et une suite d'intégration (`walking-skeleton.int.spec.ts`) restée désynchronisée depuis le Bloc 1 — jamais mise à jour pour envoyer un header d'authentification (§16.3).

---

## 2. Périmètre

**Dedans** : panier serveur (`carts`/`cart_items`/`cart_item_options`), règle « un panier = un restaurant », validation complète des options et de la quantité côté serveur, quote live (`POST /v1/carts/quote`), création de commande consommant le panier (snapshot immuable, `order_item_options`), pont d'authentification frontend minimal (connexion OTP), 4 écrans (`/connexion`, produit avec sélection d'options, `/panier`, `/commandes/[id]`), indicateur de panier dans le header.

**Explicitement dehors** (mandat) : paiement réel (Airtel Money/Moov Money/carte/PSP/webhook), dispatch réel (attribution livreur, navigation, tracking GPS), notifications métier complètes, règlement/payout/wallet client, panier multi-restaurant dans un même panier (refusé explicitement, jamais fusionné en silence). Aucun de ces sujets n'a été touché, même partiellement.

---

## 3. Commandes

```bash
pnpm install
pnpm --filter @djafat/ui run build      # requis avant tout build web (hérité du Bloc 3)
pnpm --filter @djafat/api run db:migrate  # applique 0019_carts (nécessite PostgreSQL — non exécuté ici, pas de Docker)
pnpm dev                                  # apps/api (:3001) + apps/web (:3000)

pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

---

## 4. Modèle de données (`0019_carts`)

| Table                | Rôle                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `carts`              | Un panier par utilisateur au maximum à l'état `open` (index unique partiel `carts_one_open_per_user … WHERE status='open'`) ; `restaurant_id`/`currency` `NULL` tant qu'aucun item n'a été ajouté ; `status IN ('open','converted')` — pas de `'abandoned'`, aucun sous-système d'expiration/nettoyage construit pour ce bloc (hors périmètre, §15 décision 1). |
| `cart_items`         | `quantity CHECK BETWEEN 1 AND 99` ; `name_snapshot`/`unit_price_minor` = **snapshot d'affichage uniquement**, jamais relu comme prix autoritaire (§8).                                                                                                                                                                                                          |
| `cart_item_options`  | Même logique de snapshot, `UNIQUE(cart_item_id, option_id)` pour empêcher une double sélection de la même option sur la même ligne.                                                                                                                                                                                                                             |
| `order_item_options` | **Snapshot permanent et immuable** (nouveau, miroir de `order_items.name_snapshot` déjà existant depuis le Bloc 0.5) — `option_id` gardé `ON DELETE SET NULL` pour la traçabilité seulement ; `name_snapshot`/`price_delta_minor` sont ce qui a réellement été facturé, pour toujours (§9).                                                                     |

Le commentaire en tête de migration résume la règle centrale : le panier n'est **jamais** l'autorité de prix — `GET /v1/carts` lit uniquement le snapshot d'affichage (rapide, aucune jointure live), et `POST /v1/carts/quote` (ainsi que la création de commande en interne) est le **seul** point qui relit `products`/`product_options` en direct et recalcule.

---

## 5. Règle « un panier = un restaurant » (§2.1 du mandat)

`CartsService.addItem` résout d'abord le panier ouvert existant, puis :

- Panier vide (`restaurantId === null`) → l'item est ajouté normalement, le panier se lie à ce restaurant/cette devise.
- Panier déjà lié au **même** restaurant → ajout normal.
- Panier lié à un **autre** restaurant, sans `replaceCart: true` → **refus explicite**, `409 CART_RESTAURANT_MISMATCH`.
- Panier lié à un autre restaurant, avec `replaceCart: true` → les `cart_items` existants sont purgés et le panier se rebind sur le nouveau restaurant/devise, dans la même transaction.

Jamais de fusion silencieuse — exactement l'interdiction du mandat. Cette vérification est faite **avant** la validation des options (§16.2) : un mismatch de restaurant est un problème plus fondamental qu'une option invalide sur le nouvel item.

---

## 6. Validation des options (§4 du mandat)

Le client envoie `selectedOptionIds: string[]` (liste plate). Le serveur :

1. Recharge le **produit vivant** (`CatalogService.getCartEligibleProducts`, filtré `isActive && isAvailable && restaurantId` — jamais depuis le panier) avec ses groupes d'options et leurs options.
2. Vérifie que chaque id envoyé appartient à **une** des options de **ce** produit — un id inconnu ou appartenant à un autre produit est rejeté en `422 VALIDATION_ERROR` (`UNKNOWN_OPTION` dans `details`) avant même d'atteindre la validation de groupe.
3. Délègue la validation groupe/min/max/requis/disponibilité **entièrement** à la fonction pure déjà existante `validateProductOptionSelections()` (`@djafat/core`, écrite au Bloc 2) — **aucune réimplémentation**, conformément à l'instruction explicite du mandat « réutiliser les briques existantes ».

Deux points d'appel, deux sémantiques d'erreur différentes et volontaires :

- **À l'écriture** (`addItem`/`updateItem`, sur une sélection que le client vient de choisir) → `422 UnprocessableEntityException` (`VALIDATION_ERROR`) : c'est la requête elle-même qui est invalide.
- **Au checkout** (`loadAndValidateCartForCheckout`, sur un panier qui a pu devenir obsolète depuis — option retirée entre-temps) → `409 ConflictException` (`CART_ITEM_INVALID_OPTIONS`/`CART_ITEM_UNAVAILABLE`) : ce n'est pas la requête qui est mauvaise, c'est l'état du panier qui a changé sous les pieds du client.

---

## 7. Règles de quantité (§5 du mandat)

Deux plafonds distincts, volontairement superposés :

1. **Plafond au niveau du schéma** (`AddCartItemSchema`/`UpdateCartItemSchema`, Zod) : `z.number().int().min(1).max(99)` — rejette 0, négatif, décimal, `NaN`, `Infinity` dès la validation d'entrée, avant tout accès base de données.
2. **Plafond configurable côté serveur** (`platform_settings['cart_max_item_quantity']`, défaut `99`) — même patron déjà établi pour `unpaid_order_ttl_seconds`/`otp_max_attempts` (`PlatformService.getNumberSetting()`, réutilisé sans modification ; nouvelle méthode `getCartMaxItemQuantity()` qui l'enveloppe).

Le premier protège contre une entrée absurde au niveau HTTP ; le second permet de resserrer la limite métier sans redéploiement — les deux sont vérifiés, indépendamment.

---

## 8. Règle d'autorité du prix (§6 du mandat) et Pricing (§8)

Le client peut envoyer `productId`/`quantity`/`selectedOptionIds` — **jamais** un prix, une remise, des frais de livraison ou un total. Flux respecté à la lettre :

```
Cart (snapshot d'affichage) → PricingService (relit le catalogue vivant) → CartQuote (calcul serveur, déterministe)
```

`POST /v1/carts/quote` reconstruit chaque ligne depuis `products`/`product_options` frais, calcule via la nouvelle fonction pure `@djafat/core` `cart/cart-pricing.ts` (`computeCartLine`/`computeCartSubtotal` — prix unitaire + somme des deltas d'options × quantité, puis somme des lignes ; réutilise `addMoney`/`mulMoneyByInt`/`sumMoney` déjà existants, aucune arithmétique flottante) et renvoie un `CartQuoteDto` : `subtotal`/`deliveryFee`/`serviceFee`/`discount`/`tax`/`total`/`currency`/`lines`/`computedAt`/`validUntil`. `serviceFee`/`discount`/`tax` sont à zéro (non configurés ce bloc) mais présents dans la forme — le mandat demande explicitement une forme « capable de contenir » ces champs, pas qu'ils soient déjà non-nuls. `validUntil` est une fenêtre indicative de 120 secondes, **jamais appliquée comme contrainte** : la création de commande recalcule toujours à neuf, quel que soit l'âge du dernier quote.

Aucun champ `*Xaf` n'existe nulle part dans ce bloc — chaque montant est un `Money{minor,currency}` sérialisé en `MoneyJson`, comme partout ailleurs dans le dépôt depuis le Bloc 0.5.

---

## 9. Snapshot de commande (§9 du mandat)

`OrdersService.createOrder(customerId, idempotencyKey)` ne prend plus de corps de requête (`POST /v1/orders` accepte désormais `z.object({}).strict()` — tout champ, y compris un `customerId` usurpé, est rejeté). La création :

1. Appelle `CartsService.loadAndValidateCartForCheckout(customerId)` — revalidation et re-tarification **complètes** et **vivantes** du panier de l'appelant (jamais un panier passé en paramètre).
2. Crée les `OrderItem` un par un (pas `createMany`, chacun a besoin de son id généré pour attacher ses `OrderItemOption`), puis `OrderItemOption.createMany` par ligne.
3. Appelle `CartsService.markConverted(tx, cartId)` dans la **même transaction** — le panier passe à `status='converted'`, un nouveau panier `open` pourra être créé au prochain ajout.

Une fois créée, la commande ne dépend plus jamais du catalogue courant pour son prix historique — `order_item_options` (§4) porte tout ce qu'il faut. L'idempotence (`IdempotencyService.run`) fingerprinte désormais sur `{customerId}` (constant par acteur, puisque le corps est toujours `{}`) plutôt que sur l'ancien corps — rejouer la même clé pour le même client rejoue toujours correctement, quel que soit l'état actuel du panier.

---

## 10. API

| Route                     | Méthode  | Rôle                                                                  |
| ------------------------- | -------- | --------------------------------------------------------------------- |
| `/v1/carts`               | `GET`    | Panier courant de l'appelant (snapshot d'affichage), `null` si aucun. |
| `/v1/carts/items`         | `POST`   | Ajoute un item (§5, §6).                                              |
| `/v1/carts/items/:itemId` | `PATCH`  | Modifie quantité et/ou options d'un item.                             |
| `/v1/carts/items/:itemId` | `DELETE` | Retire un item.                                                       |
| `/v1/carts`               | `DELETE` | Vide le panier.                                                       |
| `/v1/carts/quote`         | `POST`   | Quote live, jamais persisté (§8).                                     |
| `/v1/orders`              | `POST`   | Crée la commande depuis le panier de l'appelant (§9).                 |

Toutes les routes `carts` exigent `@RequireAuth() @RequireRole('customer')`. Aucune ne prend d'id de panier dans l'URL — le panier est **toujours** résolu depuis `actor.userId`, jamais depuis une valeur fournie par le client. Conséquence directe : il n'existe structurellement rien à protéger par `@RequireOwnership` (pas d'IDOR possible par construction) ; les opérations au niveau d'un item scopent leur recherche à `WHERE cartId = panier de l'appelant` et renvoient un `404 NOT_FOUND` nu (jamais `403`) pour un item appartenant à quelqu'un d'autre — délibérément indiscernable d'un id simplement inconnu.

---

## 11. Frontend

### 11.1 Pont d'authentification (nouveau, minimal, délibérément borné)

Aucune UI de connexion n'existait dans `apps/web` avant ce bloc (Blocs 2/3 ne couvraient que la navigation catalogue publique) — or le panier exige un acteur authentifié. Construit : `apps/web/src/lib/auth-storage.ts` (session `localStorage`, garde `typeof window`, événement `djafat:auth-changed`), câblé dans `apps/web/src/lib/api.ts` (`getAccessToken` renvoie `null` côté serveur, le token vivant côté client). **Ce n'est explicitement pas un frontend d'identité complet** : pas de retry automatique sur 401 avec rafraîchissement de token (dette assumée, §18 D-27), pas d'écran de gestion de compte. `/connexion` : formulaire téléphone → code OTP en deux étapes, consomme `POST /v1/auth/otp/request` et `POST /v1/auth/otp/verify` (endpoints du Bloc 1, jamais touchés côté backend).

### 11.2 Écrans

- **`ProductOptionsForm`** (nouveau, Client Component monté dans la page produit qui reste un Server Component) — sélection d'options (`Radio`/`Checkbox` de `@djafat/ui`), stepper de quantité, bannière de confirmation dédiée en cas de `409 CART_RESTAURANT_MISMATCH` (jamais de `window.confirm` natif — cohérent avec le reste du design system).
- **`/panier`** — Client Component (le token n'existe qu'en `localStorage`, illisible par un Server Component) : liste des items avec quantité/options, quote live affichée comme source de vérité des prix (repli sur le snapshot du panier uniquement si le quote échoue), retrait/vidage, bouton « Commander » désactivé tant qu'aucun quote valide n'est disponible.
- **`/commandes/[id]`** — confirmation post-commande, statut traduit + `Badge` coloré, détail des lignes et du snapshot immuable.
- **`CartIndicator`** — badge du nombre d'articles dans le header, rafraîchi sur `djafat:auth-changed`/`djafat:cart-changed` (aucun polling).

Tous les nouveaux composants interactifs de `@djafat/ui` (`Radio`, `Input`, `Alert`) ont été ajoutés à la frontière locale `ui-client.tsx` déjà établie au Bloc 3 (docs/21 §13.3, contournement du bug amont Next.js `vercel/next.js#42699`) — aucune nouvelle exception à cette règle.

---

## 12. Tests

| Suite                                                                            | Fichiers | Tests   | Statut                  |
| -------------------------------------------------------------------------------- | -------- | ------- | ----------------------- |
| `packages/core` (`cart-pricing.spec.ts` nouveau)                                 | 10       | 121     | **PASS**                |
| `apps/api` (`carts.service.spec.ts` nouveau, `all-exceptions.filter.spec.ts` +1) | 21       | 164     | **PASS**                |
| `@djafat/ui` (inchangé)                                                          | 11       | 56      | **PASS**                |
| autres packages (inchangés)                                                      | —        | 26      | **PASS**                |
| **Total unitaire**                                                               |          | **367** | **tous verts**          |
| `apps/api/test/cart.int.spec.ts` (nouveau)                                       | 1        | 12      | **N/V** (pas de Docker) |
| `apps/api/test/*.int.spec.ts` (3 autres, existants)                              | 3        | 34      | **N/V**                 |

**Ce que couvre `carts.service.spec.ts`** (15 tests) : création de panier vide, second item même restaurant, mismatch de restaurant refusé, `replaceCart` qui override, option inconnue rejetée, groupe requis non rempli, groupe simple avec deux sélections, option indisponible, quantité au-delà du plafond, 404 IDOR sur `updateItem` d'un item d'autrui, mise à jour de quantité seule qui préserve les options, retrait d'item, `CART_EMPTY` au quote, recalcul de prix live qui ignore le snapshot, produit devenu indisponible refusé au checkout.

**Ce que couvre `cart.int.spec.ts`** (12 scénarios, N/V) : 401 sur chaque route sans auth, flux complet (panier vide → ajout avec options → `GET` reflète l'état → quote live → commande créée → panier redevenu `null`), un-restaurant-par-panier (mismatch puis `replaceCart`), validation d'options (groupe requis vide, deux sélections sur un groupe simple, id d'option d'un autre produit), bornes de quantité (0/-1/100/1.5 → 422), `CART_EMPTY` (quote et création), IDOR (404 sur `PATCH`/`DELETE` d'un item d'autrui), identifiants invalides (UUID malformé → 422, UUID valide mais inconnu → 404, produit d'un restaurant suspendu → 404).

---

## 13. Responsive / accessibilité

Aucun nouveau composant `@djafat/ui` créé ce bloc — uniquement composition des primitives déjà livrées au Bloc 3 (`Radio`/`Checkbox`/`Input`/`Alert`/`Badge`/`EmptyState`/`ErrorState`/`Skeleton`), donc les garanties WCAG 2.2 AA et les points de rupture (360/390/768/1024/1280+) déjà verrouillés s'appliquent sans modification. Points spécifiques à ce bloc : le stepper de quantité porte des `aria-label` explicites (« Diminuer/Augmenter la quantité de … ») plutôt qu'une icône seule ; le badge de statut de commande porte toujours un libellé texte, jamais la couleur seule (même règle que `RestaurantStatusBadge` au Bloc 3).

---

## 14. Performance / bas-débit

Aucune nouvelle dépendance runtime. Le découpage snapshot-d'affichage (`GET /v1/carts`, pas de jointure live) vs. quote-live (`POST /v1/carts/quote`, la seule requête coûteuse) évite qu'un simple affichage de panier déclenche une revalidation complète du catalogue à chaque rendu — conforme à l'exigence bas-débit déjà posée au Bloc 2.

---

## 15. Décisions prises pendant l'implémentation

1. **Pas de statut `'abandoned'`** — seulement `'open'`/`'converted'` sur `carts.status`. Un sous-système d'expiration/nettoyage de panier est un vrai sujet (TTL, job, notification) que le mandat ne demande pas ; l'ajouter maintenant aurait été de la sur-ingénierie sans consommateur.
2. **`replaceCart: true` plutôt qu'un endpoint séparé** — le mandat demande « refuser ou demander explicitement de remplacer » ; un flag sur `POST /carts/items` couvre les deux cas avec un seul point d'entrée, cohérent avec le reste de l'API qui évite les endpoints à fonction unique.
3. **Snapshot d'affichage vs. quote live, split explicite** (§4, §8) — résout la tension entre « le panier doit s'afficher vite » et « le prix ne doit jamais être obsolète » sans dupliquer la logique de calcul : un seul endroit (`PricingService` + `cart-pricing.ts`) sait calculer un prix, tout le reste ne fait que le relire.
4. **Aucun guard `@RequireOwnership` sur `carts`** — puisque le panier est toujours résolu depuis `actor.userId`, il n'existe rien à protéger par un guard dédié ; ajouter un guard « au cas où » aurait été un faux sentiment de sécurité pour une classe de bug qui ne peut pas exister ici par construction.
5. **Pont d'authentification frontend volontairement minimal** — construire un frontend d'identité complet (récupération de mot de passe, gestion multi-session, rafraîchissement automatique) n'était pas demandé par ce mandat et l'aurait fait déborder largement de « Panier + Commande cœur » ; la limite du pont est documentée explicitement (§11.1, §18 D-27) plutôt que présentée comme terminée.
6. **`ProductOptionsForm` reste un Client Component isolé, la page produit reste un Server Component** — le rendu initial (SEO, temps de premier octet) profite toujours du fetch serveur existant depuis le Bloc 2 ; seule l'interaction (sélection, ajout) traverse la frontière client, pas tout l'écran.

---

## 16. Bugs trouvés et corrigés

### 16.1 — Codes d'erreur du panier absorbés par le filtre d'exceptions global

**Symptôme** : un `409 ConflictException({ code: 'CART_RESTAURANT_MISMATCH' })` levé par `CartsService` ressortait côté HTTP avec `error.code = 'IDEMPOTENCY_KEY_REUSED'` — un code sans rapport, hérité du repli générique par statut.

**Cause racine** : `AllExceptionsFilter.classify()` valide le `code` explicite d'une exception via `isApiErrorCode()`, qui vérifie son appartenance à `API_ERROR_CODES` (`@djafat/types`). Les quatre nouveaux codes de ce bloc (`CART_RESTAURANT_MISMATCH`, `CART_ITEM_UNAVAILABLE`, `CART_EMPTY`, `CART_ITEM_INVALID_OPTIONS`) n'y avaient jamais été ajoutés — le filtre les traitait donc comme absents et retombait sur `httpStatusToCode(409)` = `IDEMPOTENCY_KEY_REUSED`, silencieusement.

**Correction** : les quatre codes ajoutés à `API_ERROR_CODES` (`packages/types/src/errors.ts`). Verrouillé par un nouveau test de régression (`all-exceptions.filter.spec.ts`, « a Bloc-4 cart code … survives the filter »). Trouvé en écrivant `ProductOptionsForm.tsx` (la comparaison `err.code === 'CART_RESTAURANT_MISMATCH'` ne compilait pas — TypeScript signalait qu'aucun chevauchement n'existait entre le type littéral et l'union `ApiErrorCode`), donc détecté par le compilateur avant même d'atteindre un test.

### 16.2 — Ordre de validation : option avant mismatch de restaurant

**Symptôme** (trouvé en écrivant `carts.service.spec.ts`) : ajouter un item d'un autre restaurant à un panier déjà engagé échouait avec une erreur de validation d'option sans rapport, au lieu de signaler le vrai problème.

**Cause racine** : `addItem` validait les options **avant** de vérifier l'appartenance au restaurant du panier.

**Correction** : réordonné — le mismatch de restaurant (§5) est vérifié avant la validation d'options (§6), puisque c'est le problème le plus fondamental des deux. Amélioration de service délibérée, pas seulement un ajustement pour faire passer un test.

### 16.3 — `walking-skeleton.int.spec.ts` désynchronisé depuis le Bloc 1

**Symptôme** (trouvé en touchant ce fichier pour le flux panier) : la suite créait une commande en passant `customerId` directement dans le corps de la requête, sans jamais envoyer de header `Authorization` — alors que `OrdersController.create()` exige `@RequireAuth() @RequireRole('customer')` depuis le Bloc 1.

**Cause racine** : cette suite (Bloc 0.5) n'a jamais été mise à jour lors de l'introduction de l'authentification au Bloc 1 ; invisible car la suite est N/V depuis toujours (pas de Docker).

**Correction** : ajout d'un helper `loginViaOtp()` et d'un header `Authorization` réel — corrigé à l'occasion de la réécriture du flux de commande pour ce bloc, pas un correctif isolé hors-sujet.

---

## 17. Ce qui a été délibérément laissé de côté

Conformément à la liste d'interdictions explicite du mandat (§2 de ce document) :

- Aucun PSP, aucune intégration Airtel Money/Moov Money/carte, aucun webhook de paiement.
- Aucune attribution de livreur, aucune navigation, aucun tracking GPS.
- Aucune notification métier (SMS/push) au-delà de l'OTP déjà existant depuis le Bloc 1.
- Aucun règlement, payout ou wallet client.
- Aucun panier multi-restaurant — refusé explicitement (§5), jamais fusionné.

---

## 18. Dette technique

| #    | Description                                                                       | Impact                                                                                 | Pourquoi reportée                                                                                              | Bloc cible                                      |
| ---- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| D-26 | Pas de statut/nettoyage `abandoned` sur `carts`                                   | Un panier `open` jamais converti reste `open` indéfiniment                             | Aucun sous-système de TTL/nettoyage demandé par ce mandat ; prématuré sans un vrai besoin métier               | Si un vrai besoin de reporting/nettoyage émerge |
| D-27 | Pont d'authentification frontend minimal, pas de retry sur 401                    | Un token expiré en cours de session oblige l'utilisateur à se reconnecter manuellement | Construire le rafraîchissement automatique complet aurait débordé largement du périmètre « Panier + Commande » | Bloc identité frontend dédié, si demandé        |
| D-28 | Pas d'écran de gestion de compte (« Compte » reste `soon: true` dans `MobileNav`) | Aucune UI pour voir/modifier son profil depuis le mobile web                           | Hors périmètre explicite de ce mandat                                                                          | Bloc identité frontend dédié, si demandé        |

Aucune de ces dettes ne touche le modèle financier ni une décision d'architecture verrouillée.

---

## 19. Recommandation pour le Bloc 5

**Je m'arrête ici. Le Bloc 5 attend une décision explicite séparée — ce document ne constitue pas un feu vert.**

Le parcours tient bout en bout : un client authentifié peut composer un panier avec options validées, obtenir un quote live et créer une commande dont le prix restera figé pour toujours, indépendamment de toute évolution future du catalogue — sans qu'aucune ligne de code de paiement, de dispatch ou de notification n'ait été écrite. Les seules réserves sont l'exécution Docker (identique à tous les blocs précédents) et la dette explicitement assumée en §18. Le paiement réel et la livraison réelle restent hors de ce bloc, comme demandé.
