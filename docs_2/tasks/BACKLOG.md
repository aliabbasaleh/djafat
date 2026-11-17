# Backlog

Every known task, grouped by roadmap phase. Order of execution and the reasoning are in
[`PRIORITY_TASKS.md`](PRIORITY_TASKS.md). Each task resolves findings in [`../FINDINGS.md`](../FINDINGS.md).

**Statuses:** `Not started` · `In progress` · `Blocked` (see [`BLOCKED_TASKS.md`](BLOCKED_TASKS.md)) ·
`Implemented, unverified` · `Done` (move the entry to [`COMPLETED_TASKS.md`](COMPLETED_TASKS.md) with its verification).

**A task is Done only when its "Done when" is met and its "Test" has been run and recorded.**

62 tasks: Phase 0 (1) · 1 (10) · 2 (17) · 3 (13) · 4 (8) · 5 (6) · 6 (7) _(updated 2026-11-12, sync S-004: T-407 and T-408 added; S-003 added T-313)_.

---

## Phase 0 — Integration line

### T-001 · Choose how `main` and the two remote branches come together

- **Area:** repository · governance · **Priority:** Critical · **Status:** Blocked (owner decision)
- **Why:** [`GOV-01`](../FINDINGS.md#gov-01). Fixes for `SDK-01`, `TEST-01`, `MOB-01`, `FE-02`, part of `FE-01` and `PAY-05` already exist on branches. The two remote branches conflict in 6 files _(sync S-001, 2026-11-11)_.
- **Depends on:** —
- **Done when:** one branch holds all accepted work, CI runs on it, the other branches are merged or closed, and this documentation is re-based on it.
- **Test:** `git branch -r` shows no unmerged work; `PROJECT_STATUS.md` names the branch it describes.

---

## Phase 1 — Critical bugs and blockers

### T-101 · Fix the SDK `fetch` binding

- **Area:** `packages/sdk` · http · **Priority:** Critical · **Status:** Done (2026-11-14, sync S-007; see [`COMPLETED_TASKS.md`](COMPLETED_TASKS.md))
- **Why:** [`SDK-01`](../FINDINGS.md#sdk-01) · **Depends on:** — (exists on branch: prefer merging)
- **Done when:** the three web apps log in from a real browser.
- **Test:** unit test with a `this`-sensitive fetch stub; browser check of `POST /auth/otp/request` → 202.
- **Progress (updated 2026-11-13, sync S-006):** done on pull request #1's branch and verified there
  in a browser: login works in all four web apps. Merge pull request #1, or copy its lines.

### T-102 · Enforce provider enablement when creating a payment

- **Area:** `apps/api` · payments · **Priority:** Critical · **Status:** In progress — fix `a017f48` verified on pull request #4 (0.20.10); done when merged _(sync S-011; corrected in S-008: S-007 had put the refund fix `f0cbb09` here by mistake)_
- **Why:** [`PAY-01`](../FINDINGS.md#pay-01) · **Depends on:** —
- **Done when:** a payment is refused unless an enabled, currently valid configuration covers the order's restaurant/city/amount; `methodCode` comes from the provider; the mock provider is not registered in production.
- **Test:** integration tests for enabled, disabled, out-of-range amount, production mode.

### T-103 · Fix refund arithmetic

- **Area:** `apps/api` · payments · **Priority:** Critical · **Status:** In progress — fix `f0cbb09` verified on `fix/audit-blockers` (version 0.20.6, pull request #4; 0.20.4 until sync S-010); done when merged _(sync S-008)_
- **Why:** [`PAY-03`](../FINDINGS.md#pay-03) · **Depends on:** T-108 for the test
- **Done when:** partial refund, remainder and over-refund behave as specified on PostgreSQL.
- **Test:** integration test of the three cases; ledger groups balance.

### T-104 · Validate secrets at boot

- **Area:** `packages/config` · **Priority:** Critical · **Status:** In progress — fix `aa0d58d` verified on pull request #4 (0.20.8; 0.20.6 until sync S-010). It stops the boot in production only: elsewhere the API starts and lists the problems, because the local guide copies `.env.example` unchanged (`DOC-03`). Decide whether development should refuse too _(sync S-008)_
- **Why:** [`SEC-01`](../FINDINGS.md#sec-01) · **Depends on:** —
- **Done when:** placeholders, short secrets, identical secrets and wrong-length AES keys stop the boot with a readable message.
- **Test:** `env.spec.ts` cases; manual boot with `.env.example` values fails.

### T-105 · Upgrade vulnerable dependencies

- **Area:** whole workspace · **Priority:** Critical · **Status:** In progress
- **Why:** [`DEP-01`](../FINDINGS.md#dep-01) · **Depends on:** T-108, T-602 (to upgrade Fastify/Nest safely); the `next` patch upgrade can go first
- **Done when:** `pnpm audit --prod --audit-level high` exits 0, exceptions listed in `SECURITY_AUDIT.md`.
- **Test:** all checks, integration suite and browser pass after each upgrade step.
- **Note (updated 2026-11-11, sync S-003):** target `next` ≥ 15.5.28, the highest patched version
  among its 17 critical and high advisories in the hosted audit of pull request #2. Pull request
  #1's audit baseline accepts the critical ones in the meantime ([`DEP-01`](../FINDINGS.md#dep-01)).
- **Progress (updated 2026-11-17, sync S-012):** the API step is done on `fix/api-nest11-fastify5`
  (0.20.11): NestJS 11 and Fastify 5; production advisories 73 → 36, none left in the API. Left: the
  Expo tool chain, `postcss` through `next`, `zod` 4.
- **Progress (updated 2026-11-14, sync S-008):** pull request #3 is re-based on `main` (0.20.3,
  `69cd859`) and drops the 38 `next` entries of the audit baseline (115 → 77). Fastify 5 and
  Nest 11 come next, on their own pull request.
- **Progress (updated 2026-11-12, sync S-004):** the `next` step is done on a branch: pull request
  #3 upgrades `next` to 15.5.29, its hosted audit lists no `next` advisory (run 43154080538), and
  the browser comparison with `main` found no regression. Left: Fastify 5 and Nest 11 for the API
  (`@fastify/middie`, `proxy-addr`, `fastify`, `find-my-way`, `@fastify/static`; `js-yaml` and
  `lodash` through `@nestjs/swagger`), `zod` 4, the Expo tool chain (`shell-quote`, `node-forge`,
  `undici`, `image-size` and others), and `postcss`, which `next` 15.5.29 pins at 8.4.31.

### T-106 · Take the Expo apps out of the default build

- **Area:** `turbo.json`, `apps/mobile`, `apps/courier` · **Priority:** High · **Status:** Not started
- **Why:** [`MOB-01`](../FINDINGS.md#mob-01), [`CI-01`](../FINDINGS.md#ci-01). Interim measure so CI reports the other apps; T-210 is the real fix.
- **Depends on:** —
- **Done when:** `pnpm build` passes; a separate, visible job builds the mobile apps and is allowed to fail until T-210.
- **Test:** `pnpm build` exits 0 locally and in CI.
- **Note (updated 2026-11-12, sync S-005):** may no longer be needed: pull request #3 carries the
  real fix (T-210), and its `check` job builds every app.

### T-107 · Verify the webhook signature before recording the event

- **Area:** `apps/api` · payments · **Priority:** High · **Status:** In progress — fix `2319186` verified on pull request #4 (0.20.9): the audit's two requests replayed on PostgreSQL; done when merged _(sync S-010)_
- **Why:** [`PAY-05`](../FINDINGS.md#pay-05) · **Depends on:** — (exists on `fix/payment-reliability-backlog`)
- **Done when:** an invalid-signature request leaves no row that can shadow a genuine event.
- **Test:** integration test replaying the audit's two-request scenario.

### T-108 · Make the API integration suite runnable

- **Area:** `apps/api/test` · **Priority:** High · **Status:** Done (2026-11-14, sync S-007; see [`COMPLETED_TASKS.md`](COMPLETED_TASKS.md))
- **Why:** [`TEST-01`](../FINDINGS.md#test-01) · **Depends on:** — (exists on branches)
- **Done when:** `pnpm --filter @djafat/api test:int` runs all 93 tests locally with one documented command.
- **Test:** the command itself; failures are real failures, not harness errors.

### T-109 · Green CI

- **Area:** `.github/workflows` · **Priority:** High · **Status:** In progress
- **Why:** [`CI-01`](../FINDINGS.md#ci-01) · **Depends on:** T-105 (audit job), T-106, T-108
- **Done when:** both workflows pass on the integration branch; the four test values the weekly scan flags are allowlisted in `.gitleaks.toml` (two fixtures in `env.spec.ts`, two CI keys in `ci.yml` on `fix/payment-reliability-backlog`); branch protection requires green.
- **Test:** workflow runs on the hosted pipeline.
- **Progress (updated 2026-11-11, sync S-003):** the `gitleaks` job gets the token it needs on pull
  requests, on pull request #1 (`6d04e4e`, `397ca6b`) and, with the same lines, on pull request #2
  (`281c323`). The check passes on both; `main` gets the fix when either is merged. Remaining: the
  allowlist, T-105, T-106, T-108, branch protection.
- **Progress (updated 2026-11-12, sync S-004):** pull request #3 carries the same gitleaks lines
  (`480ec14`); its check passes too.
- **Progress (updated 2026-11-12, sync S-005):** on pull request #3 the `check` job passes and
  `integration` reaches the tests (`c616695`, `6cbbad4`). Left there: `TEST-01` and the audit job.

### T-110 · Fix `pnpm infra:up`

- **Area:** `infra/docker-compose.yml` · **Priority:** High · **Status:** Not started
- **Why:** [`OPS-01`](../FINDINGS.md#ops-01) · **Depends on:** —
- **Done when:** the stack starts on a clean amd64 and arm64 machine, and next to a local PostgreSQL.
- **Test:** clean-machine run of `infra:up`, `db:migrate`, `db:seed`.

---

## Phase 2 — Core functionality and incomplete workflows

### T-201 · Payment step in the SDK, web and mobile checkout

- **Area:** `packages/sdk`, `apps/web`, `apps/mobile` · **Priority:** Critical · **Status:** Not started
- **Why:** [`FE-01`](../FINDINGS.md#fe-01) · **Depends on:** T-101, T-102
- **Done when:** a customer chooses a method, pays, sees the result, and can retry a failed payment.
- **Test:** browser test: cart → pay → `placed`.
- **Progress (updated 2026-11-13, sync S-006):** done on pull request #1's branch for cash on
  delivery and verified there in a browser (`placed`); no other method was offered or tried.

### T-202 · Cash on delivery

- **Area:** `apps/api` orders/payments/deliveries, `apps/worker` · **Priority:** Critical · **Status:** Blocked (cash-limit policy)
- **Why:** [`PAY-02`](../FINDINGS.md#pay-02), [`PAY-08`](../FINDINGS.md#pay-08) · **Depends on:** T-102, policy decision
- **Done when:** a cash order is placed immediately, never expired, settled atomically at delivery, with the agreed limits enforced.
- **Test:** integration test of the full cash path; balances never negative.
- **Progress (updated 2026-11-13, sync S-006):** on pull request #1's branch a cash order was
  placed, delivered and settled in a browser run: payment `succeeded`, ledger balanced, restaurant
  and courier credited.

### T-203 · Real OTP delivery

- **Area:** `apps/api` · auth · **Priority:** Critical · **Status:** Blocked (SMS provider)
- **Why:** [`AUTH-01`](../FINDINGS.md#auth-01) · **Depends on:** provider contract
- **Done when:** codes reach real handsets; production refuses the mock.
- **Test:** device test; boot test.

### T-204 · Order cancellation for customers and staff

- **Area:** `apps/api` orders, SDK, web, admin · **Priority:** High · **Status:** Not started
- **Why:** [`ORD-01`](../FINDINGS.md#ord-01) · **Depends on:** T-205
- **Done when:** the transitions already in the state machine are reachable, with the right roles, and visible in the apps.
- **Test:** integration tests per status and role.

### T-205 · Automatic refund and ledger reversal

- **Area:** `apps/api` payments/ledger/orders · **Priority:** High · **Status:** Blocked (refund policy)
- **Why:** [`PAY-04`](../FINDINGS.md#pay-04) · **Depends on:** T-103, policy decision
- **Done when:** a paid order that ends rejected, cancelled or failed is refunded and its accrual reversed, per the policy.
- **Test:** integration tests for each terminal path; ledger balanced, payables zero.

### T-206 · Restaurant confirmation timeout

- **Area:** `apps/worker`, `apps/api` · **Priority:** High · **Status:** Not started
- **Why:** [`ORD-02`](../FINDINGS.md#ord-02) · **Depends on:** T-204, T-205
- **Done when:** an unconfirmed paid order is cancelled and refunded after a configurable delay; customer and operations are told.
- **Test:** worker integration test with a shortened delay.

### T-207 · Token refresh in the SDK and all apps

- **Area:** `packages/sdk`, all five apps · **Priority:** High · **Status:** Not started
- **Why:** [`FE-02`](../FINDINGS.md#fe-02) · **Depends on:** T-101 (exists in part on branch)
- **Done when:** sessions last as long as the refresh token; sockets reconnect with fresh tokens.
- **Test:** 20-minute browser session without redirect; unit test for concurrent 401s.

### T-208 · Delivery code in the customer apps

- **Area:** `packages/sdk`, `apps/web`, `apps/mobile` · **Priority:** High · **Status:** In progress — fix `70cfd3b` verified on pull request #4 (0.20.7; 0.20.5 until sync S-010): the browser test passes on the site; the mobile screen was not run on a device _(sync S-008)_
- **Why:** [`FE-03`](../FINDINGS.md#fe-03) · **Depends on:** T-201
- **Done when:** the code is shown from pickup to delivery.
- **Test:** browser test.
- **Note (updated 2026-11-13, sync S-006):** still missing on pull request #1's branch. The API part
  exists there (`GET /v1/deliveries/:id/code`, HTTP 200 for the order's customer); only the screens
  are missing.

### T-209 · Enforce the minimum order

- **Area:** `apps/api` carts/orders, web, mobile · **Priority:** Medium · **Status:** Not started
- **Why:** [`ORD-03`](../FINDINGS.md#ord-03) · **Depends on:** —
- **Done when:** a below-minimum order is refused with a dedicated code and explained in the cart.
- **Test:** integration test.

### T-210 · Make the Expo apps bundle; validate a device build

- **Area:** `apps/mobile`, `apps/courier` · **Priority:** Critical · **Status:** In progress
- **Why:** [`MOB-01`](../FINDINGS.md#mob-01) · **Depends on:** — (a fix exists on branch, unverified)
- **Done when:** `expo export` succeeds for both and a build runs on an Android device against staging.
- **Test:** CI job; device smoke test of login and one delivery.
- **Progress (updated 2026-11-12, sync S-005):** `expo export` succeeds for both apps in CI on pull
  request #3 (`c616695`, the same lines as pull request #1's `a972a35`). Left: a device build
  against staging.

### T-211 · Courier background location and push

- **Area:** `apps/courier`, `apps/api` notifications · **Priority:** High · **Status:** Not started
- **Why:** [`COUR-01`](../FINDINGS.md#cour-01) · **Depends on:** T-210
- **Done when:** a courier with a locked screen stays dispatchable and is alerted to offers.
- **Test:** device test.

### T-212 · Capture restaurant coordinates

- **Area:** `apps/api` catalog, `apps/admin`, `apps/restaurant` · **Priority:** High · **Status:** Not started
- **Why:** [`DLV-01`](../FINDINGS.md#dlv-01) · **Depends on:** —
- **Done when:** a restaurant cannot be activated without coordinates; they can be set in a UI.
- **Test:** order for an API-created restaurant reaches a courier.

### T-213 · MFA for every role that faces a step-up

- **Area:** `apps/api` auth · **Priority:** High · **Status:** Not started
- **Why:** [`ADM-01`](../FINDINGS.md#adm-01) · **Depends on:** —
- **Done when:** `finance` can enrol, verify, refund and record a settlement.
- **Test:** integration test as finance.

### T-214 · MFA and operational screens in the admin console

- **Area:** `apps/admin` · **Priority:** High · **Status:** Not started
- **Why:** [`ADM-03`](../FINDINGS.md#adm-03) · **Depends on:** T-101, T-213
- **Done when:** enrolment and step-up exist; refunds, order actions, restaurant activation and courier onboarding can be done from the console.
- **Test:** browser test of a role grant and a refund.

### T-215 · Real mobile-money provider and reconciliation

- **Area:** `apps/api` payments, `apps/worker` · **Priority:** High · **Status:** Blocked (provider access)
- **Why:** [`PAY-07`](../FINDINGS.md#pay-07) · **Depends on:** T-102, T-107
- **Done when:** sandbox payments complete, including late webhook, timeout and refund.
- **Test:** sandbox scenario suite.

### T-216 · Payouts

- **Area:** `apps/api` ledger/payments, `apps/admin` · **Priority:** High · **Status:** Blocked (payout policy)
- **Why:** [`PAY-06`](../FINDINGS.md#pay-06) · **Depends on:** T-213, T-215
- **Done when:** available balances can be paid out with approval and correct ledger entries.
- **Test:** integration test; ledger assertion.

### T-217 · Order history, profile and account management

- **Area:** `apps/api` users, `apps/web`, `apps/mobile` · **Priority:** Medium · **Status:** Not started
- **Why:** [`FE-04`](../FINDINGS.md#fe-04), [`AUTH-02`](../FINDINGS.md#auth-02) · **Depends on:** T-101
- **Done when:** history list, profile edit, phone change and account deletion work.
- **Test:** browser and integration tests.

---

## Phase 3 — Security, reliability and data integrity

### T-301 · Durable business reactions and reconcilers

- **Area:** `apps/api` events, `apps/worker` · **Priority:** High · **Status:** Not started
- **Why:** [`ARCH-01`](../FINDINGS.md#arch-01) · **Depends on:** T-108
- **Done when:** payment→order, order→delivery, delivery→order and delivery→cash-payment survive a crash between commit and reaction.
- **Test:** fault-injection integration tests.

### T-302 · Separate production bootstrap from development fixtures

- **Area:** `apps/api/prisma` · **Priority:** High · **Status:** Not started
- **Why:** [`SEC-02`](../FINDINGS.md#sec-02); on the active branch also [`OPS-05`](../FINDINGS.md#ops-05) _(sync S-001)_ · **Depends on:** —
- **Done when:** production can be initialised without test users or the mock provider — the reference data is created in every deployment mode, fixtures only in demo/development; a documented command creates the first super_admin.
- **Test:** bootstrap on an empty database; fixtures refuse `NODE_ENV=production`.

### T-303 · Staff hierarchy guard and step-up on account actions

- **Area:** `apps/api` users/admin · **Priority:** High · **Status:** Not started
- **Why:** [`ADM-02`](../FINDINGS.md#adm-02) · **Depends on:** T-214
- **Done when:** no action on an equal or higher role or on oneself; target sessions revoked.
- **Test:** integration tests.

### T-304 · Trusted proxy configuration

- **Area:** `apps/api/src/main.ts` · **Priority:** Medium · **Status:** Not started
- **Why:** [`SEC-04`](../FINDINGS.md#sec-04) · **Depends on:** T-603 (to know the topology)
- **Test:** spoofed header test.

### T-305 · Throttle OTP verification

- **Area:** `apps/api` auth · **Priority:** Medium · **Status:** Not started
- **Why:** [`SEC-03`](../FINDINGS.md#sec-03) · **Depends on:** —
- **Test:** lock-out scenario no longer blocks the victim.

### T-306 · Global API rate limiting

- **Area:** `apps/api` · **Priority:** Medium · **Status:** Not started
- **Why:** [`SEC-06`](../FINDINGS.md#sec-06) · **Depends on:** T-304
- **Test:** burst test.

### T-307 · Token storage hardening and content security policy

- **Area:** web apps · **Priority:** Medium · **Status:** Not started
- **Why:** [`SEC-05`](../FINDINGS.md#sec-05) · **Depends on:** T-207
- **Test:** tokens not readable from scripts; CSP report-only run clean.

### T-308 · Session liveness and fresh roles on each request

- **Area:** `apps/api` auth · **Priority:** Medium · **Status:** Not started
- **Why:** [`SEC-08`](../FINDINGS.md#sec-08) · **Depends on:** —
- **Test:** logged-out and downgraded tokens refused.

### T-309 · Enforce the ledger rules in the database

- **Area:** migrations, deployment roles · **Priority:** Medium · **Status:** Not started
- **Why:** [`SEC-07`](../FINDINGS.md#sec-07) · **Depends on:** T-603
- **Test:** direct writes fail; unbalanced group rejected at commit.

### T-310 · Correct readiness status and client-error mapping

- **Area:** `apps/api` health, exception filter · **Priority:** Medium · **Status:** Not started
- **Why:** [`OPS-03`](../FINDINGS.md#ops-03), [`API-01`](../FINDINGS.md#api-01) · **Depends on:** —
- **Test:** 503 with a dependency down; 4xx for the three client mistakes.

### T-311 · Delivery support override and atomic pickup

- **Area:** `apps/api` deliveries, admin · **Priority:** Medium · **Status:** Not started
- **Why:** [`DLV-02`](../FINDINGS.md#dlv-02), [`DLV-03`](../FINDINGS.md#dlv-03) · **Depends on:** T-214
- **Test:** locked delivery completed by support; fault-injection on pickup.

### T-312 · Decide and enforce who may create restaurants

- **Area:** `apps/api` catalog · **Priority:** Medium · **Status:** Not started
- **Why:** [`ORD-04`](../FINDINGS.md#ord-04) · **Depends on:** product decision
- **Test:** owner creation refused, or onboarding flow complete.

### T-313 · Make the pre-push secret scan read the pushed commits

- **Area:** `.husky/pre-push` · **Priority:** Low · **Status:** Not started
- **Why:** [`CI-02`](../FINDINGS.md#ci-02) · **Depends on:** — _(added 2026-11-11, sync S-003)_
- **Done when:** with gitleaks installed, pushing a commit that contains a fake token is refused locally.
- **Test:** the throwaway-repository check described in `CI-02`.

---

## Phase 4 — Architecture and code quality

### T-401 · One dispatch implementation

- **Area:** `apps/api` deliveries, `apps/worker` · **Priority:** Medium · **Status:** Not started
- **Why:** [`ARCH-02`](../FINDINGS.md#arch-02) · **Depends on:** T-601
- **Test:** existing dispatch tests against the single implementation.

### T-402 · Missing jobs, retention and a worker heartbeat

- **Area:** `apps/worker` · **Priority:** Medium · **Status:** Not started
- **Why:** [`WRK-01`](../FINDINGS.md#wrk-01) · **Depends on:** T-604 for alerting
- **Test:** retention job shrinks tables; stopped worker alerts.

### T-403 · Split the oversized services

- **Area:** `deliveries.service.ts` (1 474 lines), `orders.service.ts` (1 169), `payments.service.ts` (883), `carts.service.ts` (710) · **Priority:** Low · **Status:** Not started
- **Why:** [`CODE_QUALITY_AUDIT.md`](../CODE_QUALITY_AUDIT.md) §3 · **Depends on:** T-601 (safety net first)
- **Test:** no behaviour change; suites green.

### T-404 · Remove dead configuration

- **Area:** `packages/config`, `queue.constants.ts`, `.env.example` · **Priority:** Low · **Status:** Not started
- **Why:** unused `API_RATE_LIMIT_*`, `SMS_*`, `SENTRY_DSN`, `OTEL_*`, object-storage variables, 7 queue names — each either gets used (T-306, T-203, T-604, T-503) or goes.
- **Test:** typecheck; boot.

### T-405 · Schema hygiene

- **Area:** migrations · **Priority:** Low · **Status:** Not started
- **Why:** [`DB-01`](../FINDINGS.md#db-01) · **Depends on:** —
- **Test:** migration applies to a copy of real data.

### T-406 · Payment idempotency details

- **Area:** `apps/api` payments, idempotency · **Priority:** Low · **Status:** Not started
- **Why:** [`PAY-09`](../FINDINGS.md#pay-09) · **Depends on:** —
- **Test:** unit and integration tests.

### T-407 · Let the pre-commit hook run ESLint

- **Area:** root `package.json`, `.husky/pre-commit` · **Priority:** Low · **Status:** Not started
- **Why:** [`CI-03`](../FINDINGS.md#ci-03) · **Depends on:** — (done on `claude/compassionate-franklin-k23vcj`: `eslint` 9.17.0 in the root `devDependencies`) _(added 2026-11-12, sync S-004)_
- **Done when:** committing a staged `.ts` file runs `eslint --fix` from the hook without extra setup.
- **Test:** on a fresh clone, commit a file with a lint error; the hook refuses it with ESLint's message, not ENOENT.

### T-408 · Make typed routes actually checked

- **Area:** `apps/web` · **Priority:** Low · **Status:** Not started
- **Why:** [`FE-07`](../FINDINGS.md#fe-07) · **Depends on:** — _(added 2026-11-12, sync S-004)_
- **Done when:** a link to a route that does not exist fails `next build`; the existing untyped `href` on the product page is typed.
- **Test:** the probe page described in `FE-07` fails the build.

---

## Phase 5 — UI/UX and performance

### T-501 · Interface polish

- **Area:** web apps, seed · **Priority:** Low · **Why:** [`FE-05`](../FINDINGS.md#fe-05), [`FE-06`](../FINDINGS.md#fe-06) · **Status:** Not started (the `FE-05` part is on `main`, `c804526`, unverified; _sync S-009_)
- **Test:** visual check at 390 px and 1280 px.

### T-502 · Notification inbox and real push

- **Area:** SDK, apps, `apps/api` notifications · **Priority:** Medium · **Why:** [`NOTIF-01`](../FINDINGS.md#notif-01) · **Depends on:** T-210 · **Status:** Not started
- **Test:** device receives an order event.

### T-503 · File upload and image handling

- **Area:** `apps/api` storage, restaurant console · **Priority:** Medium · **Why:** [`STOR-01`](../FINDINGS.md#stor-01) · **Status:** Not started
- **Test:** upload a product photo.

### T-504 · Pricing: zones or distance, taxes, promotions

- **Area:** `apps/api` pricing · **Priority:** Medium · **Why:** [`ORD-05`](../FINDINGS.md#ord-05) · **Depends on:** product decision · **Status:** Not started
- **Test:** pricing unit tests; snapshot unchanged on existing orders.

### T-505 · Extract translations; groundwork for Arabic

- **Area:** all apps, `packages/i18n` · **Priority:** Low · **Why:** [`I18N-01`](../FINDINGS.md#i18n-01) · **Status:** Not started
- **Test:** no inline user-facing string in pages (lint rule).

### T-506 · Accessibility and performance audit

- **Area:** web apps · **Priority:** Low · **Why:** [`QA-01`](../FINDINGS.md#qa-01) · **Status:** Not started
- **Test:** Lighthouse and keyboard/screen-reader pass recorded in `UI_UX_AUDIT.md`.

---

## Phase 6 — Testing, deployment and production readiness

### T-601 · SQL-level integration tests for money and dispatch

- **Area:** `apps/api/test`, `apps/worker/test` · **Priority:** High · **Why:** [`TEST-02`](../FINDINGS.md#test-02) · **Depends on:** T-108 · **Status:** Not started
- **Done when:** payment, refund, accrual, release, dispatch and expiry run against PostgreSQL in CI.

### T-602 · Browser end-to-end tests

- **Area:** new e2e package · **Priority:** High · **Why:** [`TEST-02`](../FINDINGS.md#test-02) · **Depends on:** T-101 · **Status:** Not started
- **Done when:** customer order, restaurant handling and an admin action run in a real browser in CI.

### T-603 · Deployment stack

- **Area:** `infra/` · **Priority:** High · **Why:** [`OPS-02`](../FINDINGS.md#ops-02) · **Status:** Blocked (hosting decision)
- **Done when:** staging deploys from a clean host by following the runbook; backups restore in a drill.

### T-604 · Observability

- **Area:** API, worker, web apps · **Priority:** Medium · **Why:** [`OBS-01`](../FINDINGS.md#obs-01) · **Depends on:** T-603 · **Status:** Not started
- **Done when:** errors, key metrics and alerts (worker down, ledger violation, outbox backlog) exist.

### T-605 · Worker integration tests in CI

- **Area:** `apps/worker/test`, CI · **Priority:** Medium · **Why:** [`TEST-03`](../FINDINGS.md#test-03) · **Status:** Not started
- **Done when:** 9/9 on a seeded database in CI.

### T-606 · Prove realtime with two API instances

- **Area:** `apps/api` realtime · **Priority:** Low · **Why:** [`RT-01`](../FINDINGS.md#rt-01) · **Depends on:** T-603 · **Status:** Not started
- **Done when:** an event relayed on one instance reaches a socket on the other; subscribe is acknowledged.

### T-607 · Documentation cleanup

- **Area:** repository root, `docs/` · **Priority:** Low · **Why:** [`DOC-01`](../FINDINGS.md#doc-01), [`DOC-02`](../FINDINGS.md#doc-02), [`OPS-04`](../FINDINGS.md#ops-04) · **Status:** Not started
- **Done when:** the committed duplicates of the dossier are removed or justified; setup instructions name the Node version; the two `36-*` files are disambiguated.

### T-608 · Working secrets in the local setup _(added 2026-11-14, sync S-008)_

- **Area:** `docs/TRAVAILLER-EN-LOCAL.md`, `.env.example`, a small script · **Priority:** Medium · **Why:** [`DOC-03`](../FINDINGS.md#doc-03) · **Status:** Not started
- **Done when:** following the guide on a fresh clone (macOS, Linux and Windows) gives five real secrets, and an order can be delivered end to end.
- **Test:** the Windows workflow and a fresh local run follow the guide and finish a delivery.

### T-609 · Find the intermittent integration failures _(added 2026-11-17, sync S-011)_

- **Area:** `apps/api/test`, deliveries dispatch · **Priority:** Medium · **Why:** [`TEST-04`](../FINDINGS.md#test-04) · **Status:** Not started
- **Done when:** the two failure modes are explained and fixed, or shown to come from the test environment.
- **Lead _(updated 2026-11-17, sync S-012)_:** port collisions between the test app (IPv6 wildcard) and 127.0.0.1-only listeners such as Prisma's binary query engine; try `app.listen(0, '127.0.0.1')` in the integration bootstrap ([`TEST-04`](../FINDINGS.md#test-04)).
- **Test:** 20 consecutive full runs of the integration suite pass locally.

Last updated: 2026-11-17 (sync S-011)
