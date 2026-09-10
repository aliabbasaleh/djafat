# 02 — Choix technologiques

Grille de lecture pour chaque choix : **pourquoi**, **coût**, **performance**, **maintenabilité**, **partage de code**, **évolutivité**.

---

## 2.1 Langage : TypeScript partout (strict)

- **Pourquoi** : un seul langage backend + 5 fronts + packages partagés → un développeur peut naviguer partout, les types DTO circulent du schéma DB jusqu'au composant.
- **Coût** : nul (open source). Coût cognitif : config `tsconfig` stricte à maintenir (base partagée dans `packages/tsconfig`).
- **Perf** : n/a (compile-time).
- **Maintenabilité** : ⬆️ forte — refactor guidé par le compilateur.
- **Partage** : c'est la condition du partage.
- **Évolutivité** : recruter en TS/React est réaliste ; si un besoin CPU-intensif apparaît (matching géo massif), on isolera un worker en Go/Rust derrière une interface.

## 2.2 Backend : NestJS (modular monolith)

- **Pourquoi** : structure imposée (modules, providers, DI, guards, pipes, interceptors) qui **cadre une équipe** ; intégré à OpenAPI, WebSockets, class-validator, queues. Le brief demande explicitement un modular monolith → NestJS en est l'incarnation idiomatique.
- **Alternatives** : Fastify nu (plus rapide au bench, mais tout est à structurer soi-même), AdonisJS (moins d'écosystème), Go/NestJS-like (perd le partage TS).
- **Coût** : open source. Overhead runtime léger ; sous Fastify adapter, throughput largement suffisant pour le volume cible.
- **Perf** : bonne. Points chauds (listing restaurants) traités par cache Redis + requêtes SQL indexées, pas par le framework.
- **Maintenabilité** : ⬆️ conventions fortes, testabilité (DI).
- **Partage** : consomme `@djafat/types`, `@djafat/validation`, `@djafat/core`.
- **Évolutivité** : chaque module a une frontière claire (service + repository + DTO) → extraction en microservice = remplacer les appels in-process par un transport (gRPC/HTTP/queue).

## 2.3 Base de données : PostgreSQL 16 (+ PostGIS)

- **Pourquoi** : commandes et argent exigent des **transactions ACID** et des contraintes fortes (FK, `CHECK`, unicité). PostGIS gère distances/zones nativement. Full-text search intégré → pas d'Elasticsearch au MVP.
- **Alternatives** : MySQL (ok mais géo plus faible), MongoDB (rejeté : cohérence transactionnelle critique).
- **Coût** : Postgres managé ~15–50 €/mois au MVP (1 instance + replica lecture optionnelle).
- **Perf** : excellente avec index adéquats (voir doc 06). Pagination _keyset_ pour les listes longues.
- **Maintenabilité** : migrations versionnées (Prisma Migrate), `EXPLAIN ANALYZE` dans la CI sur requêtes critiques.
- **Partage** : le schéma génère les types Prisma → réexportés dans `@djafat/types` pour les entités publiques.
- **Évolutivité** : replica lecture, partitionnement de `orders`/`delivery_locations` par date, extraction analytics vers un entrepôt (plus tard).

## 2.4 ORM : Prisma (avec échappatoire SQL)

- **Pourquoi** : DX et migrations les plus solides de l'écosystème TS ; types générés.
- **Limites** : transactions très complexes, requêtes géo PostGIS, upserts massifs → on écrit du **SQL brut paramétré** (`prisma.$queryRaw`) encapsulé dans les repositories. Le financier (ledger) utilise des transactions explicites `SERIALIZABLE` si nécessaire.
- **Alternative** : Drizzle (plus proche du SQL, migrations moins mûres), Kysely (query builder pur, pas de migrations).
- **Coût** : open source.
- **Évolutivité** : si Prisma devient un plafond, Kysely peut cohabiter (même connexion) module par module.

## 2.5 Cache / temps réel / files : Redis + Socket.IO + BullMQ

- **Redis** : cache (listing, menus), rate-limiting, sessions de refresh token révoquées, pub/sub inter-instances, backing des rooms Socket.IO, broker BullMQ.
- **Socket.IO** : rooms, reconnexion automatique, **fallback long-polling** (précieux sur réseau tchadien), adaptateur Redis pour scaler horizontalement.
- **BullMQ** : jobs asynchrones (dispatch, notifications, réconciliation paiement, géocodage, agrégats). Retries + backoff + dead-letter.
- **Coût** : Redis managé ~10–30 €/mois.
- **Alternative** : SSE seul (pas de canal montant), Kafka (surdimensionné, ops lourdes).
- **Évolutivité** : partitionner les queues, plusieurs workers, Redis Cluster si besoin.

## 2.6 Web : Next.js (App Router) + TypeScript

- **Pourquoi** : React Server Components → moins de JS envoyé (clé pour le Tchad) ; SEO natif pour le site public et les pages restaurants ; PWA ; `next/image` (AVIF/WebP, tailles responsives) ; un seul framework pour site public + app client + dashboard restaurant + admin.
- **Alternatives** : Remix (bon, écosystème plus petit), SPA Vite (perd SEO/SSR).
- **Coût** : hébergeable sur Node container (pas de lock-in Vercel). Vercel optionnel pour le site marketing.
- **Perf** : streaming SSR, code splitting par route, cache granulaire.
- **Partage** : consomme tous les packages ; `@djafat/sdk` côté client et serveur (RSC).
- **Évolutivité** : segments par app (`app.`, `restaurant.`, `admin.`) déployables indépendamment.

## 2.7 Mobile : Expo (React Native) + expo-router

- **Pourquoi** : réutilisation React/TS et des packages partagés ; **OTA updates** (corriger sans repasser par les stores — utile quand la distribution est lente) ; modules natifs prêts (notifications, localisation, caméra, secure store) ; build cloud EAS.
- **Alternatives** : Flutter (perd le partage TS, 2e langage), natif pur (coût x2).
- **Coût** : EAS ~0–99 $/mois selon volume de builds ; comptes stores (25 $ Google une fois, 99 $/an Apple).
- **Perf** : suffisante pour des écrans liste/formulaire/carte ; Hermes activé ; listes virtualisées (FlashList).
- **Partage** : `@djafat/core`, `@djafat/validation`, `@djafat/sdk`, `@djafat/tokens`, `@djafat/i18n`.
- **Évolutivité** : si un écran devient critique en perf, on écrit un composant natif ponctuel.

## 2.8 Authentification : maison (téléphone + OTP)

- **Pourquoi** : au Tchad l'identité = le numéro de téléphone ; les fournisseurs d'auth managés (Auth0/Clerk) sont chers en devise forte et mal adaptés au flux OTP SMS local. Flux maîtrisé = coût et souveraineté.
- **Mécanique** : OTP 6 chiffres, TTL 5 min, 5 tentatives max, verrouillage progressif, **OTP haché en base**. JWT access 15 min + refresh 30 j **rotatif** (refresh haché, révocable via Redis/DB). RBAC par rôles.
- **Coût** : SMS ~15–60 FCFA/message selon agrégateur → poste de coût à surveiller (voir risques).
- **Évolutivité** : ajouter e-mail/mot de passe, magic link, biométrie (déverrouillage app), SSO restaurant plus tard.

## 2.9 Cartographie : abstraction + MapLibre/OSM par défaut

- **Interfaces** : `MapProvider` (affichage), `GeocodingProvider` (texte ⇄ coordonnées), `RoutingProvider` (itinéraire/ETA).
- **Défaut** : MapLibre GL + tuiles OSM (auto-hébergées ou via un fournisseur de tuiles économique). Géocodage : Nominatim/hébergé + **fallback repères manuels** (l'adressage rue est faible à N'Djamena).
- **Option** : brancher Google/Mapbox derrière la même interface là où la qualité le justifie (ETA livreur).
- **Coût** : OSM ≈ coût d'hébergement des tuiles ; Google/Mapbox = à l'usage, à activer sélectivement.
- **Évolutivité** : changer de provider = une implémentation d'interface, zéro impact UI/métier.

## 2.10 Stockage objet + CDN

- **Choix** : S3-compatible (Scaleway Object Storage / Cloudflare R2) + CDN (Cloudflare).
- **Usage** : photos restaurants/produits, avatars, justificatifs de livraison (photo + signature), exports.
- **Pipeline image** : upload → worker génère variantes (thumb/card/hero) en **AVIF + WebP + fallback JPEG**, largeurs responsives, placeholder flou (LQIP).
- **Coût** : R2 sans frais d'egress → intéressant pour un marché où la bande passante compte.

## 2.11 Hébergement & exécution

| Composant                  | MVP                                                                                             | Évolution                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------- |
| API + workers              | Conteneurs sur Scaleway/Hetzner (région Paris) — 1–2 instances API + 1 worker                   | Autoscaling, séparation worker/API, multi-AZ |
| PostgreSQL                 | Managé (Scaleway/Neon) + backups PITR                                                           | Replica lecture, partitions                  |
| Redis                      | Managé                                                                                          | Cluster                                      |
| Web (app/restaurant/admin) | Conteneurs Node                                                                                 | Edge/CDN pour le public                      |
| Mobile builds              | EAS                                                                                             | EAS + file d'attente CI                      |
| Observabilité              | Sentry (erreurs) + logs structurés (pino) + métriques Prometheus/Grafana + uptime (BetterStack) | Traces OpenTelemetry                         |

- **Pourquoi région Paris/EU** : meilleur routage réseau vers l'Afrique francophone que us-east, conformité type RGPD, coût maîtrisé (Hetzner très compétitif).
- **Coût cible MVP** : ~150–400 €/mois tout compris.

## 2.12 CI/CD

- GitHub Actions + Turborepo (jobs sur packages **affectés** uniquement) : lint → typecheck → tests unit → build → tests intégration (Postgres+Redis en services) → E2E (Playwright) sur staging.
- Déploiement : images Docker taguées par SHA, migration DB en step dédié (avec verrou), rollback = redeploy tag précédent.
- Mobile : EAS Build + EAS Submit (canaux `staging`/`production`), OTA via EAS Update.

## 2.13 Récapitulatif de la stack

```text
Langage      TypeScript (strict) partout
Backend      NestJS (Fastify adapter) — modular monolith
DB           PostgreSQL 16 + PostGIS — ORM Prisma (+ SQL brut ciblé)
Cache/RT     Redis + Socket.IO (adapter Redis) + BullMQ
Web          Next.js App Router + React + Tailwind + Radix — PWA
Mobile       Expo / React Native + expo-router + FlashList + MapLibre
Partagé      packages: types / validation(Zod) / core / sdk / tokens / i18n / config
Auth         Téléphone+OTP, JWT access court + refresh rotatif, RBAC
Carto        Abstractions Map/Geocoding/Routing — MapLibre+OSM par défaut
Fichiers     S3-compatible (R2/Scaleway) + CDN Cloudflare + pipeline images
Infra        Conteneurs Docker, région EU (Paris), Postgres/Redis managés
Observ.      Sentry + pino + Prometheus/Grafana + uptime
CI/CD        GitHub Actions + Turborepo + EAS
```
