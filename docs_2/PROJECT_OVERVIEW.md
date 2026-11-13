# Project overview

What DJAFAT is, who it is for, what it is built with, and how far along it is. For the current
state in detail see [`PROJECT_STATUS.md`](PROJECT_STATUS.md).

## 1. Purpose

DJAFAT is a meal-delivery marketplace for Chad, launching in N'Djamena, with groceries and everyday
products planned afterwards. It connects four parties:

| Party            | What they do                                                                                | Their application                               |
| ---------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Customer**     | Browses restaurants, orders, pays, follows the delivery                                     | `apps/web` (website), `apps/mobile` (phone app) |
| **Restaurant**   | Manages its menu and hours, accepts and prepares orders, follows its balance                | `apps/restaurant` (web console)                 |
| **Courier**      | Goes online, accepts delivery offers, picks up, delivers, confirms with the customer's code | `apps/courier` (phone app)                      |
| **DJAFAT staff** | Support, finance, administration                                                            | `apps/admin` (web console)                      |

The design brief (French dossier, `docs/README.md` and `docs/01` → `docs/16`) sets the constraints that shape the code:

- **Mobile-first, low bandwidth, unreliable network**, entry-level Android phones.
- **Phone number is the identity**: login by one-time code, no password.
- **Cash and mobile money** (Airtel Money, Moov Money), not cards.
- **Addresses by landmark**, because street addressing is weak in N'Djamena.
- **Several countries and currencies from the start**: money is always an integer amount in minor
  units with a currency code; the launch currency is XAF.
- **The server is the authority on every amount**; a client never sends a price.

## 2. Scope

**Intended for the first release (from `docs/14`, `docs/16`):** catalog and search, cart, order,
payment by cash and one mobile-money provider, dispatch to the nearest courier, live tracking,
restaurant and admin consoles, a double-entry ledger with restaurant and courier balances.

**Explicitly deferred by the dossier:** Arabic and right-to-left, reviews and ratings, promotions,
currency conversion, automated bank reconciliation, live courier map for customers.

**What exists versus that intent** is the subject of the rest of this documentation. In one
sentence: the server side of the main order flow exists and works; the payment methods, the failure
paths, the customer-facing completion of the journey, the mobile apps and everything operational
are missing or defective.

## 3. Users and roles

Eight roles, stored in `roles` and granted per user in `user_roles`; 21 permissions map to roles in
`role_permissions`. Restaurant roles are scoped to exactly one restaurant.

| Role               | Scope          | Can                                                                                        |
| ------------------ | -------------- | ------------------------------------------------------------------------------------------ |
| `customer`         | own data       | order, pay, manage addresses, cancel own delivery                                          |
| `restaurant_owner` | one restaurant | everything the staff can, plus edit profile and hours                                      |
| `restaurant_staff` | one restaurant | handle orders, edit menu and availability                                                  |
| `courier`          | own deliveries | go online, send location, accept/reject offers, pick up, deliver, report failure           |
| `support`          | platform       | read users, orders, payments, deliveries; suspend/reinstate couriers                       |
| `finance`          | platform       | read ledger and payments; refund and record settlements (currently unreachable — `ADM-01`) |
| `admin`            | platform       | manage users and non-admin roles, suspend/block accounts, read everything operational      |
| `super_admin`      | platform       | as admin, plus grant and revoke `admin`/`super_admin`                                      |

A new phone number that logs in becomes a `customer` automatically. Every other role is granted by
an administrator.

## 4. What the system consists of

Seven applications and ten shared packages in one repository. Full inventory:
[`APPLICATION_INVENTORY.md`](APPLICATION_INVENTORY.md). How they connect:
[`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md).

```text
apps/      api · worker · web · admin · restaurant · courier · mobile
packages/  types · core · validation · config · sdk · ui · tokens · i18n · testing · tsconfig · eslint-config
infra/     docker-compose (local stack) · two Dockerfiles · two mock services
docs/      the French design dossier and block reports (not modified by the audit)
docs_2/    this documentation: audit, status, findings, tasks, sync log
```

## 5. Technology

| Layer                  | Choice                                                                           | Version in use               |
| ---------------------- | -------------------------------------------------------------------------------- | ---------------------------- |
| Language               | TypeScript, strict                                                               | 5.7.3                        |
| Runtime                | Node.js                                                                          | 22 (repository refuses ≥ 25) |
| Workspace              | pnpm workspaces + Turborepo                                                      | 9.15.4 / 2.3.3               |
| API                    | NestJS on Fastify                                                                | 10.4.15 / 4.29.0             |
| Data access            | Prisma (typed) + raw SQL for money, locking and geography                        | 6.2.1                        |
| Database               | PostgreSQL + PostGIS, behind PgBouncer (transaction pooling)                     | 16 / 3.5                     |
| Cache, queues, streams | Redis: BullMQ jobs, a stream for domain events, rate limiting, Socket.IO adapter | 7                            |
| Realtime               | Socket.IO, namespace `/rt`                                                       | 4.8.1                        |
| Web                    | Next.js (App Router) + React                                                     | 15.1.3 / 19.0.0              |
| Mobile                 | Expo + React Native + expo-router                                                | 53 / 0.79.2                  |
| Validation             | Zod, shared between API and clients                                              | 3.24.1                       |
| Tests                  | Vitest; Testing Library for the UI package                                       | 2.1.8                        |
| Quality gates          | ESLint 9 with module-boundary rules, Prettier, commitlint, husky, gitleaks       | —                            |

Several of these versions carry published vulnerabilities ([`DEP-01`](FINDINGS.md#dep-01)).

## 6. Size and history

| Measure                                    | Value                                                              |
| ------------------------------------------ | ------------------------------------------------------------------ |
| Source lines (TypeScript and SQL, tracked) | ≈ 58 600                                                           |
| `apps/api/src`                             | 218 files, ≈ 31 100 lines, of which ≈ 13 000 are unit tests        |
| Database                                   | 29 migrations, 52 application tables, 96 foreign keys, 138 indexes |
| API surface                                | 95 HTTP routes, 1 realtime namespace                               |
| Unit tests                                 | 1 146 in 12 packages                                               |
| Commits on `main`                          | 70, from 2026-09-10 to 2026-10-14                                  |

**Timeline.** 2026-09-10: architecture dossier validated ("go with conditions"). Then fourteen
build blocks, each with a French report (`docs/17` → `docs/36`): foundations, walking skeleton,
identity, catalog, design system, cart and order, payment core, delivery and dispatch, realtime and
notifications, addresses and checkout, admin, tenant-isolation hardening, restaurant app, courier
app, mobile app, hardening. 2026-10-13/14: two pilot runs through the API on a real database, which
found and fixed about a dozen wiring defects. Since 2026-11-06 development has continued on a
remote branch that `main` has not received ([`UNMERGED_BRANCHES.md`](UNMERGED_BRANCHES.md)).

## 7. Maturity by layer

| Layer                          | Maturity             | Why                                                                                  |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------------------ |
| Domain logic (`packages/core`) | High                 | Pure, 181 tests, full statement coverage; state machines, money, ledger validation   |
| API — main order path          | Medium-high          | Verified end to end; careful locking, idempotency, tenant isolation                  |
| API — payments and finance     | Low                  | Enablement not enforced, cash broken, refunds crash, no reversal, no payouts         |
| API — failure paths            | Low                  | No cancellation, no timeout, fire-and-forget reactions between modules               |
| Background worker              | Medium               | Four jobs work; several required ones do not exist                                   |
| Web applications               | Low                  | Good-looking and coherent, but cannot reach the API from a browser; thin feature set |
| Mobile applications            | Very low             | Cannot be built                                                                      |
| Automated testing              | Low where it matters | Many unit tests on fakes; nothing runs the SQL or the UI                             |
| Operations                     | Very low             | Local stack broken, CI red, no deployment, no monitoring                             |

## 8. Rules the code is built around

From the root `README.md` and `docs/15`–`docs/16`. They are worth keeping; most are respected.

- Money is `{ minor: bigint, currency }` everywhere; never a float.
- Only the ledger module writes the ledger and wallet tables. _(Enforced by lint and convention, not by the database — `SEC-07`.)_
- Modules form a one-way dependency graph; `orders` never imports `payments`.
- Financial idempotency is guaranteed by PostgreSQL constraints; Redis only accelerates.
- Payment providers sit behind one interface and a registry. _(The enablement half of this rule is not applied when paying — `PAY-01`.)_
- No secrets in Git. _(Verified: none found.)_

## 9. Assumptions stated by the dossier and not verified here

Team of two to four developers; infrastructure budget of 150–400 € per month; target of 200–2 000
orders per day at the end of year one; hosting in Europe (Scaleway or Hetzner); availability of
mobile-money sandboxes; app-store accounts. None of these could be checked from the repository.

Last updated: 2026-11-11 (paths updated after the move to docs_2/)
