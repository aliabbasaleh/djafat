# Project status

**The single source of truth for where DJAFAT stands.** Update it with every meaningful change
(rules in [`README.md`](README.md)). Details live in the linked documents; this page points.

|                        |                                                                                                                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Last updated**       | 2026-11-21                                                                                                                                                                                                                                                                  |
| **Branch described**   | `main` @ `afaa7c2` (DJAFAT 0.23.4) — pull requests #13 to #24 merged on 2026-11-18 _(sync S-034)_                                                                                                                                                                           |
| **Evidence collected** | 2026-11-10 for the old `main`; 2026-11-13 end-to-end run of the code now on `main`; hosted CI                                                                                                                                                                               |
| **Last synced**        | S-050, 2026-11-25 — `main` is `c6e5ac1` (0.24.5). Open: PR #29 (0.24.6), #28 (FEAT-021, 0.25.0), #31 (FEAT-022 parts 1-2, 0.26.0), #32 (FEAT-024 + part 4, 0.27.0) and, above it, FEAT-022 part 3 (0.28.0, to merge with #32). GitHub's checks still do not start (billing) |
| **Updated by**         | Initial full audit; syncs S-001 to S-034                                                                                                                                                                                                                                    |

---

## 1. Overall status

**The backend core works; the product cannot be used end to end.**

Driven directly through the API, a prepaid order travels the whole way — cart, order, payment,
kitchen, dispatch, courier, delivery code, delivered, ledger and wallets — and the security
boundaries between customers, restaurants, couriers and staff hold. That was reproduced on a real
PostgreSQL and Redis on 2026-11-10.

Through the applications people would actually use, it does not work:

1. None of the three web apps can call the API from a browser ([`SDK-01`](FINDINGS.md#sdk-01)).
2. No customer app has a payment step ([`FE-01`](FINDINGS.md#fe-01)).
3. Cash on delivery — the main payment method in the market — never places an order ([`PAY-02`](FINDINGS.md#pay-02)).
4. The only working payment method is a test provider that anyone can use to order for free ([`PAY-01`](FINDINGS.md#pay-01)).
5. Refunds crash ([`PAY-03`](FINDINGS.md#pay-03)); login cannot work in production ([`AUTH-01`](FINDINGS.md#auth-01)).
6. Neither mobile app can be built, including the courier app ([`MOB-01`](FINDINGS.md#mob-01)).
7. Every CI workflow is red and the integration tests cannot run ([`CI-01`](FINDINGS.md#ci-01), [`TEST-01`](FINDINGS.md#test-01)).

**Not ready for a pilot with real users or for production.** Earlier documents concluded "GO";
those runs exercised the API with `curl` only ([`DOC-02`](FINDINGS.md#doc-02)).

One more fact shapes everything below: `main` is **41 commits behind** an active remote branch that
already fixes some of these and adds much more _(updated 2026-11-11, sync S-001: was 37)_ ([`GOV-01`](FINDINGS.md#gov-01),
[`UNMERGED_BRANCHES.md`](UNMERGED_BRANCHES.md)).

| Open findings | Critical | High | Medium | Low |
| ------------- | -------- | ---- | ------ | --- |
| 49            | 3        | 11   | 22     | 13  |

_(updated 2026-11-17, sync S-014)_ One new Low finding, on the owner's new branch: it records the mobile typecheck as a
known failure, which would hide real mobile type errors ([`TEST-05`](FINDINGS.md#test-05)).

_(updated 2026-11-17, sync S-013)_ Five findings resolved on `main` by the merge of pull request #4 (see below).

_(updated 2026-11-17, sync S-011)_ One new Medium finding: the integration suite failed intermittently in 2 of 9 local
runs of pull request #4, cause not found ([`TEST-04`](FINDINGS.md#test-04)).

_(updated 2026-11-14, sync S-008)_ One new Medium finding, from writing the `SEC-01` fix: the local guide keeps the
placeholder secrets, so a delivery cannot be completed locally ([`DOC-03`](FINDINGS.md#doc-03)).

Sync S-001 added one High finding, on the active branch only: a live server deployed from it would start without roles, permissions or ledger accounts ([`OPS-05`](FINDINGS.md#ops-05)). The other changes it brought are summarised in [`history/SYNC_LOG.md`](history/SYNC_LOG.md).

_(updated 2026-11-11, sync S-003)_ Sync S-003 added one Low finding: the local pre-push secret scan never reads the pushed commits ([`CI-02`](FINDINGS.md#ci-02)). It also found that the hosted dependency audit now lists five critical advisories in `next` 15.1.3, four of them remote code execution, and that the active branch's audit baseline accepts them ([`DEP-01`](FINDINGS.md#dep-01)).

_(updated 2026-11-12, sync S-004)_ Pull request #3 upgrades `next` to 15.5.29 in the three web apps. Verified on that branch: the hosted audit lists no `next` advisory (critical advisories 8 → 3, all outside `next`), the local checks pass, and a page-by-page browser comparison with `main`'s build found no regression. Two Low findings were added: the pre-commit hook cannot run ESLint on `main` ([`CI-03`](FINDINGS.md#ci-03)), and typed routes are never checked ([`FE-07`](FINDINGS.md#fe-07)).

_(updated 2026-11-12, sync S-005)_ Two more commits on pull request #3 copy fixes from pull request #1: the Expo apps now bundle there ([`MOB-01`](FINDINGS.md#mob-01), CI build passes) and the integration job reaches its tests (`TEST-01` remains). The local run was re-verified on the audit machine with a generated `.env` ([`DEPLOYMENT_AND_ENVIRONMENT.md`](DEPLOYMENT_AND_ENVIRONMENT.md) §2); browser login on `main` still needs [`SDK-01`](FINDINGS.md#sdk-01).

_(updated 2026-11-13, sync S-006)_ The collaborator's branch (pull request #1, `4c756e0`) was run locally end to end, through the real screens. A customer logged in, ordered and paid cash; the restaurant accepted and readied the order; the courier received the offer, picked up and delivered; the ledger balanced. On that branch this verifies the fixes for [`SDK-01`](FINDINGS.md#sdk-01), [`FE-01`](FINDINGS.md#fe-01) (cash) and [`PAY-02`](FINDINGS.md#pay-02), and its CI is fully green, the integration suite included ([`TEST-01`](FINDINGS.md#test-01)). One gap remains there: the customer cannot see the delivery code ([`FE-03`](FINDINGS.md#fe-03)), and the courier cannot deliver without it. None of this is on `main` until pull request #1 is merged.

_(updated 2026-11-14, sync S-007)_ **Pull request #1 was merged into `main` on 2026-11-13 (`46d8cae`, DJAFAT 0.20.1), and both workflows are green on `main` for the first time.** Resolved on `main`: [`SDK-01`](FINDINGS.md#sdk-01), [`FE-01`](FINDINGS.md#fe-01) (cash), [`PAY-02`](FINDINGS.md#pay-02), [`TEST-01`](FINDINGS.md#test-01), [`CI-01`](FINDINGS.md#ci-01). Still open there: no screen shows the delivery code ([`FE-03`](FINDINGS.md#fe-03)), refunds crash ([`PAY-03`](FINDINGS.md#pay-03), fix waiting in a branch), placeholder secrets accepted ([`SEC-01`](FINDINGS.md#sec-01)), webhooks stored before their signature check ([`PAY-05`](FINDINGS.md#pay-05)), disabled providers usable ([`PAY-01`](FINDINGS.md#pay-01)), vulnerable dependencies ([`DEP-01`](FINDINGS.md#dep-01)), no device build of the Expo apps ([`MOB-01`](FINDINGS.md#mob-01)).

_(updated 2026-11-17, sync S-009)_ **The demo is online.** `main` is at `9058e33` (DJAFAT 0.20.3): pull request #5
(`07f2539`: the SDK's `fetch` bound to the global object, clearer login errors, a worker that
survives a database blip) and pull request #6 (`c804526`: demo photos as PNG) were merged on
2026-11-16, and the roadmap reports the demo online at djafat.com since that day. On 2026-11-17
its five addresses answered HTTP 200 ([`OPS-02`](FINDINGS.md#ops-02)). Our pull requests #2, #3
and #4 are still open and now conflict with `main`: the versions they carry (0.20.2 to 0.20.6)
overlap the two `main` has used, so they are renumbered from 0.20.4 when brought onto it
([`UNMERGED_BRANCHES.md`](UNMERGED_BRANCHES.md) §1).

_(updated 2026-11-17, sync S-010)_ Done the same day: #2 is 0.20.4 (`d366f12`), #3 0.20.5 (`c715ae2`), #4 0.20.6 to
0.20.9 (`2319186`), which now also fixes [`PAY-05`](FINDINGS.md#pay-05).

_(updated 2026-11-17, sync S-013)_ **The audit's fixes are on `main`.** Pull requests #2, #3, #4 and #7 were merged in
order on 2026-11-17, each with every check green (Linux CI with the integration job, Windows,
Security): `main` is at `75db772` (DJAFAT 0.20.11). Resolved there: [`PAY-01`](FINDINGS.md#pay-01),
[`PAY-03`](FINDINGS.md#pay-03), [`SEC-01`](FINDINGS.md#sec-01), [`FE-03`](FINDINGS.md#fe-03) and
[`PAY-05`](FINDINGS.md#pay-05). [`DEP-01`](FINDINGS.md#dep-01) is down to the Expo tool chain,
`postcss` and `zod`; the API is on NestJS 11 and Fastify 5.

_(updated 2026-11-18, sync S-021)_ **Re-check of the open Critical and High findings** against `main` (`8ceb437`). None is
fully resolved; seven have moved: [`AUTH-01`](FINDINGS.md#auth-01) (code ready, waits for an SMS
account), [`MOB-01`](FINDINGS.md#mob-01) (bundles, never run on a device), [`PAY-06`](FINDINGS.md#pay-06)
(courier payouts), [`PAY-07`](FINDINGS.md#pay-07) (manual merchant wallets), [`TEST-02`](FINDINGS.md#test-02)
(SQL tested, UI not), [`OPS-02`](FINDINGS.md#ops-02) (deployed with backups, no monitoring) and
[`GOV-01`](FINDINGS.md#gov-01) (only the owner's old branch left). Unchanged: `PAY-04`, `ORD-01`, `ORD-02`,
`FE-02`, `ARCH-01`, `OPS-01`, `SEC-02`, `ADM-01`, `ADM-02`, `ADM-03`, `DLV-01`, `COUR-01`, `OPS-05`; `DEP-01`
has 37 advisories (1 critical).

_(updated 2026-11-18, sync S-031)_ **Ten pull requests are open, #13 to #22, none merged.** _(updated 2026-11-18, sync S-032: #13 to #16 are now merged into `main`; #17 to #23 are open.)_ _(updated 2026-11-18, sync S-034: all merged — #13 to #24 are on `main`, which is DJAFAT 0.23.4.)_ They carry
fixes for `TEST-04`, `DOC-03`, `TEST-05`, `ADM-01`, `ADM-02`, `ORD-01`, `PAY-04`, `ORD-02`, `FE-02` and
`ADM-03` (and the `FE-06` favicon follow-up), plus monitoring and a tested restore for `OPS-02`. Merge order,
verification and the decisions they wait for: the report in [`history/CHANGELOG.md`](history/CHANGELOG.md)
and [`UNMERGED_BRANCHES.md`](UNMERGED_BRANCHES.md) §2d. **Urgent:** [`OPS-06`](FINDINGS.md#ops-06), the demo
server is paid by the Oracle trial credits and will be reclaimed when the trial ends.

_(updated 2026-11-21, sync S-035)_ **Customer accounts by e-mail and password (FEAT-020) are built and verified on the branch
`feat/compte-email-password`** (version 0.24.0): unit tests for every scenario, the integration suite on a fresh database,
and a real browser run of the site. Before production: merge, then set the official Gmail address and its app password in
the server's `.env.prod` (task T-611). The same branch fixes [`API-02`](FINDINGS.md#api-02): browsers could not send PUT,
PATCH or DELETE to `api.djafat.com` (profile name, cart quantities, addresses, the restaurant console's edits).

## 2. Current development phase

**Phase 0 — Decide the integration line**, then **Phase 1 — Critical bugs and blockers.**
Roadmap: [`tasks/PRIORITY_TASKS.md`](tasks/PRIORITY_TASKS.md).

## 3. Applications

| Application       | Purpose                   | State on `main`                                                                                          | Detail                                             |
| ----------------- | ------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `apps/api`        | REST + realtime backend   | **Partially Completed** — core flow verified; payments, refunds, cash, cancellation defective or missing | [API](applications/API.md)                         |
| `apps/worker`     | Background jobs           | **Partially Completed** — 4 jobs run; several required jobs missing                                      | [WORKER](applications/WORKER.md)                   |
| `apps/web`        | Customer website          | **Broken** in a browser; no payment step                                                                 | [WEB](applications/WEB.md)                         |
| `apps/restaurant` | Restaurant console        | **Broken** in a browser; screens work once `SDK-01` is fixed                                             | [RESTAURANT](applications/RESTAURANT.md)           |
| `apps/admin`      | Back-office console       | **Broken** in a browser; read-mostly; role management unusable                                           | [ADMIN](applications/ADMIN.md)                     |
| `apps/courier`    | Courier mobile app        | **Broken** — cannot be bundled                                                                           | [COURIER](applications/COURIER.md)                 |
| `apps/mobile`     | Customer mobile app       | **Broken** — cannot be bundled; no payment step                                                          | [MOBILE](applications/MOBILE.md)                   |
| `packages/*`      | Shared code (10 packages) | **Completed** except the SDK defect and missing SDK bindings                                             | [SHARED_PACKAGES](applications/SHARED_PACKAGES.md) |

## 4. Completed and verified

Verified on 2026-11-10 unless noted. "LIVE" = against the running system.

**Toolchain and build**

- [x] Install with Node 22 / pnpm 9.15.4 (RUN)
- [x] Formatting, typecheck (24 tasks), lint (0 warnings) (RUN)
- [x] 1 146 unit tests pass in 12 packages (RUN) — [`TESTING…`](TESTING_AND_QUALITY_ASSURANCE.md) §2
- [x] API and worker production builds; `next build` for web, admin, restaurant (RUN)
- [x] 29 migrations apply to PostgreSQL 16 + PostGIS; seed succeeds (RUN)

**Identity and access** — [`modules/AUTH_AND_IDENTITY.md`](modules/AUTH_AND_IDENTITY.md)

- [x] OTP login (development mock) for all eight roles (LIVE)
- [x] Per-phone OTP limit; durable phone lock (LIVE)
- [x] Refresh rotation; reuse detection revokes the session family after the 5 s grace (LIVE)
- [x] Role and permission walls on admin, finance, support, courier and restaurant routes (LIVE)
- [x] TOTP enrolment, step-up window, role grant/revoke rules (no self-grant, admin cannot create admin) (LIVE)

**Tenant isolation**

- [x] A customer cannot read or act on another customer's order, payment, delivery, delivery code or address (LIVE)
- [x] A restaurant owner cannot modify another restaurant's profile, products or categories (LIVE)

**Catalog, cart, orders** — [`modules/CATALOG.md`](modules/CATALOG.md), [`modules/CART_AND_ORDERS.md`](modules/CART_AND_ORDERS.md)

- [x] Restaurant list, search, availability, menu, product options (LIVE)
- [x] Cart with required options, quote, one open cart per user (LIVE)
- [x] Order creation is idempotent; a second key on a spent cart is refused; closed restaurant refused (LIVE)
- [x] Unpaid orders expire with their pending payment (LIVE)

**Prepaid order to delivery** — [`modules/PAYMENTS_AND_LEDGER.md`](modules/PAYMENTS_AND_LEDGER.md), [`modules/DELIVERY_AND_DISPATCH.md`](modules/DELIVERY_AND_DISPATCH.md)

- [x] Payment (test provider) → order placed → confirm → ready → offer → accept → pickup → code → delivered (LIVE)
- [x] Delivery code refused to the courier, shown to the customer; wrong code refused (LIVE)
- [x] Ledger balanced; restaurant and courier balances correct (LIVE)

**Realtime** — [`modules/REALTIME_AND_NOTIFICATIONS.md`](modules/REALTIME_AND_NOTIFICATIONS.md)

- [x] Unauthenticated sockets refused; room access enforced; events delivered through outbox → worker → stream → socket (LIVE, one instance)

**Screens (with `SDK-01` patched in the browser only)** — [`UI_UX_AUDIT.md`](UI_UX_AUDIT.md)

- [x] Customer: login, catalog, product, cart, address book, order page render and operate (LIVE)
- [x] Restaurant: board, menu, hours, balance, profile, history (LIVE)
- [x] Admin: users, orders, restaurants, couriers, finance (LIVE)

**Repository hygiene**

- [x] No real secret in the Git history (gitleaks 8.30.1, all refs, 109 commits) (RUN)

## 5. Partially completed

- [ ] Payments — test provider only; enablement not enforced; no cash; no real provider → `PAY-01`, `PAY-02`, `PAY-07`
- [ ] Refunds — endpoint exists, crashes; no automatic refund → `PAY-03`, `PAY-04`
- [ ] Sessions in the apps — login only, no refresh → `FE-02`
- [ ] Courier app — screens exist; cannot be built; foreground location only → `MOB-01`, `COUR-01`
- [ ] Notifications — stored server-side, not shown or pushed → `NOTIF-01`
- [ ] Pricing — flat delivery fee; no zones, taxes, promotions → `ORD-05`
- [ ] Admin console — read-mostly → `ADM-03`
- [ ] Background jobs — 4 of the jobs the design calls for → `WRK-01`
- [ ] Translations — French inline; package barely used → `I18N-01`

## 6. Outstanding tasks

Full list with acceptance criteria: [`tasks/BACKLOG.md`](tasks/BACKLOG.md). Order: [`tasks/PRIORITY_TASKS.md`](tasks/PRIORITY_TASKS.md).

| Phase                                         | Tasks | Not started | In progress | Done |
| --------------------------------------------- | ----- | ----------- | ----------- | ---- |
| 0 — Integration line                          | 1     | 1           | 0           | 0    |
| 1 — Critical bugs and blockers                | 10    | 10          | 0           | 0    |
| 2 — Core workflows                            | 17    | 17          | 0           | 0    |
| 3 — Security, reliability, data integrity     | 12    | 12          | 0           | 0    |
| 4 — Architecture and code quality             | 6     | 6           | 0           | 0    |
| 5 — UI/UX and performance                     | 6     | 6           | 0           | 0    |
| 6 — Testing, deployment, production readiness | 7     | 7           | 0           | 0    |

## 7. Critical bugs and unresolved issues

- [x] `SDK-01` Browser calls fail in all web apps → T-101 (resolved on `main` `46d8cae`; _sync S-007_)
- [x] `PAY-01` Free orders through a disabled provider → T-102 (resolved on `main` `44ae073`; _sync S-013_)
- [x] `PAY-03` Refunds crash → T-103 (resolved on `main` `44ae073`; _sync S-013_)
- [x] `SEC-01` Boots with published placeholder secrets → T-104 (resolved on `main` `44ae073`: production refuses them; _sync S-013_)
- [ ] `DEP-01` Critical dependency vulnerabilities → T-105 (the `next` part is fixed on pull request #3, not merged; _updated 2026-11-12, sync S-004_; both parts on `main` (`f9a8f41`, `75db772`); left: Expo tool chain, `postcss`, `zod`; _sync S-013_)
- [ ] `MOB-01` Expo apps cannot be bundled → T-106, T-210
- [x] `PAY-02` Cash on delivery never places an order → T-202 (resolved on `main` `46d8cae`; _sync S-007_)
- [x] `FE-01` No payment step → T-201 (cash payment step resolved on `main` `46d8cae`; other methods not tried; _sync S-007_)
- [ ] `AUTH-01` No real OTP delivery → T-203

High-priority issues: see [`FINDINGS.md`](FINDINGS.md) index.

## 8. Prioritised improvements

1. Make the money paths correct before adding payment methods: `PAY-01`, `PAY-03`, `PAY-04`, `PAY-05`.
2. Make failure recoverable: durable reactions and reconcilers (`ARCH-01`), cancellation (`ORD-01`), confirmation timeout (`ORD-02`).
3. Make testing real: runnable integration suite, SQL-level and browser tests (`TEST-01`, `TEST-02`).
4. Make it deployable: secrets validation, production bootstrap, deployment stack, monitoring (`SEC-01`, `SEC-02`, `OPS-02`, `OBS-01`).

Reasoning: [`RISKS_AND_RECOMMENDATIONS.md`](RISKS_AND_RECOMMENDATIONS.md).

## 9. Blocked tasks

Detail: [`tasks/BLOCKED_TASKS.md`](tasks/BLOCKED_TASKS.md).

| Task                              | Blocked by                             |
| --------------------------------- | -------------------------------------- |
| T-001 Choose the integration line | Decision by the repository owner       |
| T-203 Real OTP delivery           | Choice and contract of an SMS provider |
| T-215 Real mobile-money provider  | Provider access and sandbox            |
| T-202 Cash on delivery            | Product decision on cash limits        |
| T-205 Automatic refunds           | Business policy: who bears a refund    |
| T-216 Payouts                     | Payout policy; T-215                   |
| T-603 Deployment stack            | Hosting decision                       |

## 10. Current development focus

Nothing is in progress. The audit made no change to application code.

## 11. Next recommended actions

**Standing rule — after every pull or fetch:** run the incremental audit sync
([`README.md`](README.md) §3) before other work. Every Claude Code session in this repository is
reminded automatically (shared hook in `.claude/settings.json`) when the code has moved past
[`history/LAST_REVIEWED_COMMIT`](history/LAST_REVIEWED_COMMIT).

1. **Bring over what is left on `fix/payment-reliability-backlog`** (T-001). The larger branch is merged (pull request #1, `46d8cae`, _sync S-007_). The owner's branch now conflicts with `main` in 8 files, so take its unique changes one by one rather than merging it: webhook signature first (`PAY-05`), PNG seed images (`FE-05`), clearer login errors, closed restaurants ranked last. _(sync S-009: its PNG seed fix `cb84077` is superseded by `c804526` on `main`.)_
2. **Phase 1, in order:** T-101 (SDK), T-102 (payment enablement), T-103 (refund crash), T-104 (secret validation), T-107 (webhook order), T-108/T-109 (runnable tests, green CI), T-110 (`infra:up`), T-105 (dependency upgrades), T-106 (unblock the build). _(updated 2026-11-14, sync S-008)_ On pull request #4: T-103, T-104 and T-208 are done and verified, waiting for merge; T-107 and T-102 come next there. _(updated 2026-11-17, sync S-010)_ T-107 is done there too (0.20.9); T-102 is next. _(updated 2026-11-17, sync S-011)_ T-102 too (0.20.10): the five blocking fixes are all on pull request #4. Next: the Fastify/NestJS upgrade (T-105), on its own pull request. _(updated 2026-11-17, sync S-012)_ Done on `fix/api-nest11-fastify5` (0.20.11), stacked on #4: the API's advisories are gone.
3. **Take the three product decisions** that gate Phase 2: cash limits, refund policy, SMS provider.

## 12. Change log

Recent entries; full history in [`history/CHANGELOG.md`](history/CHANGELOG.md).

| Date       | Change                                                                                                                                                                                                                                                                                           | Verified                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 2026-11-18 | Sync S-034: pull requests #17 to #24 merged into `main` (`afaa7c2`, DJAFAT 0.23.4) at the user's request; `TEST-05`, `ADM-01`, `ADM-02`, `ORD-01`, `PAY-04`, `ORD-02`, `ADM-03`, `SEC-02`, `OPS-05` resolved on `main`; `FE-02` merged, browser check pending; no pull request of ours left open | Checks green before each merge; `main`'s tree identical to the verified tip of #24                                     |
| 2026-11-18 | Sync S-033: `SEC-02`, `OPS-05` — reference data at every deploy (never undoes a server setting), demo fixtures refused in production, `create-super-admin.ts` (`fix/live-bootstrap`, 0.23.4)                                                                                                     | Fresh-database checks (37 assertions); integration suite 112/112                                                       |
| 2026-11-18 | Sync S-032: pull requests #13 to #16 merged into `main` (`034123a`, DJAFAT 0.21.7) at the user's request; `TEST-04` and `DOC-03` resolved on `main`; #17 to #23 still open                                                                                                                       | Checks green before each merge; `main`'s tree identical to the verified tip of #16                                     |
| 2026-11-18 | Sync S-031: tracking report — ten open pull requests (#13 to #22) carry fixes for 11 findings and part of `OPS-02`, none merged; decisions waiting on the refund policy, the Oracle trial (`OPS-06`) and the external accounts                                                                   | `git log` of the stack; CI states read on GitHub                                                                       |
| 2026-11-18 | Sync S-030: `OPS-02` health check with phone alerts and weekly restore check (`fix/ops-monitoring`, 0.23.1); new `OPS-06` (the trial-paid demo server is reclaimed at the end of the trial); external accounts checklist (`docs/39`)                                                             | Restore drill on a real dump; scripts tested locally; Oracle docs read                                                 |
| 2026-11-18 | Sync S-029: `ADM-03` console MFA enrolment and step-up prompt, refunds page, order cancel button, finance access; `ADM-02` step-up on account status (`fix/admin-console-mfa`, 0.23.0)                                                                                                           | Unit tests; integration suite 112/112; console rendered in Chromium                                                    |
| 2026-11-18 | Sync S-028: `FE-02` sessions renewed on a 401 (single flight, one tab at a time), sockets renew and reconnect after an expiry close (`fix/token-refresh`, 0.22.1)                                                                                                                                | SDK unit tests; live check against the API with 4-second tokens                                                        |
| 2026-11-18 | Sync S-027: `ORD-01` cancel routes and buttons; `PAY-04` automatic refund, accrual reversed before the kitchen starts, hand-refund queue; `ORD-02` confirmation timeout job (`fix/order-cancel-refund`, 0.22.0)                                                                                  | Unit tests; integration suite 111/111; worker job run against PostgreSQL                                               |
| 2026-11-18 | Sync S-026: `ADM-01` finance can enrol MFA; `ADM-02` no status change on oneself or on an admin/super_admin unless super_admin, sessions revoked, refresh refuses inactive accounts (`fix/admin-roles`, 0.21.9)                                                                                  | Unit tests; integration suite 103/103                                                                                  |
| 2026-11-18 | Sync S-025: `TEST-05` — the mobile app's 9 navigation calls in typed-route form; `known-failures.json` emptied (`fix/mobile-typed-routes`, 0.21.8)                                                                                                                                               | Type check with and without generated routes; both Expo builds                                                         |
| 2026-11-18 | Sync S-024: favicons resized to 512 px, 44 KB instead of 521 KB (`fix/favicon-512`, 0.21.7)                                                                                                                                                                                                      | Image checked by eye; CI builds the three apps                                                                         |
| 2026-11-18 | Sync S-023: `DOC-03` — `pnpm env:init` gives the local `.env` real secrets; guide and Windows workflow use it (`fix/env-init`, 0.21.6)                                                                                                                                                           | 5 tooling tests; production boot with a generated `.env`                                                               |
| 2026-11-18 | Sync S-022: `TEST-04` — port collision reproduced; the integration app now listens on 127.0.0.1 (`fix/test-loopback`, 0.21.5)                                                                                                                                                                    | 5 full runs green in a row (97/97)                                                                                     |
| 2026-11-18 | Sync S-021: the 21 open Critical and High findings re-checked against `main` (`8ceb437`): 7 moved, 14 unchanged, none fully resolved                                                                                                                                                             | Code read; `pnpm audit`, CI results, demo addresses                                                                    |
| 2026-11-18 | Sync S-020: the owner's pull request #12 on `main` (`8ceb437`, 0.21.2): logo without the arrowhead, favicons, `picomatch` advisory baselined (no fix published)                                                                                                                                  | CI and Security green on `8ceb437`; `pnpm audit` re-run                                                                |
| 2026-11-17 | Sync S-019: the owner's pull request #8 merged into `main` (`57120ed`, 0.21.0): the greeting, Windows quoting, the roadmap; `TEST-05` now on `main`                                                                                                                                              | CI and Security green on `57120ed`; the merge adds nothing of its own                                                  |
| 2026-11-17 | Sync S-018: pull requests #9 (`5d4befd`) and #10 (`29d3d04`) merged into `main` (0.20.16); `7cfeaa6` brings `main` (up to #9) into the owner's branch                                                                                                                                            | Every check green on #9 and #10; merges add nothing of their own                                                       |
| 2026-11-17 | Sync S-017: on #10, `djafat/ogo.png` renamed `djafat/logo.png` (0.20.16)                                                                                                                                                                                                                         | Rename only (same file content)                                                                                        |
| 2026-11-17 | Sync S-016: `6198a89` merges `main` into the owner's `feat/welcome-greeting` (#8, 0.21.0); our brand assets on #10 (0.20.14); merge order #9, #10, #8                                                                                                                                            | Read; combined diff of the merge                                                                                       |
| 2026-11-17 | Sync S-015: CI and Security green on `main` (`75db772`); the user's local run moved to `main` and checked; S-012's shutdown note corrected                                                                                                                                                       | Hosted runs on `main`; local HTTP checks                                                                               |
| 2026-11-17 | Sync S-014: the owner's new branch `feat/welcome-greeting` (`cabf058`, 0.21.0 there: greeting on the four apps, Windows quoting, roadmap); new `TEST-05`                                                                                                                                         | Read; mobile typecheck re-run on `main` (passes)                                                                       |
| 2026-11-17 | Sync S-013: pull requests #2, #3, #4 and #7 merged into `main` (`75db772`, 0.20.11); `PAY-01`, `PAY-03`, `SEC-01`, `FE-03`, `PAY-05` resolved                                                                                                                                                    | Every check green on each pull request; `main`'s tree = the verified branch head                                       |
| 2026-11-17 | Sync S-012: the API on NestJS 11 and Fastify 5 (`862ad24`, 0.20.11): advisories 73 → 36, none in the API; a Prisma shutdown hang fixed on the way                                                                                                                                                | verify:fast; integration 97/97 in 2 of 3 runs; built API booted in both modes                                          |
| 2026-11-17 | Sync S-011: `PAY-01` fixed on pull request #4 (0.20.10); new `TEST-04` (intermittent integration failures)                                                                                                                                                                                       | Unit 899/899; integration 97/97 in 7 of 9 runs                                                                         |
| 2026-11-17 | Sync S-010: our stack brought onto `main` 0.20.3 and renumbered (#2 0.20.4, #3 0.20.5, #4 0.20.6–0.20.9); `PAY-05` fixed on #4                                                                                                                                                                   | verify:fast; integration 95/95 on a fresh database                                                                     |
| 2026-11-17 | Sync S-009: pull requests #5 (SDK `fetch` binding) and #6 (demo photos) merged into `main` (`9058e33`, 0.20.3); the demo is online                                                                                                                                                               | Demo addresses HTTP 200; the commits read, not run                                                                     |
| 2026-11-14 | Sync S-008: our fixes on pull request #4 — `PAY-03` (0.20.4), `FE-03` (0.20.5), `SEC-01` (0.20.6, production); #3 re-based (0.20.3); new `DOC-03`; T-102/T-103 statuses corrected                                                                                                                | Locally: unit, integration 94/94, browser, API boots; hosted checks green except one job still running                 |
| 2026-11-14 | Sync S-007: pull request #1 merged into `main` (`46d8cae`, 0.20.1); 4 commits on `fix/payment-reliability-backlog`; our pull requests re-based on `main`                                                                                                                                         | Hosted CI and Security green on `main`; 5 findings resolved there                                                      |
| 2026-11-13 | Sync S-006: `4c756e0` on pull request #1 (integration test rewrite); the branch run locally end to end (order, cash payment, restaurant, courier, delivery)                                                                                                                                      | Local browser run without workaround; ledger balanced; hosted run 43212219986 all green; `FE-03` still open there      |
| 2026-11-12 | Sync S-005: `c616695` (Expo bundling) and `6cbbad4` (build before seed) on pull request #3, copied from #1; local run re-verified with a generated `.env`                                                                                                                                        | Hosted run 43156964436: `check` passes, `integration` reaches the tests; local API login, 29-page browser walk         |
| 2026-11-12 | Sync S-004: `next` 15.1.3 → 15.5.29 on pull request #3 (`5d36c6a`), with the gitleaks fix of #1 and #2 (`480ec14`); new `CI-03` and `FE-07`                                                                                                                                                      | Local checks; 29-page before/after browser comparison; hosted audit lists no `next` advisory; gitleaks passes          |
| 2026-11-11 | Sync S-003: pull request #2's red checks examined, and all four fail on `main` too; #1's gitleaks fix copied to #2 (`281c323`); `DEP-01` and `CI-01` detailed; new `CI-02` (the pre-push secret scan reads nothing)                                                                              | gitleaks passes on #2 (run 43046807317); local scans; merge test with #1; `CI-02` reproduced in a throwaway repository |
| 2026-11-11 | Reminder shared with the collaborator: hook moved from local to versioned `.claude/settings.json`; pushed for review as pull request [#2](https://github.com/aliabbasaleh/djafat/pull/2) to `main`                                                                                               | Shared hook seen firing in a live session; JSON validated                                                              |
| 2026-11-11 | Sync S-001: 4 new commits on the collaborator's branch reviewed; finding `OPS-05` added; `GOV-01` updated                                                                                                                                                                                        | BRANCH (read, not run); merge conflict check RUN                                                                       |
| 2026-11-11 | Audit documents moved to `docs_2/`; `docs/` and root `README.md` restored to their committed state; pull-sync procedure, checker and reminder added                                                                                                                                              | `git status` clean for `docs/` and `README.md`; checker tested on 9 cases                                              |
| 2026-11-10 | Initial full audit; documentation system created; no application code changed                                                                                                                                                                                                                    | See `FINDINGS.md` evidence levels                                                                                      |
