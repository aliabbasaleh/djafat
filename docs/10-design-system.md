# 10 — Design System DJAFAT

Objectif : une identité **propre** à DJAFAT (jamais un calque d'Uber Eats/Glovo/DoorDash), pilotée par des **tokens** partagés, avec deux implémentations de composants (web / React Native) rigoureusement alignées.

## 10.1 Fondations : les tokens (`@djafat/tokens`)

Source unique en JSON → build vers : CSS custom properties (web), objet TS typé (RN), et éventuellement Tailwind theme.

### Couleur — rôles sémantiques (valeurs à figer avec le/la designer ; placeholders ci-dessous)

```text
brand/primary         #E8531B   (orange chaud "braise" — évoque le grill, chaleureux, distinct des concurrents)
brand/primary-strong  #C43D0C
brand/on-primary      #FFFFFF
accent/secondary      #0E7C66   (vert profond — fraîcheur, complémentaire)
bg/canvas             #FBF7F2   (blanc cassé chaud, doux sur écran bon marché)
bg/surface            #FFFFFF
bg/surface-alt        #F3EDE4
text/primary          #1B1712
text/secondary        #5B534B
text/muted            #8A8078
border/default        #E4DBCF
state/success         #1E8E3E
state/warning         #B26B00
state/danger          #C62828
state/info            #1565C0
overlay/scrim         rgba(20,15,10,.55)
```

Chaque rôle a sa variante **dark** (mode sombre prévu dès le token, activé en V1.1). Contraste vérifié AA (≥ 4.5:1 texte normal, ≥ 3:1 texte large & éléments UI) par un script dans la CI.

### Typographie

```text
Famille   "Inter" (UI) + fallback système ; chiffres tabulaires pour les prix.
          Police variable, subset latin, preload, font-display: swap.
Échelle   (px / line-height)
  display   28/34   (titres d'écran mobile)  -> 34/40 dès lg
  h1        22/28
  h2        18/24
  body      15/22   (base ; jamais < 14 sur mobile)
  small     13/18
  caption   12/16   (usage limité, jamais pour info critique)
Poids      400 / 500 / 600 / 700
```

### Espacement, rayon, ombre, autres

```text
space   4,8,12,16,20,24,32,40,56 (échelle de 4)
radius  sm 8 · md 12 · lg 16 · xl 24 · pill 999
shadow  e1 (cartes) · e2 (menus/sheets) · e3 (modales)  — douces, faible opacité
z-index base 0 · sticky 100 · header 200 · dropdown 300 · sheet 400 · modal 500 · toast 600
motion  fast 120ms · base 200ms · slow 320ms · easing standard/entrance/exit ; respecte prefers-reduced-motion
breakpoints  xs<360 · sm≥360 · md≥600 · lg≥905 · xl≥1240 · 2xl≥1600
touch-target  min 44×44 (48 pour actions primaires)
```

### Iconographie & imagerie

Jeu d'icônes cohérent (trait 1.75, coins arrondis) — Lucide comme base, surchargé au besoin. Illustrations d'empty states dans un style maison (formes simples, palette brand). Photos produits : ratio 4:3 (carte) et 16:9 (hero), toujours en variantes optimisées.

## 10.2 Bibliothèque de composants

Web : `apps/*/components/primitives` (Radix UI + Tailwind + tokens). RN : `apps/mobile|courier/components/primitives` (View/Pressable + tokens). **Même nom, mêmes props sémantiques, même comportement.**

### Primitives

| Composant                       | Variantes                                                                                                | Props responsive / états clés                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `Button`                        | primary, secondary, ghost, danger, link · sizes sm/md/lg · `fullWidth` · `loading` · `iconStart/iconEnd` | pleine largeur < md ; hauteur 48 pour primary ; état `loading` bloque le double-tap |
| `IconButton`                    | ghost, solid · tailles                                                                                   | cible ≥ 44                                                                          |
| `Input` / `Textarea`            | default, error, disabled · `prefix/suffix` · `clearable`                                                 | label flottant ou au-dessus ; message d'erreur lié `aria-describedby`               |
| `Select` / `Combobox`           | recherche async, multi                                                                                   | plein écran (bottom-sheet) < md, popover ≥ md                                       |
| `Checkbox` / `Radio` / `Switch` | —                                                                                                        | zone tap élargie                                                                    |
| `Stepper` (quantité)            | sm/md                                                                                                    | `-` `n` `+`, min/max, hold-to-repeat                                                |
| `Badge`                         | neutral, success, warning, danger, brand · dot                                                           | —                                                                                   |
| `Tag` / `Chip` (filtres)        | selectable, removable                                                                                    | scroll horizontal en barre de filtres mobile                                        |
| `Card`                          | elevated, outlined, interactive                                                                          | container-query aware                                                               |
| `Modal` (web) / `Dialog`        | sm/md/lg · `dismissible`                                                                                 | ↔ `BottomSheet` sur mobile                                                         |
| `BottomSheet`                   | snap points, `dragHandle`                                                                                | primitive mobile ; sur desktop = `Modal` centré                                     |
| `Toast` / `Snackbar`            | info, success, warning, danger · action                                                                  | en bas (mobile), coin (desktop), file, auto-dismiss                                 |
| `Tabs`                          | line, segmented · scrollable                                                                             | segmented < md, line ≥ md                                                           |
| `Table` (restaurant/admin)      | dense, comfortable · tri, sélection, pagination keyset                                                   | → `CardList` empilée < md ; scroll-x conteneurisé sinon                             |
| `Avatar`                        | image, initiales · tailles                                                                               | —                                                                                   |
| `Skeleton`                      | text, rect, circle, card                                                                                 | mirroir de chaque composant de contenu                                              |
| `EmptyState`                    | illustration + titre + texte + CTA                                                                       | variantes : pas de résultat, hors zone, panier vide, hors ligne                     |
| `Spinner` / `ProgressBar`       | inline, block                                                                                            |                                                                                     |
| `Rating`                        | display, input (étoiles)                                                                                 | input : cibles ≥ 40                                                                 |
| `PriceTag`                      | sm/md/lg · `strikethrough` (promo)                                                                       | format FCFA via `@djafat/core` (chiffres tabulaires)                                |
| `NetworkBanner`                 | offline, slow, reconnecting                                                                              | sticky sous le header, non bloquant                                                 |
| `Map`                           | fill, inset · marqueurs resto/livreur/dest                                                               | wrapper de `MapProvider`                                                            |

### Composants métier

| Composant                  | Contenu                                                                                             | Responsive                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `RestaurantCard`           | cover, logo, nom, note (n avis), distance, ETA, frais/livraison gratuite, badge « Fermé »/« Promo » | pleine largeur (mobile) → grille 2 (md) → 3–4 (xl) ; version compacte en sidebar (container query) |
| `RestaurantHeader`         | cover + logo + méta + horaires + actions (favori, infos)                                            | hero 16:9 mobile → bandeau + colonne infos ≥ lg                                                    |
| `MenuList` / `MenuSection` | catégories ancrées, produits                                                                        | liste 1 col mobile ; 2 col ≥ md ; nav catégories sticky                                            |
| `ProductCard`              | photo, nom, description courte, prix, `+` rapide                                                    | ligne (mobile) / tuile (grille)                                                                    |
| `ProductDetailSheet`       | photo, description, groupes d'options, stepper, note, CTA sticky                                    | BottomSheet mobile / Dialog desktop                                                                |
| `CartLine`                 | nom, options résumées, stepper, prix ligne, suppr.                                                  | swipe-to-delete mobile                                                                             |
| `CartSummary`              | sous-total, frais livraison, remise, total, CTA                                                     | drawer/sheet mobile ; colonne sticky ≥ lg                                                          |
| `CheckoutStepper`          | adresse → livraison → paiement → récap                                                              | accordéon mono-colonne mobile ; 2 colonnes ≥ lg                                                    |
| `AddressPicker`            | GPS / carte / repère / manuel                                                                       | plein écran mobile                                                                                 |
| `OrderCard`                | code, resto, statut (badge), total, date, CTA (suivre/récommander)                                  | liste                                                                                              |
| `OrderTimeline`            | étapes (placée→livrée), horodatage, état courant animé                                              | verticale compacte mobile ; horizontale ≥ lg                                                       |
| `LiveTrackingView`         | `Map` + `OrderTimeline` + ETA + contact livreur                                                     | carte plein écran + sheet infos (mobile) ; carte + panneau latéral (≥ lg)                          |
| `CourierOfferCard`         | resto, distance pickup, distance totale, gain, compte à rebours                                     | plein écran, très gros boutons Accepter/Refuser                                                    |
| `KpiTile` (admin/resto)    | libellé, valeur, delta, sparkline                                                                   | grille 1→2→4                                                                                       |
| `OrdersBoard` (restaurant) | colonnes Nouvelles / En préparation / Prêtes, temps réel, son                                       | colonnes scrollables mobile ; kanban ≥ lg                                                          |

Chaque composant : **spec unique** (dans doc 11 / Storybook), stories web + RN, tests d'accessibilité (axe), snapshot visuel.

## 10.3 Patterns de navigation responsive

| Device           | Client                                                                                                                      | Restaurant / Admin                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Mobile (< md)    | **Bottom tab bar** : Accueil · Recherche · Commandes · Panier · Profil                                                      | Top bar + menu « … » ; vues essentielles seulement (commandes, KPI, alertes)                                                      |
| Tablette (md–lg) | Rail latéral compact (icônes + labels courts) + contenu ; master-detail                                                     | Sidebar réductible ; tables à colonnes réduites                                                                                   |
| Desktop (≥ xl)   | Sidebar persistante + header (localisation, recherche globale, panier) ; contenu large + colonne secondaire (résumé, carte) | Sidebar complète (Dashboard, Restaurants, Commandes, Promotions, Livraisons, Paiements, Profil) + zone de travail large + graphes |

Un seul composant `<AppNavigation role=... />` choisit la présentation selon le breakpoint ; les items proviennent d'une config par rôle.

## 10.4 Accessibilité (WCAG 2.2 AA visé)

- Contraste AA garanti par les tokens + check CI.
- Corps de texte ≥ 15 px mobile, jamais d'info critique en caption.
- Cibles tactiles ≥ 44×44 (48 pour primaire), espacement suffisant.
- Navigation clavier complète (desktop) : ordre logique, `:focus-visible` net, pas de piège de focus (Radix gère).
- Lecteurs d'écran : rôles/labels ARIA, `aria-live` pour les changements de statut de commande, images décoratives `alt=""`, boutons icône avec `aria-label`.
- Formulaires : label explicite, erreurs textuelles reliées, pas d'erreur uniquement par la couleur.
- `prefers-reduced-motion` → animations réduites/désactivées.
- Cibles RTL (arabe) : styles logiques (`margin-inline`, `start/end`) dès maintenant.

## 10.5 Outillage

- **Tokens** : `packages/tokens` (JSON + script de build + validation contraste).
- **Storybook** web + **Storybook RN** (ou Expo + écran de galerie) : chaque primitive et composant métier, tous les états, tous les breakpoints.
- **Tests visuels** : Chromatic ou captures Playwright/Percy-like sur les composants clés + pages de référence, aux largeurs 320/390/768/1024/1440.
- **Lint design** : ESLint interdit les valeurs de couleur/espacement en dur (doit passer par les tokens).
- **Doc vivante** : chaque composant = README (props, variantes, règles responsive, a11y) à côté du code.
