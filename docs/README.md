# DJAFAT — Dossier d'architecture (v1)

> Plateforme de livraison de repas (puis produits du quotidien) — Tchad, lancement N'Djamena.
> Ce dossier est le livrable de la **Première Mission**. **Aucune implémentation lourde n'est lancée avant validation.**

---

## Comment lire ce dossier

| #   | Document                                 | Contenu                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| —   | `README.md`                              | Résumé exécutif, décisions clés, hypothèses                                                                                                                                                                                                                                                      |
| 01  | `01-architecture-generale.md`            | Vision technique, architecture multi-plateforme, partage de code, monorepo                                                                                                                                                                                                                       |
| 02  | `02-choix-technologiques.md`             | Évaluation de la stack, coûts, alternatives, recommandation                                                                                                                                                                                                                                      |
| 03  | `03-architecture-frontend-web.md`        | Next.js, responsive, PWA, SEO, rendu                                                                                                                                                                                                                                                             |
| 04  | `04-architecture-mobile.md`              | Expo / React Native, navigation, natif                                                                                                                                                                                                                                                           |
| 05  | `05-architecture-backend.md`             | NestJS modular monolith, modules, patterns transverses                                                                                                                                                                                                                                           |
| 06  | `06-schema-postgresql.md`                | Modèle de données complet + DDL de référence                                                                                                                                                                                                                                                     |
| 07  | `07-api.md`                              | Conventions API, catalogue d'endpoints, OpenAPI                                                                                                                                                                                                                                                  |
| 08  | `08-architecture-paiement.md`            | Abstraction PSP, machine à états, webhooks, idempotence, journal financier                                                                                                                                                                                                                       |
| 09  | `09-livraison-geo-temps-reel.md`         | Dispatch livreurs, abstractions carto, WebSockets, notifications                                                                                                                                                                                                                                 |
| 10  | `10-design-system.md`                    | Tokens, composants, variantes responsive, accessibilité                                                                                                                                                                                                                                          |
| 11  | `11-ecrans-et-parcours.md`               | Inventaire complet des écrans (4 apps) + user journeys                                                                                                                                                                                                                                           |
| 12  | `12-strategies-offline-perf-securite.md` | Réseau instable, performance « contexte Tchad », sécurité                                                                                                                                                                                                                                        |
| 13  | `13-structure-git-et-dossiers.md`        | Stratégie Git, arborescence monorepo, CI/CD, qualité                                                                                                                                                                                                                                             |
| 14  | `14-roadmap-et-risques.md`               | Roadmap MVP/V2, **ordre exact de développement** (révisé post-audit), risques, **priorités P0–P3**                                                                                                                                                                                               |
| 15  | `15-audit-corrections.md`                | **Journal d'audit & de décisions** : corrections C1–C39, décisions AD-01…AD-14, **décisions verrouillées A1–A9**, modèle financier/multi-pays/paiement, **plan de migration PostgreSQL**, ambiguïtés, dette assumée                                                                              |
| 16  | `16-final-architecture-validation.md`    | **Checkpoint officiel avant développement** : verdict (GO WITH CONDITIONS), décisions A1–A9, contradictions trouvées & corrigées (dont l'équilibre du grand livre), risques restants, **définition Bloc 0**, **définition Bloc 0.5**, conditions de démarrage H1–H7, classification P0–P3 finale |

> **Statut : validé — GO WITH CONDITIONS (2026-09-10, 2 passes).** Audit CTO → « GO AVEC CORRECTIONS » → corrections appliquées → 2e passe de cohérence → **checkpoint `16`**. Documents retravaillés : `01`, `05`, `06`, `07`, `08`, `09`, `14` ; créés : `15`, `16`. Une erreur d'équilibre comptable dans l'exemple de référence a été trouvée et corrigée (C36). Le **Bloc 0 n'est pas démarré** — en attente de relecture humaine et de feu vert explicite (conditions H1–H7 dans `16`).

---

## Résumé exécutif

**Ce qu'est DJAFAT :** une marketplace de livraison locale à 4 acteurs (client, restaurant, livreur, admin), pensée **mobile-first mais pas mobile-only**, avec une expérience de qualité sur Android, iPhone, tablette et ordinateur.

**Principe directeur d'architecture :** un **monorepo TypeScript** où l'on partage tout ce qui n'est pas de l'UI (types, validation, SDK API, logique métier pure, tokens de design, i18n) et où l'on assume **deux implémentations d'UI** : Web (Next.js) et Mobile natif (Expo/React Native). On ne construit pas 4 apps indépendantes ; on construit 1 backend + 1 socle partagé + des surfaces d'affichage adaptées à chaque device.

**Backend :** modular monolith **NestJS + PostgreSQL + Redis**, découpé en modules métier prêts à être extraits en services si le volume l'exige. API REST documentée en OpenAPI, temps réel via WebSocket (Socket.IO + adaptateur Redis).

**Paiement :** abstraction `PaymentProvider` **provider-agnostic** dès le jour 1 (jamais construite autour d'un PSP) — `getCapabilities` + registry **data-driven** (`payment_provider_configs`). MVP = **Cash** + **Mock** (permanent, CI) + **un** Mobile Money réel. Le serveur est toujours l'autorité ; le client n'envoie **aucun montant** ; jamais de confirmation basée sur un état local.

**Finance :** module `ledger` **écrivain unique** du grand livre double entrée (`postEntryGroup`, `∑debit=∑credit`, idempotence durable). Soldes wallet `pending`/`available` = **projections** du grand livre. Frais PSP + `PSP_CLEARING` + `settlements` (réconciliation banque) modélisés.

**Multi-pays / multi-devise dès le MVP :** type monétaire générique `Money { minor, currency }` (fin des `*_xaf`), tables `countries`/`cities`/`currencies`, `commission_rules`/`tax_rules` résolues + snapshotées. Ouvrir un marché = INSERT, pas de migration.

**Livraison :** dispatch « livreur disponible le plus proche » au MVP, architecture évolutive (ETA, charge, zone, performance). Adressage **par points de repère** car l'adressage rue/numéro est faible à N'Djamena.

**Contexte Tchad pris au sérieux :** budget data limité, Android entrée de gamme, réseau instable, latence. → PWA pour le web client, images agressive­ment optimisées, payloads temps réel minimaux, file d'attente offline, mode économie de données.

---

## Décisions clés (et pourquoi)

| Décision               | Choix                                                                                                           | Alternative écartée                                   | Raison principale                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Organisation du code   | Monorepo pnpm + Turborepo                                                                                       | Multi-repos                                           | Partage de types/SDK/logique, refactor atomique, une seule CI                            |
| Partage d'UI           | **Non** — 2 design systems pilotés par des tokens communs                                                       | Tamagui / RN-Web unifié                               | Risque de maturité et de compromis UX ; on préfère 2 implémentations natives excellentes |
| Backend                | NestJS modular monolith + **DAG de modules explicite**                                                          | Microservices d'emblée                                | Vitesse de livraison, 1 déploiement ; extraction future propre (`payments`+`ledger`)     |
| ORM                    | Prisma (+ SQL brut pour le financier/geo)                                                                       | TypeORM, Drizzle                                      | DX et migrations ; échappatoire SQL pour transactions complexes et PostGIS               |
| Base de données        | PostgreSQL 16 + PostGIS **+ PgBouncer**                                                                         | MongoDB                                               | Transactions ACID (commandes, argent), géo natif ; pooling dès le début                  |
| Argent                 | **`Money { minor, currency }`** générique partout                                                               | `amount_xaf` / `number`                               | Multi-devise sans migration rétroactive du cœur                                          |
| Grand livre            | Module `ledger` **écrivain unique** ; wallet = projection                                                       | Écritures dispersées + `wallet_transactions` autonome | Invariant financier gardé en 1 point ; extraction propre                                 |
| Paiement               | `PaymentProvider` + `ProviderCapabilities` + registry **data-driven**                                           | Logique liée à Airtel / enum figé                     | Ajouter un PSP = 1 fichier + 1 config, zéro impact `orders`/API                          |
| Idempotence financière | **Contraintes PostgreSQL** (durable)                                                                            | Redis seul                                            | Éviction Redis ≠ double commande/paiement                                                |
| Multi-pays             | `countries`/`cities`/`currencies` + `country_id`/`city_id` dès le MVP                                           | Chad/XAF/fr implicites                                | Ouvrir un marché = INSERT                                                                |
| Commission / taxe      | `commission_rules` / `tax_rules` résolues + snapshot                                                            | Colonne figée sur `restaurants`                       | Règles configurables et historisées                                                      |
| Temps réel             | Socket.IO + Redis adapter + **outbox**                                                                          | SSE seul, WS bruts                                    | Rooms, fallback polling, scaling ; « pas d'event fantôme »                               |
| Web                    | Next.js (App Router) + TypeScript                                                                               | Remix, SPA Vite                                       | RSC pour perf, SEO natif, PWA                                                            |
| Mobile                 | Expo (React Native) + expo-router                                                                               | Flutter, natif pur                                    | Réutilisation TS/React, OTA, time-to-market                                              |
| Auth                   | Téléphone + OTP (lock durable), JWT access court + refresh **rotatif à token family** ; admin **2FA + step-up** | Email/mot de passe d'abord                            | Le téléphone est l'identité ; sécurité des sessions et des actions financières           |
| Cartographie           | MapLibre + tuiles OSM, géocodage via abstraction                                                                | Google Maps par défaut                                | Coût, souveraineté, données OSM complétées par repères                                   |
| Hébergement            | Scaleway ou Hetzner (Paris/EU) + Postgres managé                                                                | us-east                                               | Latence francophone Afrique, coût, RGPD-like                                             |
| Files d'attente        | BullMQ (Redis)                                                                                                  | Kafka                                                 | Suffisant au volume MVP, opérable par une petite équipe                                  |
| Notifications push     | Expo Push → FCM/APNs                                                                                            | OneSignal                                             | Gratuit, intégré au stack Expo                                                           |

---

## Hypothèses (à confirmer)

Conformément au brief, on ne bloque pas : voici les hypothèses retenues. Merci de corriger celles qui sont fausses.

1. **Équipe** : petite équipe (2 à 4 développeurs) au démarrage, montée en charge progressive.
2. **Budget infra MVP** : ~150–400 €/mois (VPS + Postgres managé + Redis + stockage objet + CDN).
3. **Mobile Money** : les deux acteurs dominants ciblés sont **Airtel Money** et **Moov Money (Flooz)**. L'accès se fera soit via un agrégateur panafricain, soit via API telco directe. Disponibilité d'un sandbox à vérifier — impact roadmap Phase 4.
4. **SMS OTP** : passage par un agrégateur (Twilio / Africa's Talking / partenaire local). En dev : provider SMS _mock_.
5. **Langues** : français d'abord ; architecture i18n prête pour l'arabe (RTL) en V2 ; **traduction de contenu** (`products.name_i18n`) réservée, non implémentée au MVP.
6. **Devise** : XAF au lancement (exposant ISO 4217 = 0 → `minor` = franc entier). Le modèle est **générique multi-devise** (`Money { minor, currency }`, table `currencies`) ; **pas de moteur de change** au MVP (dette assumée D2, voir doc 15 §11).
7. **Domaine** : `djafat.com` acquis ; sous-domaines `app.` / `restaurant.` / `livreur.` / `admin.` sans achat supplémentaire.
8. **Boutiques d'apps** : compte Google Play + compte Apple Developer disponibles (ou acquérables) pour la publication.
9. **Store légal/paiement** : l'entité DJAFAT est (ou sera) enregistrée et éligible à contracter avec un PSP ; conformité KYC/AML côté PSP.
10. **Volume cible fin d'année 1** : ordre de grandeur 200–2 000 commandes/jour — dimensionne le « pas besoin de microservices ».
11. **Le dépôt n'est pas encore un repo Git** — l'initialisation Git fait partie de la Phase 0.

---

## Prochaine étape

1. Lire le **checkpoint `16-final-architecture-validation.md`** (verdict, décisions A1–A9, contradictions corrigées, définition des Blocs 0 et 0.5, conditions H1–H7).
2. Relire les documents révisés (`01`, `05`, `06`, `07`, `08`, `09`, `14`) + le journal `15-audit-corrections.md`.
3. Lancer les **conditions de démarrage** (`16` §H) : H1 démarches PSP, H2 hébergement Scaleway, H3 secret manager, H4 cadrage juridique.
4. **Donner (ou non) le feu vert explicite** pour lancer le Bloc 0.

Le **Bloc 0 n'est pas démarré** et ne le sera pas sans feu vert.
