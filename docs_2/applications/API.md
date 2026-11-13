# Application: `apps/api`

The backend. One NestJS process serving the REST API under `/v1` and the realtime gateway under
`/rt`. Everything the five client applications do goes through it.

|                 |                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| **State**       | Partially Completed                                                                                             |
| **Stack**       | NestJS 10 on Fastify 4 · Prisma 6 + raw SQL · PostgreSQL 16/PostGIS via PgBouncer · Redis 7 · Socket.IO 4 · Zod |
| **Size**        | 218 source files, ≈31 100 lines (≈13 000 of unit tests); 95 routes; 16 modules                                  |
| **Tests**       | 811 unit tests pass · 93 integration tests cannot run ([`TEST-01`](../FINDINGS.md#test-01))                     |
| **Build / run** | ✅ `nest build`; started from `dist/` and exercised live on 2026-11-10                                          |
| **Port**        | 3001                                                                                                            |

## 1. Structure

```text
apps/api/
├── prisma/           schema.prisma (typed subset) · 29 SQL migrations · seed.ts
├── src/
│   ├── main.ts · bootstrap.ts · app.module.ts
│   ├── common/       config · errors · validation · idempotency · audit · authz · rate-limit
│   │                 · events · redis · health · logging · money · crypto · ports
│   ├── infra/        prisma · outbox · queue names · object-storage stub
│   └── modules/      one folder per domain (below)
└── test/             8 integration specs (not runnable)
```

Architecture and request handling: [`../SYSTEM_ARCHITECTURE.md`](../SYSTEM_ARCHITECTURE.md) §2–§5.
Routes: [`../API_AND_INTEGRATIONS.md`](../API_AND_INTEGRATIONS.md).

## 2. Modules

| Module                       | Responsibility                                                                        | State                                                                     | Document                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `auth`, `users`              | OTP login, sessions, tokens, MFA, guards; accounts and roles                          | Partially Completed — works in development; no real OTP delivery          | [AUTH_AND_IDENTITY](../modules/AUTH_AND_IDENTITY.md)                   |
| `catalog`, `addresses`       | Restaurants, menus, options, hours, availability; customer addresses                  | Completed for reading and editing; no coordinates, no uploads             | [CATALOG](../modules/CATALOG.md)                                       |
| `carts`, `orders`, `pricing` | Cart, quote, order creation and lifecycle, fees and commission                        | Partially Completed — no cancellation, no time-out, minimum order ignored | [CART_AND_ORDERS](../modules/CART_AND_ORDERS.md)                       |
| `payments`, `ledger`         | Providers, payments, webhooks, refunds, settlements; double-entry ledger and balances | Partially Completed with critical defects                                 | [PAYMENTS_AND_LEDGER](../modules/PAYMENTS_AND_LEDGER.md)               |
| `deliveries`, `couriers`     | Dispatch, offers, pickup, proof of delivery; courier status and position              | Completed for the main path; gaps around failure and operations           | [DELIVERY_AND_DISPATCH](../modules/DELIVERY_AND_DISPATCH.md)           |
| `realtime`, `notifications`  | Socket gateway; stored notifications and push port                                    | Realtime Completed (one instance); notifications Partially Completed      | [REALTIME_AND_NOTIFICATIONS](../modules/REALTIME_AND_NOTIFICATIONS.md) |
| `admin`, `platform`          | Back-office routes; settings, feature flags, public configuration                     | Partially Completed                                                       | [ADMIN_AND_PLATFORM](../modules/ADMIN_AND_PLATFORM.md)                 |
| `geo`                        | Maps and geocoding                                                                    | Not Implemented (empty module)                                            | [`DLV-01`](../FINDINGS.md#dlv-01)                                      |

## 3. Cross-cutting behaviour

| Concern                          | Implementation                                                      | State                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Configuration                    | Validated once at boot by `@djafat/config`                          | Needs Improvement — accepts placeholder secrets ([`SEC-01`](../FINDINGS.md#sec-01)); several unused required variables |
| Authentication and authorisation | Decorator-applied guards; no global guard                           | Completed and verified; opt-in design is a standing risk (`SECURITY_AUDIT.md` §3.5)                                    |
| Validation                       | Zod pipes per route                                                 | Completed                                                                                                              |
| Error envelope                   | `AllExceptionsFilter`                                               | Completed; some client errors map to 500 ([`API-01`](../FINDINGS.md#api-01))                                           |
| Idempotency                      | `IdempotencyService` + `idempotency_keys`                           | Completed and verified; no clean-up of stale reservations ([`PAY-09`](../FINDINGS.md#pay-09))                          |
| Audit log                        | Append-only `audit_logs`, written by auth and admin actions         | Completed; payments and order actions are not audited                                                                  |
| Rate limiting                    | Redis fixed window, used for OTP requests and MFA verification only | Partially Completed ([`SEC-06`](../FINDINGS.md#sec-06))                                                                |
| Events                           | Transactional outbox + in-process bus                               | Needs Improvement ([`ARCH-01`](../FINDINGS.md#arch-01))                                                                |
| Logging                          | pino, JSON, secrets redacted, full stack on 500                     | Completed; request-ID propagation broken ([`OBS-01`](../FINDINGS.md#obs-01))                                           |
| Health                           | `/v1/health`, `/v1/ready`                                           | Readiness status code wrong ([`OPS-03`](../FINDINGS.md#ops-03))                                                        |
| Security headers, CORS           | helmet; origin allow-list                                           | Completed and verified                                                                                                 |
| API documentation                | Swagger at `/v1/docs` outside production                            | Present; handlers carry few schema annotations, so the generated document is thin — Needs Improvement                  |
| Object storage                   | Stub                                                                | Not Implemented ([`STOR-01`](../FINDINGS.md#stor-01))                                                                  |

## 4. Verified on 2026-11-10

Boot from the production build against PostgreSQL through PgBouncer and Redis; all eight roles
logging in; the full prepaid order journey; tenant isolation and role walls; token rotation; MFA;
realtime delivery; behaviour with Redis stopped. Full list:
[`../TESTING_AND_QUALITY_ASSURANCE.md`](../TESTING_AND_QUALITY_ASSURANCE.md) §5.

## 5. Open findings affecting this application

**Critical:** `PAY-01` · `PAY-02` · `PAY-03` · `AUTH-01` · `SEC-01` · `DEP-01`
**High:** `PAY-04` · `PAY-05` · `PAY-06` · `PAY-07` · `ARCH-01` · `ORD-01` · `ORD-02` · `TEST-01` ·
`TEST-02` · `SEC-02` · `ADM-01` · `ADM-02` · `DLV-01`
**Medium:** `SEC-03` · `SEC-04` · `SEC-06` · `SEC-07` · `SEC-08` · `ORD-03` · `ORD-04` · `ORD-05` ·
`DLV-02` · `DLV-03` · `OPS-03` · `ARCH-02` · `AUTH-02` · `NOTIF-01` · `STOR-01` · `OBS-01` ·
`PAY-08` · `API-01`
**Low:** `DB-01` · `RT-01` · `PAY-09`

All in [`../FINDINGS.md`](../FINDINGS.md).

## 6. Outstanding tasks

Phase 1: T-102, T-103, T-104, T-105, T-107, T-108. Phase 2: T-202 → T-206, T-209, T-212, T-213,
T-215, T-216, T-217. Phase 3: T-301 → T-312. Phase 4: T-401, T-403 → T-406.
See [`../tasks/BACKLOG.md`](../tasks/BACKLOG.md).

Last updated: 2026-11-11 (evidence collected 2026-11-10)
