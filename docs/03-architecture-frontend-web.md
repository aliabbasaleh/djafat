# 03 — Architecture frontend web

Couvre `apps/web` (client + site public), et par extension `apps/restaurant` et `apps/admin` (mêmes fondations, densité d'UI différente).

## 3.1 Cible & rôle

| App                  | Domaine                                               | Public                                                   | Rendu dominant                     |
| -------------------- | ----------------------------------------------------- | -------------------------------------------------------- | ---------------------------------- |
| Site public + client | `djafat.com` (marketing/SEO) + `app.djafat.com` (app) | Clients desktop, tablette, mobile web ; visiteurs Google | SSR/SSG public, CSR+RSC app        |
| Restaurant           | `restaurant.djafat.com`                               | Restaurateurs (desktop/tablette surtout)                 | App authentifiée, temps réel       |
| Admin                | `admin.djafat.com`                                    | Staff DJAFAT (desktop)                                   | App authentifiée, tableaux/graphes |

> Une seule base de code Next.js peut héberger `djafat.com` + `app.djafat.com` (routing par segment/host). `restaurant` et `admin` sont des apps Next distinctes dans le monorepo, partageant `packages/`.

## 3.2 Next.js — principes de rendu

- **Site public** (`/`, `/restaurants`, `/restaurants/[slug]`, `/food/[categorie]`, `/contact`) : **SSG + ISR** (revalidation à l'heure) pour indexation et Core Web Vitals. Données via `@djafat/sdk` côté serveur.
- **App client** (`/app/...`) : layout RSC pour le shell, composants clients pour l'interactif (panier, checkout, tracking). Données mutables via React Query (SDK) avec hydratation.
- **Pas de sur-SSR** : les écrans très personnalisés (panier, suivi) sont rendus client, le serveur ne fait que le shell + auth gate.
- **Streaming** : `loading.tsx` + Suspense → premier octet rapide, skeletons pendant le fetch.

## 3.3 Stratégie responsive (résumé — détail en doc 10 & 12)

Breakpoints (tokens partagés) :

```text
xs   < 360px   Small Mobile      1 colonne, densité réduite, cibles 44px
sm   ≥ 360px   Mobile            1 colonne, bottom-nav
md   ≥ 600px   Tablet portrait   2 colonnes cartes, nav compacte
lg   ≥ 905px   Tablet paysage /  sidebar + contenu
              small laptop
xl   ≥ 1240px  Desktop           sidebar large + grille 3–4 colonnes
2xl  ≥ 1600px  Large Desktop     conteneur max, colonnes secondaires (résumé, carte)
```

Principes :

1. **Layouts distincts, pas mise à l'échelle.** La navigation change de nature : bottom tab bar (mobile) → rail/nav compacte (tablette) → sidebar persistante (desktop). Composant `<AppNavigation>` qui rend l'une ou l'autre selon le breakpoint (CSS + `matchMedia` pour le comportement).
2. **Container queries** pour les composants réutilisés dans des contextes de largeurs différentes (une `RestaurantCard` dans une grille vs dans une sidebar).
3. **Contenu prioritaire d'abord** : sur mobile, le CTA (« Ajouter au panier », « Commander ») est _sticky_ en bas, atteignable au pouce.
4. **Checkout** : mono-colonne guidée sur mobile ; deux colonnes (formulaire | récap sticky) dès `lg`.
5. **Tables (restaurant/admin)** : cartes empilées sur mobile, colonnes progressivement révélées ensuite ; scroll horizontal **dans un conteneur** jamais sur le body.
6. Test sur 320 / 360 / 390 / 768 / 1024 / 1366 / 1440 / 1920 px + rotation + redimensionnement à chaud (voir doc 12 §tests).

## 3.4 État & données

| Type d'état            | Outil                                                               | Exemple                                                      |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| Serveur (cache réseau) | **TanStack Query** via `@djafat/sdk`                                | restaurants, menu, commandes, profil                         |
| Client global          | **Zustand** (léger)                                                 | panier, préférences UI, état connexion réseau, mode éco-data |
| Formulaires            | **React Hook Form + Zod** (`@djafat/validation`)                    | inscription, adresse, checkout, produits                     |
| Temps réel             | client Socket.IO dans `@djafat/sdk` → invalide/patch le cache Query | statut commande, position livreur                            |
| URL                    | Next router / searchParams                                          | filtres recherche, onglets, pagination                       |

**Panier** : source de vérité locale (Zustand + persistance `localStorage`/IndexedDB) pour la saisie, **mais** un appel `POST /orders/quote` au serveur revalide prix, frais, disponibilité et remises avant le checkout. Jamais de total « de confiance » calculé uniquement côté client à l'affichage du paiement.

## 3.5 PWA (client web)

**Pertinent pour le Tchad — oui.** Justification : installation sans passer par le Play Store (économie de data et de friction), shell applicatif en cache (démarrage instantané hors ligne), écran d'accueil, notifications web où supporté.

- **Service Worker** (Workbox via `next-pwa` ou implémentation maison) :
  - _App shell_ et assets statiques : `stale-while-revalidate`.
  - _Images_ : `cache-first` avec quota + expiration.
  - _GET API catalogue_ (restaurants, menu) : `stale-while-revalidate`, TTL court.
  - _POST/PATCH_ (commande, paiement) : **jamais mis en cache**, jamais rejoués automatiquement par le SW ; la file de reprise est applicative et contrôlée (doc 12).
- **Manifest** : nom, icônes maskables, thème, `display: standalone`, orientation portrait par défaut sur mobile.
- **Offline fallback** : page « Vous êtes hors ligne » + accès au panier et aux dernières commandes en cache.
- **Limites iOS** : pas de push web fiable partout → l'app mobile Expo reste nécessaire pour un suivi de commande poussé de qualité sur iPhone.

## 3.6 SEO (site public)

- **Rendu** : SSG/ISR, HTML complet sans JS requis pour le contenu principal.
- **URLs propres** : `djafat.com/restaurants/<slug>`, `djafat.com/food/<categorie>`, `djafat.com/restaurants?quartier=...`.
- **Metadata** : `generateMetadata` par page — title, description, canonical, Open Graph, Twitter Card, `hreflang` (fr, ar plus tard).
- **Données structurées** : JSON-LD `Restaurant`, `Menu`, `Offer`, `AggregateRating`, `BreadcrumbList`.
- **`sitemap.xml`** dynamique (restaurants + catégories actifs), **`robots.txt`**, exclusion de `app.`/`restaurant.`/`admin.` de l'indexation.
- **Perf = SEO** : budget Core Web Vitals (LCP < 2,5 s sur 4G lente émulée, INP < 200 ms, CLS < 0,1). Images dimensionnées, polices `font-display: swap` + preload, pas de layout shift.
- **Contenu** : pages catégories éditorialisées légères, page restaurant riche (menu indexable, horaires, quartier), pages « livraison à <quartier> ».

## 3.7 Accessibilité (base commune — détail doc 10)

Radix UI pour les primitives (focus trap, ARIA, clavier gratuits) ; contraste AA vérifié sur les tokens ; `:focus-visible` stylé ; cibles tactiles ≥ 44×44 ; libellés de formulaire explicites + messages d'erreur liés (`aria-describedby`) ; `prefers-reduced-motion` respecté ; navigation entièrement au clavier sur desktop.

## 3.8 Structure de `apps/web`

```text
apps/web/
├── app/
│   ├── (public)/                 # SSG/ISR — indexable
│   │   ├── page.tsx              # accueil marketing
│   │   ├── restaurants/
│   │   │   ├── page.tsx
│   │   │   └── [slug]/page.tsx
│   │   ├── food/[category]/page.tsx
│   │   └── contact/page.tsx
│   ├── (app)/                    # app client — auth gate
│   │   ├── layout.tsx            # shell : <AppNavigation/> responsive
│   │   ├── home/page.tsx
│   │   ├── search/page.tsx
│   │   ├── r/[slug]/page.tsx     # resto côté app (menu + panier)
│   │   ├── cart/page.tsx
│   │   ├── checkout/page.tsx
│   │   ├── orders/
│   │   │   ├── page.tsx          # historique
│   │   │   └── [id]/page.tsx     # suivi temps réel
│   │   ├── favorites/page.tsx
│   │   └── profile/...
│   ├── (auth)/                   # login, otp, onboarding
│   ├── api/                      # route handlers minimalistes (webhooks front, revalidation)
│   ├── manifest.ts
│   ├── sitemap.ts
│   └── robots.ts
├── components/                   # UI web (consomme @djafat/tokens)
│   ├── primitives/               # Button, Input, Sheet, Dialog, ... (Radix+Tailwind)
│   ├── domain/                   # RestaurantCard, ProductCard, OrderCard, PriceTag, CartSummary
│   └── layout/                   # AppNavigation, PublicHeader, Footer
├── lib/                          # query client, socket bootstrap, analytics, sw registration
├── hooks/
├── public/
├── next.config.mjs
└── tailwind.config.ts            # importe les tokens de @djafat/tokens
```

## 3.9 Conséquences

- **+** Un seul framework couvre 3 apps + le SEO ; RSC réduit le JS envoyé.
- **+** PWA = canal de distribution « léger » adapté au marché.
- **−** App Router impose de bien séparer serveur/client ; garde-fous ESLint + revues.
- **−** SEO exige de la discipline de contenu (slugs stables, pas de contenu client-only sur le public).
