# Changelog

What changed in the project and its documentation, newest first. One entry per meaningful change.
Code changes also appear in Git; this file records **what was verified** and **what was learned**,
which Git does not.

Format: date · what changed · affected areas · verification · newly discovered issues.

---

## 2026-11-18 — Sync S-025: the mobile type check honest again

**Verified:** with Expo's generated typed routes, the mobile type check failed with 9 errors (reproduced); after
the fix, 0 errors with and without them. `expo export` succeeds for the mobile and courier apps.

**Status changes:** `TEST-05` fix present on `fix/mobile-typed-routes` (0.21.8), for the owner's review;
`known-failures.json` has no entry left (the two build entries were stale). T-610 in progress.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `history/SYNC_LOG.md`,
`history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-18 — Sync S-024: lighter favicons

**Changed:** the « D » favicon of the web, admin and restaurant apps resized from 2048 px (521 KB) to
512 px (44 KB) on `fix/favicon-512` (0.21.7); checked by eye.

**Documents changed:** `FINDINGS.md` (`FE-06`), `PROJECT_STATUS.md`,
`history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-18 — Sync S-023: real local secrets with `pnpm env:init`

**Verified:** 5 tooling tests; a `.env` generated from `.env.example` boots the built API in production mode
without any complaint about secrets.

**Status changes:** `DOC-03` fix present on a branch (`fix/env-init`,
0.21.6); T-608 in progress.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`,
`history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-18 — Sync S-022: the cause of `TEST-04`, and its fix

**Verified:** the port collision reproduced on this Mac with a small Node script; with the test app bound to
127.0.0.1 (`fix/test-loopback`, 0.21.5), 5 consecutive full integration runs green (97/97 each).

**Status changes:** `TEST-04` fix present on a branch, verified locally (5 of the 20 runs its Verify asks for);
T-609 in progress.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`,
`history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-18 — Sync S-021: the open Critical and High findings re-checked

**Reviewed:** each of the 21 open Critical and High findings against `main` at `8ceb437`, by its
Verify step where it could run here and by the code otherwise.

**Verified:** `pnpm audit --prod` (37 advisories, 1 critical); CI on `main` (both Expo apps bundle);
the demo's addresses (200); code read for the rest (evidence level stated in each note).

**Status changes:** none resolved. Partly addressed: `AUTH-01`, `MOB-01`, `PAY-06`, `PAY-07`,
`TEST-02`, `OPS-02`, `GOV-01` (statuses updated). Unchanged: `PAY-04`, `ORD-01`, `ORD-02`, `FE-02`,
`ARCH-01`, `OPS-01`, `SEC-02`, `ADM-01`, `ADM-02`, `ADM-03`, `DLV-01`, `COUR-01`, `OPS-05`, `DEP-01`.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `history/SYNC_LOG.md`,
`history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-18 — Sync S-020: the owner's pull request #12 (logo, favicons, `picomatch`)

**Reviewed:** `b141593` (the logo's arrowhead removed, judged too close to Amazon's mark; the « D »
icon as favicon of the three web apps), `97a9b77` (the `picomatch` advisory GHSA-fc5q-39xc-vjpf
added to the audit baseline) and `6940153` (version 0.21.2), merged as `8ceb437` by `aliabbasaleh`.

**Verified:** CI and Security green on `8ceb437`; `pnpm audit --prod` re-run: the advisory is high,
comes only through Expo's CLI, and has no patched version yet, so the baseline entry is justified.

**Status changes:** the favicon part of `FE-06` fixed on `main` (CODE). Our #11 renumbered 0.21.3.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `UNMERGED_BRANCHES.md`,
`history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-17 — Sync S-019: the owner's greeting on `main` (0.21.0)

**Reviewed:** `7d2c5a2` by `kcerha` (brings #10 into `feat/welcome-greeting`; roadmap journal only)
and the merge of pull request #8 into `main` by `aliabbasaleh` (`57120ed`, 0.21.0), which adds nothing
beyond the branch: the greeting on the four apps, Windows quoting in the pipeline scripts, the
roadmap updates, and the known-failure entry for the mobile typecheck.

**Verified:** CI and Security green on `57120ed`; the merge's combined diff is empty.

**Status changes:** `TEST-05` is now on `main` (evidence CODE). Our audit entry S-018 is renumbered
0.21.1 with this one (it was 0.20.17, below `main`'s 0.21.0).

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`,
`UNMERGED_BRANCHES.md`, `history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-17 — Sync S-018: pull requests #9 and #10 on `main`

**Reviewed:** the merges of #9 (`5d4befd`, the audit update) and #10 (`29d3d04`, the brand files and
the logo rename) into `main`, at the user's request, each after every check passed; neither adds
anything of its own. `7cfeaa6` by `kcerha` brings `main` (up to #9) into `feat/welcome-greeting`: only
the roadmap journal resolved by hand, version 0.21.0 kept.

**Status changes:** none. Pull request #8 conflicts with `main` again (version and journal) until it
brings in #10.

**Documents changed:** `PROJECT_STATUS.md`, `UNMERGED_BRANCHES.md`, `history/SYNC_LOG.md`,
`history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-17 — Sync S-017: the logo file renamed

**Reviewed:** our own rename on pull request #10 (0.20.16): `djafat/ogo.png` → `djafat/logo.png`, same
content (a typo in the first name).

**Status changes:** none.

**Documents changed:** `PROJECT_STATUS.md`, `history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-17 — Sync S-016: the owner's branch brings in `main`; our brand assets

**Reviewed:** `6198a89` by `kcerha`, merging `main` (`75db772`, the audit's fixes) into
`feat/welcome-greeting` (pull request #8): its only hand-made change is the roadmap journal; the
branch stays at 0.21.0. Our `155b946` (0.20.14, pull request #10): the DJAFAT logo, four icons and
five posters in `djafat/`, PNG only.

**Verified:** the merge's combined diff (only `docs/ROADMAP.md`); `verify:fast` all pass on #10.

**Status changes:** none. Merge order to keep versions ascending: #9, #10, then #8.

**Documents changed:** `PROJECT_STATUS.md`, `UNMERGED_BRANCHES.md`, `history/SYNC_LOG.md`,
`history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-17 — Sync S-015: `main` green after the merges; a correction on shutdown

**Verified:** CI and Security both green on `main` at `75db772`, the merge of pull request #7. The
user's local run (`/Users/mac/projects/djafat-latest`) now follows `main`: migration 0038 applied to
its database, seed re-run, the six apps started; checks: `/v1/ready` 200, a 2 MB body answers 413,
Helmet headers present, phone login works, `/v1/me` 200, restaurants listed, no error in the API log.

**Corrected:** S-012 said NestJS 10 was not affected by the shutdown hang. An old API process
(NestJS 10) that had run for three days ignored SIGTERM for 10 s and had to be force-stopped. Noted on
`OPS-02`; `main` bounds Prisma's disconnect since 0.20.11.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `history/SYNC_LOG.md`,
`history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-17 — Sync S-014: the owner's new branch `feat/welcome-greeting`

**Reviewed:** `cabf058` by `kcerha`, from an older `main` (`e82eb80`): a greeting on the four apps,
a restored admin import, Windows quoting for every argument in the pipeline scripts, the mobile
typecheck recorded as a known failure, and a roadmap update (demo online, Tigo Cash and Moov Money
in demo, a "100 % API" list).

**Verified:** the mobile typecheck passes on `main` (no generated typed routes there); the branch
conflicts with `main` only on the version and the journal (`git merge-tree`). The rest was read, not
run.

**Newly discovered:** `TEST-05` (Low, BRANCH): the known-failure entry would hide real mobile type
errors. Notes on `DOC-02` (the roadmap's "no code left to write" against open findings that need
code), `OPS-01` and `OPS-02` (MinIO image, trial server). 59 findings open.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`,
`UNMERGED_BRANCHES.md`, `history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-17 — Sync S-013: the audit's fixes are on `main`

**Reviewed:** the merges of pull requests #2 (`05ecacc`), #3 (`f9a8f41`), #4 (`44ae073`) and #7
(`75db772`) into `main`, in that order, at the user's request. None adds anything of its own: each
merge's tree is its pull request's head, and `main`'s final tree is identical to #7's verified head.

**Verified:** every check green on each pull request before its merge (Linux CI with the integration
job, Windows, Security).

**Status changes:** `PAY-01`, `PAY-03`, `SEC-01`, `FE-03` and `PAY-05` resolved on `main` (58
findings open, 10 resolved); T-102, T-103, T-104, T-107 and T-208 moved to `COMPLETED_TASKS.md`.
`DEP-01` down to the Expo tool chain, `postcss` and `zod`.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`,
`tasks/COMPLETED_TASKS.md`, `UNMERGED_BRANCHES.md`, `history/SYNC_LOG.md`,
`history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-17 — Sync S-012: the API on NestJS 11 and Fastify 5

**Reviewed:** our own `862ad24` (0.20.11) on the new branch `fix/api-nest11-fastify5`, stacked on
pull request #4: NestJS 10.4 → 11.2.10, Fastify 4.29 → 5.12.8 and their plugins; a bounded Prisma
disconnect on shutdown; the lint package pinned to the workspace's TypeScript; the audit baseline
trimmed.

**Verified:** `verify:fast` all pass; `pnpm audit --prod` 73 → 36 advisories, critical 3 → 1, none
in the API's stack, nothing new; integration suite 97/97 in 2 of 3 runs; the built API booted in
development and production mode (health, Helmet, CORS, Swagger, webhook, 413 on 2 MB, exit after
SIGTERM).

**Found on the way:** with NestJS 11 the API no longer stopped on SIGTERM: Prisma 6.2's
`$disconnect()` never settles when called a moment after the signal, and NestJS 11 calls it last.
Fixed on the same branch (2 s bound). `TEST-04`: a likely cause found (port collisions on macOS
with 127.0.0.1-only listeners such as Prisma's query engine); not yet proven.

**Status changes:** `DEP-01` API part fixed on a branch; `API-01` 413 case fixed there.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`,
`UNMERGED_BRANCHES.md`, `history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-17 — Sync S-011: `PAY-01` fixed on #4; new `TEST-04`

**Reviewed:** our own `a017f48` (0.20.10): payment creation applies the payment screen's rule
(enabled configuration, active provider) and stores the provider's own method.

**Verified:** `verify:fast` all pass; API unit tests 899/899; the finding's Verify step on
PostgreSQL. The full integration suite passed 97/97 in 7 of 9 local runs; the 2 others failed
intermittently outside this change, and the suite without pull request #4 passed 4 of 4.

**Status changes:** `PAY-01` has a verified fix on pull request #4 (Open until merged); T-102 in
progress. All five blocking fixes are now on #4.

**Newly discovered:** `TEST-04` (Medium, RUN): intermittent local integration failures, cause not
found. 63 findings open.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`,
`UNMERGED_BRANCHES.md`, `history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-17 — Sync S-010: our stack renumbered on `main`; `PAY-05` fixed on #4

**Reviewed:** our own commits: `main` brought into #2 (`c1abcba`, 0.20.4 `d366f12`), #2 into #3
(`0c61784`, 0.20.5 `c715ae2`), #3 into #4 (`7452ec4`, its versions renumbered 0.20.6 to 0.20.8),
and `2319186` (0.20.9): the webhook signature is checked before anything is stored (`PAY-05`).

**Verified:** `verify:fast` all pass on each branch (lint, typecheck, unit 24/24 on #3 and #4);
`pnpm install --frozen-lockfile` passes on the merged lockfile of #3; API integration suite 95/95
on a fresh database, including a new test that replays the audit's two webhook requests.

**Status changes:** `PAY-05` has a verified fix on pull request #4 (Open until merged); T-107 in
progress. The version numbers quoted for `PAY-03`, `FE-03`, `SEC-01` and their tasks updated.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`,
`UNMERGED_BRANCHES.md`, `history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-17 — Sync S-009: the demo is online; two pull requests merged into `main`

**Reviewed:** pull request #5 (`07f2539` by `kcerha`, merged as `e82eb80`) and pull request #6
(`c804526`, merged as `9058e33`); `main` is at DJAFAT 0.20.3. Of the three merges, two add nothing
of their own and `b9a6d8c` only renumbers the version.

**Verified:** the five demo addresses (site, API health, admin, restaurant, courier) answered
HTTP 200 on 2026-11-17. The commits were read, not run.

**Status changes:** `FE-05` fix present on `main`, unverified; `MOB-01` and `OPS-02` partly
addressed; `SEC-02` noted for the live demo; `SDK-01` unchanged: the commit's statement that no
browser could reach the API was not reproduced in our earlier browser runs. 62 findings open.

**Consequence for our work:** pull requests #2 to #4 overlap `main`'s version numbers and are
renumbered from 0.20.4.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`,
`UNMERGED_BRANCHES.md`, `history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-14 — Sync S-008: our fixes for the delivery code and the secrets

**Reviewed:** our own six commits on pull requests #3 and #4: two stacking merges with an empty
combined diff, the version commits 0.20.3 and 0.20.4, and two fixes: `70cfd3b` (0.20.5, the
customer sees the delivery code) and `aa0d58d` (0.20.6, production refuses weak secrets).

**Verified (locally, before each push):** `verify:fast` all pass; API integration suite 94/94 on
a fresh database; a browser journey for the delivery code; the built API started three ways for
the secrets. Hosted: CI, Windows and Security green on `70cfd3b`; on `aa0d58d` Windows, Security
and the integration job green, the lint/typecheck/test/build job still running at sync time.

**Status changes:** `PAY-03`, `FE-03` and `SEC-01` (production only) have verified fixes on pull
request #4; all three stay Open until it is merged. T-103, T-104 and T-208 in progress. Corrected:
S-007 had put the refund fix on T-102 instead of T-103.

**Newly discovered:** `DOC-03` (Medium, CODE): the local guide keeps the placeholder secrets of
`.env.example`, so pickup fails locally and no delivery can be completed. 62 findings open.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`,
`UNMERGED_BRANCHES.md`, `history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-14 — Sync S-007: `main` holds the newest code

**Reviewed:** pull request #1, merged into `main` by the owner on 2026-11-13 (`46d8cae`, DJAFAT
0.20.1), with three new commits (Windows workflow, `main` as the reference branch, a test wait),
and four commits on `fix/payment-reliability-backlog`.

**Verified:** CI and Security both green on `main` for the first time (push of `46d8cae`).

**Status changes:** `SDK-01`, `FE-01` (cash), `PAY-02`, `TEST-01` and `CI-01` resolved on `main`;
61 findings remain open. T-101, T-108 and T-202 moved to `COMPLETED_TASKS.md`.

**Our pull requests:** #2 brought onto `main` (version 0.20.2). #3 and `fix/audit-blockers` are
stacked on it.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`,
`tasks/COMPLETED_TASKS.md`, `UNMERGED_BRANCHES.md`, `history/SYNC_LOG.md`,
`history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-13 — Sync S-006: the newest code run locally end to end

**Reviewed:** `4c756e0` on `claude/compassionate-franklin-k23vcj` (pull request #1), which
rewrites the integration walking skeleton on the current delivery flow. Hosted run 43212219986:
all four checks green.

**Local run (this machine only, nothing versioned):** the branch checked out in a separate
working tree, `/Users/mac/projects/djafat-latest`, with its own Docker project and database, a
`.env` built from the branch's `.env.example` with random secrets, and a helper script that also
pulls updates and serves the courier web app.

**Verified (RUN, branch only):** 37 migrations and the seed on a fresh database; the API, the
worker and the four web apps start. In the browser, with no workaround, the full journey works:
customer login by SMS code, order, cash payment, restaurant accept and ready, courier offer,
pickup, delivery with the code, admin listing. Afterwards the payment was `succeeded` and the ledger
balanced. This verifies the branch's fixes for `SDK-01`, `FE-01` (cash) and `PAY-02`.

**Still open on the branch:** `FE-03`: no screen shows the customer their delivery code.

**Not verified:** other payment methods, WhatsApp and e-mail login, native mobile builds, a
server deployment.

**Documents changed:** `FINDINGS.md` (`SDK-01`, `PAY-02`, `FE-01`, `MOB-01`, `FE-03`, `TEST-01`,
`DOC-02`), `tasks/BACKLOG.md` (T-101, T-201, T-202, T-208), `PROJECT_STATUS.md`,
`UNMERGED_BRANCHES.md` §3.5, `TESTING_AND_QUALITY_ASSURANCE.md` §5,
`DEPLOYMENT_AND_ENVIRONMENT.md` §2, `history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-12 — Local run configured; sync S-005: two more commits on pull request #3

**Local run (this machine only, nothing versioned):** a `.env` generated from `.env.example` with
random secrets; a Docker Compose override for the port clash and the missing arm64 image; Node 22
in an ignored folder; a helper script for setup, start, stop and login codes. The two AES keys were
kept from the earlier local session so the data already encrypted in the local database stays
readable.

**Verified:** the project's own configuration check accepts the `.env`; migrations (none pending),
seed and the package build pass; the API, the worker and the three web apps start in watch mode.
An API login (code request, code read from Redis, verification, `/me`) works. A 29-page browser
walk renders every screen. With the fetch workaround the logged-in screens work. Order creation is
refused because the test restaurant was closed at the hour of the test, as designed.

**Sync S-005:** `c616695` and `6cbbad4` on `fix/next-15.5`, pushed by another Claude session
working as the repository's user, both copied from pull request #1. Hosted run 43156964436: `check`
passes, Expo apps included (`MOB-01` fixed there); `integration` gets past Seed and fails at the
tests (`TEST-01`). Merging pull requests #1 and #3 now also conflicts in `ci.yml` (take #1's file).

**Not verified:** the Expo apps on a device; browser login on `main`, which needs `SDK-01` fixed.

**Documents changed:** `FINDINGS.md` (`MOB-01`, `CI-01`), `tasks/BACKLOG.md` (T-106, T-109,
T-210), `PROJECT_STATUS.md`, `DEPLOYMENT_AND_ENVIRONMENT.md` §2, `UNMERGED_BRANCHES.md` §2b,
`history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-12 — Sync S-004: `next` upgraded to 15.5.29 on pull request #3

**Changed**

- New branch `fix/next-15.5`, pull request [#3](https://github.com/aliabbasaleh/djafat/pull/3),
  from `main`: `next` 15.1.3 → 15.5.29 in `apps/web`, `apps/admin`, `apps/restaurant` and
  `packages/ui`. The lockfile changes only within `next`'s own dependency tree; `typedRoutes`
  moves out of `experimental`; `next-env.d.ts` is regenerated (commit `5d36c6a`). The gitleaks
  token fix of pull requests #1 and #2 is copied unchanged (commit `480ec14`).

**Verified:** locally with Node 22, format, typecheck, lint, unit tests and the build without the
Expo apps pass; the typecheck also passes with no `.next` folder. In headless Chrome, 29 pages of
the three apps were walked against the same API and data, once on `main`'s build and once on the
branch. 26 pages are identical in every recorded field, and the other 3 differ only by the order
each run placed and an elapsed time; 22 screenshots are byte-identical, the 7 others checked by
eye. Hosted pipeline on pull request #3: no `next` advisory left (110 advisories instead of 151,
3 critical instead of 8); gitleaks passes; `check` fails at Build and `integration` at Seed, as
on `main`.

**New issues:** `CI-03` (Low): the pre-commit hook cannot run ESLint on `main`. `FE-07` (Low):
typed routes are configured but never checked.

**Not verified:** the upgraded apps on a server reachable from outside; the Expo apps, which the
change does not touch and which cannot be bundled on `main` either (`MOB-01`).

**Documents changed:** `FINDINGS.md` (`DEP-01`, `CI-01`, new `CI-03` and `FE-07`, counts),
`tasks/BACKLOG.md` (T-105, T-109, new T-407 and T-408), `tasks/PRIORITY_TASKS.md`,
`PROJECT_STATUS.md`, `SECURITY_AUDIT.md`, `TESTING_AND_QUALITY_ASSURANCE.md` §5,
`DEPLOYMENT_AND_ENVIRONMENT.md` §4, `APPLICATION_INVENTORY.md`, `UNMERGED_BRANCHES.md`,
`applications/WEB.md`, `ADMIN.md`, `RESTAURANT.md`, `history/SYNC_LOG.md`,
`history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-11 — Sync S-003: pull request #2's checks; the secret scan runs on pull requests

**Changed**

- `.github/workflows/security.yml` (commit `281c323`, pull request #2): the `gitleaks` job gets the
  run's `GITHUB_TOKEN` and read-only `contents` and `pull-requests` permissions. Without them
  `gitleaks-action` stops on every pull request before scanning. The lines are those of pull
  request #1 (`6d04e4e`, `397ca6b`), so the two pull requests merge without a conflict in that
  file. The audit job is unchanged.

**Verified:** the gitleaks check passes on pull request #2 (run 43046807317: 4 commits, no leaks),
as on pull request #1. A local gitleaks 8.30.1 scan of the same commits, with and without
`.gitleaks.toml`, finds nothing. Merge test with pull request #1: only `.claude/settings.json`
conflicts (expected), and `security.yml` comes out as #1's file; no conflict with
`fix/payment-reliability-backlog`.

**Learned:** the other three red checks on pull request #2 fail at the same steps as on `main`
(Build, Seed, audit). The audit job reports 151 advisories, 8 critical. Five of these are in
`next` 15.1.3, four of them remote code execution, and according to the advisories none affects
15.5.28 or later. Pull request #1's audit baseline accepts all eight critical ones. The weekly
secret scan reads every branch: besides the two fixtures on `main`, it flags two throwaway CI keys
on `fix/payment-reliability-backlog`.

**New issue:** `CI-02` (Low): the pre-push secret scan reads the staged changes, not the pushed
commits, so it never finds anything; reproduced in a throwaway repository, task T-313.

**Documents changed:** `FINDINGS.md` (`DEP-01`, `CI-01`, new `CI-02`, counts), `tasks/BACKLOG.md`
(T-105, T-109, new T-313), `PROJECT_STATUS.md`, `SECURITY_AUDIT.md`,
`TESTING_AND_QUALITY_ASSURANCE.md` §4, `DEPLOYMENT_AND_ENVIRONMENT.md` §4,
`APPLICATION_INVENTORY.md`, `UNMERGED_BRANCHES.md`, `applications/WEB.md`, `ADMIN.md`,
`RESTAURANT.md`, `history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`.

---

## 2026-11-11 — The after-pull reminder is shared with the collaborator

**Changed**

- The hook moved from the local `.claude/settings.local.json` to the versioned
  `.claude/settings.json`, so every Claude Code session in the repository runs it. The local file
  was set aside, so the hook does not run twice on this machine.
- `.gitignore`: `.claude/` is no longer ignored as a whole — only its local contents are. The lines
  are copied verbatim from the collaborator's branch, so the two versions merge without conflict.
- The checker no longer reacts to one's own `git commit` (the next prompt reports those);
  `docs_2/.gitattributes` keeps the script's line endings for Windows and gives
  `LAST_REVIEWED_COMMIT` Git's `union` merge.
- `README.md` §4 rewritten for the shared setup: when it runs, requirements, how to silence it, and
  how to resolve the expected conflict on `.claude/settings.json` with the collaborator's branch.
- Committed on the branch `docs/audit-sync` and proposed to `main` as pull request
  [#2](https://github.com/aliabbasaleh/djafat/pull/2) (merge with a merge commit, not a squash).
- Sync S-002 recorded for that commit. The checker now ignores commits that change only `docs_2/`,
  so recording a review does not trigger another reminder.

**Verified:** the shared hook fired inside the running session (temporary sentinel, removed); the
checker reminds after `git pull` and `git fetch`, stays silent after `git commit`; JSON settings
validated with `jq`; repository format check passes.

---

## 2026-11-11 — Sync S-001: four new commits on the collaborator's branch

**Reviewed:** `origin/claude/compassionate-franklin-k23vcj` `2a622a1..804176f` — test-suite
hygiene, a versioned roadmap (`docs/ROADMAP.md`) and a local-setup guide in `docs/`, a one-command
server install, a `node-forge` override. `main` unchanged.

**Verified:** nothing on the branch was run (BRANCH evidence). One RUN check: merging the two remote
branches conflicts in 6 files (throwaway clone).

**Documents changed:** `FINDINGS.md` (counts, `GOV-01`, `TEST-01`, `DEP-01`, `OPS-01`, `OPS-02`,
`SEC-02`, `DOC-01`, `DOC-02`, new `OPS-05`), `PROJECT_STATUS.md`, `UNMERGED_BRANCHES.md` (§3.4 new),
`SECURITY_AUDIT.md`, `DEPLOYMENT_AND_ENVIRONMENT.md`, `RISKS_AND_RECOMMENDATIONS.md`,
`tasks/BACKLOG.md`. Detail: [`SYNC_LOG.md`](SYNC_LOG.md) → S-001.

**Learned:** a live server deployed from the branch would start without roles, permissions or
ledger accounts, and the obvious workaround is unsafe (`OPS-05`, High). 63 open findings.

---

## 2026-11-11 — Audit documents moved to `docs_2/`; sync after every pull

**Changed**

- Moved all 36 audit documents from `docs/` to `docs_2/`, at the user's request, so the original
  `docs/` folder stays the design dossier and the collaborator's space.
- Restored `docs/README.md` (it had been renamed to `docs/00-dossier-architecture-v1.md`) and the
  root `README.md` (its banner had been edited) to their committed versions. `git status` shows no
  change under `docs/` or to `README.md`.
- Rewrote `docs_2/README.md`; added `history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT` and
  `tools/audit-sync-check.sh`; installed a local Claude Code hook (`.claude/settings.local.json`,
  untracked) that runs the checker on every prompt and after branch-moving `git` commands.
- Corrected the paths in `PROJECT_OVERVIEW.md`, `FINDINGS.md` (`DOC-01`) and
  `tasks/COMPLETED_TASKS.md`.

**Verified:** see `tasks/COMPLETED_TASKS.md` → AUDIT-2.

---

## 2026-11-10 — Initial full audit; documentation system created

**Changed**

- Created the living documentation: `README.md` (index), `PROJECT_STATUS.md`, `FINDINGS.md`,
  `PROJECT_OVERVIEW.md`, `SYSTEM_ARCHITECTURE.md`, `APPLICATION_INVENTORY.md`,
  `DATABASE_AND_DATA_MODEL.md`, `API_AND_INTEGRATIONS.md`, `SECURITY_AUDIT.md`,
  `CODE_QUALITY_AUDIT.md`, `UI_UX_AUDIT.md`, `TESTING_AND_QUALITY_ASSURANCE.md`,
  `DEPLOYMENT_AND_ENVIRONMENT.md`, `TECHNICAL_DEBT.md`, `RISKS_AND_RECOMMENDATIONS.md`,
  `UNMERGED_BRANCHES.md`, `applications/` (8), `modules/` (7), `tasks/` (4), this file.
- Renamed the previous `docs/README.md` (French dossier summary) to
  `docs/00-dossier-architecture-v1.md`. Content unchanged. _(Reverted 2026-11-11.)_
- Root `README.md`: replaced the stale "Bloc 0 — Foundations" banner with a pointer to
  `docs/PROJECT_STATUS.md`; added `courier` and `ui` to the structure lines; named Node 22;
  flagged that `pnpm infra:up` fails as written and linked the working procedure. _(Reverted
  2026-11-11.)_
- **No application code was changed.**

**Verified on 2026-11-10** (branch `main` @ `d1439c6`; detail in `TESTING_AND_QUALITY_ASSURANCE.md`)

- Install, formatting, typecheck, lint, 1 146 unit tests: pass.
- Builds: API, worker, web, admin, restaurant pass; mobile and courier fail; root `pnpm build` fails.
- 29 migrations and seed on PostgreSQL 16 + PostGIS: pass.
- Integration suites: API 0 of 93 run; worker 6 of 9 pass.
- Live scenarios against API + worker + PostgreSQL + Redis: prepaid order to delivery; payment
  abuse; cash; webhooks; rejection; refunds; tenant isolation; roles; rate limits; token rotation;
  MFA; realtime; placeholder secrets; Redis outage.
- The three web apps in headless Chrome, unmodified and with the SDK defect patched in the page.
- Hosted CI status and logs; dependency audit; secret scan of the full history.

**Learned**

- 62 findings: 9 critical, 21 high, 22 medium, 10 low (`FINDINGS.md`).
- `main` is 37 commits behind an active remote branch (`UNMERGED_BRANCHES.md`).
- Statements in earlier reports that the pilot was "GO" and the integration tests green describe
  API-level runs and tests that cannot execute; corrected in `FINDINGS.md` (`DOC-02`, `TEST-01`).

**Environment notes for whoever repeats this**

- Node 26 is refused by the repository; Node 22.23.4 was used.
- `pnpm infra:up` does not work as written; the stack was started without MinIO and with PostgreSQL
  forced to `linux/amd64` (`OPS-01`).
- Everything started for the audit was stopped and removed afterwards. `node_modules` and build
  outputs remain (ignored by Git).

---

## Before 2026-11-10

See the Git history (70 commits on `main`, 2026-09-10 → 2026-10-14) and the French block reports
`docs/17` → `docs/36`.
