# 13 — Structure Git, arborescence & qualité

## 13.1 Dépôt

Un **monorepo** unique : `djafat/` (le dossier actuel `Desktop/Djafat`). `git init` fait partie de la Phase 0.

- Hébergement : GitHub (privé), organisation `djafat`.
- Gestionnaire de paquets : **pnpm** (workspaces) — rapide, strict, `node_modules` économe.
- Orchestrateur : **Turborepo** (cache local + distant, exécution des tâches sur les projets affectés uniquement).

## 13.2 Arborescence

```text
djafat/
├── apps/
│   ├── api/                 # NestJS — HTTP + WebSocket gateway
│   ├── worker/              # NestJS — processors BullMQ (même code base, autre entrypoint)
│   ├── web/                 # Next.js — site public (djafat.com) + client (app.djafat.com) + PWA
│   ├── restaurant/          # Next.js — restaurant.djafat.com
│   ├── admin/               # Next.js — admin.djafat.com
│   ├── mobile/              # Expo — client Android/iOS/tablette
│   └── courier/             # Expo — livreur  (+ courier-web optionnel plus tard)
├── packages/
│   ├── types/               # @djafat/types      — DTO, enums, types d'événements
│   ├── validation/          # @djafat/validation — schémas Zod (partagés client/serveur)
│   ├── core/                # @djafat/core       — logique métier pure (panier, frais, ETA, state machines)
│   ├── sdk/                 # @djafat/sdk        — client API typé + hooks React Query + socket + auth
│   ├── tokens/              # @djafat/tokens     — design tokens (JSON -> CSS vars / TS)
│   ├── ui-web/              # @djafat/ui-web     — primitives web (Radix + Tailwind)  [optionnel : ou dans apps/web]
│   ├── ui-native/           # @djafat/ui-native  — primitives RN
│   ├── i18n/                # @djafat/i18n       — clés FR (+ structure AR), helpers format
│   ├── config/              # @djafat/config     — constantes + validation des env
│   ├── eslint-config/       # règles ESLint partagées
│   ├── tsconfig/            # bases tsconfig
│   └── testing/             # helpers de test (factories, fixtures, mocks providers)
├── infra/
│   ├── docker-compose.yml   # postgres+postgis, redis, minio(s3), mailhog, mock-sms, mock-psp
│   ├── docker/              # Dockerfiles api/worker/web/...
│   ├── migrations/          # (ou apps/api/prisma/migrations) — SQL versionné
│   ├── seed/                # jeux de données dev/staging
│   └── deploy/              # manifests (compose prod / k8s plus tard), scripts release
├── docs/                    # CE DOSSIER (00 → 14) + specs d'écrans + ADR/
│   └── adr/                 # Architecture Decision Records (1 fichier par décision)
├── .github/workflows/       # CI/CD
├── .changeset/              # versionnage des packages
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

### Structure interne type d'un module API (`apps/api/src/modules/orders/`)

```text
orders/
├── orders.module.ts
├── orders.controller.ts        # HTTP (/v1/orders, /v1/restaurant/orders...)
├── orders.gateway.ts           # WS (émissions vers rooms)
├── orders.service.ts           # règles (compose pricing, promotions, machine à états)
├── orders.repository.ts        # accès Prisma / SQL brut
├── dto/                        # entrées/sorties (référencent @djafat/validation)
├── events/                     # définitions d'événements de domaine
└── orders.service.spec.ts
```

## 13.3 Stratégie de branches & commits

- **Trunk-based léger** : branche `main` déployable en permanence.
- Branches courtes `feat/…`, `fix/…`, `chore/…`, `docs/…` → PR → merge (squash) dans `main`.
- `main` protégée : CI verte obligatoire, 1 review minimum, pas de push direct.
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`) → génération de changelog + versionnage.
- Tags de release `api-vX.Y.Z`, `web-vX.Y.Z`, `mobile-vX.Y.Z` (via Changesets).
- Environnements : merge sur `main` → déploie **staging** auto ; promotion **production** manuelle (bouton / tag).
- Fin de message de commit :
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  ```

## 13.4 CI/CD (`.github/workflows/`)

| Workflow             | Déclencheur               | Étapes                                                                                                                                         |
| -------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`             | PR + push `main`          | install (pnpm, cache) → `turbo lint typecheck test build` (projets affectés) → tests intégration (services Postgres+Redis) → upload couverture |
| `e2e.yml`            | push `main` / nightly     | déploie preview/staging → Playwright (web) + Maestro (mobile, sur émulateur) → rapport                                                         |
| `lighthouse.yml`     | PR touchant `web`         | Lighthouse CI sur pages publiques, budgets bloquants                                                                                           |
| `deploy-staging.yml` | push `main`               | build images Docker (tag = SHA) → push registry → migrate DB (step verrouillé) → rollout staging                                               |
| `deploy-prod.yml`    | tag / dispatch manuel     | même pipeline → production → smoke tests → notif                                                                                               |
| `mobile-build.yml`   | tag `mobile-*` / dispatch | EAS Build (staging/prod) + EAS Submit + EAS Update (OTA)                                                                                       |
| `security.yml`       | PR + weekly               | `pnpm audit`, Trivy (images), CodeQL, vérif secrets (gitleaks)                                                                                 |

Règles : migrations DB toujours **rétro-compatibles** (expand/contract) ; rollback = redeploy du tag précédent ; pas de `--force` git, pas de skip de hooks.

## 13.5 Qualité de code

- **TypeScript strict** partout (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`), base dans `packages/tsconfig`.
- **ESLint** (config partagée) : import order, boundaries (interdit `apps/web` d'importer `apps/api`, interdit un module API d'importer le dossier d'un autre module hors `*.service`/`*.types`), pas de couleurs/espacements en dur (design lint), pas de `console.log` en prod, `no-floating-promises`.
- **Prettier** (format unique, pré-commit).
- **Hooks** (Husky + lint-staged) : format + lint + typecheck rapide sur les fichiers modifiés + `commitlint`.
- **Tests** :
  - _Unitaires_ (Vitest) : `@djafat/core` (100 % des règles métier : panier, frais, remises, transitions), services API (mocks repos/providers), composants UI (Testing Library).
  - _Intégration_ (Vitest + Testcontainers/compose) : repositories contre Postgres réel, endpoints API (supertest), webhooks paiement (mock PSP), dispatch.
  - _Contractuels_ : chaque `PaymentProvider` / `GeocodingProvider` contre un mock conforme.
  - _E2E_ : Playwright (parcours J1, J3, J6 web) ; Maestro (parcours J1 mobile, J4 livreur).
  - _Charge_ : k6 sur `GET /home`, `GET /restaurants`, `POST /orders`, dispatch (avant go-live).
- **Couverture** : cible 80 % global, **100 % sur `@djafat/core`** et sur `payments`/`orders`/`deliveries` services.
- **ADR** : toute décision d'archi structurante → un fichier `docs/adr/NNNN-titre.md` (contexte, options, décision, conséquences). Premier ADR : [`adr/0001-djafat-logistics-and-vertical-integration.md`](adr/0001-djafat-logistics-and-vertical-integration.md) — réseau logistique multi-restaurants et intégration verticale.
- **Interdits** (repris du brief) : duplication, logique métier dans les composants UI, secrets dans le frontend, données fictives non signalées (`// TODO: MOCK` + feature flag + jamais en prod), dépendances inutiles, complexité prématurée (pas de microservices/k8s/Kafka au MVP).

## 13.6 Gestion des versions de packages

- **Changesets** : chaque PR modifiant un package ajoute un changeset → bump semver + changelog automatiques à la release.
- Le `sdk` est régénéré à partir de l'OpenAPI de l'`api` à chaque release d'API ; incompatibilité détectée par les types à la compilation des fronts.

## 13.7 Onboarding développeur (cible)

```bash
git clone … && cd djafat
pnpm install
pnpm infra:up          # docker-compose : postgres, redis, minio, mock-sms, mock-psp
pnpm db:migrate && pnpm db:seed
pnpm dev               # turbo : api + worker + web (+ mobile via expo start au besoin)
```

`.env.example` complet par app ; `@djafat/config` refuse le démarrage si une variable requise manque.
