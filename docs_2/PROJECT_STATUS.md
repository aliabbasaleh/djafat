# Project status

**The single source of truth for where DJAFAT stands.** Update it with every meaningful change
(rules in [`README.md`](README.md)). Details live in the linked documents; this page points.

|                        |                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Last updated**       | 2026-11-11                                                                                                                             |
| **Branch described**   | `main` @ `d1439c6` — unchanged since the audit                                                                                         |
| **Evidence collected** | 2026-11-10 for `main`; branches read at BRANCH level (not run)                                                                         |
| **Last synced**        | S-001, 2026-11-11 — 4 commits on `origin/claude/compassionate-franklin-k23vcj` reviewed ([`history/SYNC_LOG.md`](history/SYNC_LOG.md)) |
| **Updated by**         | Initial full audit; sync S-001                                                                                                         |

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
| 63            | 9        | 22   | 22     | 10  |

Sync S-001 added one High finding, on the active branch only: a live server deployed from it would start without roles, permissions or ledger accounts ([`OPS-05`](FINDINGS.md#ops-05)). The other changes it brought are summarised in [`history/SYNC_LOG.md`](history/SYNC_LOG.md).

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

- [ ] `SDK-01` Browser calls fail in all web apps → T-101
- [ ] `PAY-01` Free orders through a disabled provider → T-102
- [ ] `PAY-03` Refunds crash → T-103
- [ ] `SEC-01` Boots with published placeholder secrets → T-104
- [ ] `DEP-01` Critical dependency vulnerabilities → T-105
- [ ] `MOB-01` Expo apps cannot be bundled → T-106, T-210
- [ ] `PAY-02` Cash on delivery never places an order → T-202
- [ ] `FE-01` No payment step → T-201
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

1. **Decide how `main` and the two remote branches come together** (T-001). Until then, any fix risks being done twice. The two branches conflict in 6 files (sync S-001), so the merge needs a person who knows both.
2. **Phase 1, in order:** T-101 (SDK), T-102 (payment enablement), T-103 (refund crash), T-104 (secret validation), T-107 (webhook order), T-108/T-109 (runnable tests, green CI), T-110 (`infra:up`), T-105 (dependency upgrades), T-106 (unblock the build).
3. **Take the three product decisions** that gate Phase 2: cash limits, refund policy, SMS provider.

## 12. Change log

Recent entries; full history in [`history/CHANGELOG.md`](history/CHANGELOG.md).

| Date       | Change                                                                                                                                              | Verified                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 2026-11-11 | Reminder shared with the collaborator: hook moved from local to versioned `.claude/settings.json`; pushed for review as a pull request to `main`    | Shared hook seen firing in a live session; JSON validated                 |
| 2026-11-11 | Sync S-001: 4 new commits on the collaborator's branch reviewed; finding `OPS-05` added; `GOV-01` updated                                           | BRANCH (read, not run); merge conflict check RUN                          |
| 2026-11-11 | Audit documents moved to `docs_2/`; `docs/` and root `README.md` restored to their committed state; pull-sync procedure, checker and reminder added | `git status` clean for `docs/` and `README.md`; checker tested on 9 cases |
| 2026-11-10 | Initial full audit; documentation system created; no application code changed                                                                       | See `FINDINGS.md` evidence levels                                         |
