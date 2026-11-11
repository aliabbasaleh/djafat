# Findings register

Every fact the audit established about DJAFAT, one entry per finding. Other documents refer to
these IDs instead of repeating the detail.

- **Audited:** branch `main` at commit `d1439c6` (2026-10-14), on 2026-11-10.
- **How:** code reading of the whole repository, then execution — install, format, typecheck, lint,
  unit tests, builds, 29 migrations and seed on PostgreSQL 16 + PostGIS, API and worker booted from
  their production builds, HTTP scenarios with `curl`, the three web apps in headless Chrome, and
  the hosted CI logs. Environment details: [`TESTING_AND_QUALITY_ASSURANCE.md`](TESTING_AND_QUALITY_ASSURANCE.md) §1.
- **Vocabulary:** classification and evidence levels are defined in [`README.md`](README.md).
- **Counts:** 9 Critical · 22 High · 22 Medium · 10 Low = 63 open findings.
- **Last synced:** S-001, 2026-11-11 — four new commits on `origin/claude/compassionate-franklin-k23vcj`
  reviewed; `main` unchanged since the audit. Pull-by-pull history: [`history/SYNC_LOG.md`](history/SYNC_LOG.md).

An entry is never deleted. When fixed, set `Status: Resolved`, add the commit and how the fix was
verified.

## Index

| ID                    | Title                                                                                    | Class               | Priority | Evidence |
| --------------------- | ---------------------------------------------------------------------------------------- | ------------------- | -------- | -------- |
| [SDK-01](#sdk-01)     | Browser calls to the API fail in every web app                                           | Broken              | Critical | LIVE     |
| [PAY-01](#pay-01)     | A disabled payment provider can still be charged — free orders                           | Broken              | Critical | LIVE     |
| [PAY-02](#pay-02)     | Cash-on-delivery orders are never placed; they expire                                    | Broken              | Critical | LIVE     |
| [PAY-03](#pay-03)     | Every refund request crashes                                                             | Broken              | Critical | LIVE     |
| [FE-01](#fe-01)       | No customer screen or SDK call can pay for an order                                      | Not Implemented     | Critical | LIVE     |
| [AUTH-01](#auth-01)   | No real OTP delivery — nobody can log in to a production deployment                      | Not Implemented     | Critical | LIVE     |
| [SEC-01](#sec-01)     | The API boots with the published placeholder secrets                                     | Broken              | Critical | LIVE     |
| [DEP-01](#dep-01)     | 8 critical and 64 high vulnerabilities in production dependencies                        | Needs Improvement   | Critical | RUN      |
| [MOB-01](#mob-01)     | Neither Expo app can be bundled; root build and CI fail                                  | Broken              | Critical | RUN      |
| [PAY-04](#pay-04)     | Paid orders that are rejected, cancelled or failed are never refunded or reversed        | Not Implemented     | High     | LIVE     |
| [PAY-05](#pay-05)     | An unauthenticated request can make a genuine payment webhook be ignored                 | Broken              | High     | LIVE     |
| [PAY-06](#pay-06)     | No payout flow: restaurant and courier balances can never be paid out                    | Not Implemented     | High     | LIVE     |
| [PAY-07](#pay-07)     | No real payment provider (Airtel / Moov)                                                 | Not Implemented     | High     | CODE     |
| [ARCH-01](#arch-01)   | Cross-module business reactions are fire-and-forget, in-process                          | Needs Improvement   | High     | CODE     |
| [ORD-01](#ord-01)     | Nobody can cancel an order                                                               | Not Implemented     | High     | LIVE     |
| [ORD-02](#ord-02)     | A paid order the restaurant ignores stays `placed` forever                               | Not Implemented     | High     | LIVE     |
| [FE-02](#fe-02)       | No token refresh anywhere: every session ends after 15 minutes                           | Partially Completed | High     | CODE     |
| [FE-03](#fe-03)       | The customer cannot see the delivery code in any app                                     | Not Implemented     | High     | CODE     |
| [TEST-01](#test-01)   | The API integration suite (93 tests) cannot run                                          | Broken              | High     | RUN      |
| [TEST-02](#test-02)   | No automated test runs the application's SQL or the UI                                   | Needs Improvement   | High     | RUN      |
| [CI-01](#ci-01)       | Every CI workflow on `main` is red                                                       | Broken              | High     | RUN      |
| [OPS-01](#ops-01)     | `pnpm infra:up` fails on a fresh machine and on ARM64                                    | Broken              | High     | RUN      |
| [OPS-02](#ops-02)     | No deployment path, supervision, backups or monitoring                                   | Not Implemented     | High     | CODE     |
| [SEC-02](#sec-02)     | The only seed creates a super_admin on a known phone number                              | Needs Improvement   | High     | LIVE     |
| [ADM-01](#adm-01)     | The `finance` role cannot perform refunds or settlements                                 | Broken              | High     | LIVE     |
| [ADM-02](#adm-02)     | An `admin` can block a `super_admin`                                                     | Needs Improvement   | High     | LIVE     |
| [ADM-03](#adm-03)     | Role management in the admin console cannot work: no MFA screen                          | Broken              | High     | CODE     |
| [GOV-01](#gov-01)     | `main` is 41 commits behind the active branch; a fix branch is orphaned                  | Needs Improvement   | High     | RUN      |
| [DLV-01](#dlv-01)     | Restaurants created through the API can never be dispatched to                           | Not Implemented     | High     | LIVE     |
| [COUR-01](#cour-01)   | Courier app tracks location only in the foreground; no push                              | Partially Completed | High     | CODE     |
| [OPS-05](#ops-05)     | On the active branch, a live server starts without roles, permissions or ledger accounts | Broken              | High     | BRANCH   |
| [SEC-03](#sec-03)     | Anyone can lock any phone number out of login                                            | Needs Improvement   | Medium   | LIVE     |
| [SEC-04](#sec-04)     | Client-supplied `X-Forwarded-For` is trusted                                             | Needs Improvement   | Medium   | LIVE     |
| [SEC-05](#sec-05)     | Web apps keep access and refresh tokens in `localStorage`                                | Needs Improvement   | Medium   | CODE     |
| [SEC-06](#sec-06)     | No general API rate limiting                                                             | Not Implemented     | Medium   | CODE     |
| [SEC-07](#sec-07)     | The "single ledger writer" rule is not enforced by the database                          | Needs Improvement   | Medium   | LIVE     |
| [SEC-08](#sec-08)     | Access tokens survive logout and role revocation for up to 15 minutes                    | Needs Improvement   | Medium   | LIVE     |
| [ORD-03](#ord-03)     | Minimum order amount is displayed but not enforced                                       | Broken              | Medium   | LIVE     |
| [ORD-04](#ord-04)     | A restaurant owner can create additional restaurants                                     | Needs Verification  | Medium   | LIVE     |
| [ORD-05](#ord-05)     | Delivery fee is one flat global amount; no zones, taxes or promotions                    | Partially Completed | Medium   | LIVE     |
| [DLV-02](#dlv-02)     | No way to complete a delivery once the code is locked or expired                         | Not Implemented     | Medium   | CODE     |
| [DLV-03](#dlv-03)     | Pickup is not atomic; a retry can leave a delivery without a code                        | Needs Improvement   | Medium   | CODE     |
| [OPS-03](#ops-03)     | Readiness probe answers HTTP 200 when not ready                                          | Broken              | Medium   | LIVE     |
| [WRK-01](#wrk-01)     | Missing background jobs, no cleanup, no worker health signal                             | Not Implemented     | Medium   | CODE     |
| [TEST-03](#test-03)   | Worker integration tests fail on a seeded database and are not in CI                     | Broken              | Medium   | RUN      |
| [ARCH-02](#arch-02)   | Dispatch logic exists twice (API and worker)                                             | Needs Improvement   | Medium   | CODE     |
| [AUTH-02](#auth-02)   | No profile update, phone change or account deletion                                      | Not Implemented     | Medium   | CODE     |
| [NOTIF-01](#notif-01) | Notifications are stored but never shown or pushed                                       | Partially Completed | Medium   | LIVE     |
| [STOR-01](#stor-01)   | No file upload: object storage is a stub                                                 | Not Implemented     | Medium   | CODE     |
| [OBS-01](#obs-01)     | No error tracking, metrics or tracing; request IDs are not propagated                    | Not Implemented     | Medium   | LIVE     |
| [FE-04](#fe-04)       | Customer web has no order history or profile page                                        | Not Implemented     | Medium   | LIVE     |
| [PAY-08](#pay-08)     | Cash settlement posts ledger groups in the wrong order                                   | Needs Verification  | Medium   | CODE     |
| [API-01](#api-01)     | Several client mistakes are answered with HTTP 500                                       | Needs Improvement   | Medium   | LIVE     |
| [FE-05](#fe-05)       | Seeded restaurant and product images do not render                                       | Broken              | Low      | LIVE     |
| [FE-06](#fe-06)       | Interface polish gaps                                                                    | Needs Improvement   | Low      | LIVE     |
| [DB-01](#db-01)       | Schema hygiene: retention, indexes, a missing primary key, a reused column               | Needs Improvement   | Low      | LIVE     |
| [DOC-01](#doc-01)     | Entry-point documents were out of date                                                   | Needs Improvement   | Low      | RUN      |
| [DOC-02](#doc-02)     | Earlier "GO" verdicts covered the API only                                               | Needs Improvement   | Low      | LIVE     |
| [OPS-04](#ops-04)     | Install is refused on the current Node release                                           | Needs Improvement   | Low      | RUN      |
| [RT-01](#rt-01)       | Realtime: multi-instance fan-out unproven; refused joins are silent                      | Needs Verification  | Low      | LIVE     |
| [I18N-01](#i18n-01)   | Text is hard-coded in French; Arabic not started                                         | Partially Completed | Low      | CODE     |
| [QA-01](#qa-01)       | Accessibility and performance were not measured                                          | Needs Verification  | Low      | —        |
| [PAY-09](#pay-09)     | Payment idempotency scope is global; attempt counter never moves                         | Needs Improvement   | Low      | CODE     |

---

## Critical

### SDK-01

**Browser calls to the API fail in every web app** · Broken · Critical · LIVE · Status: Open

- **Where:** `packages/sdk` → HTTP client. `packages/sdk/src/http.ts`, `ApiHttp` constructor and `request()`.
  Affects `apps/web`, `apps/admin`, `apps/restaurant`.
- **Observed:** In headless Chrome, submitting the login form of each of the three apps shows
  "Impossible d'envoyer le code…" and **zero requests reach the API**. Evaluating the same pattern in
  the page returns `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`.
- **Cause:** the constructor stores `globalThis.fetch` in `this.doFetch` and later calls
  `this.doFetch(url, …)`. A browser's `fetch` must be called with `window` (or nothing) as `this`.
  Node does not care, so server-side rendering, unit tests and `curl` never show it. The login pages
  catch every error and print the same message, which hides it further.
- **Why it matters:** nobody can log in, add to cart, or operate the restaurant or admin console from
  a browser. Only server-rendered catalog pages work.
- **Fix:** `this.doFetch = (input, init) => impl(input, init);`. Add a regression test that calls the
  client with a `this`-sensitive fetch stub.
- **Depends on:** nothing. Already fixed on the unmerged branch (see `UNMERGED_BRANCHES.md`).
- **Verify:** in a real browser, log in on `:3000/connexion`; the network panel must show
  `POST /v1/auth/otp/request` → 202.

### PAY-01

**A disabled payment provider can still be charged — free orders** · Broken · Critical · LIVE · Status: Open

- **Where:** `apps/api` → payments. `payments.service.ts` `doCreatePayment` (L72–155);
  `payment-provider.registry.ts`; `providers/mock/mock-payment.provider.ts`. Table `payment_provider_configs`.
- **Observed:** with `mock` disabled in `payment_provider_configs` (discovery returned an empty
  list), `POST /v1/payments {"providerCode":"mock"}` returned `succeeded` and the order moved to `placed`.
- **Cause:** `doCreatePayment` checks only that a provider **class** is registered
  (`registry.has`) and supports the currency. The enablement rows are consulted by the discovery
  endpoint only. The mock provider is always registered, lets the client choose the outcome through
  `metadata.mockOutcome`, and signs webhooks with a secret written in the source.
- **Why it matters:** any logged-in customer can obtain any order without paying, in any
  environment, whatever the configuration says. Restaurant and courier balances are credited for it.
- **Fix:** in `doCreatePayment`, resolve the enabled configuration for the order's context
  (restaurant → city → country, validity window, amount bounds) and refuse with
  `PAYMENT_METHOD_UNAVAILABLE` otherwise; derive `methodCode` from the provider instead of trusting
  the client. Do not register `MockPaymentProvider` when `NODE_ENV=production`.
- **Depends on:** nothing.
- **Verify:** disable the row, repeat the call → 409 and the order stays `awaiting_payment`.
  Integration test for both the enabled and disabled case.

### PAY-02

**Cash-on-delivery orders are never placed; they expire** · Broken · Critical · LIVE · Status: Open

- **Where:** `apps/api` → orders, payments; `apps/worker` → order-expiry. `orders.service.ts`
  `doCreateOrder` (always `status: 'awaiting_payment'`, L287); `cash-payment.provider.ts`;
  `order-expiry.processor.ts`; `packages/core/src/order/state-machine.ts` (`draft → placed`,
  trigger `create_order_cod`, unused).
- **Observed:** a cash payment is created `pending`; the order stays `awaiting_payment` and does not
  appear on the restaurant board. When the TTL elapsed, the worker set the order and its payment to `expired`.
- **Cause:** only `payment.succeeded` moves an order to `placed`, and a cash payment succeeds at
  delivery — which cannot happen for an order the kitchen never sees. The state machine models the
  cash path; nothing calls it.
- **Why it matters:** cash is the dominant means of payment in the launch market. With `PAY-07`
  (no mobile-money provider) there is no legitimate way to pay at all.
- **Fix:** when the chosen method is cash, place the order at payment creation (or at order creation
  with a declared method), keep the payment `pending` until delivery, and exclude such orders from
  expiry. Decide the fraud limits first (maximum cash amount, courier cash float — `platform_settings`
  already has `courier_cash_float_cap_minor`).
- **Depends on:** a product decision on cash limits. See `PAY-08` before enabling.
- **Verify:** cash order appears on the board as `placed`; delivered → payment `succeeded`,
  ledger balanced, wallets credited; never expired by the job.

### PAY-03

**Every refund request crashes** · Broken · Critical · LIVE · Status: Open

- **Where:** `apps/api` → payments. `payments.service.ts` `doRefundPayment` (L554–558) and
  `finalizeRefundSuccess` (L690–695). Table `refunds`.
- **Observed:** `POST /v1/payments/:id/refund` by a stepped-up super_admin returned HTTP 500 three
  times. Server log: `TypeError: Cannot mix BigInt and other types`. No `refunds` row was created.
- **Cause:** `SELECT COALESCE(SUM(amount_minor), 0) AS total` returns PostgreSQL `numeric`, which
  Prisma maps to a `Decimal`, not a `bigint`; `payment.amountMinor - total` then throws. The unit
  tests pass because the hand-written Prisma fake returns a `bigint`. `ledger-read.service.ts`
  avoids this by casting `::bigint`; these two queries do not.
- **Why it matters:** there is no working way to give money back to a customer (see also `PAY-04`).
- **Fix:** cast both sums to `::bigint`. Add an integration test that runs a partial refund, an
  over-refund (409) and the remainder against real PostgreSQL.
- **Depends on:** `TEST-01` for the test to run.
- **Verify:** partial refund → `partially_refunded`; remainder → `refunded`; excess → 409
  `REFUND_EXCEEDS_PAYMENT`; ledger groups balance.

### FE-01

**No customer screen or SDK call can pay for an order** · Not Implemented · Critical · LIVE · Status: Open

- **Where:** `apps/web` (`src/app/panier/page.tsx` L125–128, `src/app/commandes/[id]/page.tsx`),
  `apps/mobile` (`app/(app)/cart.tsx`, `orders/[id].tsx`), `packages/sdk` (no `payments` binding).
- **Observed:** in Chrome (with `SDK-01` patched in the page), "Commander" creates the order and
  opens the order page, which shows "En attente de paiement" and a single button, "Continuer mes
  achats". The order then expires after 15 minutes. A search of web, mobile and SDK sources finds no
  call to `/payments`.
- **Why it matters:** the customer journey cannot be completed through the product. The earlier
  pilot completed it by calling the API directly.
- **Fix:** add `payments` to the SDK (`listMethods`, `create`, `get`, `cancel`); add a payment step
  to web and mobile checkout that lists `GET /config/payment-methods` and creates the payment; show
  payment state and a retry on the order page.
- **Depends on:** `PAY-01`, `PAY-02`; `SDK-01`.
- **Verify:** browser test: cart → pay → order shows `placed`.

### AUTH-01

**No real OTP delivery — nobody can log in to a production deployment** · Not Implemented · Critical · LIVE · Status: Open

- **Where:** `apps/api` → auth. `auth.module.ts` (binds `OTP_DELIVERY_PORT` to the mock);
  `providers/mock-otp-delivery.provider.ts`.
- **Observed:** on an instance started with `NODE_ENV=production`, `POST /v1/auth/otp/request`
  answered 202 `{"status":"sent"}` and no code existed anywhere. The mock writes the code to Redis
  only outside production; nothing sends an SMS. `SMS_PROVIDER` and `SMS_MOCK_URL` are parsed and unused.
- **Why it matters:** login is OTP-only. A deployment of `main` has no way in.
- **Fix:** implement an `OtpDeliveryPort` adapter for a real gateway, selected by `SMS_PROVIDER`;
  refuse to boot in production when the mock is selected.
- **Depends on:** choosing and contracting an SMS provider (external).
- **Verify:** a real handset receives the code; boot fails in production with `SMS_PROVIDER=mock`.

### SEC-01

**The API boots with the published placeholder secrets** · Broken · Critical · LIVE · Status: Open

- **Where:** `packages/config/src/env.ts` (`AuthSchema`, `OtpSchema`: secrets validated as
  non-empty strings only); `.env.example`.
- **Observed:** an instance started in production mode with the literal placeholder values from
  `.env.example` booted normally. A token signed offline with that public placeholder, claiming
  `super_admin`, was accepted: `GET /v1/admin/users` → 200 with user data. The same token was
  rejected (401) by the correctly configured instance.
- **Why it matters:** one forgotten substitution gives full administrative access to anyone who can
  read the repository. The two AES keys are only checked on first use, so a bad key surfaces later as
  a runtime error.
- **Fix:** in `@djafat/config`: minimum length for the three HMAC secrets, reject any value
  containing `REPLACE_ME`/`CHANGE_ME`, require the three to differ, and validate both AES keys decode
  to exactly 32 bytes — at boot. Fail hard in production.
- **Depends on:** nothing.
- **Verify:** unit tests in `env.spec.ts`; booting with `.env.example` values exits with a readable error.

### DEP-01

**8 critical and 64 high vulnerabilities in production dependencies** · Needs Improvement · Critical · RUN · Status: Open

- **Where:** `pnpm-lock.yaml`; `apps/web|admin|restaurant` (`next@15.1.3`), `apps/api`
  (`fastify@4.29.0`, `@nestjs/platform-fastify@10.4.15`, `@fastify/static@7.0.4`), Expo tool chain.
- **Observed:** `pnpm audit --prod` on 2026-11-10: 142 advisories — 8 critical, 64 high,
  54 moderate, 16 low. Critical ones include remote code execution and middleware authorization
  bypass in `next`, an authentication bypass in `@fastify/middie`, and IP spoofing in `proxy-addr`
  (relevant to `SEC-04`). `zod@3.24.1` and `prisma@6.2.1` are also behind.
- **Why it matters:** the three web apps would be exposed to published exploits on day one. The
  security workflow has been failing on this for weeks without action (`CI-01`).
- **Fix:** upgrade `next` to the patched line named by the audit, then Fastify/Nest (a major
  upgrade — plan and test it), then the rest; re-run the audit until no high or critical remains in
  production dependencies. Record accepted exceptions explicitly.
- **Depends on:** `TEST-01`, `TEST-02` to upgrade the API safely.
- **Verify:** `pnpm audit --prod --audit-level high` exits 0; all checks and the browser pass succeed.
- **Sync S-001 note (2026-11-11), branch only:** commit `804176f` forces `node-forge` to `^1.4.3`,
  clearing its advisories. `next` 15.1.3, `fastify` 4.29.0, `@nestjs/platform-fastify` 10.4.15,
  `zod` 3.24.1 and `prisma` 6.2.1 are unchanged there, and the branch tolerates the remaining
  advisories through a baseline file (115 by its own count). Open (partly addressed) on the branch.

### MOB-01

**Neither Expo app can be bundled; root build and CI fail** · Broken · Critical · RUN · Status: Open

- **Where:** `apps/mobile`, `apps/courier` (`package.json` `build` = `expo export`,
  `metro.config.js`); `.npmrc` (`node-linker=isolated`).
- **Observed:** `expo export` fails in both apps: `Unable to resolve module
regenerator-runtime/runtime` from `react-native`. Because `turbo run build` includes them,
  `pnpm build` exits 1 and aborts the web builds; this is the failing step of the CI `check` job.
  Built separately, API, worker, web, admin and restaurant all build.
- **Why it matters:** the courier app is the only courier interface, so no delivery can be carried
  out through the product. The customer mobile app is equally unavailable.
- **Fix:** make Metro resolve through pnpm's layout (monorepo-aware `metro.config.js` with
  `watchFolders`/`nodeModulesPaths`, or hoist the React Native tree for these two packages). Until
  then, take the two apps out of the default `build` task so CI reports the rest. Validate the real
  path (`eas build`) on a device.
- **Depends on:** nothing. A fix exists on the unmerged branch (not verified here).
- **Verify:** `expo export` succeeds for both; the app runs on an Android device against a staging API.

---

## High

### PAY-04

**Paid orders that are rejected, cancelled or failed are never refunded or reversed** · Not Implemented · High · LIVE · Status: Open

- **Where:** orders, payments, deliveries, ledger. `orders.service.ts` `rejectOrder`,
  `onDeliveryCancelled`, `onDeliveryFailed`; `payments.service.ts` (refund is admin-only and manual);
  `refund-entries.ts`.
- **Observed:** a paid order rejected by the restaurant ended as order `rejected`, payment
  `succeeded`, zero refunds, and the rejecting restaurant's pending balance still credited with its
  share. Nothing in the code refunds or reverses on any terminal failure.
- **Why it matters:** the customer's money is kept for food that will not arrive. The ledger keeps
  recognising commission and restaurant/courier payables for an order that did not happen. A manual
  refund (once `PAY-03` is fixed) debits DJAFAT's revenue only and leaves the payables in place.
- **Fix:** define the policy (who bears what, per failure point), then post a reversing ledger group
  and a provider refund automatically when a paid order reaches `rejected`/`cancelled`/failed-before-pickup.
- **Depends on:** `PAY-03`, `ARCH-01`; a business decision.
- **Verify:** reject a paid order → refund created, payables back to zero, ledger balanced.

### PAY-05

**An unauthenticated request can make a genuine payment webhook be ignored** · Broken · High · LIVE · Status: Open

- **Where:** `payments.service.ts` `handleWebhook` (insert at L179–184, signature check at L191–201). Table `webhook_events`.
- **Observed:** a request with an invalid signature and event id `X` got 401 but its row was
  stored. The genuine, correctly signed webhook with the same id then answered
  `{"status":"duplicate"}` and the payment stayed `pending`.
- **Why it matters:** an attacker who can guess or observe event ids blocks payment confirmation,
  and anyone can fill the table. With a real provider this is a direct revenue and support problem.
- **Fix:** verify the signature first; store nothing for an unauthenticated request (or store it
  under a key that cannot collide). Already implemented on `fix/payment-reliability-backlog`.
- **Depends on:** nothing.
- **Verify:** repeat the two requests; the second must process the payment.

### PAY-06

**No payout flow: restaurant and courier balances can never be paid out** · Not Implemented · High · LIVE · Status: Open

- **Where:** ledger, payments. `settlements.service.ts` exists; there is no payout table, endpoint or job
  (`QUEUES.payouts` is declared and unused).
- **Observed:** after a delivered order the restaurant shows 8 800 XAF available and the courier
  1 000 XAF; `DJAFAT_BANK` stays 0. No endpoint moves an available balance out.
- **Why it matters:** partners cannot be paid through the system; reconciliation would be manual and off-ledger.
- **Fix:** design payouts (schedule, method, approval, ledger entries), then implement request →
  approval → execution → ledger posting.
- **Depends on:** `PAY-07`, `ADM-01`.
- **Verify:** payout reduces `available`, credits bank/provider clearing, balances.

### PAY-07

**No real payment provider (Airtel / Moov)** · Not Implemented · High · CODE · Status: Blocked (external)

- **Where:** `payments.module.ts` registers `cash` and `mock` only; seed rows `airtel_money`, `moov_money` are inactive.
- **Why it matters:** together with `PAY-02`, there is no legitimate payment method.
- **Fix:** obtain provider access, implement a `PaymentProvider` adapter, a reconciliation job for
  pending payments (`QUEUES.paymentsReconcile` is unused), and asynchronous refund handling.
- **Depends on:** provider contract and sandbox (condition H1 in `docs/16`).
- **Verify:** sandbox payment end to end, including a late webhook and a timeout.

### ARCH-01

**Cross-module business reactions are fire-and-forget, in-process** · Needs Improvement · High · CODE · Status: Open

- **Where:** `orders.service.ts` `@OnEvent('payment.succeeded' | 'delivery.*')`;
  `deliveries.service.ts` `@OnEvent('order.ready')`; `payments.service.ts` `@OnEvent('delivery.delivered')`;
  emitters call `EventEmitter2.emit` after commit.
- **Observed (code):** the durable chain outbox → worker → Redis stream → `DomainEventsConsumer`
  re-emits only `domain-event.relayed`, consumed by realtime and notifications. The reactions that
  change business state use the in-process bus, which is at-most-once and not retried.
  `markPlacedFromPayment` also writes its three rows without a transaction.
- **Why it matters:** a crash, deploy or handler error at the wrong moment leaves a payment
  succeeded with its order unplaced (which the expiry job then expires), an order `ready` with no
  delivery, or a delivery done with its order open. Nothing detects or repairs these.
- **Fix:** drive the reactions from the durable stream (idempotent handlers keyed by outbox id), or
  add reconciliation jobs for each pair. Make each handler one transaction.
- **Depends on:** nothing; larger change — plan it.
- **Verify:** kill the API between commit and reaction in a test; state converges after restart.
  Not reproduced live (timing-dependent); established by reading every emitter and listener.

### ORD-01

**Nobody can cancel an order** · Not Implemented · High · LIVE · Status: Open

- **Where:** `orders.controller.ts` (routes: create, list, mine, get, confirm, ready, reject).
  The state machine defines `customer_cancel`, `cancel_before_preparing` and `admin_force_cancel`.
- **Observed:** `POST /v1/orders/:id/cancel` → 404. A customer can only cancel the _delivery_, which
  exists from `ready` onwards; an admin has no order action at all.
- **Fix:** add customer cancel (before preparation) and admin force-cancel, both wired to `PAY-04`.
- **Depends on:** `PAY-04`.
- **Verify:** cancel from each allowed status; refused from the others; refund issued when paid.

### ORD-02

**A paid order the restaurant ignores stays `placed` forever** · Not Implemented · High · LIVE · Status: Open

- **Where:** worker (no job); `order-expiry.processor.ts` handles `awaiting_payment` only.
- **Observed:** a paid order sat in "Nouvelles" for 4 h 42 during the audit with no escalation.
  Listed as accepted debt in `docs/36` §6.3.
- **Fix:** confirmation deadline in `platform_settings`; a job that cancels and refunds, and
  notifies the customer and operations.
- **Depends on:** `PAY-04`, `ORD-01`.
- **Verify:** unconfirmed paid order is cancelled and refunded after the deadline.

### FE-02

**No token refresh anywhere: every session ends after 15 minutes** · Partially Completed · High · CODE · Status: Open

- **Where:** `apps/*/src/lib/auth-storage.ts`, `apps/courier|mobile/lib/auth-*`; `packages/sdk/src/http.ts`.
- **Observed (code):** all five apps store the refresh token and never use it; on 401 the pages
  redirect to login. Access tokens last 900 s. The realtime gateway also disconnects sockets whose
  token expired.
- **Why it matters:** a kitchen board or a courier on the road is logged out four times an hour.
- **Fix:** refresh-on-401 with a single in-flight refresh in the SDK, reconnecting the socket with
  the new token. An implementation exists on the unmerged branch.
- **Depends on:** `SDK-01`.
- **Verify:** keep a board open for 20 minutes; no redirect, events keep arriving.

### FE-03

**The customer cannot see the delivery code in any app** · Not Implemented · High · CODE · Status: Open

- **Where:** `GET /v1/deliveries/:id/code` exists and works (LIVE); no SDK binding, no screen in web or mobile.
- **Why it matters:** the courier must enter the code to complete a delivery. Without it the only exit is "failed".
- **Fix:** SDK binding and a prominent code on the order page once the order is picked up.
- **Depends on:** `FE-01`.
- **Verify:** browser test shows the code after pickup; it disappears after delivery.

### TEST-01

**The API integration suite (93 tests) cannot run** · Broken · High · RUN · Status: Open

- **Where:** `apps/api/test/*.int.spec.ts`, `apps/api/test/vitest.int.config.ts`, `.github/workflows/ci.yml`.
- **Observed:** with the environment the CI job declares: `ConfigValidationError …
REFRESH_TOKEN_HASH_SECRET: Required`. With the secrets supplied: `TypeError: Cannot read
properties of undefined (reading 'get')` in `new RedisService(undefined)` — Vitest's esbuild does
  not emit decorator metadata, so Nest injects nothing. Both runs: 8 files failed, 93 tests skipped.
  In CI the job fails even earlier, at the seed step.
- **Why it matters:** no HTTP-level or database-level behaviour is checked automatically.
- **Fix:** transpile the integration tests with SWC (decorator metadata on), provide test secrets in
  the workflow, build workspace packages before seeding. All three exist on the unmerged branches.
- **Sync S-001 note (2026-11-11), branch only:** commit `ef13704` also resets the OTP rate-limit keys
  and opens the fixture restaurant all day before each test, removing two causes of order- and
  time-dependent failures. The branch reports 92 of 93 tests passing (walking-skeleton still red).
  On the branch: fix present, unverified (BRANCH). On `main`: unchanged, Open.
- **Depends on:** nothing.
- **Verify:** `pnpm --filter @djafat/api test:int` green locally and in CI.

### TEST-02

**No automated test runs the application's SQL or the UI** · Needs Improvement · High · RUN · Status: Open

- **Where:** `apps/api/src/modules/*/*-test-support.ts` (≈2 000 lines of in-memory Prisma fakes);
  `apps/web` and `apps/admin` have no tests.
- **Observed:** all 1 146 unit tests pass, yet `SDK-01`, `PAY-03`, `PAY-01` and `PAY-02` were found
  within hours of running the real thing. The services rely heavily on raw SQL that the fakes
  imitate rather than execute.
- **Fix:** a small real-database suite for the money and dispatch paths; a browser suite (Playwright)
  for the three critical journeys; run both in CI.
- **Depends on:** `TEST-01`.
- **Verify:** the suites fail when the corresponding bug is reintroduced.

### CI-01

**Every CI workflow on `main` is red** · Broken · High · RUN · Status: Open

- **Where:** `.github/workflows/ci.yml`, `.github/workflows/security.yml`.
- **Observed (GitHub, head `d1439c6`):** `check` fails at **Build** (`MOB-01`); `integration` fails
  at **Seed**; `gitleaks` reports leaks; `pnpm audit` fails (`DEP-01`). A local gitleaks scan of all
  109 commits on all refs found five hits, all test fixtures — two of them on `main`, in
  `packages/config/src/env.spec.ts`. No real secret was found.
- **Why it matters:** a permanently red pipeline stops signalling anything, and a real leak would be lost in the noise.
- **Fix:** resolve `MOB-01`/`TEST-01`/`DEP-01`; allowlist the two test fixtures in `.gitleaks.toml`;
  make green CI a merge requirement.
- **Depends on:** `MOB-01`, `TEST-01`, `DEP-01`.
- **Verify:** both workflows green on `main`.

### OPS-01

**`pnpm infra:up` fails on a fresh machine and on ARM64** · Broken · High · RUN · Status: Open

- **Where:** `infra/docker-compose.yml` (`minio/minio:RELEASE.2024-12-18…`, `postgis/postgis:16-3.5`).
- **Observed:** the MinIO image cannot be pulled (`repository does not exist`), which aborts the
  whole `up`. Without MinIO, the PostGIS image fails on Apple Silicon (`no matching manifest for
linux/arm64`). The stack started only with MinIO skipped and PostgreSQL forced to `linux/amd64`.
  The compose file also publishes 5432, which collides with a locally installed PostgreSQL.
- **Why it matters:** the first command in the README does not work for a new developer.
- **Fix:** replace or remove the MinIO service (nothing uses it — `STOR-01`); use a multi-arch
  PostGIS image or declare `platform`; make the host port configurable.
- **Depends on:** nothing.
- **Verify:** on a clean machine, `pnpm infra:up && pnpm db:migrate && pnpm db:seed` succeeds on amd64 and arm64.
- **Sync S-001 note (2026-11-11), branch only:** the branch's **production** stack now picks a
  community multi-arch PostGIS image on ARM servers; its **development** compose file is unchanged,
  and its new local guide (`docs/TRAVAILLER-EN-LOCAL.md`) still starts with `pnpm infra:up`. Open.

### OPS-02

**No deployment path, supervision, backups or monitoring** · Not Implemented · High · CODE · Status: Open

- **Where:** `infra/deploy/.gitkeep` only; two Dockerfiles (API, worker) and none for the web apps.
- **Observed (code):** no production compose or infrastructure code, no TLS or reverse proxy, no
  backup or restore procedure, no process supervision (a dead worker went unnoticed for 26 hours
  during the pilot — `docs/36`), no alerting. See also `OBS-01`.
  The two existing Dockerfiles were not built; their runtime stage omits each app's own
  `node_modules`, which pnpm's isolated layout relies on, so the images may not start (Needs Verification).
- **Fix:** define the target (one server or managed services), then deliver compose/IaC, TLS,
  backups with a tested restore, restart policies and health checks, and a runbook. A one-server
  stack exists on the unmerged branch (not reviewed in depth).
- **Depends on:** hosting decision (condition H2 in `docs/16`).
- **Verify:** a staging deployment from a clean host following the runbook; a restore drill.
- **Sync S-001 note (2026-11-11), branch only:** the branch adds `infra/deploy/install.sh`, a
  one-command install for a single server (target: Oracle Cloud "Always Free", ARM). It installs
  Docker by piping `get.docker.com` to `sudo sh`, opens ports 80/443, pulls the code, generates the
  secrets file once and starts the stack. Points to check when it is run: the ARM PostGIS image is a
  community build referenced by tag, not digest; there is still no monitoring or alerting (the
  branch's roadmap lists it as to do); a live server lacks reference data ([`OPS-05`](#ops-05)).
  Partly addressed on the branch, unverified.

### SEC-02

**The only seed creates a super_admin on a known phone number** · Needs Improvement · High · LIVE · Status: Open

- **Where:** `apps/api/prisma/seed.ts` (fixtures at L372–428 alongside roles, permissions, settings, ledger accounts).
- **Observed:** `pnpm db:seed` is the only way to create the roles, the 21 permissions and the chart
  of accounts the API needs — and the same run creates eight test users, including `admin` and
  `super_admin`, five test restaurants and enables the mock payment provider.
- **Why it matters:** seeding production as documented hands super_admin to whoever holds a
  published phone number, and turns on fake payments.
- **Fix:** split into a reference-data bootstrap (safe everywhere) and development fixtures (refused
  in production); add a documented one-off command to create the first super_admin.
- **Depends on:** nothing.
- **Verify:** the bootstrap on an empty database yields no users and no enabled mock provider.
- **Sync S-001 note (2026-11-11), branch only:** the branch's server stack runs the seed in demo mode
  only, and its seed still creates the eight fixture accounts unconditionally (`seed.ts` L477–533).
  The consequence for a live server is [`OPS-05`](#ops-05).

### ADM-01

**The `finance` role cannot perform refunds or settlements** · Broken · High · LIVE · Status: Open

- **Where:** `auth.controller.ts` (`mfa/setup`, `mfa/verify`: `admin`/`super_admin` only);
  `payments.controller.ts` refund and `settlements.controller.ts` record (`@RequireStepUp()`, role `finance` allowed).
- **Observed:** as `finance`: `POST /auth/mfa/setup` → 403; refund → 428 `STEP_UP_REQUIRED`;
  settlement → 428. The role is authorised for actions it has no means to unlock.
- **Fix:** let every role that faces a step-up enrol and verify (derive the list from `MFA_REQUIRED_ROLES`).
- **Depends on:** nothing.
- **Verify:** finance enrols, verifies, then refunds successfully.

### ADM-02

**An `admin` can block a `super_admin`** · Needs Improvement · High · LIVE · Status: Open

- **Where:** `users.service.ts` `setStatus`; `users-admin.controller.ts` suspend/block/reactivate.
- **Observed:** `admin` blocked the `super_admin`, whose next request got 403, then reactivated it.
  No check on the target's role, none against acting on oneself, no step-up, and existing sessions are not revoked.
- **Why it matters:** one compromised admin session can lock out every higher-privileged account.
- **Fix:** forbid acting on an equal or higher role and on oneself; require step-up; revoke the target's sessions.
- **Depends on:** `ADM-03` for the step-up part.
- **Verify:** admin → super_admin block returns 403; admin → customer works after step-up.

### ADM-03

**Role management in the admin console cannot work: no MFA screen** · Broken · High · CODE · Status: Open

- **Where:** `apps/admin/src` (no file mentions MFA, TOTP or step-up); `app/admin/users/[id]/page.tsx` offers role grant and revoke.
- **Observed:** through the API, a role grant without step-up answers 428 (LIVE). The console has no
  enrolment or verification screen, so those buttons can only ever fail. The console also has no
  refund, settlement, restaurant-activation or order-action screens.
- **Fix:** MFA enrolment (QR) and step-up prompt in the console; then the missing operational screens.
- **Depends on:** `SDK-01`.
- **Verify:** grant a role from the console after entering a TOTP code.

### GOV-01

**`main` is 41 commits behind the active branch; a fix branch is orphaned** · Needs Improvement · High · RUN · Status: Open

- **Where:** `origin/claude/compassionate-franklin-k23vcj` (+41 commits, 456 files, +31 592 lines,
  last commit 2026-11-10 18:10); `origin/fix/payment-reliability-backlog` (+2 commits, 2026-11-01,
  not contained in the other). _(updated 2026-11-11, sync S-001: was +37 commits, 449 files.)_
- **Sync S-001 note (2026-11-11):** the two branches now provably conflict — merging the fix branch
  into the larger one stops on 6 files, including `payments.service.ts` and the lockfile (RUN, in a
  throwaway clone). The larger branch also added its own reference roadmap, `docs/ROADMAP.md`.
- **Why it matters:** an audit or a fix made on `main` can duplicate or conflict with work that
  already exists; the webhook fix (`PAY-05`) lives only on the smaller branch. Several defects found
  today are present on both lines. Detail in [`UNMERGED_BRANCHES.md`](UNMERGED_BRANCHES.md).
- **Fix:** decide the integration line before any roadmap work: review and merge, or cherry-pick,
  with CI green as the gate.
- **Depends on:** repository owner's decision.
- **Verify:** one branch contains all accepted work; the others are deleted.

### DLV-01

**Restaurants created through the API can never be dispatched to** · Not Implemented · High · LIVE · Status: Open

- **Where:** `catalog/dto/restaurant-management.schema.ts` (no coordinates), `geo.module.ts` (empty
  skeleton), `deliveries.service.ts` `runDispatchWave` (L289–303: no pickup coordinates → stays `searching_courier`).
- **Observed:** a restaurant created by `POST /v1/restaurants` has no `geom`; only seeded
  restaurants have coordinates, set by SQL. Addresses created by customers have coordinates only if
  the client sends them; there is no geocoding and no map.
- **Fix:** capture coordinates when creating/editing a restaurant (map pin), validate before
  activation; decide the geocoding approach.
- **Depends on:** nothing.
- **Verify:** an order for an API-created restaurant reaches a courier.

### COUR-01

**Courier app tracks location only in the foreground; no push** · Partially Completed · High · CODE · Status: Open

- **Where:** `apps/courier/lib/location.ts` (foreground `watchPositionAsync`); notifications use a mock push provider.
- **Observed (code):** a courier is a dispatch candidate only with a position newer than 120 s
  (`courier_location_stale_seconds`). With the app in the background the position goes stale, and no
  push can announce an offer that expires after 30 s.
- **Fix:** background location task and real push; revisit the 30 s offer window for the field.
- **Depends on:** `MOB-01`.
- **Verify:** device test with the screen locked: an offer arrives and can be accepted.

### OPS-05

**On the active branch, a live server starts without roles, permissions or ledger accounts** · Broken · High · BRANCH · Status: Open (branch only) · Found in sync S-001, 2026-11-11

- **Where:** `origin/claude/compassionate-franklin-k23vcj` @ `804176f` — `infra/deploy/gen-secrets.sh`
  (`MODE=live` → `SEED_DEMO=0`), `infra/deploy/docker-compose.prod.yml` (service `migrate` runs the
  seed only when `SEED_DEMO=1`), `apps/api/prisma/seed.ts`, `apps/api/prisma/migrations/*`.
- **Observed (reading the branch, not run):** no migration inserts into `roles`, `permissions`,
  `role_permissions`, `currencies`, `countries`, `cities`, `payment_methods`, `payment_providers`,
  `platform_settings` or `ledger_accounts`; only `seed.ts` does. No application code creates them at
  start-up (the ledger only creates per-owner accounts on demand). The deployment guide's live-mode
  instructions mention the SMS provider and the merchant number, nothing about this data or the
  first administrator.
- **Consequences, as read:** the first login would fail — a new account is given the `customer`
  role, which references a `roles` row that does not exist. Payments would fail on the missing
  platform ledger accounts. There would be no market, no payment methods, and no administrator.
- **The trap:** the obvious workaround — running the seed on the live server — also creates the
  eight fixture accounts (`seed.ts` L477–533), including `admin` and `super_admin`. With a real SMS
  provider configured in live mode, the login codes for those numbers would be sent by SMS to
  whoever holds them.
- **Why it matters:** the branch is preparing a server install; demo mode works around the gap, live
  mode cannot work without a manual step that is unsafe as it stands.
- **Fix:** the same split as [`SEC-02`](#sec-02) — an idempotent reference-data bootstrap run in
  every mode (migration or dedicated step), demo fixtures only in demo mode, and a one-off command to
  create the first super_admin. Task T-302.
- **Depends on:** T-001 (where the fix is made).
- **Verify:** on the branch, `MODE=live` on an empty database: first login succeeds as `customer`, a
  test payment posts to the ledger, and no fixture account exists.

---

## Medium

### SEC-03

**Anyone can lock any phone number out of login** · Needs Improvement · Medium · LIVE

- **Where:** `otp.service.ts` `verifyOtp` / `registerFailedAttempt`; `POST /v1/auth/otp/verify` has no per-IP limit.
- **Observed:** ten unauthenticated wrong codes for a number, then that number's code request → 423 `OTP_LOCKED` (15 minutes, repeatable).
- **Fix:** throttle verification per IP and per phone before counting; count only against an existing challenge.
- **Verify:** repeat; the victim can still request and verify a code.

### SEC-04

**Client-supplied `X-Forwarded-For` is trusted** · Needs Improvement · Medium · LIVE

- **Where:** `apps/api/src/main.ts` (`trustProxy: true`).
- **Observed:** a request with `X-Forwarded-For: 203.0.113.77` created the rate-limit key for that address. Audit rows record the same value.
- **Fix:** trust only the known proxy hops; configure per environment.
- **Verify:** spoofed header no longer changes the key when the API is reached directly.

### SEC-05

**Web apps keep access and refresh tokens in `localStorage`** · Needs Improvement · Medium · CODE

- **Where:** `apps/web|admin|restaurant/src/lib/auth-storage.ts`. The API sends a strict CSP only in production; the Next apps define none.
- **Why it matters:** any script injection yields a 30-day refresh token, including for administrators.
- **Fix:** httpOnly cookies behind a same-site backend-for-frontend, or at least a strict CSP and short-lived refresh for staff roles.
- **Verify:** tokens not readable from page scripts.

### SEC-06

**No general API rate limiting** · Not Implemented · Medium · CODE

- **Where:** `API_RATE_LIMIT_WINDOW_MS` / `API_RATE_LIMIT_MAX` are parsed and used nowhere. Only OTP requests and MFA verification are limited.
- **Fix:** global limiter (per IP and per user) with stricter limits on write and public search routes.
- **Verify:** burst test returns 429.

### SEC-07

**The "single ledger writer" rule is not enforced by the database** · Needs Improvement · Medium · LIVE

- **Where:** migrations `0007`, `0008`, `0029`; `ledger.repository.ts` (`SET LOCAL ROLE djafat_ledger`).
- **Observed:** connected as the application role (which owns the tables), a direct insert into
  `wallet_balances` and an unbalanced insert into `ledger_entries` were both accepted without
  `SET ROLE`. Updates and deletes are correctly blocked by the append-only trigger. No constraint checks that a group balances.
- **Fix:** run the application as a non-owner role; add a deferred constraint trigger for Σdebit = Σcredit per group.
- **Verify:** the same statements fail.

### SEC-08

**Access tokens survive logout and role revocation for up to 15 minutes** · Needs Improvement · Medium · LIVE

- **Where:** `actor-resolver.service.ts` (roles read from the token; session not checked).
- **Observed:** `GET /me` with a logged-out token → 200. Documented as accepted in the resolver's comment, which also wrongly says role changes apply on the next request.
- **Fix:** check session liveness (cached) and load roles from the database, at least for staff roles.
- **Verify:** logged-out or downgraded token is refused immediately.

### ORD-03

**Minimum order amount is displayed but not enforced** · Broken · Medium · LIVE

- **Where:** `carts.service.ts` `loadAndValidateCartForCheckout`; `restaurants.min_order_minor`.
- **Observed:** an 800 XAF order was accepted for a restaurant whose minimum is 1 000 XAF.
- **Fix:** refuse at order creation with a dedicated error code; show it in the cart.
- **Verify:** below-minimum order → 409.

### ORD-04

**A restaurant owner can create additional restaurants** · Needs Verification · Medium · LIVE

- **Where:** `catalog-management.controller.ts` `POST /restaurants` (`restaurants:write`, held by `restaurant_owner`).
- **Observed:** an owner created "Shadow Resto" (`draft`, owned by them, no coordinates, no role scope, so they cannot manage it). Nothing can activate it afterwards from any UI.
- **Fix:** decide whether self-service onboarding is intended; if not, restrict creation to staff.
- **Verify:** owner → 403, or a complete onboarding flow exists.

### ORD-05

**Delivery fee is one flat global amount; no zones, taxes or promotions** · Partially Completed · Medium · LIVE

- **Where:** `pricing.service.ts` (`skeleton_flat_delivery_fee_minor`); tables `tax_rules` (empty, unread), no zones, no promotion tables.
- **Observed:** every order carries 1 000 XAF whatever the distance; the courier is paid exactly that.
- **Fix:** zone or distance pricing; decide on taxes and promotions.
- **Verify:** fee varies with the configured rule; snapshot stays frozen on the order.

### DLV-02

**No way to complete a delivery once the code is locked or expired** · Not Implemented · Medium · CODE

- **Where:** `deliveries.service.ts` (`MAX_PROOF_ATTEMPTS = 5`, 4-hour TTL; message says "contact support").
- **Fix:** staff action to re-issue a code or force-complete, audited and step-up protected.
- **Verify:** locked delivery can be completed by support.

### DLV-03

**Pickup is not atomic; a retry can leave a delivery without a code** · Needs Improvement · Medium · CODE

- **Where:** `deliveries.service.ts` `doMarkPickedUp` (L666–737): status update, second update, code issue and outbox write are separate statements; the replay branch returns early without issuing a code.
- **Fix:** one transaction; issue the code if none exists on replay.
- **Verify:** fault-injection test between the statements.

### OPS-03

**Readiness probe answers HTTP 200 when not ready** · Broken · Medium · LIVE

- **Where:** `common/health/health.controller.ts` `ready()`.
- **Observed:** with Redis stopped: body `"status":"not_ready"`, HTTP 200.
- **Fix:** return 503 when any check fails.
- **Verify:** same test → 503.

### WRK-01

**Missing background jobs, no cleanup, no worker health signal** · Not Implemented · Medium · CODE

- **Where:** `apps/worker/src/main.ts` (4 processors); `infra/queue/queue.constants.ts` declares 10 queue names, 7 unused.
- **Missing:** confirmation timeout (`ORD-02`), payment reconciliation, payouts, repair of stuck states (`ARCH-01`), and retention for `otp_codes`, `sessions`, `idempotency_keys`, `outbox`, `webhook_events`, `notifications`, `audit_logs`. The worker exposes no heartbeat; `ledger-assert` only logs.
- **Fix:** add the jobs with the features they belong to; a heartbeat and an alert on ledger violations.
- **Verify:** tables stop growing without bound; a stopped worker raises an alert.

### TEST-03

**Worker integration tests fail on a seeded database and are not in CI** · Broken · Medium · RUN

- **Where:** `apps/worker/test/processors.int.spec.ts`.
- **Observed:** 6 passed, 3 failed with `duplicate key … ledger_accounts_uk` (the tests insert accounts the seed already created). CI never runs this suite.
- **Fix:** isolate the fixtures; add the suite to CI.
- **Verify:** 9/9 on a seeded database, in CI.

### ARCH-02

**Dispatch logic exists twice (API and worker)** · Needs Improvement · Medium · CODE

- **Where:** `deliveries.service.ts` `runDispatchWave`, `couriers.service.ts`, and `apps/worker/src/processors/dispatch.processor.ts` ("mirrored 1:1").
- **Why it matters:** a rule changed in one copy silently diverges; this already caused a pilot defect that had to be fixed twice.
- **Fix:** one implementation — shared SQL in a package, or the worker as the only dispatcher.
- **Verify:** a single source for the candidate query.

### AUTH-02

**No profile update, phone change or account deletion** · Not Implemented · Medium · CODE

- **Where:** no `users` controller; `UsersService.deleteAndAnonymize` has no endpoint; OTP purposes `register`/`change_phone` behave like `login`.
- **Why it matters:** users cannot set a name; account deletion is a legal and app-store requirement.
- **Fix:** `PATCH /me`, phone change with re-verification, account deletion.
- **Verify:** each flow end to end.

### NOTIF-01

**Notifications are stored but never shown or pushed** · Partially Completed · Medium · LIVE

- **Where:** `modules/notifications/*`; no SDK binding or screen; `mock-push.provider.ts`.
- **Observed:** nine notification rows were written during the live run; no device is ever registered.
- **Fix:** SDK binding and an inbox; a real push provider; an SMS fallback for key order events.
- **Verify:** an order event reaches a device.

### STOR-01

**No file upload: object storage is a stub** · Not Implemented · Medium · CODE

- **Where:** `infra/storage/object-storage.module.ts` (every method rejects; injected nowhere); table `files` unused.
- **Consequence:** logos, covers and product photos are free-text URLs typed into forms.
- **Fix:** S3-compatible adapter, signed uploads, image variants.
- **Verify:** upload a product photo from the restaurant console.

### OBS-01

**No error tracking, metrics or tracing; request IDs are not propagated** · Not Implemented · Medium · LIVE

- **Where:** `SENTRY_DSN` and `OTEL_*` are validated and unused; `common/logging/logging.module.ts`.
- **Observed:** a request sent with `x-request-id` received no such response header and a different `traceId` in the body. Server logs do contain full stacks for 500s.
- **Fix:** wire error tracking and basic metrics; honour and return the correlation header.
- **Verify:** an induced error appears in the tracker with the caller's ID.

### FE-04

**Customer web has no order history or profile page** · Not Implemented · Medium · LIVE

- **Where:** `apps/web/src/app` (routes: home, restaurants, restaurant, product, cart, addresses, order detail, login).
- **Observed:** `/commandes` → the generic 404, whose text speaks of a missing restaurant or dish. `GET /orders/mine` exists and works.
- **Fix:** history list, profile page, accurate 404 copy.
- **Verify:** the history lists past orders.

### PAY-08

**Cash settlement posts ledger groups in the wrong order** · Needs Verification · Medium · CODE

- **Where:** `deliveries.service.ts` `confirmDelivered` posts `funds_available` in its transaction; the cash `order_accrual` is posted afterwards by `payments.onDeliveryDelivered` through an in-process event. An order may also hold several pending payments.
- **Risk:** pending balances go negative in between and stay so if the second step fails. Unreachable today (`PAY-02`).
- **Fix:** settle cash in one transaction, accrual first; allow one open payment per order.
- **Verify:** integration test of a cash delivery; balances never negative.

### API-01

**Several client mistakes are answered with HTTP 500** · Needs Improvement · Medium · LIVE

- **Where:** `common/errors/all-exceptions.filter.ts` `classify`.
- **Observed:** `Content-Type: application/json` with an empty body → 500; a 2 MB body → 500 (should be 413); an unknown `methodCode` → 500 (foreign-key violation). A simultaneous first login for one phone would also 500 (code).
- **Fix:** map Fastify client errors by `statusCode`; translate Prisma `P2003`/`P2002` where the cause is input.
- **Verify:** each case returns 4xx with the standard envelope.

---

## Low

### FE-05

**Seeded restaurant and product images do not render** · Broken · Low · LIVE — `seed.ts` uses `placehold.co` URLs that return SVG; `/_next/image` answers 400. Use `.png` URLs in the seed. Development only.

### FE-06

**Interface polish gaps** · Needs Improvement · Low · LIVE — no favicon in the three apps (404); on a 390 px screen the header wraps "Déconnexion — Client Test"; the admin order list shows raw status identifiers; the courier list shows only a UUID; login errors are generic whatever the cause.

### DB-01

**Schema hygiene** · Needs Improvement · Low · LIVE — `user_roles` has no primary key (unique expression index instead); about 50 foreign keys have no supporting index (mostly currency references; notable: `orders.dropoff_address_id`, `order_items.product_id`, `refunds.requested_by`); the encrypted delivery code is stored in `delivery_proofs.reference`, a column documented as an object-storage key; `wallet_balances` has no non-negative check; the Prisma schema models 46 of 52 tables and declares none of the indexes.

### DOC-01

**Entry-point documents were out of date** · Needs Improvement · Low · RUN — the root `README.md` and the former `docs/README.md` said "Bloc 0 not started"; two files are numbered `36`, none `26`; `DJAFAT-architecture-complete.md` (714 KB) and `djafat-docs.zip` duplicate the dossier in the repository. Not corrected by the audit: on 2026-11-11 its own documents moved to `docs_2/` and `docs/` and the root `README.md` were restored to their committed state, so these files stay with their owners _(updated 2026-11-11)_.

### DOC-02

**Earlier "GO" verdicts covered the API only** · Needs Improvement · Low · LIVE — `docs/36-bloc-13-hardening.md` concludes "GO" for a pilot and `docs/36-pilot-e2e-scenario.md` reports 19/19. Both runs drove the API with `curl`; the same journey fails in a browser (`SDK-01`, `FE-01`), and the cited integration tests cannot run (`TEST-01`). _Sync S-001 note (2026-11-11): the active branch's new `docs/ROADMAP.md` makes the same kind of claim — pilot functions "faites et vérifiées en vrai", integration tests 92/93 — which this audit has not been able to verify (BRANCH)._

### OPS-04

**Install is refused on the current Node release** · Needs Improvement · Low · RUN — `engines.node` is `>=20 <25` with `engine-strict=true`; `pnpm install` stops on Node 26. Correct behaviour, undocumented: the README should name Node 22 and how to get it.

### RT-01

**Realtime details** · Needs Verification · Low · LIVE — authentication, room authorisation and event delivery work on one instance (LIVE). Unproven with two instances; `subscribe` sends no acknowledgement, so a refused join is silent; the gateway accepts any origin.

### I18N-01

**Text is hard-coded in French** · Partially Completed · Low · CODE — `@djafat/i18n` is used by five files; most strings are inline. Arabic and right-to-left are not started (planned for V2).

### QA-01

**Accessibility and performance were not measured** · Needs Verification · Low — no Lighthouse, screen-reader or load test was run. First-load JavaScript is 105–143 kB per route (build output).

### PAY-09

**Payment idempotency details** · Needs Improvement · Low · CODE — the idempotency scope for payments, cancels and refunds is global rather than per user; `payments.attempt_no` is never incremented; a stale `reserved` key (process died mid-request) blocks its key forever.

---

Last updated: 2026-11-11 (sync S-001)
