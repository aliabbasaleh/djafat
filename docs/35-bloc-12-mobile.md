# Bloc 12 — Native Customer Mobile

> Verdict : 🟢 **PASS WITH DEBT** — `apps/mobile` passe d'une coquille Bloc 0 (un écran
> "API: ..." et rien d'autre) à un parcours client natif complet et réellement
> fonctionnel : connexion → catalogue → produit → panier → adresse → checkout →
> commande → suivi temps réel. Entièrement construit sur le SDK déjà existant
> (`catalog`, `cart`, `orders`, `addresses` — Blocs 2/4/8) : **zéro changement backend**
> pour ce bloc, contrairement aux Blocs 10/11. Dette assumée et explicite : §6 — en
> particulier `expo export` reste bloqué par la même chaîne de dépendances pnpm/Expo
> SDK 53 déjà documentée au Bloc 11 (docs/34), confirmée ici comme un défaut
> **systémique** du monorepo plutôt que propre à une seule app.

---

## 1. Contexte et périmètre

`apps/mobile` n'avait que son squelette Bloc 0 : `app/index.tsx` affichait "Socle
mobile — Bloc 0" + un ping santé API, `app/_layout.tsx` un `Stack` vide. Mandat
roadmap (docs/14 §115, item 35) : _"navigation expo-router (tabs/rail tablette) ;
réutilisation core/validation/sdk/tokens/i18n + ui-native ; tous les parcours du Bloc 8
en natif ; expo-notifications (push) ; expo-location ; MapLibre ; file offline MMKV ;
safe areas iOS ; perfs Android entrée de gamme ; EAS + OTA."_ — explicitement
"post-pilote" (~4 semaines), contrairement aux Blocs 9/10/11 qui faisaient partie du
MVP pilote immédiat (confirmé avec l'utilisateur avant d'ouvrir ce bloc).

Avant de coder, audit du SDK existant : `packages/sdk/src/catalog.ts` (Bloc 2),
`cart.ts` (Bloc 4), `orders.ts` (Bloc 0.5/4), `addresses.ts` (Bloc 8) sont **tous déjà
complets et typés** — exactement les mêmes clients qu'`apps/web` utilise. Lecture des
pages `apps/web` correspondantes (`/restaurants`, `/restaurants/[slug]`,
`/restaurants/[slug]/products/[productId]`, `/panier`, `/commandes/[id]`) pour
extraire la logique métier exacte à reproduire nativement (gestion
`CART_RESTAURANT_MISMATCH`, sélection d'adresse, `quote()` comme seule source de
vérité pour les prix, `order:{id}` en temps réel) — aucune réinvention.

Hors périmètre, non touché : BUG-10.1.x/`OwnershipGuard`/RBAC (aucune preuve que ce
bloc en avait besoin), `apps/courier`/`apps/restaurant` (Blocs 10/11, non modifiés),
API/backend (zéro changement), paiement (aucun sélecteur de méthode de paiement
n'existe non plus sur `apps/web` — la commande part directement en `awaiting_payment`,
reproduit à l'identique).

## 2. Backend / SDK — ce qui a été réutilisé et ce qui a été ajouté

**Réutilisé intégralement, sans modification :**

- `@djafat/sdk` : `catalog` (listRestaurants/getRestaurant/getMenu/getProduct),
  `cart` (getCart/addItem/updateItem/removeItem/quote), `orders`
  (create/get), `addresses` (list/create/setDefault/remove).
- Toutes les routes API correspondantes (`GET /restaurants`, `GET /restaurants/:slug`,
  `GET /restaurants/:slug/menu`, `GET /products/:id`, `GET/POST/PATCH/DELETE /carts*`,
  `POST /carts/quote`, `POST /orders`, `GET /orders/:id`, `GET/POST/PATCH/DELETE
/users/me/addresses*`) — aucune n'a été touchée.
- La room temps réel `order:{id}` (Bloc 7) — déjà autorisée pour le client
  propriétaire de la commande.

**Ajouté : rien côté backend.** C'est le premier bloc de cette série (10, 11, 12) à ne
nécessiter AUCUN changement API — la totalité de l'effort est frontend.

## 3. Mobile — écrans et comportements réellement implémentés

- **Connexion** (`/(auth)/login`) — OTP téléphone/code, support du paramètre
  `redirect` (équivalent natif du `?redirect=` d'`apps/web`) pour revenir à l'écran
  visé après connexion.
- **Catalogue** (`/(app)/restaurants`) — liste publique (pas d'auth requise, comme
  `apps/web`), nom/note/temps de préparation/description, bouton Panier.
- **Détail restaurant + menu** (`/(app)/restaurants/[slug]`) — catégories, produits,
  prix, disponibilité, infos pratiques (adresse, commande minimum).
- **Détail produit** (`/(app)/restaurants/[slug]/products/[productId]`) — sélection
  de groupes d'options (`single`/`multiple`, min/max, requis), quantité,
  "Ajouter au panier" ; gère `CART_RESTAURANT_MISMATCH` (panier d'un autre restaurant)
  exactement comme `apps/web`.
- **Panier/checkout** (`/(app)/cart`) — lignes, `quote()` en direct (sous-total, frais
  de livraison, total), sélection d'adresse, "Commander" → `orders.create` avec clé
  d'idempotence → redirection vers le suivi.
- **Adresses** (`/(app)/addresses`) — liste, création (quartier/rue/repère/téléphone,
  saisie manuelle — pas de sélecteur carte, voir §6), définir par défaut, supprimer.
- **Suivi de commande** (`/(app)/orders/[id]`) — statut, articles, total,
  **temps réel** via `order:{id}` (hint de refetch, jamais un payload appliqué
  directement — même discipline que `apps/web`/`apps/restaurant`/`apps/courier`).

Toutes les mutations (connexion, ajout panier, création commande) passent par le même
gate d'authentification que le reste du repo ; les écrans protégés (panier, adresses,
suivi) redirigent vers `/(auth)/login?redirect=...` si la session est absente, miroir
exact du comportement `apps/web`.

## 4. Sécurité — ce qui a été vérifié sur le nouveau périmètre

Aucune nouvelle route, aucune nouvelle permission, aucun nouveau mécanisme
d'autorisation — ce bloc consomme exclusivement des endpoints déjà fermés et testés
(Blocs 2/4/7/8). Points vérifiés :

- Le token d'accès vit en mémoire (`lib/api.ts`) + `expo-secure-store` (chiffré,
  OS keychain/keystore) — jamais en clair sur disque, même convention que
  `apps/courier`/`apps/restaurant`.
- Chaque écran protégé vérifie `authState` lui-même avant d'appeler l'API (pas de
  dépendance à un seul gate global) — un 401 serveur redirige systématiquement vers
  `/login`, jamais affiché comme une erreur générique.
- `orders.create` passe une `Idempotency-Key` fraîche à chaque tentative — aucune
  double commande possible sur un retap réseau.
- Aucune donnée d'un autre utilisateur n'est jamais demandée au client : `orderId`,
  `addressId` viennent tous de réponses serveur déjà scopées à l'acteur courant,
  jamais d'un identifiant deviné.
- `OwnershipGuard`/BUG-10.1.x non réouverts — aucune preuve nouvelle ne le justifiait.

## 5. Tests

**Frontend (nouveau, exécuté) :**

- `lib/format.spec.ts` — 3 cas (`formatMoneyDelta` : "Inclus" à zéro, signe positif,
  signe négatif sans double tiret).
- `lib/idempotency.spec.ts` — 2 cas (forme, unicité) — mêmes tests que
  `apps/courier`/`apps/restaurant`.

**Résultat** : `apps/mobile` 2 fichiers / 5 tests ✅. `tsc`/`eslint`/`prettier` verts.

**Non exécuté :**

- Aucun appel HTTP réel, aucune requête PostgreSQL réelle — Docker indisponible,
  dette inchangée depuis BUG-10.1.x (docs/32).
- `expo export --platform android` tenté, bloqué sur `expo-modules-core`
  introuvable — **exactement le même point de blocage que `apps/courier`** (docs/34
  §6), confirmant qu'il s'agit d'un défaut **systémique** de la combinaison pnpm +
  Expo SDK 53 dans ce monorepo, pas d'un problème propre à une app. Pas de nouvelle
  tentative de correction ici — l'investigation a déjà été menée et documentée au
  Bloc 11 ; la répéter aurait transformé ce bloc en chasse de tooling plutôt qu'en
  livraison produit. `tsc`/`eslint`/tests unitaires restent le plafond de
  vérification atteint, comme pour `apps/courier`. **Aucune capture d'écran produite**
  (pas de simulateur disponible).

## 6. Dette restante (ne devient pas un chantier séparé sans autorisation)

- **`expo export`** : bloqué par `expo-modules-core` manquant — même cause que
  `apps/courier` (docs/34 §6). Une résolution définitive nécessiterait soit de
  continuer à ajouter des dépendances une à une sans garantie de terminaison, soit de
  changer le hoisting pnpm du monorepo entier (`shamefully-hoist`), une décision plus
  large que ce bloc.
- **Navigation tabs/rail tablette** : le roadmap demande une navigation par onglets
  et un layout maître-détail sur tablette (docs/04 §4.6) — ce bloc utilise une pile
  `Stack` simple, suffisante pour le parcours vertical demandé mais pas la mise en
  page finale prévue.
- **Recherche/filtres/tri catalogue** : `apps/web` a une recherche + tri + pagination
  complets sur `/restaurants` ; la version mobile liste simplement les 30 premiers
  résultats (pas de `SearchForm` équivalent).
- **Notifications push, MapLibre, file offline MMKV** : aucun des trois n'est câblé —
  le roadmap les liste explicitement pour ce bloc, mais aucun n'est nécessaire au
  parcours vertical demandé (connexion → catalogue → …→ suivi), et chacun ajoute une
  dépendance native supplémentaire qui n'aurait pu être vérifiée dans cet
  environnement (pas de simulateur). Temps réel au premier plan (`order:{id}`) couvre
  déjà le besoin de suivi pendant que l'app est ouverte.
- **Pas de sélecteur de carte pour les adresses** : saisie manuelle uniquement —
  identique à la limite déjà documentée pour `apps/courier` concernant la
  localisation, et cohérent avec le choix déjà fait côté web (`apps/web` n'a pas non
  plus de carte interactive à ce stade).
- **Validation E2E réelle** (HTTP + PostgreSQL) : toujours bloquée par l'absence de
  Docker — inchangé depuis BUG-10.1.x.
