# 21 — Bloc 3 : Design System + Application Shell

> L'identité visuelle DJAFAT, un vrai système de composants partagé (`@djafat/ui`), et une coquille applicative (header/navigation/footer) réutilisable — appliqués aux 4 pages livrées au Bloc 2.
> **Aucune logique métier nouvelle, aucun panier fonctionnel, aucune évolution de schéma PostgreSQL** (voir §2).
> Ce document est le rapport de fin de bloc — **le Bloc 4 n'est pas démarré** (voir §16, attend décision séparée).

---

## 1. Résultat

# 🟢 PASS — avec réserve de vérification (pas de Docker dans l'environnement de build)

`pnpm install` · `prettier --check` · `turbo run lint typecheck test build` → **23/23 tâches lint, 23/23 typecheck, 23/23 test, 15/15 build**. **343 tests unitaires réellement exécutés** (114 `@djafat/core` + 148 `apps/api` + 56 `@djafat/ui` + 25 autres packages), tous verts. Le catalogue (Bloc 2) reste intégralement fonctionnel — aucune migration, aucun endpoint, aucune règle d'ownership/RBAC modifiée.

**Trois vrais bugs trouvés et corrigés pendant ce bloc** (§13) : (1) `apps/web/src/app/globals.css` portait encore le bug de tokens-numériques-sans-unité corrigé sur un seul fichier au Bloc 2 (`error.tsx`) mais jamais sur `globals.css` lui-même — la taille de police de base de **toute** l'application ne s'appliquait pas ; (2) sous `exactOptionalPropertyTypes`, `className={styles['x']}` (typé `string | undefined` par les CSS Modules) ne pouvait pas être passé aux props `className?: string` des composants `@djafat/ui` — corrigé partout via l'utilitaire `cx()` déjà prévu à cet effet ; (3) un vrai bug amont de Next.js (`vercel/next.js#42699`) fait que la directive `'use client'` d'un composant vivant **dans** un package `transpilePackages` externe n'est pas fiable lors de la génération statique — `MobileNav` faisait planter `next build` sur `/_not-found` (« Element type is invalid… got undefined »). Corrigé par une limite `'use client'` locale (`apps/web/src/components/ui-client.tsx`) qui ré-exporte les composants concernés — contournement documenté, pas un correctif upstream.

---

## 2. Périmètre

**Dedans** : tokens de design étendus (couleurs d'interaction, ombres, motion, échelle typographique/spatiale nommée) de façon **strictement additive** ; nouveau package `@djafat/ui` (composants Foundations/Typography/Buttons/Form/Feedback/Navigation/Overlay + composants catalogue DJAFAT-spécifiques) ; coquille applicative (`Header`/`Footer`/`MobileNav`) appliquée globalement via `app/layout.tsx` ; les 4 pages du Bloc 2 reconstruites avec ces composants ; accessibilité WCAG 2.2 AA raisonnable ; tests de composants (56, `@testing-library/react` + `jsdom`).

**Explicitement dehors** (mandat) : panier fonctionnel, checkout, paiement, livraison, dispatch, tracking, logique de commande complète, logique financière, wallet, notifications métier, application mobile native complète. Le bouton « Ajouter au panier » reste désactivé, documenté « bientôt disponible ». Aucune migration PostgreSQL, aucun endpoint API, aucune règle RBAC/ownership n'a été touchée — le Bloc 3 est un bloc frontend pur.

---

## 3. Commandes

```bash
pnpm install
pnpm --filter @djafat/ui run build      # requis avant tout build web (dist/ + copie des *.module.css)
pnpm dev                                 # apps/api (:3001) + apps/web (:3000)

pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Aucune commande de base de données n'est nécessaire pour ce bloc (pas de migration).

---

## 4. Identité visuelle

Direction retenue : chaleureuse mais professionnelle, ancrée dans les tokens déjà verrouillés au Bloc 0 (`#E8531B` terracotta / `#0E7C66` teal / `#FBF7F2` canvas chaud) — **aucune nouvelle couleur de marque n'a été inventée**, conformément à « honorer ce qui existe déjà ». Le travail du Bloc 3 a consisté à **compléter** la rampe autour de ce noyau (hover/active, fonds d'état, focus ring) plutôt qu'à la redessiner, et à lui donner une exécution cohérente à travers de vrais composants plutôt que du style ad hoc par page (le symptôme exact du Bloc 2 : chaque page réinventait ses propres classes CSS pour les mêmes boutons/cartes/badges).

Aucun cliché visuel « africain » littéral n'a été introduit ; aucune ressemblance délibérée avec Uber Eats/Glovo/DoorDash/Deliveroo (pas de copie de mise en page, de composants ou de textes).

---

## 5. Design tokens (`packages/tokens`) — extension additive

Règle explicite respectée : **toute clé qui existait au Bloc 2 garde exactement son nom et sa valeur** — testé (`tokens.spec.ts`, « Bloc 2 keys are unchanged »). Ajouts :

| Catégorie   | Ajouts                                                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Couleur     | `primaryHover`, `secondaryHover`/`secondaryStrong`, `surfaceHover`, `text.disabled`, `border.strong`, `focusRing`, `state.*Bg` (fonds pour badges/alertes), |
| Espacement  | Alias nommés `xs/sm/md/lg/xl/2xl/3xl` **pointant sur les mêmes valeurs** que l'échelle numérique existante (`space.md === space['4']`, testé)               |
| Ombres      | `shadow.none/subtle/card/elevated/modal`                                                                                                                    |
| Motion      | `motion.duration.{fast,base,slow}`, `motion.easing.{standard,decelerate,accelerate}` (respecte `prefers-reduced-motion` partout où utilisé)                 |
| Typographie | `size.h3`, `size.label`, `size.button`, `weight.{regular..extrabold}`, `lineHeight.{tight..relaxed}`                                                        |

Comme au Bloc 2, ces tokens numériques restent **unitless** par design (partagés tels quels avec React Native) — voir §13.1 pour le rappel du piège que cela pose en CSS.

---

## 6. `@djafat/ui` — nouveau package partagé

Premier package du monorepo à livrer à la fois du TypeScript compilé **et** des `*.module.css` colocalisées — une étape de build spécifique a dû être ajoutée (§13.3, §14).

### Foundations

`Container`, `Stack`, `Inline`, `Grid` (colonnes fixes ou `auto-fill` responsive via `minItemWidth`), `Divider`, `VisuallyHidden`.

### Typography

`Heading` (le niveau sémantique `1|2|3` pilote la balise DOM, `size` pilote le rendu visuel — jamais lié l'un à l'autre par accident, WCAG 2.2 §2.4.6), `Text`, `Label`, `Caption`.

### Buttons

`Button` (rend un vrai `<a>` quand `href` est fourni — un lien stylé bouton reste un lien, jamais un faux bouton), `IconButton` (label obligatoire), `ButtonGroup`. États : default/hover/active/disabled/loading/focus — `loading` désactive réellement le bouton (jamais cliquable pendant une requête) et porte un spinner **labellisé** (`role="status"`, `aria-label`), testé.

### Form

`Input`, `SearchInput`, `Select`, `Checkbox`, `Radio`, `Switch`, `Textarea` — `label` est un prop **obligatoire** partout (jamais un placeholder comme substitut) ; erreurs exposées via `role="alert"` + `aria-describedby`, testé.

### Feedback

`Alert`, `Toast` (contexte + `useToast()`), `Badge`/`StatusBadge`, `Skeleton`, `Spinner`, `EmptyState`, `ErrorState` — `EmptyState` (résultat vide légitime) et `ErrorState` (échec) sont **deux composants distincts**, jamais confondus.

### Navigation

`Header`, `DesktopNav` (liens intégrés à `Header`), `MobileNav` (barre d'onglets basse, cachée à `lg`+), `Breadcrumb`, `Tabs` (pattern clavier WAI-ARIA APG complet : ←/→ déplace ET active, Home/End vont aux extrémités, tabindex roving — testé, §12).

### Overlay

`Modal`, `Drawer`, `Popover` — `useOverlay()` partagé (piège de focus, fermeture sur Échap, restauration du focus au déclencheur à la fermeture) : **construits maintenant, consommés par un bloc futur** (aucun flux de ce bloc n'a besoin d'une modale), testé pour `Modal` (5 tests, §12).

### Composants catalogue DJAFAT

| Composant               | États couverts                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `RestaurantStatusBadge` | OPEN/CLOSED/PAUSED/UNAVAILABLE → libellé français, jamais recalculé (le statut vient toujours du serveur, docs/20 §22-§23) |
| `RestaurantCard`        | image ou repli coloré avec initiale, badge de statut, note/ETA, description tronquée à 2 lignes                            |
| `RestaurantCardGrid`    | grille responsive 1→4 colonnes (points de rupture identiques à `packages/tokens` : 600/905/1240)                           |
| `ProductCard`           | layout `row` (liste de menu) ou `grid` (future section « populaire ») ; disponibilité, indice « · options »                |
| `CategoryChip`          | sélectionné via `aria-current`, jamais la couleur seule                                                                    |

---

## 7. Application shell

`Header`/`Footer`/`MobileNav` rendus **une seule fois**, dans `app/layout.tsx` — aucune page ne construit plus son propre en-tête (contrairement au Bloc 2, où `SiteHeader` était importé sur chaque route). Vraie réorganisation de mise en page mobile→desktop (3 lignes empilées : logo+actions / localisation / recherche sur mobile, 1 ligne avec liens de navigation à partir de `lg` = 905px) — pas un desktop simplement rétréci (mandat §10).

Le slot `search` du `Header` est délibérément laissé vide : chaque page catalogue porte déjà sa propre recherche proéminente (maquette Bloc 2 §60), et un second champ de recherche dans l'en-tête sticky n'aurait ajouté aucune capacité, seulement du bruit visuel — décision documentée (§17.1), pas un oubli.

`Footer` : colonnes de liens comme **données**, pas comme markup — un futur bloc ajoute un lien en ajoutant une ligne. Chaque lien non encore fonctionnel porte `soon: true` et se rend comme texte inerte avec une étiquette « Bientôt » plutôt qu'un lien mort (mandat §8 : « ne pas inventer de liens fonctionnels qui n'existent pas encore »). Aucune icône de réseau social n'a été ajoutée — aucune n'existe réellement, en inventer aurait été exactement le piège que le mandat interdit.

`MobileNav` : 4 entrées (Accueil, Restaurants, Panier, Compte) — les deux dernières `soon: true` (Bloc 4/Bloc identité-compte), rendues comme boutons désactivés avec `aria-label` explicite plutôt que des liens vers nulle part.

---

## 8. Pages reconstruites

Les 4 routes du Bloc 2 sont refaites avec les composants ci-dessus — **aucune nouvelle route, aucun nouveau comportement métier** :

- **`/`** — titre `Heading level=1 size="display"` avec une vraie proposition de valeur (« Vos restaurants préférés, livrés à N'Djamena »), recherche, catégories (`CategoryChip`), grille de restaurants (`RestaurantCardGrid`), `ErrorState`/`EmptyState` selon le cas.
- **`/restaurants`** — recherche + filtres (`Checkbox`/`Select`), compteur de résultats, grille, pagination (boutons `Button` avec un vrai état désactivé aux extrémités plutôt qu'un lien mort).
- **`/restaurants/[slug]`** — couverture/logo, `RestaurantStatusBadge`, description/note/ETA/adresse, menu par catégorie avec `ProductCard` (layout `row`).
- **`/restaurants/[slug]/products/[productId]`** — `Breadcrumb`, image, prix, groupes d'options (markup natif `<fieldset>`/`<legend>`, aucun composant générique n'existe encore pour ça — pas construit prématurément), bouton « Ajouter au panier » désactivé.

États de chargement : chaque route a son propre `loading.tsx` reconstruit avec `Skeleton` (respecte `prefers-reduced-motion` — hérité du composant, plus besoin de le répéter par page). État d'erreur : `error.tsx` racine reconstruit avec `ErrorState` + `Button` de réessai. 404 : `not-found.tsx` reconstruit avec `EmptyState`.

---

## 9. Responsive

Testé aux largeurs demandées (360/390/768/1024/1280+) via les points de rupture déjà verrouillés dans `packages/tokens` (`sm=360, md=600, lg=905, xl=1240`) — **aucun nouveau point de rupture inventé**. Vraie réorganisation à chaque palier (grille de cartes 1→2→3→4 colonnes, en-tête 3 lignes→1 ligne) plutôt qu'une réduction proportionnelle du desktop.

---

## 10. Accessibilité (WCAG 2.2 AA)

- **Focus visible** : `:focus-visible` sur chaque élément interactif (hérité du reset global + rendu explicite dans chaque `*.module.css` de `@djafat/ui`).
- **Navigation clavier** : `Tabs` implémente le pattern WAI-ARIA APG complet (testé, 6 tests dédiés) ; `Modal`/`Drawer`/`Popover` piègent le focus et le restaurent à la fermeture (testé pour `Modal`).
- **Labels** : tout champ de formulaire exige un `label` textuel (prop obligatoire, jamais un placeholder) ; `SearchInput` utilise `VisuallyHidden` pour un label présent dans l'arbre d'accessibilité mais invisible.
- **Pas de signalisation par la couleur seule** : `Badge`/`RestaurantStatusBadge` portent toujours un libellé texte ; `CategoryChip` utilise `aria-current`, pas seulement un changement de fond.
- **États de chargement/erreur accessibles** : `Skeleton` est `aria-hidden` (le squelette lui-même ne doit jamais être annoncé), les conteneurs parents portent `aria-busy`/`aria-label` ; `EmptyState` = `role="status"`, `ErrorState` = `role="alert"`.
- **HTML sémantique avant ARIA** : boutons réels, liens réels, `<fieldset>`/`<legend>` pour les groupes d'options — aucun rôle ARIA ajouté là où l'élément natif suffit déjà.
- **`prefers-reduced-motion`** : respecté globalement (`app/globals.css`) et dans chaque composant animé (`Skeleton`, `Spinner`).

---

## 11. Performance / bas-débit

Aucune nouvelle dépendance lourde ajoutée — `@djafat/ui` n'a **aucune** dépendance runtime hors `react`/`react-dom`/`next` (déjà présentes). `next/image`/`next/link` restent les seuls mécanismes d'image/navigation (inchangé depuis le Bloc 2 — lazy loading, tailles responsives). Aucune bibliothèque UI généraliste (pas de Radix/MUI/Chakra) n'a été introduite : chaque composant est écrit à la main, volontairement petit, exactement ce que demande le mandat (« toute nouvelle dépendance importante doit être justifiée » — aucune ne l'a été car aucune n'était nécessaire).

---

## 12. Tests

| Suite                                          | Fichiers | Tests | Statut                        |
| ---------------------------------------------- | -------- | ----- | ----------------------------- |
| `@djafat/core` (inchangé)                      | 9        | 114   | **PASS**                      |
| `apps/api` (inchangé — aucun endpoint touché)  | 20       | 148   | **PASS**                      |
| `@djafat/ui` (nouveau)                         | 11       | 56    | **PASS** (réellement exécuté) |
| `packages/tokens` (2 tests ajoutés)            | 1        | 5     | **PASS**                      |
| autres packages (`i18n/config/validation/sdk`) | 4        | 20    | **PASS** (inchangé)           |

**Total unitaire réellement exécuté : 343**, tous verts.

**Ce que les 56 tests de `@djafat/ui` couvrent** : états de `Button` (défaut/lien/disabled/loading/4 variantes) ; tons de `Badge` (5, avec vérification que le texte reste toujours présent) ; les 4 statuts de `RestaurantStatusBadge` ; `CategoryChip` (lien réel, `aria-current`) ; `RestaurantCard` (props → rendu, repli image coloré) ; `Tabs` (rôle tablist, clic, ←/→/Home/End, roving tabindex) ; `Modal` (fermé = rien rendu, focus sur le premier élément focusable à l'ouverture, Échap ferme + restaure le focus, bouton de fermeture) ; `Input`/`Checkbox` (association label, aide/erreur, `aria-invalid`) ; `Stack` (rendu, prop `as`) ; `spaceVar`/`px` (le correctif du bug de tokens sans unité, verrouillé par test — §13.1).

Aucune suite d'intégration nouvelle n'était nécessaire (aucun endpoint API touché) — `catalog.int.spec.ts` (Bloc 2) reste N/V pour la même raison qu'avant (pas de Docker ici).

---

## 13. Bugs trouvés et corrigés

### 13.1 — `body` sans unité dans `globals.css` (régression manquée au Bloc 2)

**Symptôme** : `font-size: var(--djafat-type-size-body, 15px)` sur `body` — la taille de police de base ne s'appliquait à **aucune** page.

**Cause racine** : même classe de bug que celle corrigée sur `error.tsx` au Bloc 2 (docs/20 §19.1) — les tokens numériques sont unitless par design (partagés avec React Native), donc `var(--djafat-type-size-body)` vaut littéralement `"15"`, invalide comme valeur de `font-size`. Le correctif du Bloc 2 avait traité une occurrence sans généraliser la recherche à tout le dépôt.

**Correction** : `calc(var(--djafat-type-size-body, 15) * 1px)` ; la même logique a été **centralisée** dans `@djafat/ui/src/tokens.ts` (`spaceVar()`/`px()`) pour que plus aucun composant n'ait à écrire ce `calc(...)` à la main — verrouillé par test (`tokens.spec.ts`, « never a bare var() »).

### 13.2 — `className?: string` incompatible avec `exactOptionalPropertyTypes`

**Symptôme** : `className={styles['main']}` (typé `string | undefined` par les CSS Modules sous `noUncheckedIndexedAccess`) rejeté par TypeScript partout où un composant `@djafat/ui` déclare `className?: string` (pas `string | undefined`).

**Cause racine** : `exactOptionalPropertyTypes: true` (verrouillé au niveau du dépôt) distingue « prop omise » de « prop valant `undefined` » — la même classe de piège déjà rencontrée au Bloc 2 sur `ListRestaurantsQuery` (docs/20, erreurs #8).

**Correction** : utilisation systématique de `cx()` (déjà exporté par `@djafat/ui` pour exactement ce usage) à chaque site d'appel — `cx()` ne retourne jamais `undefined`, seulement `string`, donc satisfait le type exact de la prop sans élargir l'interface de chaque composant.

### 13.3 — `next build` plantait sur `/_not-found` (« Element type is invalid… got undefined »)

**Symptôme** : `next build` échouait uniquement lors du prérendu statique de `/_not-found`, avec un message React générique ne nommant pas le composant fautif.

**Cause racine** : isolé par élimination (retrait successif de composants du layout racine) à `MobileNav` — un composant `'use client'` **vivant à l'intérieur** d'un package `transpilePackages` externe (`@djafat/ui`). C'est une limitation amont connue de Next.js (`vercel/next.js#42699`, ouverte depuis des années, fermée « not planned ») : la directive `'use client'` d'un fichier transpilé depuis un package externe n'est pas fiable lors de la génération statique, avec des messages d'erreur décrits par le mainteneur comme « aléatoires au mieux ».

**Correction** : `apps/web/src/components/ui-client.tsx` — un fichier `'use client'` **local à `apps/web`** qui ré-exporte `Button`/`MobileNav`/`SearchInput`/`Checkbox`/`Select` (les composants interactifs de `@djafat/ui` réellement utilisés ici). La frontière `'use client'` est déclarée dans un fichier que Next.js compile lui-même, contournant entièrement la limitation, sans renoncer à réutiliser l'implémentation réelle du package. Vérifié par un `next build` complet, propre, deux fois de suite (§1).

---

## 14. Décisions prises pendant l'implémentation

1. **Extension additive stricte des tokens** — aucune clé Bloc 2 renommée ni supprimée, verrouillé par test (§5). Une refonte de palette aurait cassé silencieusement chaque composant Bloc 2 encore en place ailleurs.
2. **`@djafat/ui` livré compilé (`dist/`), pas consommé en source brute** — les autres packages partagés (`sdk`, `tokens`, `core`, `types`) suivent déjà ce patron ; `@djafat/ui` avait initialement copié le `package.json` d'une app Next.js (`main: ./src/index.ts`), ce qui casse la résolution de module de webpack pour les imports relatifs suffixés `.js` (convention TypeScript `NodeNext`, verrouillée au niveau du dépôt) pointant vers des fichiers `.tsx`. Aligné sur la convention existante plutôt que de créer un cas particulier.
3. **Étape de copie des `*.module.css`** (`scripts/copy-assets.mjs`) — `tsc` ne copie jamais les fichiers non-TypeScript ; sans cette étape, le JS compilé référence une feuille de style qui n'existe pas à côté de lui dans `dist/`. Solution minimale (`fs.cpSync` + filtre d'extension), aucune dépendance ajoutée.
4. **Limite `'use client'` locale plutôt qu'une dépendance à une future correction de Next.js** (§13.3) — le contournement est documenté comme tel, pas présenté comme la façon canonique de faire ; si Next.js corrige un jour ce comportement en amont, `ui-client.tsx` pourra être supprimé sans toucher `@djafat/ui` lui-même.
5. **Aucun composant générique pour les groupes d'options de produit** — le mandat liste des familles de composants précises (Foundations/Typography/Buttons/Form/Feedback/Navigation/Overlay/catalogue) ; les groupes d'options n'y figurent pas et n'ont qu'un seul point d'usage réel dans tout le frontend — les construire en composant réutilisable maintenant aurait été de la sur-ingénierie sans un deuxième cas d'usage pour valider la bonne abstraction.
6. **Dark mode non implémenté** — le mandat autorise explicitement à le reporter et le documenter plutôt que d'accepter une dette d'architecture importante (§15 du mandat) si ça nécessite une grosse refonte. Aucun token de thème sombre n'existe encore dans `packages/tokens` (une seule palette « light », comme au Bloc 0/2) ; en ajouter un maintenant sans un vrai consommateur (`data-theme`, détection `prefers-color-scheme`) aurait été prématuré. Dette assumée, §15 D-22.
7. **`Header` sans champ de recherche câblé** (§7) — décision délibérée, pas un oubli, pour éviter deux barres de recherche visuellement concurrentes sur les pages qui en ont déjà une proéminente.

---

## 15. Dette technique

| #    | Description                                                                          | Impact                                                                                                                                                         | Pourquoi reportée                                                                                                                      | Bloc cible                                                            |
| ---- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| D-22 | Pas de thème sombre                                                                  | L'application reste en thème clair unique                                                                                                                      | Aucun consommateur réel (pas de bascule utilisateur demandée) ; le mandat autorise explicitement à reporter plutôt que refondre        | Si un vrai besoin utilisateur émerge                                  |
| D-23 | Contournement `'use client'` local (`ui-client.tsx`) plutôt qu'un correctif upstream | Un nouveau composant interactif de `@djafat/ui` ajouté à une page doit être pensé à cette limitation (ré-exporté localement s'il finit sur une route statique) | Bug amont Next.js non résolu (`vercel/next.js#42699`) ; aucune app de ce dépôt n'a encore de vraies pages statiques hors `/_not-found` | Si Next.js corrige en amont, ou si une vraie page statique apparaît   |
| D-24 | Groupes d'options produit sans composant générique                                   | Markup dupliqué si un deuxième écran affiche un jour des options produit                                                                                       | Un seul point d'usage réel ; prématuré d'abstraire sans un deuxième cas                                                                | Quand un deuxième consommateur existera (Bloc 4 panier, probablement) |
| D-25 | `Toast`/`Alert`/`Drawer`/`Popover` construits mais non consommés                     | Composants non exercés par un vrai flux applicatif (seul `Modal` a des tests d'intégration comportementale)                                                    | Demandés explicitement par le mandat comme primitives prêtes pour de futurs blocs (§4 « Feedback »/« Overlay »)                        | Quand un flux réel les consommera                                     |

Aucune de ces dettes ne touche une décision d'architecture verrouillée ni le modèle financier — toutes sont strictement frontend.

---

## 16. Recommandation pour le Bloc 4

**Je m'arrête ici. Le Bloc 4 attend une décision explicite séparée — ce document ne constitue pas un feu vert.**

Le système de composants tient bout en bout : les 4 pages du catalogue (Bloc 2) sont maintenant visuellement cohérentes, responsives, accessibles, et bâties sur une coquille applicative réutilisable — sans qu'aucune règle métier, API ou donnée n'ait changé. Les seules réserves sont l'exécution Docker (identique à tous les blocs précédents) et la dette explicitement assumée en §15 — aucune ne remet en cause une décision d'architecture verrouillée. Le panier fonctionnel, le checkout, le paiement et la livraison restent hors de ce bloc, comme demandé.
