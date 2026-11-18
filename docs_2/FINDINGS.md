# Findings register

Every fact the audit established about DJAFAT, one entry per finding. Other documents refer to
these IDs instead of repeating the detail.

- **Audited:** branch `main` at commit `d1439c6` (2026-10-14), on 2026-11-10.
- **How:** code reading of the whole repository, then execution — install, format, typecheck, lint,
  unit tests, builds, 29 migrations and seed on PostgreSQL 16 + PostGIS, API and worker booted from
  their production builds, HTTP scenarios with `curl`, the three web apps in headless Chrome, and
  the hosted CI logs. Environment details: [`TESTING_AND_QUALITY_ASSURANCE.md`](TESTING_AND_QUALITY_ASSURANCE.md) §1.
- **Vocabulary:** classification and evidence levels are defined in [`README.md`](README.md).
- **Counts:** 3 Critical · 19 High · 22 Medium · 14 Low = 58 open findings, plus 12 resolved
  _(updated 2026-11-18, sync S-030: new `OPS-06`; sync S-032: `TEST-04` and `DOC-03` resolved on `main`)_
  _(updated 2026-11-14, sync S-008: new `DOC-03`; 2026-11-17, sync S-011: new `TEST-04`; sync
  S-013: `PAY-01`, `PAY-03`, `SEC-01`, `FE-03` and `PAY-05` resolved on `main`; sync S-014: new `TEST-05`)_
  _(updated 2026-11-14, sync S-007: `SDK-01`, `FE-01`, `PAY-02`, `TEST-01` and `CI-01` resolved on
  `main`; S-004 added `CI-03` and `FE-07`; S-003 added `CI-02`)_.
- **Last synced:** S-013, 2026-11-17 — pull requests #2, #3, #4 and #7 merged into `main`
  (`75db772`, DJAFAT 0.20.11): five findings resolved. Earlier: S-007, 2026-11-14 — pull request #1
  merged into `main` as `46d8cae` (DJAFAT 0.20.1); `main` now holds the code run end to end in S-006. Earlier: S-005 two commits on pull
  request #3, S-004 our `next` upgrade, S-003 our CI fix on pull request #2, S-001 four commits on
  the collaborator's branch. Pull-by-pull history: [`history/SYNC_LOG.md`](history/SYNC_LOG.md).

An entry is never deleted. When fixed, set `Status: Resolved`, add the commit and how the fix was
verified.

## Index

| ID                    | Title                                                                                       | Class               | Priority | Evidence |
| --------------------- | ------------------------------------------------------------------------------------------- | ------------------- | -------- | -------- |
| [SDK-01](#sdk-01)     | Browser calls to the API fail in every web app                                              | Broken              | Critical | LIVE     |
| [PAY-01](#pay-01)     | A disabled payment provider can still be charged — free orders                              | Broken              | Critical | LIVE     |
| [PAY-02](#pay-02)     | Cash-on-delivery orders are never placed; they expire                                       | Broken              | Critical | LIVE     |
| [PAY-03](#pay-03)     | Every refund request crashes                                                                | Broken              | Critical | LIVE     |
| [FE-01](#fe-01)       | No customer screen or SDK call can pay for an order                                         | Not Implemented     | Critical | LIVE     |
| [AUTH-01](#auth-01)   | No real OTP delivery — nobody can log in to a production deployment                         | Not Implemented     | Critical | LIVE     |
| [SEC-01](#sec-01)     | The API boots with the published placeholder secrets                                        | Broken              | Critical | LIVE     |
| [DEP-01](#dep-01)     | 8 critical and 66 high vulnerabilities in production dependencies                           | Needs Improvement   | Critical | RUN      |
| [MOB-01](#mob-01)     | Neither Expo app can be bundled; root build and CI fail                                     | Broken              | Critical | RUN      |
| [PAY-04](#pay-04)     | Paid orders that are rejected, cancelled or failed are never refunded or reversed           | Not Implemented     | High     | LIVE     |
| [PAY-05](#pay-05)     | An unauthenticated request can make a genuine payment webhook be ignored                    | Broken              | High     | LIVE     |
| [PAY-06](#pay-06)     | No payout flow: restaurant and courier balances can never be paid out                       | Not Implemented     | High     | LIVE     |
| [PAY-07](#pay-07)     | No real payment provider (Airtel / Moov)                                                    | Not Implemented     | High     | CODE     |
| [ARCH-01](#arch-01)   | Cross-module business reactions are fire-and-forget, in-process                             | Needs Improvement   | High     | CODE     |
| [ORD-01](#ord-01)     | Nobody can cancel an order                                                                  | Not Implemented     | High     | LIVE     |
| [ORD-02](#ord-02)     | A paid order the restaurant ignores stays `placed` forever                                  | Not Implemented     | High     | LIVE     |
| [FE-02](#fe-02)       | No token refresh anywhere: every session ends after 15 minutes                              | Partially Completed | High     | CODE     |
| [FE-03](#fe-03)       | The customer cannot see the delivery code in any app                                        | Not Implemented     | High     | CODE     |
| [TEST-01](#test-01)   | The API integration suite (93 tests) cannot run                                             | Broken              | High     | RUN      |
| [TEST-02](#test-02)   | No automated test runs the application's SQL or the UI                                      | Needs Improvement   | High     | RUN      |
| [CI-01](#ci-01)       | Every CI workflow on `main` is red                                                          | Broken              | High     | RUN      |
| [OPS-01](#ops-01)     | `pnpm infra:up` fails on a fresh machine and on ARM64                                       | Broken              | High     | RUN      |
| [OPS-02](#ops-02)     | No deployment path, supervision, backups or monitoring                                      | Not Implemented     | High     | CODE     |
| [SEC-02](#sec-02)     | The only seed creates a super_admin on a known phone number                                 | Needs Improvement   | High     | LIVE     |
| [ADM-01](#adm-01)     | The `finance` role cannot perform refunds or settlements                                    | Broken              | High     | LIVE     |
| [ADM-02](#adm-02)     | An `admin` can block a `super_admin`                                                        | Needs Improvement   | High     | LIVE     |
| [ADM-03](#adm-03)     | Role management in the admin console cannot work: no MFA screen                             | Broken              | High     | CODE     |
| [GOV-01](#gov-01)     | `main` is 41 commits behind the active branch; a fix branch is orphaned                     | Needs Improvement   | High     | RUN      |
| [DLV-01](#dlv-01)     | Restaurants created through the API can never be dispatched to                              | Not Implemented     | High     | LIVE     |
| [COUR-01](#cour-01)   | Courier app tracks location only in the foreground; no push                                 | Partially Completed | High     | CODE     |
| [OPS-05](#ops-05)     | On the active branch, a live server starts without roles, permissions or ledger accounts    | Broken              | High     | BRANCH   |
| [OPS-06](#ops-06)     | The demo server is paid by Oracle's trial credits and will be reclaimed when the trial ends | Needs Improvement   | High     | DOC      |
| [SEC-03](#sec-03)     | Anyone can lock any phone number out of login                                               | Needs Improvement   | Medium   | LIVE     |
| [SEC-04](#sec-04)     | Client-supplied `X-Forwarded-For` is trusted                                                | Needs Improvement   | Medium   | LIVE     |
| [SEC-05](#sec-05)     | Web apps keep access and refresh tokens in `localStorage`                                   | Needs Improvement   | Medium   | CODE     |
| [SEC-06](#sec-06)     | No general API rate limiting                                                                | Not Implemented     | Medium   | CODE     |
| [SEC-07](#sec-07)     | The "single ledger writer" rule is not enforced by the database                             | Needs Improvement   | Medium   | LIVE     |
| [SEC-08](#sec-08)     | Access tokens survive logout and role revocation for up to 15 minutes                       | Needs Improvement   | Medium   | LIVE     |
| [ORD-03](#ord-03)     | Minimum order amount is displayed but not enforced                                          | Broken              | Medium   | LIVE     |
| [ORD-04](#ord-04)     | A restaurant owner can create additional restaurants                                        | Needs Verification  | Medium   | LIVE     |
| [ORD-05](#ord-05)     | Delivery fee is one flat global amount; no zones, taxes or promotions                       | Partially Completed | Medium   | LIVE     |
| [DLV-02](#dlv-02)     | No way to complete a delivery once the code is locked or expired                            | Not Implemented     | Medium   | CODE     |
| [DLV-03](#dlv-03)     | Pickup is not atomic; a retry can leave a delivery without a code                           | Needs Improvement   | Medium   | CODE     |
| [OPS-03](#ops-03)     | Readiness probe answers HTTP 200 when not ready                                             | Broken              | Medium   | LIVE     |
| [WRK-01](#wrk-01)     | Missing background jobs, no cleanup, no worker health signal                                | Not Implemented     | Medium   | CODE     |
| [TEST-03](#test-03)   | Worker integration tests fail on a seeded database and are not in CI                        | Broken              | Medium   | RUN      |
| [ARCH-02](#arch-02)   | Dispatch logic exists twice (API and worker)                                                | Needs Improvement   | Medium   | CODE     |
| [AUTH-02](#auth-02)   | No profile update, phone change or account deletion                                         | Not Implemented     | Medium   | CODE     |
| [NOTIF-01](#notif-01) | Notifications are stored but never shown or pushed                                          | Partially Completed | Medium   | LIVE     |
| [STOR-01](#stor-01)   | No file upload: object storage is a stub                                                    | Not Implemented     | Medium   | CODE     |
| [OBS-01](#obs-01)     | No error tracking, metrics or tracing; request IDs are not propagated                       | Not Implemented     | Medium   | LIVE     |
| [FE-04](#fe-04)       | Customer web has no order history or profile page                                           | Not Implemented     | Medium   | LIVE     |
| [PAY-08](#pay-08)     | Cash settlement posts ledger groups in the wrong order                                      | Needs Verification  | Medium   | CODE     |
| [API-01](#api-01)     | Several client mistakes are answered with HTTP 500                                          | Needs Improvement   | Medium   | LIVE     |
| [DOC-03](#doc-03)     | The local guide's placeholder secrets block local deliveries                                | Broken              | Medium   | CODE     |
| [TEST-04](#test-04)   | The API integration suite fails intermittently on a local machine                           | Needs Improvement   | Medium   | RUN      |
| [FE-05](#fe-05)       | Seeded restaurant and product images do not render                                          | Broken              | Low      | LIVE     |
| [FE-06](#fe-06)       | Interface polish gaps                                                                       | Needs Improvement   | Low      | LIVE     |
| [DB-01](#db-01)       | Schema hygiene: retention, indexes, a missing primary key, a reused column                  | Needs Improvement   | Low      | LIVE     |
| [DOC-01](#doc-01)     | Entry-point documents were out of date                                                      | Needs Improvement   | Low      | RUN      |
| [DOC-02](#doc-02)     | Earlier "GO" verdicts covered the API only                                                  | Needs Improvement   | Low      | LIVE     |
| [OPS-04](#ops-04)     | Install is refused on the current Node release                                              | Needs Improvement   | Low      | RUN      |
| [RT-01](#rt-01)       | Realtime: multi-instance fan-out unproven; refused joins are silent                         | Needs Verification  | Low      | LIVE     |
| [I18N-01](#i18n-01)   | Text is hard-coded in French; Arabic not started                                            | Partially Completed | Low      | CODE     |
| [QA-01](#qa-01)       | Accessibility and performance were not measured                                             | Needs Verification  | Low      | —        |
| [CI-02](#ci-02)       | The pre-push secret scan never reads the pushed commits                                     | Broken              | Low      | RUN      |
| [CI-03](#ci-03)       | The pre-commit hook cannot run ESLint on `main`                                             | Broken              | Low      | RUN      |
| [FE-07](#fe-07)       | Typed routes are configured but never checked                                               | Broken              | Low      | RUN      |
| [PAY-09](#pay-09)     | Payment idempotency scope is global; attempt counter never moves                            | Needs Improvement   | Low      | CODE     |
| [TEST-05](#test-05)   | The mobile typecheck is silenced by a known-failure entry                                   | Needs Improvement   | Low      | CODE     |

---

## Critical

### SDK-01

**Browser calls to the API fail in every web app** · Broken · Critical · LIVE · Status: Resolved on `main` (`46d8cae`, sync S-007; verified 2026-11-13, see the S-006 note)

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
- **Sync S-006 note (2026-11-13), RUN on pull request #1's branch (`4c756e0`), not on `main`:**
  verified there. Through the real login pages, with no workaround, all four web apps log in
  (customer site by SMS code, restaurant console, admin console, courier app):
  `POST /v1/auth/otp/request` → 202, `verify` → 200. The branch's fix calls `fetch` as a plain
  function in `packages/sdk/src/http.ts`.
- **Sync S-009 note (2026-11-17), CODE + RUN:** `07f2539` (0.20.2, pull request #5, by `kcerha`)
  binds `fetch` to the global object instead of calling it through an arrow function. Its message
  says no browser could reach the API with the arrow-function version; that was not reproduced
  here: our browser runs on that version (S-006 on `4c756e0`, and the delivery-code journey of
  2026-11-14 on a branch of `46d8cae`, both in Chrome) logged in, ordered and delivered. Binding is
  correct in every browser, so the change is safe either way. Status unchanged.

### PAY-01

**A disabled payment provider can still be charged — free orders** · Broken · Critical · LIVE · Status: Resolved on `main` (pull request #4, merged into `main` as `44ae073` on 2026-11-17, sync S-013; `main`'s code is identical to the verified branch head); fix on `fix/audit-blockers` (`a017f48`, version 0.20.10, pull request #4), verified there (sync S-011)

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
- **Sync S-011 note (2026-11-17), BRANCH + RUN:** payment creation now resolves
  `listAvailablePaymentMethods`, the payment screen's own rule, and refuses anything else with
  `409 PAYMENT_METHOD_UNAVAILABLE` before writing; the stored method is the provider's, not the
  client's `methodCode` (`a017f48`, version 0.20.10, pull request #4; same rule as the owner's
  `6cf7c9b`). Production already lacked `mock` (FEAT-002); there the gap was a cash or wallet method
  switched off by an operator. Verified: the Verify step above on PostgreSQL
  (`payment-enablement.int.spec.ts`: disabled row → 409, order still `awaiting_payment`, no payment
  row; enabled again → 201), plus an unknown `methodCode`, which gave HTTP 500, now stored as the
  provider's. Both fail on the previous code, as do 12 of 14 unit tests.

### PAY-02

**Cash-on-delivery orders are never placed; they expire** · Broken · Critical · LIVE · Status: Resolved on `main` (`46d8cae`, sync S-007; verified 2026-11-13, see the S-006 note)

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
- **Sync S-006 note (2026-11-13), RUN on pull request #1's branch (`4c756e0`), not on `main`:** this
  Verify step passes there. A cash order chosen in the browser became `placed`, appeared on the
  restaurant board, and was accepted, readied, picked up and delivered. After delivery the payment is
  `succeeded` (`cash_on_delivery`), and the ledger's two entry groups balance: 6 000 of cash float,
  4 000 to the restaurant, 1 000 to the courier, 1 000 of revenue, with the restaurant's and the
  courier's shares moved to available.

### PAY-03

**Every refund request crashes** · Broken · Critical · LIVE · Status: Resolved on `main` (pull request #4, merged into `main` as `44ae073` on 2026-11-17, sync S-013; `main`'s code is identical to the verified branch head); fix on `fix/audit-blockers` (`f0cbb09`), verified there by a new integration test, red before and green after (sync S-007); version 0.20.6 of pull request #4 (`8e59bd4`, sync S-008; numbered 0.20.4 until S-010)

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

**No customer screen or SDK call can pay for an order** · Not Implemented · Critical · LIVE · Status: Resolved on `main` (`46d8cae`, sync S-007; verified 2026-11-13, cash on delivery; see the S-006 note)

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
- **Sync S-006 note (2026-11-13), RUN on pull request #1's branch (`4c756e0`), not on `main`:** the
  order page asks how to pay. With cash on delivery chosen, "Confirmer la commande" gave
  `POST /v1/payments` → 201, and the order went to `placed`. Cash was the only method offered and
  tried.

### AUTH-01

**No real OTP delivery — nobody can log in to a production deployment** · Not Implemented · Critical · LIVE · Status: Open — code ready, waits for an SMS provider account (sync S-021)

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
- **Sync S-021 re-check (2026-11-18), CODE + unit test:** fix present on `main`. The OTP transport
  is chosen by `SMS_PROVIDER`: an HTTP SMS gateway (FEAT-006), WhatsApp (FEAT-008) and e-mail
  (FEAT-007) exist, and production refuses `SMS_PROVIDER=mock` (`env.spec.ts` SPEC-006-02-SC01,
  passing). What is left is an account with an SMS provider in Chad; the "real handset" step of
  Verify cannot run before that.
- **Sync S-030 (2026-11-18), DOC:** what DJAFAT must obtain, the HTTP contract the code expects and how
  to check it: `docs/39-comptes-externes.md` §1.

### SEC-01

**The API boots with the published placeholder secrets** · Broken · Critical · LIVE · Status: Resolved on `main` (pull request #4, merged into `main` as `44ae073` on 2026-11-17, sync S-013; `main`'s code is identical to the verified branch head); fix on `fix/audit-blockers` (`aa0d58d`, version 0.20.8, pull request #4), production only, verified there (sync S-008; numbered 0.20.6 until S-010)

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
- **Sync S-008 note (2026-11-14), BRANCH + RUN:** in production, `loadApiEnv` now refuses a
  secret that still holds a placeholder (`REPLACE_ME`, `CHANGE_ME`), an HMAC secret under 32
  characters, one value used for two secrets, and an AES key that does not decode to exactly
  32 bytes (`SMS_GATEWAY_ENCRYPTION_KEY` included when set). Messages name the variable, never
  its value (`aa0d58d`, version 0.20.6, pull request #4). Verified: six new tests in
  `env.spec.ts`, five of which fail on the previous code; integration suite 94/94; the built API
  started three times: production with the `.env.example` values exits with code 1 naming the
  five secrets, production with generated secrets answers `/health`, development with the
  `.env.example` values starts and logs a warning. Outside production nothing is refused, on
  purpose: the local guide copies `.env.example` unchanged (`DOC-03`), and refusing there would
  stop every teammate's API at the next pull. Whether development should refuse too is the
  team's call. The shared test fixture had 20–24-character secrets and a 33-byte MFA key
  (labelled 32): its inputs were corrected, no assertion changed.

### DEP-01

**8 critical and 66 high vulnerabilities in production dependencies** · Needs Improvement · Critical · RUN · Status: Open

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
- **Sync S-003 note (2026-11-11), RUN (hosted pipeline):** the `pnpm audit` job on pull request #2
  (runs 43044189948 and 43046807317) reports 151 advisories: 8 critical, 66 high, 58 moderate,
  19 low. The lockfile is unchanged since the 2026-11-10 run, so the nine extra advisories were
  presumably published in between. The eight critical, with the first patched version:

  - `next` 15.1.3: GHSA-9qr9-h5gf-34mp, remote code execution in the React flight protocol
    (15.1.9); GHSA-f82v-jwr5-mffw, authorization bypass in middleware (15.2.3);
    GHSA-p293-qw3h-jr36, unauthenticated remote code execution on Windows-hosted servers (15.5.24);
    GHSA-2xp9-vwfh-vxw4 and GHSA-2464-fhr4-w9xw, unauthenticated remote code execution in the Image
    Optimization API with AVIF and with SVG files (15.5.24, 15.5.28).
  - `@fastify/middie` 8.3.3, through `@nestjs/platform-fastify`: GHSA-72c6-fx6q-fr5w,
    authentication bypass in child plugin scopes (9.3.2).
  - `proxy-addr` 2.0.7, through `fastify`: GHSA-jqcg-44mw-7w3h, IP spoofing via an IPv4-mapped
    IPv6 trust subnet (2.0.8).
  - `shell-quote` 1.10.0, through React Native's `react-devtools-core`: GHSA-pqg4-j6r4-53mv,
    command injection in `quote()` (1.11.0).

  Relevance (CODE): the three Next.js apps use the App Router (`src/app`), the code path of
  GHSA-9qr9-h5gf-34mp; `apps/web` serves images through `next/image`, that is through the Image
  Optimization API; none of the three has a `middleware.ts`, so GHSA-f82v-jwr5-mffw has nothing to
  bypass today. Whether any of them is reachable from the internet was not checked. The highest
  patched version among the 17 critical and high `next` advisories is 15.5.28, so `next` ≥ 15.5.28
  should clear them all; re-run the audit to confirm (T-105).

  Pull request #1 (BRANCH): its `scripts/pipeline/baselines/audit.json` accepts all eight critical
  advisories (38 of its 115 entries are for `next`), though its stated reason is "essentially via
  expo/react-native". Once it is merged, the audit job turns green while these stay open, because
  the job then fails only on advisories missing from the baseline. That is a sound gate against new
  problems, as long as a green audit job is not read as "no critical vulnerability"; the `next`
  entries should leave the baseline with the upgrade.

- **Sync S-004 note (2026-11-12): fix present on a branch, verified there.** Pull request #3
  (`fix/next-15.5`, commit `5d36c6a`) upgrades `next` to 15.5.29 in the three web apps and
  `packages/ui`. Verified (RUN): the hosted audit of that branch (run 43154080538) lists no `next`
  advisory: 110 advisories instead of 151, 3 critical instead of 8, 51 high instead of 66. Format,
  typecheck, lint, unit tests and the build pass locally, and a 29-page browser comparison with
  `main`'s build shows no regression (`TESTING_AND_QUALITY_ASSURANCE.md` §5). Status stays Open:
  the fix is not on `main`, and what remains still fails the audit job:
  - API: `@fastify/middie` (critical, fixed in 9.3.2) and `proxy-addr` (critical, 2.0.8), plus
    `fastify`, `@nestjs/platform-fastify`, `find-my-way` and `@fastify/static` (high; Fastify 5
    and Nest 11 territory), `js-yaml` and `lodash` through `@nestjs/swagger`, and `zod` (fixed in
    version 4).
  - Expo apps: `shell-quote` (critical, 1.11.0), `node-forge` (8 high, 1.4.1; pull request #1
    forces 1.4.3), `undici`, `image-size`, `decode-uri-component`, `compression`.
  - `postcss` (2 high, 8.5.18): `next` 15.5.29 itself pins 8.4.31.
  - `brace-expansion` (6 high), through React Native's tooling, `@fastify/static` and the ESLint
    plugins of `packages/eslint-config`.
- **Sync S-008 note (2026-11-14), BRANCH:** pull request #3 is re-based on `main` as version
  0.20.3 (`69cd859`, after the merge `6b13d96`, which adds nothing of its own). Its audit baseline
  drops the 38 `next` entries pull request #1 had accepted (115 → 77 entries, counted in both
  files), so the audit job fails again if a `next` advisory returns. Next step: Fastify 5 and
  Nest 11, on their own pull request (T-105).
- **Sync S-012 note (2026-11-17), BRANCH + RUN:** the API step is done on a branch:
  `fix/api-nest11-fastify5` (`862ad24`, version 0.20.11, stacked on pull request #4) moves the API to
  NestJS 11.2.10 and Fastify 5.12.8 (with `@fastify/middie` 9.3.4, `@fastify/cors` 11, `@fastify/helmet`
  13, `@fastify/static` 10, `@nestjs/swagger` 11). `pnpm audit --prod`: 73 advisories → 36, critical
  3 → 1, and none left in the API's stack; the baseline drops the 36 entries that no longer exist,
  nothing new appears. NestJS 12 was not chosen: its packages are ESM-only and its tooling wants
  TypeScript 6, for the same Fastify. What remains is mostly the Expo tool chain, `postcss` through
  `next`, and `zod` (fixed only in version 4). Status stays Open until merged.
- **Sync S-013 note (2026-11-17), RUN:** both steps are on `main`: `next` 15.5.29 (pull request #3,
  merged as `f9a8f41`) and NestJS 11 / Fastify 5 (pull request #7, merged as `75db772`), whose tree
  is identical to the branch head that was verified. `pnpm audit --prod` on that lockfile: 36
  advisories, 1 critical, none in the API's stack. Open: the Expo tool chain, `postcss` through
  `next`, `zod` (fixed only in version 4).
- **Sync S-020 note (2026-11-18), RUN:** the baseline gains one entry on `main` (`97a9b77`, pull
  request #12): `GHSA-fc5q-39xc-vjpf|picomatch`, a high ReDoS advisory published on 2026-11-18. It
  comes only through Expo's CLI (`apps/courier`, `apps/mobile` → `expo` → `@expo/cli` → `picomatch`
  3.0.2; also 2.3.2 and 4.0.7), and no patched version exists yet (the advisory names none), so
  baselining it is the only option for now. Remove the entry once a fixed `picomatch` is published.
- **Sync S-021 re-check (2026-11-18), RUN:** `pnpm audit --prod` on `main` (`8ceb437`): 37
  advisories — 1 critical (`shell-quote`, Expo tooling), 18 high, 14 moderate, 4 low. The rest is
  mostly the Expo tool chain, plus `postcss` through `next` and `zod` (fixed only in version 4).

### MOB-01

**Neither Expo app can be bundled; root build and CI fail** · Broken · Critical · RUN · Status: Open — bundling fixed, never run on a device (sync S-021)

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
- **Sync S-005 note (2026-11-12): fix present on a branch, verified there in CI.** Commit
  `c616695` on pull request #3 (the same lines as `a972a35` on pull request #1) stops
  `metro.config.js` from disabling Metro's hierarchical lookup, which hid each package's own
  dependencies under pnpm's isolated layout. On that branch the hosted `check` job now passes every
  step, Build included (run 43156964436), so both Expo apps export. Status stays Open: the fix is
  not on `main`, and neither app has been run on a device (T-210).
- **Sync S-006 note (2026-11-13), RUN on pull request #1's branch (`4c756e0`):** the courier app
  builds for the browser (`build:web`). Served locally, it logs in, shares its position, receives
  the offer, and completes pickup and delivery. Native builds were not tried.
- **Verify:** `expo export` succeeds for both; the app runs on an Android device against a staging API.
- **Sync S-009 note (2026-11-17), BRANCH:** `07f2539` declares `babel-preset-expo` in both Expo
  apps; the commit reports that the courier web app could not be bundled without it (pnpm installed
  it, Metro did not find it). Fix present, unverified by us: our local courier web export, built
  before this change, did bundle, so the failure seems to depend on how the install is laid out.
- **Sync S-021 re-check (2026-11-18), RUN:** both Expo apps bundle: CI's `pnpm build` (`expo export`
  for the mobile app, the courier's build) is green on `main` (`8ceb437`), and the courier's web
  export built locally on 2026-11-17. Neither app has run on an Android device: that half of Verify
  is still to do.
- **Sync S-025 note (2026-11-18), RUN:** `turbo run build` for `@djafat/mobile` and `@djafat/courier` succeeded
  locally (`expo export`: "Exported: dist" for both), so their 2026-11-06 entries in `known-failures.json`
  ("Metro cannot resolve `invariant`") were stale; removed on `fix/mobile-typed-routes` (0.21.8).

---

## High

### PAY-04

**Paid orders that are rejected, cancelled or failed are never refunded or reversed** · Not Implemented · High · LIVE · Status: Open on `main`; fix present on `fix/order-cancel-refund` (version 0.22.0), verified there (sync S-027)

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
- **Sync S-021 re-check (2026-11-18), CODE:** unchanged on `main`: `rejectOrder`,
  `onDeliveryCancelled` and `onDeliveryFailed` issue no refund or reversal, and no listener reacts
  to a rejected or cancelled paid order.
- **Sync S-027 (2026-11-18), RUN, branch `fix/order-cancel-refund`:** `payments` reacts to `order.cancelled`
  (also emitted for a rejection), in process and from the durable stream. An open payment is cancelled; a
  paid one gets one automatic refund. Policy applied (`docs/37`; the API design in `docs/07` already said
  "refund auto si payé"): before the kitchen started, the accrual is reversed (restaurant, courier pool and
  commission back to zero, the customer owed the amount in `REFUNDS_PAYABLE`, DJAFAT bears the PSP fee);
  after, DJAFAT absorbs the refund (the documented rule). Merchant wallets (no refund API) leave the refund
  `pending` in `GET /v1/admin/refunds`; `POST /v1/admin/refunds/:id/complete` records the hand transfer.
  Integration (real PostgreSQL): customer cancel, restaurant reject, admin cancel after preparation,
  hand-completed refund and a relayed event delivered twice; ledger balanced, payables at zero where
  expected. A delivery that fails after pickup still has no order-side reaction (unchanged).

### PAY-05

**An unauthenticated request can make a genuine payment webhook be ignored** · Broken · High · LIVE · Status: Resolved on `main` (pull request #4, merged into `main` as `44ae073` on 2026-11-17, sync S-013; `main`'s code is identical to the verified branch head); fix on `fix/audit-blockers` (`2319186`, version 0.20.9, pull request #4), verified there (sync S-010)

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
- **Sync S-010 note (2026-11-17), BRANCH + RUN:** the signature is now checked before the
  `webhook_events` row is written; a rejected request leaves nothing and is only logged (`2319186`,
  version 0.20.9, pull request #4: the owner's `6cf7c9b` re-applied on `main`'s code). Verified:
  the two requests above replayed on real PostgreSQL (`webhook-forgery.int.spec.ts`): the forgery
  gets 401 and leaves no row, the genuine webhook then answers `ok`, the payment succeeds, the
  order is placed, and a replay answers `duplicate`. That test and three unit tests fail on the
  previous code; integration suite 95/95 on a fresh database. The unit tests also showed that,
  before the fix, every later forgery carrying the same id got HTTP 200 `duplicate`, not 401.
  `docs/24-bloc-5-payment.md`, which described the stored `ignored` row as the rule, is updated.

### PAY-06

**No payout flow: restaurant and courier balances can never be paid out** · Not Implemented · High · LIVE · Status: Open — couriers covered (FEAT-014), restaurants not (sync S-021)

- **Where:** ledger, payments. `settlements.service.ts` exists; there is no payout table, endpoint or job
  (`QUEUES.payouts` is declared and unused).
- **Observed:** after a delivered order the restaurant shows 8 800 XAF available and the courier
  1 000 XAF; `DJAFAT_BANK` stays 0. No endpoint moves an available balance out.
- **Why it matters:** partners cannot be paid through the system; reconciliation would be manual and off-ledger.
- **Fix:** design payouts (schedule, method, approval, ledger entries), then implement request →
  approval → execution → ledger posting.
- **Depends on:** `PAY-07`, `ADM-01`.
- **Verify:** payout reduces `available`, credits bank/provider clearing, balances.
- **Sync S-021 re-check (2026-11-18), CODE:** partly addressed on `main`: courier payouts exist
  (FEAT-014: `courier_payouts` table, service and endpoints, the cash a courier owes settled first,
  unit-tested). Restaurant balances are still settled only by recording a settlement by hand. Not
  run.

### PAY-07

**No real payment provider (Airtel / Moov)** · Not Implemented · High · CODE · Status: Blocked (external) — manual merchant-wallet flow in place, no provider API (sync S-021)

- **Where:** `payments.module.ts` registers `cash` and `mock` only; seed rows `airtel_money`, `moov_money` are inactive.
- **Why it matters:** together with `PAY-02`, there is no legitimate payment method.
- **Fix:** obtain provider access, implement a `PaymentProvider` adapter, a reconciliation job for
  pending payments (`QUEUES.paymentsReconcile` is unused), and asynchronous refund handling.
- **Depends on:** provider contract and sandbox (condition H1 in `docs/16`).
- **Verify:** sandbox payment end to end, including a late webhook and a timeout.
- **Sync S-021 re-check (2026-11-18), CODE:** partly addressed: merchant-wallet payments (FEAT-009:
  the customer transfers to DJAFAT's Airtel, Tigo or Moov number, matched by a receipt or, FEAT-016,
  by the merchant phone's SMS). No provider API yet (FEAT-019 waits for access).
- **Sync S-030 (2026-11-18), DOC:** checklist for the merchant accounts, the dedicated phones and the
  one setting to change (`MOBILE_MONEY_WALLETS`): `docs/39-comptes-externes.md` §2.

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
- **Sync S-021 re-check (2026-11-18), CODE:** unchanged: 17 in-process `emit` calls and 16
  `@OnEvent` listeners in `apps/api`, no outbox relay for these reactions.

### ORD-01

**Nobody can cancel an order** · Not Implemented · High · LIVE · Status: Open on `main`; fix present on `fix/order-cancel-refund` (version 0.22.0), verified there (sync S-027)

- **Where:** `orders.controller.ts` (routes: create, list, mine, get, confirm, ready, reject).
  The state machine defines `customer_cancel`, `cancel_before_preparing` and `admin_force_cancel`.
- **Observed:** `POST /v1/orders/:id/cancel` → 404. A customer can only cancel the _delivery_, which
  exists from `ready` onwards; an admin has no order action at all.
- **Fix:** add customer cancel (before preparation) and admin force-cancel, both wired to `PAY-04`.
- **Depends on:** `PAY-04`.
- **Verify:** cancel from each allowed status; refused from the others; refund issued when paid.
- **Sync S-021 re-check (2026-11-18), CODE:** unchanged: no cancel route in `orders.controller.ts`,
  and nothing calls the state machine's cancel transitions.
- **Sync S-027 (2026-11-18), RUN, branch `fix/order-cancel-refund`:** `POST /v1/orders/:id/cancel` (the
  customer: `awaiting_payment`, `placed`, `confirmed`; 409 after, 404 for someone else's order) and
  `POST /v1/admin/orders/:id/cancel` (admin/super_admin, step-up, reason; up to `courier_assigned`; the
  delivery is cancelled and the courier released), both as designed in `docs/07`. A cancel button in the
  web order page and the mobile order screen (not tried in a browser or on a device). No console screen
  for the admin cancel yet (`ADM-03`).

### ORD-02

**A paid order the restaurant ignores stays `placed` forever** · Not Implemented · High · LIVE · Status: Open on `main`; fix present on `fix/order-cancel-refund` (version 0.22.0), verified there (sync S-027)

- **Where:** worker (no job); `order-expiry.processor.ts` handles `awaiting_payment` only.
- **Observed:** a paid order sat in "Nouvelles" for 4 h 42 during the audit with no escalation.
  Listed as accepted debt in `docs/36` §6.3.
- **Fix:** confirmation deadline in `platform_settings`; a job that cancels and refunds, and
  notifies the customer and operations.
- **Depends on:** `PAY-04`, `ORD-01`.
- **Verify:** unconfirmed paid order is cancelled and refunded after the deadline.
- **Sync S-021 re-check (2026-11-18), CODE:** unchanged: the worker's `order-expiry` still handles
  `awaiting_payment` only.
- **Sync S-027 (2026-11-18), RUN, branch `fix/order-cancel-refund`:** worker job
  `order-confirmation-timeout` (every 30 s) cancels `placed` orders older than
  `platform_settings['order_confirmation_timeout_seconds']`, default 900 s (a proposal for DJAFAT to
  confirm), as the system transition `confirmation_timeout`; the relayed `order.cancelled` makes the API
  refund and notify the customer. The built job, run against the test database, cancelled a 20-minute-old
  order with its history row and event. Operations are not alerted beyond the order list.

### FE-02

**No token refresh anywhere: every session ends after 15 minutes** · Partially Completed · High · CODE · Status: Open on `main`; fix present on `fix/token-refresh` (version 0.22.1), verified there (sync S-028)

- **Where:** `apps/*/src/lib/auth-storage.ts`, `apps/courier|mobile/lib/auth-*`; `packages/sdk/src/http.ts`.
- **Observed (code):** all five apps store the refresh token and never use it; on 401 the pages
  redirect to login. Access tokens last 900 s. The realtime gateway also disconnects sockets whose
  token expired.
- **Why it matters:** a kitchen board or a courier on the road is logged out four times an hour.
- **Fix:** refresh-on-401 with a single in-flight refresh in the SDK, reconnecting the socket with
  the new token. An implementation exists on the unmerged branch.
- **Depends on:** `SDK-01`.
- **Verify:** keep a board open for 20 minutes; no redirect, events keep arriving.
- **Sync S-021 re-check (2026-11-18), CODE:** unchanged: no refresh call in the SDK or in any app.
- **Sync S-028 (2026-11-18), RUN, branch `fix/token-refresh`:** the SDK renews on a 401 to a request made
  with the stored token: one renewal at a time (concurrent 401s share it), the rotated pair stored by the
  app, the request retried once; a refused renewal (401/403) clears the session, a network error keeps it.
  The three web apps renew one tab at a time (Web Locks), since two tabs presenting the same refresh token
  would trip reuse detection; the Expo apps keep the tokens in memory and SecureStore. The socket hooks read
  the token at each connection and, after the server closes a socket for an expired token (socket.io never
  reconnects after that), renew and reconnect, at most once a minute. Live check against the real API with
  4-second tokens (built SDK, real socket.io client): an expired token is renewed once, six parallel calls
  share one renewal, the server closed the socket on expiry and it reconnected with a renewed token. Not run:
  the React hooks themselves in a browser or on a device. The "implementation on the unmerged branch" this
  finding mentioned no longer exists (that branch was merged; no refresh code was on `main`).

### FE-03

**The customer cannot see the delivery code in any app** · Not Implemented · High · CODE · Status: Resolved on `main` (pull request #4, merged into `main` as `44ae073` on 2026-11-17, sync S-013; `main`'s code is identical to the verified branch head); fix on `fix/audit-blockers` (`70cfd3b`, version 0.20.7, pull request #4), verified there in a browser (sync S-008; numbered 0.20.5 until S-010)

- **Where:** `GET /v1/deliveries/:id/code` exists and works (LIVE); no SDK binding, no screen in web or mobile.
- **Why it matters:** the courier must enter the code to complete a delivery. Without it the only exit is "failed".
- **Fix:** SDK binding and a prominent code on the order page once the order is picked up.
- **Depends on:** `FE-01`.
- **Verify:** browser test shows the code after pickup; it disappears after delivery.
- **Sync S-006 note (2026-11-13), RUN on pull request #1's branch (`4c756e0`): still open there.**
  During a full delivery the customer's order page only said "Préparez votre code de livraison" and
  never showed the code. No message carried it either: the mock SMS store held only the login code,
  and the notifications were `order.confirmed` and `order.delivered`. `GET /v1/deliveries/:id/code`
  returns it to the customer (HTTP 200), but no screen calls it, on the web or in the mobile app.
  The courier app refuses a delivery without the right code, so a real delivery cannot be completed
  from the screens alone; the test run fetched the code through the API.
- **Sync S-008 note (2026-11-14), BRANCH + RUN:** order tracking now returns the delivery's id,
  the SDK reads `GET /v1/deliveries/:id/code`, and both customer apps show « Votre code de
  livraison » from pickup to handover, refreshed every 10 s (`70cfd3b`, version 0.20.5, pull
  request #4). Verified on an isolated database: unit tests (API, SDK), integration suite 94/94,
  and a browser journey: no code before pickup, a 4-digit code after it, the courier confirms
  with that code, the order is delivered, the code is gone. Hosted CI, Windows and Security
  checks green on that push. The mobile screen was type-checked and linted, not run on a device.

### TEST-01

**The API integration suite (93 tests) cannot run** · Broken · High · RUN · Status: Resolved on `main` (`46d8cae`, sync S-007: hosted `integration` job green on the push; 94/94 locally on a fresh database with the new refund test)

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
- **Sync S-006 note (2026-11-13), RUN (hosted pipeline), branch only:** on `4c756e0`, pull request
  #1's `integration` job passes (run 43212219986). The commit reports 93/93 on a fresh local
  database; that was not re-run here.

### TEST-02

**No automated test runs the application's SQL or the UI** · Needs Improvement · High · RUN · Status: Open — SQL covered, UI not (sync S-021)

- **Where:** `apps/api/src/modules/*/*-test-support.ts` (≈2 000 lines of in-memory Prisma fakes);
  `apps/web` and `apps/admin` have no tests.
- **Observed:** all 1 146 unit tests pass, yet `SDK-01`, `PAY-03`, `PAY-01` and `PAY-02` were found
  within hours of running the real thing. The services rely heavily on raw SQL that the fakes
  imitate rather than execute.
- **Fix:** a small real-database suite for the money and dispatch paths; a browser suite (Playwright)
  for the three critical journeys; run both in CI.
- **Depends on:** `TEST-01`.
- **Verify:** the suites fail when the corresponding bug is reintroduced.
- **Sync S-021 re-check (2026-11-18), RUN:** partly addressed: the integration suite (97 tests on
  real PostgreSQL and Redis) runs the application's SQL in CI on every pull request. The UI is still
  barely tested — test files per app: web 1, admin 0, restaurant 3, courier 3, mobile 2.

### CI-01

**Every CI workflow on `main` is red** · Broken · High · RUN · Status: Resolved on `main` (`46d8cae`, sync S-007: CI and Security both green on the push; the weekly scan of other branches and the allowlist stay with T-109)

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
- **Sync S-003 note (2026-11-11), RUN (hosted pipeline):**
  - On pull requests the `gitleaks` job stopped before scanning ("GITHUB_TOKEN is now required to
    scan pull requests"): the workflow passes no token, so pull requests went unscanned. Pull
    request #1 fixes this (commits `6d04e4e`, `397ca6b`: the run's token, with read-only
    `contents` and `pull-requests` permissions); commit `281c323` copies the same lines to pull
    request #2, and the two merge without a conflict in that file (merge test RUN). The check now
    passes on both (pull request #2: run 43046807317, gitleaks 8.24.3, 4 commits, no leaks).
  - The weekly scan reads every branch, not only `main`. Its last run (2026-11-09) flagged four
    test values: the two `env.spec.ts` fixtures on `main`, and two throwaway CI keys
    (`MFA_ENCRYPTION_KEY`, `DELIVERY_CODE_ENCRYPTION_KEY`) that commit `a68934d` adds to `ci.yml`
    on `fix/payment-reliability-backlog`, labelled as such there. The allowlist must cover all four.
    Locally, gitleaks 8.30.1 also flags one line of `apps/web/src/lib/offline-order.ts` on
    `claude/compassionate-franklin-k23vcj`; the pipeline's 8.24.3 does not.
  - The three other checks fail on pull request #2 at the same steps as on `main`: `check` at
    Build (`MOB-01`), `integration` at Seed, `pnpm audit` (`DEP-01`). On pull request #1 (head
    `804176f`) only `integration` fails.
  - The local pre-push scan does not make up for any of this: it reads nothing (`CI-02`).
- **Sync S-004 note (2026-11-12), RUN (hosted pipeline):** pull request #3 (`fix/next-15.5`) shows
  the same picture. Its gitleaks job failed for want of the token until commit `480ec14` copied the
  fix of pull requests #1 and #2; it now passes (run 43154793991, 2 commits, no leaks). `check`
  still fails at Build (`MOB-01`) after format, typecheck, lint and unit tests pass, `integration`
  at Seed, and `pnpm audit` on the advisories left outside `next` (`DEP-01`).
- **Sync S-005 note (2026-11-12), RUN (hosted pipeline):** on pull request #3, commit `6cbbad4`
  builds the API's workspace packages before seeding (the same step as pull request #1), and
  `c616695` fixes the Expo bundling (`MOB-01`). Run 43156964436: `check` passes; `integration` now
  gets past Seed and fails at Integration tests (`TEST-01`); `pnpm audit` still fails (`DEP-01`);
  gitleaks passes. Merging pull requests #1 and #3 now also conflicts in `ci.yml`: both add the
  build step, and pull request #1 adds a throwaway-secrets step next to it, so take pull request
  #1's file.

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
- **Sync S-014 note (2026-11-17), CLAIM:** the owner's roadmap (`cabf058`, branch
  `feat/welcome-greeting`) says the `quay.io/minio/minio` image can no longer be downloaded (registry
  locked in mid-November), even locally; the local guide's troubleshooting already starts the stack
  without MinIO. Not checked by us.
- **Sync S-021 re-check (2026-11-18), CODE:** unchanged in `infra/docker-compose.yml`:
  `postgis/postgis:16-3.5` has no ARM64 image and MinIO is pinned to `RELEASE.2024-12-18…` (which
  the owner reports can no longer be pulled). Not re-run on a clean machine.

### OPS-02

**No deployment path, supervision, backups or monitoring** · Not Implemented · High · CODE · Status: Open — deployed with backups; monitoring and restore-check scripts on `fix/ops-monitoring` (0.23.1), tested locally, not installed on the server (sync S-030)

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
- **Sync S-009 note (2026-11-17), LIVE:** the one-server stack is deployed. The roadmap of 0.20.3
  reports the demo online since 2026-11-16 (Oracle Cloud, HTTPS on six addresses, checked from
  outside); on 2026-11-17 `djafat.com`, `api.djafat.com/v1/health` and the `admin.`, `resto.` and
  `livreur.` addresses answered HTTP 200 (status codes only, nothing else requested). The server
  runs in production mode with demo data, and its test SMS inbox is bound to the server's own
  localhost (`docker-compose.prod.yml`), so login codes cannot be read from outside. The stack has
  a backup service; monitoring, alerting and a restore drill are still not reported. Open, partly
  addressed.
- **Sync S-014 note (2026-11-17), CLAIM:** per the owner's roadmap (`cabf058`), the demo server is an
  Oracle Cloud **free trial** on x86 (the ARM "Always Free" offer was unavailable), so its life is
  limited unless migrated or paid; and object storage (photos) is blocked by the MinIO image above.
  Not checked by us.
- **Sync S-015 note (2026-11-17), RUN: shutdown.** On `main` since 0.20.11 the API exits about 2 s
  after SIGTERM (Prisma's disconnect is bounded, see S-012). Correction to S-012, which said NestJS
  10 was not affected: an old API process (NestJS 10, code of `4c756e0`) that had run for three days
  on the user's machine ignored SIGTERM for 10 s and had to be force-stopped. A deployment should
  still give the API a stop timeout and check that it exits; the cause in that old process was not
  investigated.
- **Sync S-021 re-check (2026-11-18), LIVE + CODE:** partly addressed: the one-server stack runs the
  demo (`djafat.com` and the API's health answered 200 today), with restart policies, a health check
  and a backup service (`infra/deploy/docker-compose.prod.yml`). Missing: monitoring and alerting, a
  restore drill, and a plan for the end of the trial server.
- **Sync S-030 (2026-11-18), RUN (locally), branch `fix/ops-monitoring`:** `healthcheck.sh` (sites, API,
  containers, disk, backup age, last restore check; alerts an ntfy topic only on a state change, plus a
  6-hour reminder) and `restore-check.sh` (restores the newest dump into a scratch database, checks
  migrations, users, ledger balance and PostGIS, drops it). Restore drill on a real dump of the test
  database (same PostgreSQL 16 + PostGIS 3.5 image): the guide's `pg_restore --clean` and a restore into
  an empty database both gave every table its original row count, a balanced ledger, 39 migrations, and
  Prisma "up to date". Health check tested against a fake ntfy receiver and simulated failures. Not done:
  installing the cron jobs on the server, an off-server backup copy. End of the trial server: see `OPS-06`.

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
- **Sync S-009 note (2026-11-17), CODE:** the live demo runs this seed (`SEED_DEMO=1`), so its
  super-admin exists on the known number. Its login codes only reach the test inbox bound to the
  server's localhost, so the number cannot be used from outside; anyone with a shell on the server
  can. With `MODE=live` the seed does not run ([`OPS-05`](#ops-05)).
- **Sync S-021 re-check (2026-11-18), CODE:** unchanged: the seed creates its fixture accounts, the
  `super_admin` among them, unconditionally; the live demo runs it.

### ADM-01

**The `finance` role cannot perform refunds or settlements** · Broken · High · LIVE · Status: Open on `main`; fix present on `fix/admin-roles` (version 0.21.9), verified there (sync S-026)

- **Where:** `auth.controller.ts` (`mfa/setup`, `mfa/verify`: `admin`/`super_admin` only);
  `payments.controller.ts` refund and `settlements.controller.ts` record (`@RequireStepUp()`, role `finance` allowed).
- **Observed:** as `finance`: `POST /auth/mfa/setup` → 403; refund → 428 `STEP_UP_REQUIRED`;
  settlement → 428. The role is authorised for actions it has no means to unlock.
- **Fix:** let every role that faces a step-up enrol and verify (derive the list from `MFA_REQUIRED_ROLES`).
- **Depends on:** nothing.
- **Verify:** finance enrols, verifies, then refunds successfully.
- **Sync S-021 re-check (2026-11-18), CODE:** unchanged: `mfa/setup` and `mfa/verify` still require
  `admin` or `super_admin`, so `finance` cannot pass the step-up its refunds need.
- **Sync S-026 (2026-11-18), RUN, branch `fix/admin-roles`:** `mfa/setup`, `mfa/verify` and `mfa/disable`
  admit `MFA_ENROLLABLE_ROLES` (admin, super_admin, finance; new in `@djafat/types`). A unit test reads every
  controller and checks that each role a step-up route asks a second factor from can enrol and verify; it
  failed on the old controller ("PaymentsController.refund: finance cannot enrol MFA"). Integration: a fresh
  finance account gets 428 on a refund, enrols and verifies, then gets 404 for an unknown payment instead of 428.
  A refund of a real payment by finance was not run.

### ADM-02

**An `admin` can block a `super_admin`** · Needs Improvement · High · LIVE · Status: Open on `main`; fix present across `fix/admin-roles` (0.21.9: hierarchy, sessions, refresh) and `fix/admin-console-mfa` (0.23.0: step-up), verified there (syncs S-026, S-029)

- **Where:** `users.service.ts` `setStatus`; `users-admin.controller.ts` suspend/block/reactivate.
- **Observed:** `admin` blocked the `super_admin`, whose next request got 403, then reactivated it.
  No check on the target's role, none against acting on oneself, no step-up, and existing sessions are not revoked.
- **Why it matters:** one compromised admin session can lock out every higher-privileged account.
- **Fix:** forbid acting on an equal or higher role and on oneself; require step-up; revoke the target's sessions.
- **Depends on:** `ADM-03` for the step-up part.
- **Verify:** admin → super_admin block returns 403; admin → customer works after step-up.
- **Sync S-021 re-check (2026-11-18), CODE:** unchanged: `setStatus` checks nothing about the
  target's roles (role grants are guarded, status changes are not).
- **Sync S-026 (2026-11-18), RUN, branch `fix/admin-roles`:** `setStatus` refuses one's own account and,
  unless the actor is super_admin, any account holding admin or super_admin (the rule `grantRole` already
  used; a super_admin may still act on another super_admin, or nobody could stop a compromised one).
  Suspend and block revoke every session of the target, and `/auth/refresh` now refuses an inactive account
  (it renewed tokens for blocked users before) and ends its sessions. Unit and integration tests: admin →
  super_admin block 403, self-block 403, a blocked customer's refresh token stays dead after reactivation.
  Still open: step-up on these routes, which waits for the console's MFA screen (`ADM-03`).
- **Sync S-029 (2026-11-18), RUN, branch `fix/admin-console-mfa`:** `suspend`/`block`/`reactivate` now carry
  `@RequireStepUp(MFA_REQUIRED_ROLES)`, the console prompting for the code. The unit test that pinned the old
  deliberate gap (its reason: no console step-up flow) is replaced by one asserting the gate. Integration:
  without a step-up 428, then the hierarchy scenarios with a stepped-up admin. Courier `suspend`/`reinstate`
  are still ungated.

### ADM-03

**Role management in the admin console cannot work: no MFA screen** · Broken · High · CODE · Status: Open on `main`; fix present on `fix/admin-console-mfa` (version 0.23.0), verified there (sync S-029)

- **Where:** `apps/admin/src` (no file mentions MFA, TOTP or step-up); `app/admin/users/[id]/page.tsx` offers role grant and revoke.
- **Observed:** through the API, a role grant without step-up answers 428 (LIVE). The console has no
  enrolment or verification screen, so those buttons can only ever fail. The console also has no
  refund, settlement, restaurant-activation or order-action screens.
- **Fix:** MFA enrolment (QR) and step-up prompt in the console; then the missing operational screens.
- **Depends on:** `SDK-01`.
- **Verify:** grant a role from the console after entering a TOTP code.
- **Sync S-021 re-check (2026-11-18), CODE:** unchanged: no file in `apps/admin/src` mentions TOTP,
  MFA or step-up.
- **Sync S-029 (2026-11-18), RUN, branch `fix/admin-console-mfa`:** a "Sécurité" page enrols MFA (the key
  grouped by four and an `otpauth://` link; no QR code, to avoid a new dependency) and opens the step-up
  window; any console action answered 428 opens a code prompt and is retried (`lib/step-up-flow.ts`, 6 unit
  tests): roles, account status, the new "Remboursements" page (hand refunds of `PAY-04`) and an "Annuler"
  button on the orders list. New `GET /v1/auth/mfa/status`. `finance` can now log in to the console (Finance,
  Remboursements, Sécurité pages). Rendered in Chromium against the test API: enrolment with a real TOTP code,
  the prompt on an order cancellation then the order cancelled in the database, the refunds page with and
  without a pending row. Still missing: restaurant activation and settlement screens.

### GOV-01

**`main` is 41 commits behind the active branch; a fix branch is orphaned** · Needs Improvement · High · RUN · Status: Open — only the owner's old branch is left (sync S-021)

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
- **Sync S-021 re-check (2026-11-18), RUN:** mostly resolved: `main` is the reference branch and
  fully contains `claude/compassionate-franklin-k23vcj` (`git merge-base --is-ancestor`). Left: the
  owner's `fix/payment-reliability-backlog`, 6 commits not in `main` (its webhook and enablement
  fixes were re-applied as `PAY-05` and `PAY-01`, its PNG fix superseded), and the merged branch
  could be deleted. The owner's call.

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
- **Sync S-021 re-check (2026-11-18), CODE:** unchanged: the restaurant-creation schema still has no
  coordinates, and no route sets a restaurant's location.

### COUR-01

**Courier app tracks location only in the foreground; no push** · Partially Completed · High · CODE · Status: Open

- **Where:** `apps/courier/lib/location.ts` (foreground `watchPositionAsync`); notifications use a mock push provider.
- **Observed (code):** a courier is a dispatch candidate only with a position newer than 120 s
  (`courier_location_stale_seconds`). With the app in the background the position goes stale, and no
  push can announce an offer that expires after 30 s.
- **Fix:** background location task and real push; revisit the 30 s offer window for the field.
- **Depends on:** `MOB-01`.
- **Verify:** device test with the screen locked: an offer arrives and can be accepted.
- **Sync S-021 re-check (2026-11-18), CODE:** unchanged: `apps/courier/lib/location.ts` is still
  foreground only (it says so itself).

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
- **Sync S-021 re-check (2026-11-18), CODE:** now on `main`: with `MODE=live` the deploy runs the
  migrations only (`SEED_DEMO=0`), and no migration creates roles, permissions or ledger accounts,
  so a live server would start without them.

### OPS-06

**The demo server is paid by Oracle's trial credits and will be reclaimed when the trial ends** · Needs Improvement · High · CLAIM + DOC · Status: Open _(added 2026-11-18, sync S-030)_

- **Where:** the live server (not inspected: no access); `docs/ROADMAP.md` phase 1 ("Serveur Oracle
  Cloud (essai gratuit, x86 — l'offre ARM « Always Free » restait indisponible…)");
  `infra/deploy/README.md` §1.
- **Observed:** per the project's own roadmap, the demo runs on an **x86 instance of the free
  trial**. Oracle's Free Tier documentation (read on 2026-11-18): "Paid resources that were provisioned
  with your credits during your free trial are reclaimed by Oracle unless you upgrade your account."
  The deployment guide also told readers to create an Ampere A1 instance of **4 OCPUs and 24 GB** as
  "sans limite de durée"; Oracle's current Always Free allowance is **2 OCPUs and 12 GB** (1,500
  OCPU-hours and 9,000 GB-hours a month), and above it "all existing OCI Ampere A1 Compute instances are
  disabled and then deleted after 30 days, unless you upgrade to a paid account".
- **Why it matters:** at the end of the trial (around 2026-12-16 if the account was opened on
  2026-11-16; the console shows the date) the demo would go down **with its backups**, which are on
  the server's own disk.
- **Fix:** decide before the date: upgrade the account to Pay As You Go (with a budget alert), or move
  to an Always Free A1 instance (2/12, if capacity allows) or a paid VPS; in every case copy backups off
  the server. Runbook: `docs/38-exploitation-demo.md` §3. The guide's numbers are corrected.
- **Depends on:** a DJAFAT decision (cost); console access.
- **Verify:** the console shows a Pay As You Go account (or the demo runs elsewhere), and an off-server
  backup copy exists and passes `restore-check.sh`.

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
- **Sync S-012 note (2026-11-17), BRANCH + RUN:** on the NestJS 11 / Fastify 5 branch (`862ad24`), a
  2 MB body now answers 413 (checked on the built API); the other cases were not re-run.
- **Sync S-013 note (2026-11-17):** the 413 case is on `main` (pull request #7, `75db772`).

### DOC-03

**The local guide's placeholder secrets block local deliveries** · Broken · Medium · CODE · Status: Resolved on `main` (pull request #15, merged into `main` as `07dd23b` on 2026-11-18, sync S-032; `main`'s code is identical to the verified branch head); fix on `fix/env-init` (version 0.21.6), verified there (sync S-023) _(added 2026-11-14, sync S-008)_

- **Where:** `docs/TRAVAILLER-EN-LOCAL.md` §2 (`cp .env.example .env`, nothing about the secrets);
  `.env.example`; `deliveries.service.ts` `doMarkPickedUp` → `issueDeliveryCode`;
  `common/crypto/at-rest.ts` `keyOf`; `auth/crypto.util.ts` `encryptMfaSecret`.
- **Observed (CODE, not run):** the five secrets of `.env.example` are placeholders and the guide
  never says to replace them (`docs/36-pilot-e2e-scenario.md` does). The placeholder of
  `DELIVERY_CODE_ENCRYPTION_KEY` decodes to 22 bytes (computed with Node's decoder) and `keyOf`
  throws unless the key is 32 bytes. Pickup first moves the delivery to `on_the_way`, then issues the
  code; the encryption throws there, so the delivery stays on its way with no code and
  `confirmDelivered` can never succeed. MFA enrolment fails the same way on `MFA_ENCRYPTION_KEY`.
- **Why it matters:** a teammate who follows the guide cannot finish a delivery locally, and the
  failure appears mid-flow, not at start. Since 0.20.6 (pull request #4, `SEC-01`) the API at least
  lists the five placeholders in a warning at boot.
- **Fix:** make the guide produce real values (a small cross-platform script that fills `.env` from
  `.env.example` with random secrets, or one documented command per secret); consider making
  pickup and code issuance one transaction, so a failure cannot leave a delivery without a code.
- **Verify:** follow the guide on a fresh clone and deliver an order end to end.
- **Sync S-023 note (2026-11-18), RUN: fix on a branch.** `pnpm env:init` (`scripts/env-init.mjs`, plain Node)
  creates `.env` from `.env.example` if needed and gives the five secrets fresh random values wherever
  they are empty or placeholders (64 hex characters; AES keys that decode to 32 bytes); real values are
  kept and nothing is printed. The guide's step 2 and the Windows workflow use it. Verified: 5 tooling
  tests; a `.env` generated from the real `.env.example` booted the built API in production mode, where
  SEC-01 refuses weak secrets, with no complaint. Not run: a full delivery on a fresh clone.

### TEST-04

**The API integration suite fails intermittently on a local machine** · Needs Improvement · Medium · RUN · Status: Resolved on `main` (pull request #14, merged into `main` as `4336ef7` on 2026-11-18, sync S-032; `main`'s code is identical to the verified branch head); fix on `fix/test-loopback` (version 0.21.5), verified locally (sync S-022) _(added 2026-11-17, sync S-011)_

- **Where:** `apps/api/test` (`walking-skeleton`, `identity`, `webhook-forgery`); dispatch in
  `deliveries.service.ts` (`onOrderReady` → `createAndDispatch` → `runDispatchWave`).
- **Observed (RUN, 2026-11-17, fresh test database each run, same file order):** with pull request
  #4's code, 2 of 9 full runs failed. Once, `POST /v1/orders` in `webhook-forgery` never answered
  (30 s timeout). Once, `walking-skeleton`'s pickup answered 404 just after a successful accept, then
  `identity`'s order creation answered 404 (same customer). Pickup answers 404 only when the delivery is
  missing or no longer names that courier. No database session waited on a lock during that run
  (sampled every second). Four runs with diagnostics did not reproduce; the suite without pull request
  #4 passed 4 of 4; GitHub's CI has been green on every push. The failing requests' log lines were
  lost: the test process exits before its buffered log is written.
- **Why it matters:** an intermittent red build costs reruns and trust; the pickup 404 may hide a real
  race (a second `order.ready` dispatch wave changing the courier around the accept).
- **Fix:** capture the error codes (response body printed on failure, or synchronous logging in
  tests); check whether one order can trigger two dispatch waves.
- **Verify:** 20 consecutive full runs pass.
- **Sync S-012 note (2026-11-17), RUN + CODE: likely cause.** Every failure is a 404 (or no answer) on
  a route that exists, and the API never logged the request: a third case, `GET /v1/restaurants?search=`
  in `catalog`, did the same on the upgrade branch. Supertest opens the app on the IPv6 wildcard with a
  random port and then connects to `127.0.0.1`; on this machine several programs listen on random
  127.0.0.1-only ports, among them Prisma's query engine (`engineType = "binary"`, an HTTP server)
  started by every test file. macOS lets both binds coexist, so a request can reach the engine instead
  of the app; Linux refuses the second bind, which fits a CI that never fails. Not proven yet. Fix to
  try: start the test app with `app.listen(0, '127.0.0.1')` and point supertest at that address.
- **Sync S-022 note (2026-11-18), RUN: cause proven, fix on a branch.** A 30-line Node script reproduces it
  on this Mac: with a program listening on `127.0.0.1:P`, a second server still binds `[::]:P`, and a
  request to `127.0.0.1:P` reaches the first program; binding the second to `127.0.0.1` is refused
  (`EADDRINUSE`). `fix/test-loopback` starts the test app with `app.listen(0, '127.0.0.1')` (helper
  `apps/api/test/listen-on-loopback.ts`, used by all 11 files), so supertest and the Socket.IO clients
  reuse a port that is free on 127.0.0.1. Result: 5 consecutive full runs green (97/97 each), against 3
  failing runs out of 12 before. Verify asks for 20 consecutive runs: 5 done.

---

## Low

### FE-05

**Seeded restaurant and product images do not render** · Broken · Low · LIVE — `seed.ts` uses `placehold.co` URLs that return SVG; `/_next/image` answers 400. Use `.png` URLs in the seed. Development only. _Sync S-007 note (2026-11-14): fix present on `fix/payment-reliability-backlog` (`cb84077`: the seed asks placehold.co for PNG), not on `main` (BRANCH)._ _Sync S-009 note (2026-11-17): fix present on `main` (`c804526`, 0.20.3): the seed's 21 addresses ask for `.png`, and migration 0038 rewrites the stored `placehold.co` ones (all old ones carry the query string its pattern needs). The commit reports the live image optimizer answering 200 `image/png`; not re-checked by us (CODE)._

### FE-06

**Interface polish gaps** · Needs Improvement · Low · LIVE — no favicon in the three apps (404); on a 390 px screen the header wraps "Déconnexion — Client Test"; the admin order list shows raw status identifiers; the courier list shows only a UUID; login errors are generic whatever the cause. _Sync S-020 note (2026-11-18), CODE: the favicon part is fixed on `main` (`b141593`, pull request #12): the three web apps use the « D » icon through Next.js's `app/icon.png`; each is the 2048 px, 521 KB original, heavy for a favicon (a 512 px version would do). Not checked in a browser._ _Sync S-024 note (2026-11-18): the three favicons are 512 px, 44 KB instead of 521 KB, on `fix/favicon-512` (version 0.21.7); same image, resized._ _Sync S-032 note (2026-11-18): the favicon item is on `main` (pull request #12 added the icons, #16 resized them to 512 px, merged as `034123a`); the other items stay open._

### DB-01

**Schema hygiene** · Needs Improvement · Low · LIVE — `user_roles` has no primary key (unique expression index instead); about 50 foreign keys have no supporting index (mostly currency references; notable: `orders.dropoff_address_id`, `order_items.product_id`, `refunds.requested_by`); the encrypted delivery code is stored in `delivery_proofs.reference`, a column documented as an object-storage key; `wallet_balances` has no non-negative check; the Prisma schema models 46 of 52 tables and declares none of the indexes.

### DOC-01

**Entry-point documents were out of date** · Needs Improvement · Low · RUN — the root `README.md` and the former `docs/README.md` said "Bloc 0 not started"; two files are numbered `36`, none `26`; `DJAFAT-architecture-complete.md` (714 KB) and `djafat-docs.zip` duplicate the dossier in the repository. Not corrected by the audit: on 2026-11-11 its own documents moved to `docs_2/` and `docs/` and the root `README.md` were restored to their committed state, so these files stay with their owners _(updated 2026-11-11)_.

### DOC-02

**Earlier "GO" verdicts covered the API only** · Needs Improvement · Low · LIVE — `docs/36-bloc-13-hardening.md` concludes "GO" for a pilot and `docs/36-pilot-e2e-scenario.md` reports 19/19. Both runs drove the API with `curl`; the same journey fails in a browser (`SDK-01`, `FE-01`), and the cited integration tests cannot run (`TEST-01`). _Sync S-001 note (2026-11-11): the active branch's new `docs/ROADMAP.md` makes the same kind of claim — pilot functions "faites et vérifiées en vrai", integration tests 92/93 — which this audit has not been able to verify (BRANCH)._ _Sync S-006 note (2026-11-13): run locally on `4c756e0`, the customer, restaurant, courier and admin journeys work end to end, with one gap the roadmap does not mention: the customer cannot see the delivery code (`FE-03`) (RUN)._ _Sync S-014 note (2026-11-17), BRANCH: the owner's roadmap on `feat/welcome-greeting` (`cabf058`) says the API is "techniquement terminé" and that every remaining item only waits for an external account, "aucun code à écrire". The audit still lists open findings that need code, among them `PAY-04` (no refund when a paid order is rejected or cancelled), `PAY-06` (no payouts), `ORD-01` (no cancellation), `ORD-02` (no confirmation timeout), `FE-02` (no token refresh), `ARCH-01` and `TEST-04`._

### OPS-04

**Install is refused on the current Node release** · Needs Improvement · Low · RUN — `engines.node` is `>=20 <25` with `engine-strict=true`; `pnpm install` stops on Node 26. Correct behaviour, undocumented: the README should name Node 22 and how to get it.

### RT-01

**Realtime details** · Needs Verification · Low · LIVE — authentication, room authorisation and event delivery work on one instance (LIVE). Unproven with two instances; `subscribe` sends no acknowledgement, so a refused join is silent; the gateway accepts any origin.

### I18N-01

**Text is hard-coded in French** · Partially Completed · Low · CODE — `@djafat/i18n` is used by five files; most strings are inline. Arabic and right-to-left are not started (planned for V2).

### QA-01

**Accessibility and performance were not measured** · Needs Verification · Low — no Lighthouse, screen-reader or load test was run. First-load JavaScript is 105–143 kB per route (build output).

### CI-02

**The pre-push secret scan never reads the pushed commits** · Broken · Low · RUN — `.husky/pre-push` runs `gitleaks protect --staged`, which scans the staged changes; when `git push` runs, the index is normally empty. In a throwaway repository with a fake GitHub token committed and a clean index, the command scanned 0 bytes and reported no leaks, while a scan of the commit found the token. A secret is therefore caught only by CI, after it has left the machine. Fix: scan the commits no remote has yet, `gitleaks git --redact --config .gitleaks.toml --log-opts="HEAD --not --remotes"` (gitleaks 8.19 or later; the refs Git passes to the hook on standard input give the exact range when another branch is pushed). In the same throwaway repository it scanned exactly the unpushed commits and found the token (T-313). Found in sync S-003 (2026-11-11); the collaborator's branch leaves `.husky/` unchanged.

### CI-03

**The pre-commit hook cannot run ESLint on `main`** · Broken · Low · RUN — `lint-staged` runs `eslint --fix` on staged code files from the repository root, but `eslint` is not a root dependency, and pnpm's isolated layout puts no `eslint` in the root `node_modules/.bin`. Any commit that touches a `.ts`, `.tsx`, `.js`, `.mjs` or `.cjs` file is refused with "eslint … failed without output (ENOENT)". This was seen on 2026-11-12 while committing pull request #3, so such commits on `main` must have been made without the hook. The root `eslint.config.mjs` itself works: with the workspace's ESLint 9.17.0 put on `PATH`, the hook ran in full. Fix: add `eslint` 9.17.0 to the root `devDependencies`, as `claude/compassionate-franklin-k23vcj` already does (T-407). Found in sync S-004.

### FE-07

**Typed routes are configured but never checked** · Broken · Low · RUN — `apps/web` enables `typedRoutes`, but its `tsconfig.json` lists `.next` under `exclude`, and an exclusion overrides the `.next/types/**/*.ts` include. So the generated link types are loaded neither by `tsc` nor by `next build`. On `next` 15.5.29, a page linking to a route that does not exist built without error. With the generated types loaded, `tsc` reports that link, and one existing one: a plain `string` passed as `href` in `src/app/restaurants/[slug]/products/[productId]/page.tsx` (line 29). The same `tsconfig.json` is on `main` (CODE). Fix: remove `.next` from `exclude` (the `include` list only pulls in `.next/types`) and type that link; optionally run `next typegen` before `tsc` so the typecheck step catches it before the build (T-408). Found in sync S-004.

### PAY-09

**Payment idempotency details** · Needs Improvement · Low · CODE — the idempotency scope for payments, cancels and refunds is global rather than per user; `payments.attempt_no` is never incremented; a stale `reserved` key (process died mid-request) blocks its key forever.

### TEST-05

**The mobile typecheck is silenced by a known-failure entry** · Needs Improvement · Low · CODE · Status: Open on `main`; fix present on `fix/mobile-typed-routes` (version 0.21.8), verified there (sync S-025) _(added 2026-11-17, sync S-014; on `main` since pull request #8, `57120ed`, sync S-019)_ — `cabf058` on `feat/welcome-greeting` records `@djafat/mobile#typecheck` in `scripts/pipeline/baselines/known-failures.json` as pre-existing ("expo-router's generated route-literal type is stale…"). On `main` it passes (RUN, 2026-11-17: `turbo run typecheck --filter=@djafat/mobile`, and in every `verify:fast` run that day; CI green): it fails only where Expo has generated its typed routes (`.expo/types`, gitignored), against calls such as `router.push(`/orders/${id}`)`. Once the entry is in, any real mobile type error is reported as pre-existing on every machine. Fix: write those calls in typed-route form (or regenerate the types) and drop the entry. Verify: with `.expo/types` generated, `pnpm --filter @djafat/mobile typecheck` passes. _Sync S-025 note (2026-11-18), RUN: reproduced (Expo's dev server generated `.expo/types`; the type check then failed with 9 errors, all calls cast to `` `/${string}` ``). The nine calls now use typed-route objects (`{ pathname, params }`), and login only follows an in-app `redirect` (`/(app)/…`). The type check passes with the generated types (0 errors) and without them, as in CI (0 errors); the `@djafat/mobile#typecheck`entry is removed from`known-failures.json`, together with the stale `@djafat/mobile#build`and`@djafat/courier#build`entries (both apps build:`expo export` succeeded for each). Navigation not run on a device.\_

---

Last updated: 2026-11-17 (sync S-014)
