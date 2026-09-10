# 12 — Stratégies : responsive, offline, performance, sécurité

## PARTIE A — RESPONSIVE (synthèse opérationnelle)

Détails composants en doc 10, écrans en doc 11. Règles transverses :

1. **Breakpoints uniques** (tokens) : `xs<360 · sm≥360 · md≥600 · lg≥905 · xl≥1240 · 2xl≥1600`.
2. **Layout, pas zoom** : la navigation _change de nature_ (bottom-tab → rail → sidebar). Le contenu se réorganise (1 → 2 → 3–4 colonnes), une colonne secondaire (résumé/carte) apparaît ≥ lg.
3. **Container queries** pour les composants réutilisés à des largeurs différentes.
4. **Mobile-first CSS** : styles de base = mobile, `min-width` pour enrichir.
5. **Actions primaires atteignables au pouce** : CTA sticky bas sur mobile.
6. **Jamais de scroll horizontal du body** : tables/diagrammes/code dans un conteneur `overflow-x:auto`.
7. **Tactile ET souris/clavier** : `:focus-visible` partout, hover non essentiel, cibles ≥ 44 px, `pointer: coarse` pris en compte.
8. **Orientation** : tester portrait/paysage sur tablette ; gérer le redimensionnement à chaud (split-screen, rotation).
9. **Densité** : `comfortable` sur mobile, option `compact` sur les tables desktop restaurant/admin.
10. **Matrice de test** : 320 / 360 / 390 / 768 (P+L) / 1024 (P+L) / 1366 / 1440 / 1920 + zoom navigateur 200 %.

## PARTIE B — OFFLINE / RÉSEAU INSTABLE

### B.1 Principe cardinal

> **Une commande ou un paiement n'est JAMAIS confirmé à partir d'un état local.** Le client peut _préparer_ hors ligne ; seule une réponse serveur (2xx) fait foi.

### B.2 Ce qui fonctionne hors ligne

| Élément              | Mécanisme                                                       | Détail                                                        |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| Panier               | Zustand + persistance (localStorage/IndexedDB web, MMKV mobile) | jamais perdu ; revalidé par `carts/quote` au retour en ligne  |
| Catalogue déjà vu    | TanStack Query persistant + SW cache (web)                      | restaurants/menus consultables ; badge « données du <heure> » |
| Dernières commandes  | cache Query                                                     | consultation lecture seule                                    |
| Shell de l'app (web) | Service Worker (app shell + assets)                             | démarrage instantané, page « hors ligne »                     |
| Adresses, profil     | cache                                                           | lecture seule hors ligne                                      |

### B.3 Mutations & file de reprise

- **Toute mutation critique** (`POST /orders`, `POST /payments`, actions livreur) porte un **`Idempotency-Key`** généré côté client et **persisté** avec la requête.
- File applicative (`outbox` client) : si offline au moment de l'envoi → la requête est mise en attente avec son état (`pending_send`), l'UI affiche « sera envoyé à la reconnexion », **sans** afficher « commande passée ».
- Reprise : à la reconnexion, on rejoue les requêtes en attente **une par une**, avec la même clé. Réponse `2xx` (ou `409` idempotent renvoyant la ressource existante) → succès ; on ne recrée jamais.
- **Anti-double commande** : bouton « Commander » désactivé pendant l'envoi + après succès ; contrainte serveur `unique(order_id, idempotency_key)` ; garde « une commande active en cours de création par client ».
- Les requêtes non critiques (favoris, note) : retry auto avec backoff, silencieux.
- Le **Service Worker ne rejoue jamais** de POST automatiquement — la reprise est applicative et contrôlée.

### B.4 Signalisation

- `NetworkBanner` global : `offline` / `connexion lente` / `reconnexion…` (détection : `navigator.onLine` + échecs/timeouts + latence RTT observée).
- Temps réel : bascule WS → polling annoncée discrètement.
- Chaque écran a un état « hors ligne » défini (doc 11).

### B.5 Détails plateforme

- **Mobile** : `expo-network` / NetInfo ; file en MMKV ; reprise sur `AppState active` + changement de connectivité ; timeout requêtes court (10–15 s) + retry.
- **Web/PWA** : SW Workbox ; IndexedDB pour la file ; `Background Sync` optionnel comme _déclencheur_ (mais la logique de rejeu reste applicative et idempotente).

## PARTIE C — PERFORMANCE (« contexte Tchad »)

Cibles : 1re page utile < 3 s sur 3G rapide émulée / mid-range Android ; interaction fluide ; consommation data minimale.

### C.1 Images (poste n°1)

- Pipeline serveur : variantes **AVIF + WebP + JPEG fallback**, largeurs responsives (`srcset`/`sizes`), **LQIP** (placeholder flou base64).
- `next/image` (web) / `expo-image` (mobile), lazy-loading, dimensions explicites (zéro CLS).
- Tailles cibles : carte ≤ 25 KB, hero ≤ 80 KB (AVIF).
- CDN (Cloudflare) devant le stockage objet ; cache long + hash.

### C.2 JavaScript / bundle

- **RSC / SSR** (Next) : le contenu critique arrive en HTML, moins de JS.
- Code splitting par route ; imports dynamiques pour carte, graphes, éditeurs.
- Budget : JS initial app client ≤ ~170 KB gzip ; audit `size-limit` en CI (échec si dépassement).
- Mobile : Hermes, RAM bundles, FlashList, éviter les grosses libs (moment→date-fns/Temporal, pas de lodash global).
- Polices : subset + preload + `font-display: swap` ; 1 famille.

### C.3 Réseau / API

- Pagination **keyset** partout ; `?fields=` pour limiter les payloads lourds.
- Cache HTTP : `ETag` + `Cache-Control` sur catalogue ; cache Redis serveur (listing/menu, TTL court) ; SWR côté client.
- Compression Brotli.
- Regrouper : endpoint `GET /v1/home` agrégé (1 requête pour l'accueil) ; `carts/quote` unique plutôt que N appels.
- Temps réel : payloads minimaux, throttle position, désabonnement.
- `GET /v1/config/public` mis en cache agressivement.

### C.4 Perçu

- **Skeletons** miroir du contenu (pas de spinner plein écran).
- Streaming SSR + Suspense (`loading.tsx`).
- Optimistic UI sur ajout panier / favori (réconcilié).
- Préchargement au survol/interaction imminente (liens restaurants).

### C.5 Mode économie de données

- Toggle « Économie de données » (auto si `Save-Data` header / connexion `2g`) : images plus compressées / différées, pas d'autoplay, carte en tuiles basse def, désactive le préchargement.

### C.6 Mesure

- **Lighthouse CI** sur le site public (budget Core Web Vitals, échec bloquant).
- **RUM** : web-vitals envoyés à un endpoint analytics (LCP, INP, CLS, TTFB) segmentés par type de connexion et device.
- Traces backend (p95/p99 par route), profondeur des queues, temps de dispatch.
- Tests réguliers en **throttling réseau** (Slow 3G) et sur un vrai Android d'entrée de gamme.

## PARTIE D — SÉCURITÉ

### D.1 Authentification

- Téléphone + **OTP** : 6 chiffres, TTL 5 min, **haché** en base (bcrypt/argon2), max 5 tentatives puis verrouillage temporisé, rate-limit strict (par numéro et par IP), pas de divulgation « numéro inconnu ».
- **JWT access** court (15 min), signé (RS256, clés en secret manager, rotation prévue).
- **Refresh** 30 j, **rotatif**, haché en base (`sessions.refresh_hash`), révocable ; détection de réutilisation d'un refresh déjà tourné → révocation de toute la chaîne + alerte.
- Web : refresh en cookie `HttpOnly + Secure + SameSite=Lax/Strict` + **CSRF token** sur les mutations à cookie. Mobile : refresh en `expo-secure-store`.
- Déconnexion = révocation session ; « déconnecter tous les appareils » dispo.
- 2FA (TOTP) pour les comptes **admin**.

### D.2 Autorisation

- **RBAC** : `customer · restaurant_owner · restaurant_staff · courier · admin · super_admin` + **contrôle de portée** systématique (resto ↔ son établissement, livreur ↔ ses livraisons, client ↔ ses ressources).
- Politique centralisée (`common/rbac`), testée ; deny par défaut.
- Endpoints admin isolés (`/v1/admin/*`), réseau/IP allowlist possible, audit systématique.

### D.3 Entrées & API

- **Validation Zod** sur 100 % des entrées (body, params, query) — schémas partagés.
- Requêtes paramétrées (Prisma / `$queryRaw` avec params) → pas d'injection SQL.
- **Rate limiting** (token bucket Redis) global + renforcé (OTP, recherche, création commande, webhooks).
- Limite de taille de payload, timeouts, pagination bornée (`limit` max).
- **XSS** : échappement par défaut (React) ; pas de `dangerouslySetInnerHTML` sans sanitize (DOMPurify) ; **CSP** stricte sur le web (script-src allowlist, pas d'inline non-nonce).
- **CORS** : allowlist explicite des domaines DJAFAT ; pas de `*` avec credentials.
- **Headers** : Helmet (HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors 'none').
- **Uploads** : URL présignées, type/size vérifiés, re-encodage image côté serveur (strip EXIF), noms aléatoires, bucket privé + URL signées pour la lecture des justificatifs.

### D.4 Paiement (rappel doc 08)

Webhooks **signés + horodatés** (anti-rejeu) ; **idempotency** partout ; transitions monotones ; recoupement des montants ; **aucune donnée de carte stockée** ; clés PSP en secret manager ; `ledger_entries` immuable ; actions financières privilégiées = admin + audit + double confirmation.

### D.5 Données & vie privée

- Secrets hors repo (secret manager / variables d'env chiffrées) ; **rien de sensible dans le frontend** (clés serveur, config PSP).
- Chiffrement en transit (TLS partout) et au repos (disque DB/stockage).
- Minimisation : pas de collecte inutile ; rétention définie (doc 06 §6.6) ; masquage des payloads PSP/PII en logs.
- `audit_logs` sur toute action privilégiée / financière / de modération.
- Droit à la suppression du compte (anonymisation des commandes historiques, pas de suppression brute qui casserait le ledger).
- Conformité type protection des données (préparer registre des traitements, CGU, politique de confidentialité).

### D.6 Infra & exploitation

- Dépendances : `npm audit` / Dependabot / lockfile figé ; pas de dépendance non justifiée.
- Images Docker minimales, utilisateur non-root, scan (Trivy) en CI.
- Séparation stricte des environnements et des secrets (`local` / `staging` / `production`).
- Sauvegardes chiffrées + **test de restauration** périodique.
- Sentry (scrubbing PII activé) ; alertes (taux d'erreur, DLQ, échecs paiement, pics de latence).
- **Security review** avant chaque mise en prod majeure (checklist OWASP ASVS niveau 2 en cible) + `security-review` sur les diffs sensibles.
- Plan de réponse à incident (contacts, procédure de révocation de clés, communication).
