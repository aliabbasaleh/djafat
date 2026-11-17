# Sync log

One entry per review of new commits against this documentation, newest first. The procedure is in
[`../README.md`](../README.md) §3; the commits each entry brought the documentation up to are in
[`LAST_REVIEWED_COMMIT`](LAST_REVIEWED_COMMIT). Documents changed by a sync carry a dated note
`(updated YYYY-MM-DD, sync S-nnn)` next to the statement that changed.

"Reviewed" is not "verified": every status below states its evidence level (vocabulary in
[`../README.md`](../README.md) §1).

---

## S-016 — 2026-11-17 — the owner's branch brings in `main`; our brand assets

|                 |                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------- |
| **Trigger**     | The shared hook, after a fetch and our own push                                                |
| **Range**       | `origin/feat/welcome-greeting` `cabf058..6198a89`; `origin/chore/brand-assets` (new) `155b946` |
| **Size**        | 1 merge by `kcerha` (38 files from `main`); 1 commit of ours (10 images, version files)        |
| **Evidence**    | CODE — combined diff of the merge; our commit's content                                        |
| **Reviewed by** | Claude, in the audit session                                                                   |

### Added

- `155b946` (0.20.14, pull request #10): brand files in `djafat/` (`ogo.png`, four "D" icons,
  `posters/1-5.png`).

### Removed

- none

### Fixed

- none

### Changed

- `feat/welcome-greeting` now contains `main`; the merge resolves only the roadmap journal and keeps
  0.21.0. Pull request #8 mergeable; merge it after #9 and #10.

### New findings

- none

### Documents updated

`PROJECT_STATUS.md`, `UNMERGED_BRANCHES.md`, `history/CHANGELOG.md`,
`history/LAST_REVIEWED_COMMIT`.

### Not verified

Pull request #8's checks (still running at sync time).

### Marker

`origin/feat/welcome-greeting` → `6198a89`; new line `origin/chore/brand-assets` → this sync's
version commit; `HEAD` → the same.

---

## S-015 — 2026-11-17 — `main` green after the merges; a correction on shutdown

|                 |                                                                                       |
| --------------- | ------------------------------------------------------------------------------------- |
| **Trigger**     | The end of the day's work: hosted runs on `main` finished; the user's local run moved |
| **Range**       | no new commit on GitHub besides ours                                                  |
| **Size**        | —                                                                                     |
| **Evidence**    | RUN — hosted CI and Security on `main`; HTTP checks on the local run                  |
| **Reviewed by** | Claude, in the audit session                                                          |

### Added

- none

### Removed

- none

### Fixed

- none

### Changed

- S-013's "not verified" is now verified: CI and Security green on `main` at `75db772`.
- The user's local run follows `main` (0.20.11): migration 0038 applied, seed re-run, six apps up;
  `/v1/ready` 200, 413 on a 2 MB body, Helmet headers, phone login, `/v1/me` 200, no API log error.
- Correction to S-012: NestJS 10 is not immune to a shutdown hang either (an old process ignored
  SIGTERM for 10 s); note on `OPS-02`.

### New findings

- none

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

The cause of the old process's hang; the pull request #9 merge itself (after this entry).

### Marker

`HEAD` → this sync's version commit; the other lines unchanged.

---

## S-014 — 2026-11-17 — the owner's new branch `feat/welcome-greeting`

|                 |                                                    |
| --------------- | -------------------------------------------------- |
| **Trigger**     | The shared hook, after a fetch (new remote branch) |
| **Range**       | `origin/feat/welcome-greeting` `e82eb80..cabf058`  |
| **Size**        | 1 commit by `kcerha`, 13 files                     |
| **Evidence**    | BRANCH; one RUN (mobile typecheck on `main`)       |
| **Reviewed by** | Claude, in the audit session                       |

### Added

- `<Greeting>` (`@djafat/ui`) on the client home page (signed in), the restaurant board, the admin
  dashboard and the courier home; Windows quoting of every argument in `scripts/pipeline`; the
  mobile typecheck recorded as a known failure; roadmap: demo online, Tigo Cash and Moov Money
  active in demo with fictitious merchant numbers, a "100 % API" checklist; version 0.21.0.

### Removed

- none

### Fixed

- none of the findings (the admin import fixes a break the same commit introduced)

### Changed

- `DOC-02`, `OPS-01`, `OPS-02`: notes on the roadmap's claims (see `FINDINGS.md`).

### New findings

- `TEST-05` (Low, BRANCH): `@djafat/mobile#typecheck` silenced through `known-failures.json`; it
  passes on `main` and in CI, and fails only where Expo generated its typed routes.

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `UNMERGED_BRANCHES.md`,
`history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

The greeting in a browser; the branch's builds and checks (it has no pull request yet); the MinIO
and trial-server claims.

### Marker

New line `origin/feat/welcome-greeting` → `cabf058`.

---

## S-013 — 2026-11-17 — pull requests #2, #3, #4 and #7 merged into `main`

|                 |                                                                                     |
| --------------- | ----------------------------------------------------------------------------------- |
| **Trigger**     | The shared hook, after the merges (made at the user's request)                      |
| **Range**       | `origin/main` `9058e33..75db772`                                                    |
| **Size**        | 4 merge commits, none with changes of its own                                       |
| **Evidence**    | RUN — the checks of each pull request; `main`'s tree equals the verified head of #7 |
| **Reviewed by** | Claude, in the audit session                                                        |

### Added

- On `main`: the audit (`docs_2/`, pull request #2), Next.js 15.5.29 (#3), the five fixes (#4) and
  NestJS 11 / Fastify 5 (#7). DJAFAT 0.20.11.

### Removed

- The branches `docs/audit-sync`, `fix/next-15.5`, `fix/audit-blockers` and
  `fix/api-nest11-fastify5`, deleted after their merges.

### Fixed

- Resolved on `main`: `PAY-01`, `PAY-03`, `SEC-01` (production), `FE-03`, `PAY-05`.

### Changed

- `DEP-01`: the `next` and API parts are on `main`; left: the Expo tool chain, `postcss`, `zod`.

### New findings

- none

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `tasks/COMPLETED_TASKS.md`,
`UNMERGED_BRANCHES.md`, `history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

`main`'s own CI and Security runs on `75db772` were still running when this entry was written.

### Marker

`origin/main` → `75db772`; the lines of the four deleted branches removed; `HEAD` → this sync's
version commit.

---

## S-012 — 2026-11-17 — the API on NestJS 11 and Fastify 5

|                 |                                                                                       |
| --------------- | ------------------------------------------------------------------------------------- |
| **Trigger**     | Our own commit, before its push                                                       |
| **Range**       | `fix/api-nest11-fastify5` `a017f48..862ad24` (new branch, stacked on pull request #4) |
| **Size**        | 1 commit, ours, 8 files                                                               |
| **Evidence**    | BRANCH + RUN                                                                          |
| **Reviewed by** | Claude, in the session that wrote the commit                                          |

### Added

- `862ad24` (0.20.11): NestJS 11.2.10 and Fastify 5.12.8 in the API with their plugins; Prisma's
  disconnect bounded to 2 s on shutdown (three unit tests); `typescript` 5.7.3 declared by the lint
  package; 36 obsolete entries removed from the audit baseline.

### Removed

- none

### Fixed

- On the new branch, not on `main`: the API part of `DEP-01` (no advisory left in the API's stack);
  the 413 case of `API-01`.
- Found and fixed there: NestJS 11 calls Prisma's disconnect last on shutdown, and Prisma 6.2's
  `$disconnect()` never settles a moment after SIGTERM, so the API kept serving after SIGTERM.
  Reproduced outside NestJS (at once it returns, 300 ms later it hangs). `main` (NestJS 10) calls it
  first and is not affected.

### Changed

- `TEST-04`: a third failure of the same shape (`GET /v1/restaurants?search=` → 404, never logged by
  the API); likely cause recorded (port collisions with 127.0.0.1-only listeners on macOS).

### New findings

- none

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `UNMERGED_BRANCHES.md`,
`history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

The hosted checks of the new branch (still to come); the `TEST-04` cause; a browser run against the
upgraded API.

### Marker

New line `origin/fix/api-nest11-fastify5` → `862ad24`; the other lines unchanged.

---

## S-011 — 2026-11-17 — `PAY-01` fixed on #4; new `TEST-04`

|                 |                                                |
| --------------- | ---------------------------------------------- |
| **Trigger**     | The shared hook, after our own push            |
| **Range**       | `origin/fix/audit-blockers` `2319186..a017f48` |
| **Size**        | 1 commit, ours, 7 files                        |
| **Evidence**    | BRANCH + RUN                                   |
| **Reviewed by** | Claude, in the session that wrote the commit   |

### Added

- `a017f48` (0.20.10): payment creation refuses a provider the payment screen would not list for the
  order (`409 PAYMENT_METHOD_UNAVAILABLE`) and stores the provider's own method. The unit test
  harness starts from an enabled configuration and filters configs as Prisma does. New tests:
  `payments-provider-enablement.spec.ts` (14), `payment-enablement.int.spec.ts` (2).
  `docs/24-bloc-5-payment.md` says the rule now covers creation.

### Removed

- none

### Fixed

- On `fix/audit-blockers` (pull request #4), not on `main`: `PAY-01`, verified there.

### Changed

- none

### New findings

- `TEST-04` (Medium, RUN): the integration suite failed intermittently in 2 of 9 local runs of pull
  request #4 (a 30 s hang in `POST /v1/orders`; a pickup 404 after a successful accept, then an
  order 404). Not reproduced in 4 instrumented runs; 4 of 4 runs without pull request #4 passed.

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `UNMERGED_BRANCHES.md`,
`history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

The cause of `TEST-04`. The hosted checks of `a017f48` were still to come.

### Marker

`fix/audit-blockers` → `a017f48`; the other lines unchanged.

---

## S-010 — 2026-11-17 — our stack renumbered on `main`; `PAY-05` fixed on #4

|                 |                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------- |
| **Trigger**     | The shared hook, after our own pushes                                                     |
| **Range**       | `origin/fix/next-15.5` `69cd859..c715ae2`; `origin/fix/audit-blockers` `aa0d58d..2319186` |
| **Size**        | 5 commits, all ours: 3 merges, 2 version commits, 1 fix                                   |
| **Evidence**    | BRANCH + RUN — each push verified locally first; hosted checks not read in this entry     |
| **Reviewed by** | Claude, in the session that wrote the commits                                             |

### Added

- `2319186` (0.20.9): the payment webhook checks the signature before writing its idempotency row;
  a rejected request leaves nothing (`PAY-05`). New integration test `webhook-forgery.int.spec.ts`;
  three unit tests from the owner's `6cf7c9b`. `docs/24-bloc-5-payment.md` updated to match.
- Re-stack merges: `c1abcba` (`main` into #2), `0c61784` (#2 into #3), `7452ec4` (#3 into #4).
  They resolve only `package.json` and `docs/ROADMAP.md`; `pnpm-lock.yaml` merged without conflict
  on #3 and passes `pnpm install --frozen-lockfile`.
- Version commits `d366f12` (#2, 0.20.4) and `c715ae2` (#3, 0.20.5).

### Removed

- none

### Fixed

- On `fix/audit-blockers` (pull request #4), not on `main`: `PAY-05`, verified there.

### Changed

- Our versions renumbered, same commits: #2 0.20.2 → 0.20.4; #3 0.20.3 → 0.20.5; #4's `PAY-03`
  0.20.4 → 0.20.6, `FE-03` 0.20.5 → 0.20.7, `SEC-01` 0.20.6 → 0.20.8.

### New findings

- none

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `UNMERGED_BRANCHES.md`,
`history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

The hosted checks of the three pushes were still to come when this entry was written.

### Marker

`fix/next-15.5` → `c715ae2`; `fix/audit-blockers` → `2319186`; the other lines unchanged.

---

## S-009 — 2026-11-17 — pull requests #5 and #6 merged into `main`; the demo is online

|                 |                                                                                       |
| --------------- | ------------------------------------------------------------------------------------- |
| **Trigger**     | A fetch at the user's prompt, three days after S-008                                  |
| **Range**       | `origin/main` `46d8cae..9058e33` (also `origin/claude/compassionate-franklin-k23vcj`) |
| **Size**        | 5 commits: `07f2539`, `c804526` and 3 merges; 16 files outside `docs_2/`              |
| **Evidence**    | CODE for the commits; LIVE for the demo's addresses (HTTP status only)                |
| **Reviewed by** | Claude, in the audit session                                                          |

### Added

- `07f2539` (0.20.2, pull request #5, by `kcerha` with Claude Sonnet 5): the SDK binds `fetch`
  to the global object; the web and restaurant login pages show the real cause of a failure;
  `babel-preset-expo` declared in both Expo apps; the worker logs an idle database client's error
  instead of crashing; the pipeline scripts quote Windows paths containing spaces; a
  troubleshooting section in `docs/TRAVAILLER-EN-LOCAL.md` (login codes, stale bundles, courier
  positions older than 120 s, mobile money needing both enablement flags, the courier web app's
  port in `API_CORS_ORIGINS`). It says nothing about the placeholder secrets (`DOC-03` stays open).
- `c804526` (0.20.3, pull request #6, commit author "Claude"): the seed asks `placehold.co` for
  PNG; migration 0038 rewrites the stored `placehold.co` addresses (only those, idempotent); the
  roadmap records the demo online since 2026-11-16.
- Merges by `aliabbasaleh`: `e82eb80` and `9058e33` add nothing of their own; `b9a6d8c` only
  renumbers the version (0.20.2 → 0.20.3) in `package.json` and `docs/ROADMAP.md`.

### Removed

- The branch `fix/browser-fetch-and-local-dev`, deleted after its merge.

### Fixed

- `FE-05` on `main` (`c804526`): fix present, unverified by us.

### Changed

- `OPS-02`: the one-server stack is deployed (five addresses answer HTTP 200); monitoring,
  alerting and a restore drill are still not reported. Partly addressed.
- `MOB-01`: `babel-preset-expo` declared in both Expo apps (fix present, unverified).
- `SEC-02`: the live demo runs the seed with its known super-admin number; the codes only reach a
  server-local inbox (CODE).
- `SDK-01`: unchanged. The commit says no browser could reach the API with the previous version;
  our browser runs on that version did (S-006, 2026-11-14).
- Our pull requests #2 to #4 now conflict with `main` on the version: 0.20.2 and 0.20.3 are taken.

### New findings

- none

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `UNMERGED_BRANCHES.md`,
`history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

The commits were read, not run. Of the demo, only the HTTP status of five addresses was checked.
Migration 0038's pattern was checked against the old seed's addresses only.

### Marker

`origin/main` and the collaborator's branch → `9058e33`; `HEAD` → `d366f12`, the version commit that
brings `main` into pull request #2 (0.20.4, renumbered from 0.20.2); the other lines unchanged.

---

## S-008 — 2026-11-14 — our own fixes on pull requests #3 and #4

|                 |                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------- |
| **Trigger**     | The shared hook, at the user's prompt, after our own pushes                               |
| **Range**       | `origin/fix/next-15.5` `5122fd6..69cd859`; `origin/fix/audit-blockers` `f0cbb09..aa0d58d` |
| **Size**        | 6 commits, all ours: 2 stacking merges, 4 version commits (0.20.3 to 0.20.6), 19 files    |
| **Evidence**    | BRANCH + RUN — each fix run locally before its push; hosted checks as listed below        |
| **Reviewed by** | Claude, in the session that wrote the commits                                             |

### Added

- `70cfd3b` (0.20.5): the customer sees the delivery code on the site and in the app (`FE-03`).
- `aa0d58d` (0.20.6): production refuses placeholder, short, reused or malformed secrets
  (`SEC-01`); development starts and lists them.
- `69cd859` (0.20.3) and `8e59bd4` (0.20.4): the version commits of the `next` upgrade
  (`5122fd6`) and of the refund fix (`f0cbb09`), both reviewed in S-007.
- `6b13d96` (`main` and #2 into #3) and `ab92c1a` (#3 into #4): stacking merges; their combined
  diff is empty, so they add nothing of their own.

### Removed

- none

### Fixed

- On `fix/audit-blockers` (pull request #4), not on `main`: `PAY-03`, `FE-03`, `SEC-01`
  (production only), each verified there. All three stay Open until the pull request is merged.

### Changed

- Corrected an S-007 mistake: the refund fix's status had been written on T-102 (`PAY-01`)
  instead of T-103 (`PAY-03`). T-102 is back to Not started.
- `DEP-01`: pull request #3's baseline drops the 38 `next` entries (115 → 77), counted in both files.

### New findings

- `DOC-03` (Medium, CODE): the local guide keeps the five placeholder secrets of `.env.example`.
  With the placeholder delivery-code key, pickup moves the delivery on its way and then fails, so
  no local delivery can be completed. Found while writing the `SEC-01` fix.

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `UNMERGED_BRANCHES.md`,
`history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

On `aa0d58d`, the hosted lint/typecheck/test/build job was still running at sync time (Windows,
Security and the integration job had passed). The mobile delivery-code screen was not run on a
device. `DOC-03` was read in the code and its key length computed; the failing pickup was not run.

### Marker

`fix/next-15.5` → `69cd859`; `fix/audit-blockers` → `aa0d58d`; `HEAD` → `aee9650`; the other
lines unchanged.

---

## S-007 — 2026-11-14 — pull request #1 merged into `main`; four commits on the owner's branch

|                 |                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Trigger**     | The shared hook at the user's prompt, after the editor fetched                                                       |
| **Range**       | `origin/main` `d1439c6..46d8cae`; `origin/fix/payment-reliability-backlog` `a68934d..92e8d52`; our own pull requests |
| **Size**        | `main`: 3 commits after `4c756e0`, then the merge; the owner's branch: 4 commits, 12 files                           |
| **Evidence**    | RUN — hosted runs on `main`; BRANCH for the owner's commits                                                          |
| **Reviewed by** | Claude, in the audit session                                                                                         |

### Added

- On `main`: pull request #1, merged by the owner on 2026-11-13 as `46d8cae` ("DJAFAT 0.20.1"), with
  three commits not yet reviewed. `b2f498b` adds a Windows workflow (install, unit tests, builds,
  courier web export, customer site started; no Docker on Windows runners). `9072943` makes `main`
  the reference branch in the guides and adds a branch rule to `CLAUDE.md`: work on a branch, open a
  pull request to `main`, merge only when the Linux and Windows checks are green. `c0487a2` waits up
  to 5 s for the order to be placed after the payment webhook (a flaky test).
- On `fix/payment-reliability-backlog`: `1600bdb`, `0d60445`, `cb84077`, `92e8d52` (see
  `UNMERGED_BRANCHES.md` §2).

### Removed

- none

### Fixed

- Resolved on `main`: `SDK-01`, `FE-01` (cash), `PAY-02`, `TEST-01` (verified in S-006 on
  `4c756e0`; the merge adds only CI, documentation and test changes), and `CI-01` (CI and Security
  green on the push of `46d8cae`).
- On the owner's branch only: `FE-05` (PNG seed images).

### Changed

- Our pull requests: #2 re-based on `main` (version 0.20.2); #3 and `fix/audit-blockers` follow.

### New findings

- none

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `tasks/COMPLETED_TASKS.md`,
`UNMERGED_BRANCHES.md`, `history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

The owner's four commits were read, not run. The Windows workflow has not yet run on one of our
pull requests.

### Marker

`origin/main` and the collaborator's branch → `46d8cae`; owner's branch → `92e8d52`;
`fix/next-15.5` → `5122fd6`; `fix/audit-blockers` → `f0cbb09`; `HEAD` → this sync's version
commit.

---

## S-006 — 2026-11-13 — one commit on pull request #1, and the branch run end to end

|                 |                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| **Trigger**     | The shared hook after a fetch; the user asked to run the newest code locally                               |
| **Range**       | `origin/claude/compassionate-franklin-k23vcj` `804176f..4c756e0`: 1 new commit, 2026-11-12 11:46, "Claude" |
| **Size**        | 3 files: `apps/api/test/walking-skeleton.int.spec.ts`, `docs/ROADMAP.md`, `package.json` (0.19.3)          |
| **Evidence**    | RUN — hosted run 43212219986; the branch run locally, browser journey without workaround, SQL checks       |
| **Reviewed by** | Claude, in the audit session                                                                               |

### Added

- none in the application; the walking-skeleton integration test now follows the current delivery
  flow (courier online, offer, accept, pickup, delivery with the customer's code).

### Removed

- From that test: the removed `POST /deliveries` assignment flow.

### Fixed

- Verified on the branch, by running it (not on `main`): `SDK-01` (browser login in all four web
  apps), `FE-01` (cash payment step), `PAY-02` (a cash order is placed, delivered and settled; ledger
  balanced). `MOB-01`: the courier web export runs end to end.
- `TEST-01`, on the branch: the hosted `integration` job passes.

### Changed

- `docs/ROADMAP.md` and the root version (0.19.3), per the branch's versioning rule.

### New findings

- none. `FE-03` is confirmed still open on the branch: no screen shows the delivery code, although
  `GET /v1/deliveries/:id/code` serves it.

### Documents updated

`FINDINGS.md`, `tasks/BACKLOG.md`, `PROJECT_STATUS.md`, `UNMERGED_BRANCHES.md`,
`TESTING_AND_QUALITY_ASSURANCE.md`, `DEPLOYMENT_AND_ENVIRONMENT.md`, `history/CHANGELOG.md`,
`history/LAST_REVIEWED_COMMIT`.

### Not verified

The 93/93 local integration result the commit reports (the hosted run passed). Payment methods
other than cash, WhatsApp and e-mail login, native mobile builds, a server deployment.

### Marker

`origin/claude/compassionate-franklin-k23vcj`: `804176f` → `4c756e0`. Other lines unchanged.

---

## S-005 — 2026-11-12 — two commits on pull request #3 from another session

|                 |                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**     | The shared hook, after the editor fetched `origin/fix/next-15.5`                                                                 |
| **Range**       | `origin/fix/next-15.5` `480ec14..6cbbad4`: 2 commits, 2026-11-12 05:43–05:45, by another Claude session as the repository's user |
| **Size**        | 3 files: `apps/courier/metro.config.js`, `apps/mobile/metro.config.js`, `.github/workflows/ci.yml`; +14 / −2                     |
| **Evidence**    | RUN — hosted pipeline run 43156964436 on pull request #3; merge tests                                                            |
| **Reviewed by** | Claude, in the audit session                                                                                                     |

### Added

- CI, `integration` job: "Build workspace packages used by the API" before the migrations
  (`6cbbad4`), the same step as pull request #1's.

### Removed

- `config.resolver.disableHierarchicalLookup = true` in both Expo apps' `metro.config.js`
  (`c616695`, the same lines as pull request #1's `a972a35`).

### Fixed

- `MOB-01`, on the branch only: the hosted `check` job passes every step, Build included, so both
  Expo apps export. Not run on a device.
- `CI-01`, in part, on the branch: `integration` no longer stops at Seed; it now fails at
  Integration tests (`TEST-01`).

### Changed

- Merge with pull request #1: `.github/workflows/ci.yml` now conflicts as well. Both add the build
  step, and #1 adds a throwaway-secrets step next to it; take #1's file.

### New findings

- none

### Documents updated

`FINDINGS.md`, `tasks/BACKLOG.md`, `PROJECT_STATUS.md`, `DEPLOYMENT_AND_ENVIRONMENT.md`,
`UNMERGED_BRANCHES.md`, `history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

The Expo apps on a device or simulator. The commits' own local checks (`CI=true pnpm build`, the
seed without a database) were not re-run here; the hosted run covers the build.

### Marker

`origin/fix/next-15.5`: `480ec14` → `6cbbad4`. Other lines unchanged.

---

## S-004 — 2026-11-12 — our own branch: `next` upgraded to 15.5.29 (pull request #3)

|                 |                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Trigger**     | The user asked for the upgrade and a check that nothing breaks; the shared hook then reported the new branch       |
| **Range**       | `origin/fix/next-15.5` `d1439c6..480ec14`: 2 commits (the repository's user, with Claude)                          |
| **Size**        | 10 files: four `package.json`, `pnpm-lock.yaml`, three `next-env.d.ts`, `apps/web/next.config.mjs`, `security.yml` |
| **Evidence**    | RUN — local checks, a before/after browser comparison, hosted pipeline runs on pull request #3                     |
| **Reviewed by** | Claude, in the audit session                                                                                       |

### Added

- Branch `fix/next-15.5` and pull request #3 against `main`.
- On that branch, in `security.yml`: the gitleaks token and permissions, the lines of pull
  requests #1 and #2.

### Removed

- From the lockfile: `next` 15.1.3 and its tree; `busboy`, `streamsearch` and `@swc/counter`, which
  `next` 15.5 no longer uses.

### Fixed

- `DEP-01`, the `next` part, on the branch only: the hosted audit of pull request #3 (run 43154080538) lists no `next` advisory. The status stays Open: `main` keeps 15.1.3 until the
  merge, and 3 critical and 51 high advisories remain in other packages.

### Changed

- `next` 15.5.29 in `apps/web`, `apps/admin`, `apps/restaurant` and `packages/ui`; `sharp` 0.35.5
  under it.
- `apps/web/next.config.mjs`: `typedRoutes` at the top level, as 15.5 asks.
- `next-env.d.ts` (three apps): one added reference to `.next/types/routes.d.ts`, written by
  `next build`.

### New findings

- `CI-03` (Low, RUN): the pre-commit hook cannot run ESLint on `main`. Seen when committing
  `5d36c6a`, which then went through the full hook with the workspace's ESLint on `PATH`.
- `FE-07` (Low, RUN): typed routes are configured but never checked; a deliberately wrong link
  built without error.

### Documents updated

`FINDINGS.md`, `tasks/BACKLOG.md`, `tasks/PRIORITY_TASKS.md`, `PROJECT_STATUS.md`,
`SECURITY_AUDIT.md`, `TESTING_AND_QUALITY_ASSURANCE.md`, `DEPLOYMENT_AND_ENVIRONMENT.md`,
`APPLICATION_INVENTORY.md`, `UNMERGED_BRANCHES.md`, `applications/WEB.md`,
`applications/ADMIN.md`, `applications/RESTAURANT.md`, `history/CHANGELOG.md`,
`history/LAST_REVIEWED_COMMIT`.

### Not verified

The upgraded apps on a server reachable from outside. The Expo apps: the change does not touch
them, and they cannot be bundled on `main` either (`MOB-01`). The logged-in screens were compared
with the fetch workaround (`SDK-01`).

### Marker

Added `480ec14 origin/fix/next-15.5`. Other lines unchanged.

---

## S-003 — 2026-11-11 — our own commit: the secret scan runs on pull requests

|                 |                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Trigger**     | The user pasted the failing checks of pull request #2; the fix, our own commit, was then reported by the shared hook     |
| **Range**       | `HEAD` `5e379b3..281c323`: `281c323` (the repository's user, with Claude); `7adfd6a` and `7198f30` change only `docs_2/` |
| **Size**        | 1 file outside `docs_2/`: `.github/workflows/security.yml`, +10 lines                                                    |
| **Evidence**    | RUN — hosted pipeline runs on both pull requests, local gitleaks scans, merge tests, a throwaway repository              |
| **Reviewed by** | Claude, in the audit session                                                                                             |

### Added

- `security.yml`, job `gitleaks`: `permissions` (`contents: read`, `pull-requests: read`) and the
  run's `GITHUB_TOKEN`. These are the lines of pull request #1 (`6d04e4e`, `397ca6b`), unchanged.

### Removed

- none

### Fixed

- `CI-01`, in part, on both pull requests: the secret scan now runs on a pull request instead of
  stopping, and passes (pull request #2: run 43046807317, 4 commits, no leaks). The status stays
  Open: `main` keeps the old workflow until one of the pull requests is merged, and three checks
  are still red there.

### Changed

- none in the application.

### New findings

- `CI-02` (Low, RUN): the pre-push hook's `gitleaks protect --staged` never reads the commits being
  pushed. Found while checking the secret scans; task T-313.
- Refined, not new: `DEP-01` (151 advisories on the unchanged lockfile, the eight critical listed,
  `next` ≥ 15.5.28 as the target, pull request #1's baseline accepting all eight); `CI-01` (why the
  scan failed on pull requests; the weekly scan reads every branch and flags four test values).

### Documents updated

`FINDINGS.md`, `tasks/BACKLOG.md`, `PROJECT_STATUS.md`, `SECURITY_AUDIT.md`,
`TESTING_AND_QUALITY_ASSURANCE.md`, `DEPLOYMENT_AND_ENVIRONMENT.md`, `APPLICATION_INVENTORY.md`,
`UNMERGED_BRANCHES.md`, `applications/WEB.md`, `applications/ADMIN.md`,
`applications/RESTAURANT.md`, `history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

Whether any of the Next.js apps is reachable from the internet. That `next` 15.5.28 clears the
advisories is read from their version ranges, not tested. The new workflow on `main` itself: it
runs there only after a merge.

### Marker

`HEAD`: `5e379b3` → `281c323`. Other lines unchanged.

---

## S-002 — 2026-11-11 — our own commit: the audit and its reminder shared

|                 |                                                                                 |
| --------------- | ------------------------------------------------------------------------------- |
| **Trigger**     | Our own commit on the branch `docs/audit-sync`, reported by the new shared hook |
| **Range**       | `HEAD` `5e379b3` — 1 commit (the repository's user, with Claude)                |
| **Size**        | 42 files; outside `docs_2/`: `.claude/settings.json` (new), `.gitignore`        |
| **Evidence**    | RUN — the hook was seen firing; the checker was run before and after            |
| **Reviewed by** | Claude, in the audit session                                                    |

### Added

- `.claude/settings.json` (versioned): runs `docs_2/tools/audit-sync-check.sh` on every prompt and
  after branch-moving `git` commands, in every Claude Code session in the repository.
- `docs_2/` as a whole, now under version control.

### Removed

- none

### Fixed

- none (no finding concerns this change)

### Changed

- `.gitignore`: `.claude/` is no longer ignored as a whole; only `settings.json`, `skills/` and
  `agents/` are versioned. Lines copied verbatim from the collaborator's branch.
- The checker now ignores commits that change only `docs_2/` — such as the commit recording this
  entry — so recording a review never asks for another one.

### New findings

- none

### Documents updated

`history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`, `history/CHANGELOG.md`, `README.md` §4.

### Not verified

The hook on the collaborator's machine.

### Marker

`HEAD`: `d1439c6` → `5e379b3`. Other lines unchanged.

---

## S-001 — 2026-11-11 — four new commits on the collaborator's branch

|                 |                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**     | A `git fetch` on 2026-11-11 at 10:01 moved `origin/claude/compassionate-franklin-k23vcj`. `main` and `origin/main` did not move.                                       |
| **Range**       | `origin/claude/compassionate-franklin-k23vcj` `2a622a1..804176f` — 4 commits, author "Claude" (agent sessions), 2026-11-10 10:31 → 18:10                               |
| **Size**        | 16 files, +473 / −52                                                                                                                                                   |
| **Evidence**    | BRANCH — read with `git log`, `git diff` and `git show`; the branch was not checked out, built or run. One RUN item: a merge test in a throwaway clone (see "Changed") |
| **Reviewed by** | Claude, in the audit session                                                                                                                                           |

The four commits, oldest first:

| Commit    | Message                                                                                              | What it touches                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ef13704` | test(api): integration suite independent of shared limiter state and of the hour                     | `apps/api/test/*` — new `int-setup.ts`                                                       |
| `41296a8` | docs: versioned roadmap in the repo, work-from-home guide, free ARM hosting; integration tests 92/93 | `docs/ROADMAP.md`, `docs/TRAVAILLER-EN-LOCAL.md`, `CLAUDE.md`, `README.md`, `infra/deploy/*` |
| `54d50b5` | chore(infra): one-command install on Oracle Cloud (install.sh, GitHub deploy key)                    | `infra/deploy/install.sh`, `infra/deploy/README.md`                                          |
| `804176f` | fix(deps): force node-forge ^1.4.3 (5 newly published advisories)                                    | `package.json`, `pnpm-lock.yaml`, `scripts/pipeline/baselines/audit.json`                    |

### Added

- **`docs/ROADMAP.md`** (101 lines, French) — the team's versioned roadmap: what is done, what is
  left before the pilot, decisions, and a journal of versions (0.12.0 → 0.19.2). Declared "the
  reference roadmap", updated on every push.
- **`docs/TRAVAILLER-EN-LOCAL.md`** (119 lines, French) — how a teammate runs the project at home.
- **A versioning rule in `CLAUDE.md`**: every push bumps `version` in the root `package.json`
  (now `0.19.2`, was `0.0.0`) and adds a line to the journal in `docs/ROADMAP.md`.
- **`infra/deploy/install.sh`** (67 lines) — one-command server install: installs Docker through the
  `get.docker.com` script piped to `sudo sh`, opens ports 80 and 443 with `iptables`,
  `git pull --ff-only`, generates the secrets file once, then `docker compose … up -d --build`
  (with the `demo` profile when `SEED_DEMO=1`).
- **Production stack picks a community PostGIS image on ARM servers** (`imresamu/postgis:16-3.5`,
  by tag), because the official image has no ARM build — target: Oracle Cloud "Always Free".
- **`apps/api/test/int-setup.ts`** — before each integration test: clears the OTP rate-limit keys
  in Redis and opens the fixture restaurant all day, so results no longer depend on test order or
  on the hour.
- **`README.md`** — three pointers: roadmap, local guide, deployment guide.
- **pnpm override** forcing `node-forge` to `^1.4.3`.

### Removed

- **12 tolerated `node-forge` advisories** from the branch's audit baseline
  (`scripts/pipeline/baselines/audit.json`) — they no longer apply after the override. The branch's
  roadmap says the number of tolerated advisories went from 127 to 115.

### Fixed (on the branch — none of this is on `main`)

| Finding                                                          | What the commits do                                                                                                                                      | Status on `main` | Status on the branch                                                                            |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| [`TEST-01`](../FINDINGS.md#test-01) Integration suite cannot run | Removes two causes of flaky failures (shared limiter budget, time of day). The branch reports 92 of 93 passing, the walking-skeleton test still failing  | Open             | Fix present, unverified                                                                         |
| [`DEP-01`](../FINDINGS.md#dep-01) Vulnerable dependencies        | Clears the `node-forge` advisories only. `next` 15.1.3, `fastify` 4.29.0, `@nestjs/platform-fastify` 10.4.15, `zod` 3.24.1, `prisma` 6.2.1 are unchanged | Open             | Open (partly addressed)                                                                         |
| [`OPS-01`](../FINDINGS.md#ops-01) `infra:up` fails               | Only the **production** stack gains an ARM PostGIS choice; the development compose file is unchanged and the new local guide still says `pnpm infra:up`  | Open             | Open                                                                                            |
| [`OPS-02`](../FINDINGS.md#ops-02) No deployment path             | One-command install for a single server                                                                                                                  | Open             | Partly addressed, unverified; still no monitoring or alerting (their roadmap lists it as to do) |

### Changed

- **Two competing status pages.** `docs/ROADMAP.md` states that the pilot functions are "faites et
  vérifiées en vrai" and that the server install is "prête, testée en local". This audit has not
  run the branch and cannot confirm either; on `main` the same journey fails
  ([`DOC-02`](../FINDINGS.md#doc-02)). After a merge the repository would hold two documents each
  claiming to be the reference — see [`../UNMERGED_BRANCHES.md`](../UNMERGED_BRANCHES.md) §5.
- **Merging the two remote branches will need hand work** (RUN, throwaway clone): merging
  `origin/fix/payment-reliability-backlog` into `origin/claude/compassionate-franklin-k23vcj`
  conflicts in 6 files — `apps/api/package.json`,
  `apps/api/src/modules/payments/payments.service.ts`, `apps/api/test/identity.int.spec.ts`,
  `apps/api/test/vitest.int.config.ts`, `apps/api/test/walking-skeleton.int.spec.ts`,
  `pnpm-lock.yaml`.
- **The new local guide repeats steps the audit found broken on `main`**: `pnpm infra:up` (MinIO
  image withdrawn, PostGIS without ARM) and `cp .env.example .env` without saying the five secret
  placeholders must be replaced. Whether the branch now validates secrets was not checked.

### New findings

- [`OPS-05`](../FINDINGS.md#ops-05) — **High**, BRANCH. On the branch's server stack, `MODE=live`
  runs migrations only. No migration creates roles, permissions, the market, currencies, payment
  providers or the platform ledger accounts — only `seed.ts` does, and it runs in demo mode only.
  A live server would start without them. The obvious workaround, running the seed, would also
  create the eight fixture staff accounts, whose login codes would then go out by real SMS.

### Documents updated

`FINDINGS.md` (header, index, `GOV-01`, `TEST-01`, `DEP-01`, `OPS-01`, `OPS-02`, `SEC-02`,
`DOC-01`, `DOC-02`, new `OPS-05`) · `PROJECT_STATUS.md` · `UNMERGED_BRANCHES.md` ·
`SECURITY_AUDIT.md` · `DEPLOYMENT_AND_ENVIRONMENT.md` · `RISKS_AND_RECOMMENDATIONS.md` ·
`tasks/BACKLOG.md` (T-001, T-302) · `history/CHANGELOG.md` · `LAST_REVIEWED_COMMIT`.

### Not verified

Everything on the branch: the 92/93 result, `install.sh` on a server, the ARM image, the live and
demo modes, the dependency override. Verifying needs the branch checked out with its own
dependencies and a database migrated to its 37 migrations.

### Marker

`origin/claude/compassionate-franklin-k23vcj`: `2a622a1` → `804176f`. Other lines unchanged.

---

## S-000 — 2026-11-10 — baseline: the initial audit

|              |                                                                             |
| ------------ | --------------------------------------------------------------------------- |
| **Range**    | `main` up to `d1439c6` (whole history)                                      |
| **Evidence** | LIVE, RUN and CODE for `main`; BRANCH for the two remote branches           |
| **Result**   | 62 findings ([`../FINDINGS.md`](../FINDINGS.md)); documentation set created |

Branch tips read at BRANCH level that day:
`origin/claude/compassionate-franklin-k23vcj` @ `2a622a1` (37 commits ahead of `main`) and
`origin/fix/payment-reliability-backlog` @ `a68934d` (2 commits ahead).

---

## Template for the next entry

Copy above the most recent entry and fill every heading; write "none" rather than deleting one.

```markdown
## S-nnn — YYYY-MM-DD — <what arrived, in a few words>

|                 |                                                                 |
| --------------- | --------------------------------------------------------------- |
| **Trigger**     | pull / fetch / checkout / our own commit — and which refs moved |
| **Range**       | `<ref>` `<old>..<new>` — n commits, authors, dates              |
| **Size**        | n files, +x / −y                                                |
| **Evidence**    | LIVE / RUN / CODE / BRANCH — and what was actually executed     |
| **Reviewed by** | who                                                             |

### Added

### Removed

### Fixed

(table: finding · what the commits do · status before · status now, with evidence)

### Changed

(behaviour changes, possible regressions, contradictions with the documents)

### New findings

### Documents updated

### Not verified

### Marker
```

Last updated: 2026-11-11 (sync S-002)
