# Application inventory

Every deployable application and shared package on `main`, with its purpose, technology, size and
state. Detailed audits: [`applications/`](applications/).

## 1. Applications

| App                                             | Purpose                         | Technology                                  | Size (tracked source)    | Unit tests | Build | State                  |
| ----------------------------------------------- | ------------------------------- | ------------------------------------------- | ------------------------ | ---------- | ----- | ---------------------- |
| [`apps/api`](applications/API.md)               | REST API and realtime gateway   | NestJS 10, Fastify 4, Prisma 6, Socket.IO 4 | 218 files · 31 100 lines | 811        | ✅    | Partially Completed    |
| [`apps/worker`](applications/WORKER.md)         | Scheduled background jobs       | BullMQ 5, `pg`, ioredis                     | 14 files · 2 230 lines   | 36         | ✅    | Partially Completed    |
| [`apps/web`](applications/WEB.md)               | Customer website (port 3000)    | Next.js 15.1, React 19                      | 29 files · 2 480 lines   | 0          | ✅    | Broken in browsers     |
| [`apps/restaurant`](applications/RESTAURANT.md) | Restaurant console (port 3003)  | Next.js 15.1, React 19                      | 28 files · 2 380 lines   | 16         | ✅    | Broken in browsers     |
| [`apps/admin`](applications/ADMIN.md)           | Back-office console (port 3002) | Next.js 15.1, React 19                      | 19 files · 1 550 lines   | 0          | ✅    | Broken in browsers     |
| [`apps/courier`](applications/COURIER.md)       | Courier phone app               | Expo 53, React Native 0.79                  | 25 files · 1 500 lines   | 9          | ❌    | Broken (cannot bundle) |
| [`apps/mobile`](applications/MOBILE.md)         | Customer phone app              | Expo 53, React Native 0.79                  | 27 files · 2 160 lines   | 5          | ❌    | Broken (cannot bundle) |

### Main modules of each application

| App        | Modules / screens                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| api        | auth · users · addresses · catalog · pricing · carts · orders · payments · ledger · couriers · deliveries · notifications · realtime · admin · platform · geo (empty) |
| worker     | outbox-relay (2 s) · order-expiry (30 s) · dispatch-retry (10 s) · ledger-assert (hourly)                                                                             |
| web        | home · restaurant list and search · restaurant · product · cart and checkout · addresses · order page · login                                                         |
| restaurant | order board · history · menu · hours · balance · profile · support (placeholder) · login                                                                              |
| admin      | dashboard · users (search, detail, roles, suspend/block) · orders · restaurants · couriers · finance (read-only) · login                                              |
| courier    | login · home (status, offers) · active delivery · earnings                                                                                                            |
| mobile     | login · restaurant list · restaurant · product · cart · addresses · order page                                                                                        |

### Dependencies between applications

Every client depends on `packages/sdk`, which depends on the API's HTTP contract (types in
`packages/types`). The worker and the API share the database and Redis but never call each other.
The API and worker depend on `packages/core`, `packages/config`, `packages/types` (and the API on
`packages/validation`).

## 2. Shared packages

Detail: [`applications/SHARED_PACKAGES.md`](applications/SHARED_PACKAGES.md).

| Package                                     | Purpose                                                                                                                                                                                                            | Lines | Tests                  | State                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `@djafat/types`                             | Shared types: roles, permissions, events, error codes, ports, DTO shapes                                                                                                                                           | 830   | —                      | Completed                                                                                               |
| `@djafat/core`                              | Pure domain logic: money, order/delivery/payment state machines, ledger validation, cart pricing, option validation, restaurant availability, OTP and token-rotation policies, TOTP, idempotency helpers, distance | 3 460 | 181 (100 % statements) | Completed                                                                                               |
| `@djafat/validation`                        | Zod schemas shared by API and clients (phone, UUID, money)                                                                                                                                                         | 130   | 4                      | Completed                                                                                               |
| `@djafat/config`                            | Environment validation and platform constants                                                                                                                                                                      | 320   | 8                      | Needs Improvement ([`SEC-01`](FINDINGS.md#sec-01))                                                      |
| `@djafat/sdk`                               | Typed HTTP client used by all five client apps                                                                                                                                                                     | 1 550 | 10                     | Broken in browsers ([`SDK-01`](FINDINGS.md#sdk-01)); no payment, notification or delivery-code bindings |
| `@djafat/ui`                                | React design system for the web apps (64 source files)                                                                                                                                                             | 2 340 | 56                     | Completed                                                                                               |
| `@djafat/tokens`                            | Design tokens (colours, spacing, type) for web and mobile                                                                                                                                                          | 85    | 5                      | Completed                                                                                               |
| `@djafat/i18n`                              | Translation helper and French strings                                                                                                                                                                              | 105   | 5                      | Partially Completed ([`I18N-01`](FINDINGS.md#i18n-01))                                                  |
| `@djafat/testing`                           | Shared test helpers                                                                                                                                                                                                | 55    | 0                      | Minimal                                                                                                 |
| `@djafat/tsconfig`, `@djafat/eslint-config` | Compiler presets; lint rules including module boundaries                                                                                                                                                           | —     | —                      | Completed                                                                                               |

## 3. Infrastructure assets

| Path                                               | What                                                                                  | State                                                                                                                                                                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infra/docker-compose.yml`                         | Local stack: PostgreSQL/PostGIS, PgBouncer, Redis, MinIO, Mailpit, mock PSP, mock SMS | Broken as written ([`OPS-01`](FINDINGS.md#ops-01)); four of seven services unused                                                                                                                                                                                                   |
| `infra/docker/api.Dockerfile`, `worker.Dockerfile` | Multi-stage images, Node 22, run as non-root                                          | Not built during the audit — Needs Verification                                                                                                                                                                                                                                     |
| `infra/mock-psp`, `infra/mock-sms`                 | Small Node servers                                                                    | Not used by any code                                                                                                                                                                                                                                                                |
| `infra/deploy/`                                    | Placeholder (`.gitkeep`)                                                              | Not Implemented ([`OPS-02`](FINDINGS.md#ops-02))                                                                                                                                                                                                                                    |
| `.github/workflows/ci.yml`, `security.yml`         | Lint, typecheck, test, build; integration; gitleaks; audit                            | All failing ([`CI-01`](FINDINGS.md#ci-01)) _(updated 2026-11-23, sync S-042: plus `windows.yml`; on `ci/cheaper-runs`, a `scope` job skips the heavy jobs on drafts and docs-only pull requests; since 2026-11-23 no job starts — the owner account's Actions minutes are used up)_ |
| `.husky/`                                          | commit-msg (commitlint), pre-commit (lint-staged), pre-push (gitleaks if installed)   | Present; the pre-push scan reads nothing ([`CI-02`](FINDINGS.md#ci-02), added 2026-11-11, sync S-003); the pre-commit ESLint step cannot run ([`CI-03`](FINDINGS.md#ci-03), sync S-004)                                                                                             |

## 4. Completion at a glance

Rough share of each application's intended first-release scope that exists **and works when used
as intended**. A judgement, not a measurement; the evidence is in the application documents.

| App        | Exists | Works as used                                   | Biggest gap                      |
| ---------- | ------ | ----------------------------------------------- | -------------------------------- |
| api        | ~75 %  | ~55 %                                           | payments and failure paths       |
| worker     | ~40 %  | ~40 %                                           | missing jobs                     |
| web        | ~50 %  | 0 % in a browser (≈45 % once `SDK-01` is fixed) | no payment, no history           |
| restaurant | ~70 %  | 0 % in a browser (≈65 % once fixed)             | session expiry, no uploads       |
| admin      | ~40 %  | 0 % in a browser (≈30 % once fixed)             | no write operations that matter  |
| courier    | ~50 %  | 0 % (not buildable)                             | build, background location, push |
| mobile     | ~45 %  | 0 % (not buildable)                             | build, payment                   |

Last updated: 2026-11-11 (evidence collected 2026-11-10)
