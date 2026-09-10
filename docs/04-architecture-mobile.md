# 04 — Architecture mobile (Expo / React Native)

Couvre `apps/mobile` (client Android/iOS + tablette) et `apps/courier` (livreur). Même socle Expo, deux binaires.

## 4.1 Pourquoi Expo (rappel)

Réutilisation React/TS et des `packages/` partagés ; OTA updates (EAS Update) pour corriger vite sans review store ; modules natifs maintenus (notifications, localisation arrière-plan, caméra, SecureStore, task manager) ; builds cloud (EAS Build) sans Mac local obligatoire.

## 4.2 Fondations techniques

| Sujet                | Choix                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| Navigation           | `expo-router` (file-based, deep links, typed routes)                                                      |
| Rendu listes         | `@shopify/flash-list` (recyclage, indispensable sur Android entrée de gamme)                              |
| État serveur         | TanStack Query + persistance `AsyncStorage`/MMKV (offline cache)                                          |
| État client          | Zustand + persistance MMKV (panier, session, préférences, mode éco-data)                                  |
| Formulaires          | React Hook Form + Zod (`@djafat/validation`)                                                              |
| Stockage sécurisé    | `expo-secure-store` (refresh token, PIN éventuel)                                                         |
| Réseau temps réel    | client Socket.IO (via `@djafat/sdk`), reconnexion + fallback polling                                      |
| Cartes               | `@maplibre/maplibre-react-native` (ou react-native-maps si provider Google activé) derrière `MapProvider` |
| Notifications        | `expo-notifications` → Expo Push → FCM/APNs                                                               |
| Localisation livreur | `expo-location` + `expo-task-manager` (updates arrière-plan throttlées)                                   |
| Images               | `expo-image` (cache disque, AVIF/WebP, placeholder flou)                                                  |
| i18n                 | `@djafat/i18n` + `expo-localization`                                                                      |
| Perf JS              | Hermes activé, RAM bundles, `react-native-screens`                                                        |
| Crash/erreurs        | Sentry RN                                                                                                 |

## 4.3 Partage de code avec le web

Consommé tel quel : `@djafat/types`, `@djafat/validation`, `@djafat/core` (panier, frais, ETA, machine à états), `@djafat/sdk`, `@djafat/tokens` (en objet JS), `@djafat/i18n`, `@djafat/config`.

Réimplémenté en natif : composants d'UI (bibliothèque RN maison), navigation, accès capteurs, safe areas, notifications.

`@djafat/tokens` expose `tokens.color.brand`, `tokens.space[4]`, `tokens.radius.md`, `tokens.type.body`… → une `RestaurantCard` RN visuellement identique à la web sans partager de code de rendu.

## 4.4 Spécifique iOS

- **Safe areas** : `react-native-safe-area-context`, insets respectés sur tous les écrans (encoche, Dynamic Island, home indicator).
- **Notifications** : permission demandée au bon moment (après la 1re commande, pas au 1er lancement) ; catégories (mise à jour commande, promo) pour réglages fins ; APNs via Expo.
- **Comportements** : retour par geste (swipe), haptique sur actions clés (`expo-haptics`), `KeyboardAvoidingView` calibré iOS, `ScrollView` avec `contentInsetAdjustmentBehavior`.
- **Publication** : compte Apple Developer, App Privacy manifest, justification de la localisation « Always » (livreur) sinon rejet.

## 4.5 Spécifique Android (entrée/milieu de gamme = cible principale)

- **Perf** : listes FlashList, images dimensionnées et mises en cache, éviter les ré-renders (memo/selectors Zustand), animations sur `react-native-reanimated` (thread UI).
- **Tueurs de tâches OEM** (Xiaomi, Transsion/Tecno-Infinix très présents en Afrique) : le suivi de position livreur en arrière-plan peut être coupé → **foreground service** avec notification persistante pendant une livraison active, et repli sur mises à jour à l'ouverture de l'app.
- **Tailles d'écran** : layouts fluides, densité `sp`/`dp` via tokens, test sur petit écran 5" 720p.
- **APK/AAB** : taille maîtrisée (assets distants, pas de polices lourdes embarquées inutiles), App Bundle + splits ABI.
- **Notifications** : canaux Android (importance par type), FCM via Expo.

## 4.6 Tablette

- `expo-router` + détection `useWindowDimensions()` → layouts **master-detail** dès la largeur tablette : liste restaurants à gauche, détail à droite ; commande + carte côte à côte pour le suivi.
- Grilles 2–3 colonnes pour les cartes, formulaires en 2 colonnes.
- Support rotation (verrou portrait uniquement sur l'app livreur si besoin de simplicité).

## 4.7 App livreur (`apps/courier`) — contraintes propres

- **Priorité UX** : gros boutons, peu de texte, une action principale par écran, contraste élevé (usage en extérieur, plein soleil).
- **Écrans** : Online/Offline (toggle géant) → Offres entrantes (accepter/refuser, compte à rebours) → Navigation vers restaurant → Confirmer récupération → Navigation vers client → Confirmer livraison (photo + code/OTP client) → Récap gains.
- **Localisation** : envoi de position throttlé (5–10 s) **uniquement** quand une course est active ou le livreur online ; batch + compression ; arrêt total offline.
- **Résilience** : file d'actions (accepter/récupérer/livrer) avec idempotency key ; jamais de double acceptation ; état serveur fait foi.
- **Batterie** : mode éco (fréquence GPS réduite si batterie < 20 %), pas d'animations coûteuses.

## 4.8 Offline (résumé — détail doc 12)

- Cache Query persistant → catalogue consultable hors ligne.
- Panier en MMKV → jamais perdu.
- Mutations critiques (commande, paiement, actions livreur) : **file applicative** avec idempotency, reprise **manuelle ou sur reconnexion avec confirmation**, jamais un rejeu silencieux.
- Bandeau d'état réseau global.

## 4.9 Structure de `apps/mobile`

```text
apps/mobile/
├── app/                          # expo-router
│   ├── (auth)/                   # phone, otp, onboarding
│   ├── (tabs)/                   # home, search, orders, cart, profile
│   │   ├── _layout.tsx           # tab bar (mobile) / rail (tablette)
│   │   ├── home.tsx
│   │   ├── search.tsx
│   │   ├── orders/index.tsx
│   │   ├── orders/[id].tsx       # suivi temps réel + carte
│   │   ├── cart.tsx
│   │   └── profile/...
│   ├── r/[slug].tsx              # restaurant + menu
│   ├── checkout.tsx
│   └── _layout.tsx               # providers : Query, Zustand, Socket, SafeArea, i18n
├── components/                   # UI RN (consomme @djafat/tokens)
│   ├── primitives/               # Button, Input, BottomSheet, Badge, Price...
│   └── domain/                   # RestaurantCard, ProductCard, OrderTimeline, CourierMap
├── lib/                          # socket, notifications, location task, storage(MMKV), analytics
├── hooks/
├── assets/
├── app.config.ts                # config Expo (permissions, plugins, canaux EAS)
└── eas.json
```

## 4.10 Conséquences

- **+** OTA = cycle de correction court, crucial quand la distribution store est lente.
- **+** Un binaire livreur dédié permet d'optimiser à fond un usage très différent.
- **−** Le suivi de position en arrière-plan est le point technique le plus fragile (OEM Android, permissions iOS) → à prototyper tôt.
- **−** Double implémentation d'UI (web/mobile) : mitigée par tokens + specs d'écran uniques (doc 11).
