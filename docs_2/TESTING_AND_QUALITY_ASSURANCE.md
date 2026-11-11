# Testing and quality assurance

What tests exist, what was actually executed during the audit and with what result, and what is
not covered. Nothing here is reported as passing unless it was run on 2026-11-10.

## 1. Environment used

| Item        | Value                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Code        | `main` @ `d1439c6`, clean working tree                                                                                        |
| Machine     | macOS, Apple Silicon                                                                                                          |
| Node / pnpm | 22.23.4 (the machine's Node 26 is refused by the repository) / 9.15.4                                                         |
| Database    | `postgis/postgis:16-3.5` run as `linux/amd64` under emulation, behind PgBouncer 1.23                                          |
| Redis       | 7 (alpine)                                                                                                                    |
| Browser     | Google Chrome, headless, driven over the DevTools protocol                                                                    |
| Processes   | API and worker started from their production builds (`node dist/main.js`); web apps with `next start`                         |
| Secrets     | Random values generated for the session; never the example placeholders, except in the test of [`SEC-01`](FINDINGS.md#sec-01) |

The scripts used were kept outside the repository and are not versioned. Section 6 describes each
scenario precisely enough to rebuild it; turning them into versioned tests is tasks T-601 and T-602.

## 2. Static checks and unit tests — all executed

| Check                       | Command                                                              | Result                                                        |
| --------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| Formatting                  | `pnpm format:check`                                                  | ✅ pass                                                       |
| Types                       | `pnpm typecheck`                                                     | ✅ 24 tasks                                                   |
| Lint                        | `pnpm lint`                                                          | ✅ 0 warnings                                                 |
| Unit tests                  | `pnpm test`                                                          | ✅ 1 146 passed, 0 failed                                     |
| Build                       | `pnpm build`                                                         | ❌ fails in `@djafat/mobile` ([`MOB-01`](FINDINGS.md#mob-01)) |
| Build without the Expo apps | `turbo run build --filter=!@djafat/mobile --filter=!@djafat/courier` | ✅ 14 tasks                                                   |
| Dependency audit            | `pnpm audit --prod`                                                  | ❌ 8 critical, 64 high ([`DEP-01`](FINDINGS.md#dep-01))       |
| Secret scan                 | gitleaks 8.30.1, all refs                                            | 5 hits, all test fixtures ([`CI-01`](FINDINGS.md#ci-01))      |

### Unit tests by package

| Package                                                        | Files | Tests | What they exercise                                                       |
| -------------------------------------------------------------- | ----- | ----- | ------------------------------------------------------------------------ |
| `apps/api`                                                     | 62    | 811   | Services against in-memory fakes; guards; exception filter; event router |
| `packages/core`                                                | 14    | 181   | Pure domain logic — 100 % statements, 97 % branches                      |
| `packages/ui`                                                  | 11    | 56    | Components with Testing Library                                          |
| `apps/worker`                                                  | 3     | 36    | Processors against a fake `pg` client                                    |
| `apps/restaurant`                                              | 2     | 16    | Formatting and status helpers                                            |
| `packages/sdk`                                                 | 3     | 10    | Request building with a stub `fetch`                                     |
| `apps/courier`                                                 | 2     | 9     | Helpers                                                                  |
| `packages/config`                                              | 1     | 8     | Environment parsing                                                      |
| `apps/mobile`                                                  | 2     | 5     | Helpers                                                                  |
| `packages/tokens`, `i18n`, `validation`                        | 3     | 14    | Small unit tests                                                         |
| `apps/web`, `apps/admin`, `packages/types`, `packages/testing` | 0     | 0     | —                                                                        |

Coverage is measured only for `packages/core`.

## 3. Integration tests — executed, mostly not runnable

| Suite                                 | Command                                 | Result                                                                                                                                       |
| ------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| API, with the environment CI declares | `pnpm --filter @djafat/api test:int`    | ❌ 8 files failed, **93 tests skipped** — configuration error: required secrets absent                                                       |
| API, with secrets supplied            | same                                    | ❌ 8 files failed, **93 tests skipped** — dependency injection receives `undefined` (no decorator metadata under Vitest's default transform) |
| Worker                                | `pnpm --filter @djafat/worker test:int` | ⚠️ 6 passed, 3 failed — fixtures collide with seeded ledger accounts                                                                         |

Run against a dedicated database (`djafat_ci`) and Redis database 1, migrated and seeded for the
purpose. See [`TEST-01`](FINDINGS.md#test-01) and [`TEST-03`](FINDINGS.md#test-03). The 93 API
tests cover identity, catalog, cart, addresses, admin RBAC, realtime and the walking skeleton —
none has run in this configuration.

## 4. Continuous integration — status read from the hosted pipeline

| Workflow / job                       | Head `d1439c6` | Failing step                 |
| ------------------------------------ | -------------- | ---------------------------- |
| CI / lint · typecheck · test · build | ❌             | Build                        |
| CI / integration                     | ❌             | Seed                         |
| Security / gitleaks                  | ❌             | Two test fixtures flagged    |
| Security / pnpm audit                | ❌             | High and critical advisories |

Format, typecheck, lint and unit tests pass inside the failing `check` job.

## 5. Live scenarios — executed against the running system

✅ behaved correctly · ❌ defect found · the finding gives the detail.

### Order journey

| Scenario                                                                           | Result                                        |
| ---------------------------------------------------------------------------------- | --------------------------------------------- |
| Login as each of eight seeded roles through OTP                                    | ✅                                            |
| Catalog list, search, availability, menu, product options, invalid identifiers     | ✅                                            |
| Cart with a required option; quote                                                 | ✅                                            |
| Create order; replay with the same key; second key on the spent cart               | ✅ one order, replay returned, second refused |
| Pay with the test provider → `placed`                                              | ✅                                            |
| Restaurant: board, confirm, ready                                                  | ✅                                            |
| Courier: online, position, offer received with context, accept, pickup             | ✅                                            |
| Delivery code: refused to courier, given to customer; wrong code; right code       | ✅                                            |
| Final state: order delivered, history, ledger balanced, balances 8 800 / 1 000 XAF | ✅                                            |
| Unpaid orders left alone                                                           | ✅ expired by the worker with their payment   |

### Payments and money

| Scenario                                                  | Result                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| Pay with a provider disabled in configuration             | ❌ succeeded — [`PAY-01`](FINDINGS.md#pay-01)                        |
| Pay cash                                                  | ❌ order never placed, then expired — [`PAY-02`](FINDINGS.md#pay-02) |
| Webhook with a bad signature, then the genuine one        | ❌ genuine one ignored — [`PAY-05`](FINDINGS.md#pay-05)              |
| Restaurant rejects a paid order                           | ❌ no refund, payable kept — [`PAY-04`](FINDINGS.md#pay-04)          |
| Refund: partial, excess, remainder                        | ❌ HTTP 500 each time — [`PAY-03`](FINDINGS.md#pay-03)               |
| Order below the restaurant's minimum                      | ❌ accepted — [`ORD-03`](FINDINGS.md#ord-03)                         |
| Customer cancels an order                                 | ❌ no such route — [`ORD-01`](FINDINGS.md#ord-01)                    |
| Direct SQL write to ledger tables as the application role | ❌ accepted — [`SEC-07`](FINDINGS.md#sec-07)                         |

### Access control and abuse

| Scenario                                                              | Result                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------- |
| Eight cross-customer reads and writes                                 | ✅ all refused                                          |
| Five cross-restaurant writes                                          | ✅ all refused                                          |
| Eight role-wall checks                                                | ✅ all as designed                                      |
| Per-phone OTP limit                                                   | ✅                                                      |
| Refresh rotation; reuse inside and after the grace window             | ✅ as designed                                          |
| MFA enrolment, step-up, role grant rules                              | ✅                                                      |
| Restaurant owner creates a restaurant                                 | ⚠️ allowed — [`ORD-04`](FINDINGS.md#ord-04)             |
| Admin blocks a super_admin                                            | ❌ allowed — [`ADM-02`](FINDINGS.md#adm-02)             |
| Finance enrols MFA, refunds, records a settlement                     | ❌ 403, 428, 428 — [`ADM-01`](FINDINGS.md#adm-01)       |
| Ten wrong codes for a victim's number                                 | ❌ victim locked out — [`SEC-03`](FINDINGS.md#sec-03)   |
| Spoofed `X-Forwarded-For`                                             | ❌ trusted — [`SEC-04`](FINDINGS.md#sec-04)             |
| Access token after logout                                             | ⚠️ still accepted — [`SEC-08`](FINDINGS.md#sec-08)      |
| Production-mode boot with example secrets; forged administrator token | ❌ accepted — [`SEC-01`](FINDINGS.md#sec-01)            |
| Production-mode OTP request                                           | ❌ no code delivered — [`AUTH-01`](FINDINGS.md#auth-01) |

### Platform behaviour

| Scenario                                                                      | Result                                                         |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Realtime: handshake auth, five room-join cases, event after a real transition | ✅                                                             |
| Redis stopped: readiness                                                      | ❌ body `not_ready`, HTTP 200 — [`OPS-03`](FINDINGS.md#ops-03) |
| Redis stopped: catalog read                                                   | ✅ 200                                                         |
| Redis stopped and restarted: API and worker recover                           | ✅                                                             |
| Empty JSON body, 2 MB body, unknown payment method code                       | ❌ HTTP 500 — [`API-01`](FINDINGS.md#api-01)                   |
| Caller-supplied request ID                                                    | ❌ ignored — [`OBS-01`](FINDINGS.md#obs-01)                    |
| Security headers, CORS preflight, Swagger in production mode                  | ✅                                                             |

### Browser

| Scenario                                                                | Result                                                   |
| ----------------------------------------------------------------------- | -------------------------------------------------------- |
| Server-rendered catalog pages, phone viewport                           | ✅ render; images broken — [`FE-05`](FINDINGS.md#fe-05)  |
| Login on customer site, restaurant console, admin console               | ❌ no request sent — [`SDK-01`](FINDINGS.md#sdk-01)      |
| With the defect patched in the page: customer journey to the order page | ⚠️ works up to a dead end — [`FE-01`](FINDINGS.md#fe-01) |
| Patched: restaurant console, six screens                                | ✅                                                       |
| Patched: admin console, six screens; customer account refused           | ✅                                                       |

## 6. How to repeat the live scenarios

1. Start PostgreSQL, PgBouncer and Redis (see [`DEPLOYMENT_AND_ENVIRONMENT.md`](DEPLOYMENT_AND_ENVIRONMENT.md) §2), migrate, seed.
2. Export a complete environment with real random secrets; start `apps/api` and `apps/worker`.
3. Log in: `POST /v1/auth/otp/request`, read the code with `redis-cli GET "otp:mock:<phone>"`,
   `POST /v1/auth/otp/verify`. Seeded phones are `+23566000001` (customer) to `+23566000008`
   (super_admin); roles are listed in `apps/api/prisma/seed.ts`.
4. Follow `docs/36-pilot-e2e-scenario.md` §3 for the order journey. Notes: the "Poulet braisé"
   product needs one option from its required group; payments need `methodCode` `mobile_money`
   (test provider) or `cash_on_delivery`; the test restaurant is open 11:00–22:00 N'Djamena time.
5. For each failing scenario above, the finding's "Observed" and "Verify" lines give the exact request.
6. Browser: build the three web apps, `next start`, and drive Chrome. To see behind the login
   before `SDK-01` is fixed, inject `const f = window.fetch.bind(window); window.fetch = (...a) => f(...a);`
   before page scripts.

## 7. Gaps

| Gap                                               | Consequence                                            | Task         |
| ------------------------------------------------- | ------------------------------------------------------ | ------------ |
| Integration suite cannot run                      | No automated HTTP or database check                    | T-108        |
| Unit tests run against imitations of the database | SQL errors reach production (it happened: `PAY-03`)    | T-601        |
| No browser tests                                  | A total front-end outage passed every check (`SDK-01`) | T-602        |
| Web and admin have no tests                       | Same                                                   | T-602        |
| Worker integration tests fail and are not in CI   | Job regressions unseen                                 | T-605        |
| No test on a device                               | Mobile apps unverified                                 | T-210        |
| No load, soak or failure-injection test           | Capacity and recovery unknown                          | T-301, later |
| No accessibility or performance measurement       | Unknown on target devices                              | T-506        |
| No multi-instance test                            | Scaling unproven                                       | T-606        |
| Coverage measured for one package                 | Blind spots invisible                                  | with T-601   |

## 8. Definition of "verified" for this project

A change is verified when the check that would fail without it has been run and has passed, and
the command and result are written in [`tasks/COMPLETED_TASKS.md`](tasks/COMPLETED_TASKS.md).
For anything touching SQL, that check must run against PostgreSQL. For anything a person clicks,
it must run in a browser or on a device. A green unit suite alone is not verification here — the
audit found four critical defects under 1 146 passing tests.

Last updated: 2026-11-11 (evidence collected 2026-11-10)
