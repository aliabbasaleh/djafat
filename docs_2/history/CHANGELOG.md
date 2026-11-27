# Changelog

What changed in the project and its documentation, newest first. One entry per meaningful change.
Code changes also appear in Git; this file records **what was verified** and **what was learned**,
which Git does not.

Format: date · what changed · affected areas · verification · newly discovered issues.

---

## 2026-11-27 — Sync S-055: the sign-up stack in `main` (PR #34, 0.28.3); PR #29 updated (0.28.4)

The repository is public, so GitHub's checks run again: PR #34 (the teammate's integration branch) merged with its
five checks green; #28 marked merged, #31 to #33 closed, their branches deleted; PR #29 brought up to date as
0.28.4. Verification: `verify --full` on a separate database (all pass but a `build` failure caused by
`NODE_ENV=development`, `TEST-07`), and the sign-up and sign-in of customers, couriers, restaurants and admins in a
real browser, 31/31. `CI-03` resolved, T-407 done. Learned: a fresh worktree needs `pnpm install` and the workspace
packages built before the type-aware pre-commit ESLint means anything.

---

## 2026-11-27 — Sync S-054: the integration branch checked out, three roadmap lines restored, 0.28.3

The main checkout follows the teammate's `feat/connexion-integration`. Its merge had put back the pre-0.24.5 text of
three `docs/ROADMAP.md` lines (real e-mail in production, DJAFAT Gmail, MinIO re-test); `a4cfd23` (0.28.3) restores
them from `main`. `fix/login-method-icons` is gone (PR #26 closed as superseded by FEAT-020). Verification: a real
commit through the batched pre-commit config (RUN, macOS); `verify:fast` clean. Learned: compare a teammate's merge
with `git merge-tree` of its parents — a conflict resolution can also undo lines that merged cleanly.

---

## 2026-11-26 — Sync S-053: teammate merge of the PR #33 stack into `main`

`feat/connexion-integration` (kcerha) merges our stack into `main`, with the pre-commit commands batched
(`lint-staged.config.cjs`) and the stop hook's Prettier check batched. Verification: the batching exercised
(RUN); not run as a real commit nor on Windows. Nothing new learned about the code.

---

## 2026-11-25 — Sync S-052: favicons from the new icon, FEAT-022 decisions confirmed, 0.28.2

The three web apps' favicons come from the new icon; the user confirmed six FEAT-022 decisions (Q18–Q22, Q25).
Verification: the running sites serve the new favicon; `verify:fast`. Nothing new learned.

---

## 2026-11-25 — Sync S-051: new brand images, 0.28.1

The user's new logo and icon in `djafat/`, the old « D » icons and the posters removed (no code used them; the
apps' favicons unchanged). Verification: `git grep` for references, `check:hygiene`. Nothing new learned.

---

## 2026-11-25 — Sync S-050: FEAT-022 part 3 (restaurants), 0.28.0

The restaurant's four steps in its console, DJAFAT's decisions on restaurants, changes after approval
(waiting for an admin, accepted with the step-up code; payouts keep the approved number), « Mes gains » /
« Mes papiers » in the courier app, the admin « Quartiers » page. Areas: `catalog`, `couriers`, `admin`,
`payments` (read through a new port), restaurant, admin and courier apps, SDK. Verification: `verify --full`
at `70733f3`, 33 integration tests on a fresh database, browser run (28 checks). Learned: the independent
review (three rounds) found two cross-restaurant authorization problems before any push — new findings
`SEC-09`, `SEC-10`, fixed on the branch; admin role grants now keep « one account, one restaurant ».

---

## 2026-11-24 — Sync S-049: checked inputs (FEAT-024) and sign-up screens (FEAT-022 part 4), 0.27.0

**Added (branch, PR to come):** no SMS code abroad — a foreign number uses WhatsApp (when in service) or
the e-mail; no fixed line for an account or a code; Mobile Money in Chad; names in letters; help for a
mistyped e-mail; « +235 » in every phone field. Courier and restaurant sign-up screens, welcome e-mail,
« Devenir livreur » and « Inscrire mon restaurant » in « Mon profil ». **Fixed:** a malformed phone could
crash the sign-up (AUTH-03). To merge with FEAT-022 part 3 only.

---

## 2026-11-24 — Sync S-048: FEAT-022 parts 1-2 reviewed and corrected (0.26.0); PR #29 is 0.24.6

**Fixed (review):** a restaurant that signed up could be made visible by its owner without DJAFAT — refused
now; photo uploads are read only on their routes and for a valid session; a full disk answers « plus de
place » without leaving files; photos lose what phones append after the image; a switch to a bicycle asks
before deleting photos. **Changed:** the photos backup and its weekly check cover every photo the database
refers to. PR #29 takes 0.24.6 (`main` merged in).

---

## 2026-11-23 — Sync S-047: `main` 0.24.5; FEAT-022 part 2 (local branch, not pushed)

**`main` (teammate, PR #30):** customer accounts by e-mail run on djafat.com with DJAFAT's real Gmail; the MinIO
image is still locked (claims; our registration request was accepted by the live API). PR #29 must move to 0.24.6
before its merge (`main` is 0.24.5). **FEAT-022 part 2:** couriers fill and send their application in the courier
app; admins check it in « Demandes à vérifier » and approve or refuse with a reason, by e-mail; private photos open
only through 5-minute links. Four older problems fixed on the way (error details, images across sub-domains,
console sub-pages, disabled buttons in the courier app's browser build).

---

## 2026-11-23 — Sync S-046: FEAT-022 part 1 (local branch, not pushed)

**Added:** the N'Djamena neighbourhood list (admin-editable, never reset by a reinstall), photos on the server disk
(private papers only through 5-minute signed links, metadata removed, nightly backup of the volume), sign-up as a
courier or a restaurant on the API (created with the account, in one transaction). **Changed:** a courier who signed
up goes online only once approved. **Verified:** fast checks; 129 integration tests on a fresh database.

---

## 2026-11-23 — Sync S-045: FEAT-022 specs adjusted

**Changed (docs only):** sign-up reachable from every login screen (SPEC-022-01 v2), photo metadata stripped
without a native image library (SPEC-022-04 v2), a taken phone number said openly as in FEAT-020 (SPEC-022-02, 08 v2).

---

## 2026-11-23 — Sync S-044: sign-up by account type specified (FEAT-022)

**Added (docs only):** FEAT-022's specs, decisions and brief on `feat/inscription-par-type`. **Decided by the user:**
photos on the server disk (papers private), a neighbourhood list plus « Autre », a new Mobile Money number approved
before use, couriers 18 or older with a birth date, a terms checkbox with a placeholder text. **Followed:** PR #28
(FEAT-021) and PR #29 (cheaper CI) — no GitHub job runs on them until billing is fixed.

---

## 2026-11-23 — Sync S-043: the team logs in by e-mail and password (FEAT-021, 0.25.0)

**Added:** `packages/sdk/src/team-login.ts` (one role check for every way in, the FEAT-020 password rules before any
reset is sent), `requestPhoneLoginCode` / `verifyPhoneLoginCode` in the SDK client; the admin console, the restaurant
console and the courier app log in by e-mail and password (a code by e-mail on a new device, « Mot de passe
oublié ? »), SMS and WhatsApp shown « Bientôt disponible » until `/auth/methods` offers them; `infra/deploy/README.md`
§4: how to switch SMS off, with a read-only pre-cut check. **Changed:** production accepts `SMS_PROVIDER=disabled`
with `EMAIL_PROVIDER=smtp` (SPEC-021-01, supersedes SPEC-008-01 R3); the first admin creates an account on the site.
**Fixed:** the consoles' login form touched the screen edges at 390 px (already on `main`).

**Verified:** `verify --full` on a fresh database, no new failure (typecheck, lint, tests, build, audit, integration;
e2e unavailable); 15 execution screenshots opened; the pre-cut query on the local database. **Decided:**
FEAT-021-Q11 — SMS is switched off only once every active team account has a verified e-mail and a password; a
step-up code on e-mail and password changes for MFA roles is deferred (T-612). **Not verified:** a GitHub run (no
job starts until billing is fixed), the cut-over on the server.

---

## 2026-11-23 — Sync S-042: PR #27 merged; CI that spends fewer Actions minutes (0.24.5)

**Changed:** `main` is `038c723` (PR #27 merged, FEAT-020). Branch `ci/cheaper-runs`, at the user's request (« make CI
cheaper »): a `scope` job decides which jobs a run needs — every check on `main` and on a manual run, nothing heavy on
a draft pull request (« Ready for review » runs them), only `format:check` and `check:specs` when the whole pull
request is documentation (the root version bump included). It judges the whole pull request, never the last push
alone, so code is always tested before merge. Security cancels a superseded pull-request run.
`docs/TRAVAILLER-EN-LOCAL.md` asks teammates to open pull requests as drafts and to group their pushes.

**Verified:** `scripts/pipeline/test/ci-scope.test.mjs` (7 tests, one runs the script on a real git history),
`pnpm check:pipeline` 78/78, `verify:fast` all pass. **Not verified:** a real GitHub run — none starts until billing is
fixed.

---

## 2026-11-23 — Sync S-041: PR #27 merged into `main` without GitHub's checks (FEAT-020, 0.24.4)

**Changed:** at the user's request (« just merge it and comment it in the changelog »), PR #27 is merged although
no GitHub job ran on it: the account that owns the repository has used up its Actions minutes for the month
(« recent account payments have failed or your spending limit needs to be increased »; about 1,800 minutes used by
this repository since 1 November, Windows jobs counting double).

**Verified instead:** `verify --full` locally on `4a785d0`, without new failure (PostgreSQL + Redis integration
included); on GitHub, Linux, integration, audit and gitleaks green on `379db20`; after it, only the time limits of
four test files changed (`5818b77`), re-run locally: 45 tests out of 45. **Not verified:** the Windows job with those
limits, and any check on `main` itself.

**To do:** once the owner fixes billing (Settings → Billing and licensing), re-run every check on `main`
(`docs/ROADMAP.md`, « à faire côté DJAFAT »).

---

## 2026-11-23 — Sync S-040: Windows CI timeouts on PR #27 (FEAT-020, 0.24.3)

**Learned:** real scrypt (N=2^15) in unit tests is slower on the Windows CI runner: two tests passed 5 s
(vitest's default). The test files that hash real passwords now allow 30 s; what they check is unchanged.

---

## 2026-11-22 — Sync S-039: FEAT-020 reviewed three times, corrected, ready for PR (0.24.2)

**Verified:** `verify --full` on `4a785d0` (fresh database, mock e-mail): every check passes, e2e
unavailable — no new failure; the third review found nothing left to fix. **Fixed before merge:** an
open redirect after login; phone orders filing a caller's order into an e-mail account whose number
was only typed; three ways to learn whether an address had an account; an e-mail change that needed
neither the password nor an alert. **Changed by the user's decisions:** a verified e-mail opens cash on
delivery at level T1; phone orders are refused for such numbers until confirmed. **Learned:** a fix can
open its own hole (the first redirect fix normalised `/..//x` into `//x`) — the second review caught it.

---

## 2026-11-22 — Sync S-038: three features confirmed (FEAT-021, FEAT-022, FEAT-023)

**Added (plans, no code):** the user decided to switch SMS off until DJAFAT has an API, so admins, restaurants and
couriers will log in by e-mail and password (FEAT-021, T-614); anyone will sign up as customer, courier or restaurant,
complete their profile in their own app and be validated by DJAFAT (FEAT-022, T-615); WhatsApp login will be free
because the customer sends the code (FEAT-023, T-616). **Learned:** Meta's official pricing page (read 2026-11-22)
charges every business-sent message since 2026-10-01, including replies in the 24-hour window; FEAT-008's reply with
the code is therefore no longer free.

---

## 2026-11-22 — Sync S-037: first registration code received in a real inbox (FEAT-020, 0.24.2)

**Verified:** the user received « Confirmez votre adresse e-mail DJAFAT » in DJAFAT's Gmail inbox (Inbox, not spam),
with the text of `email-otp-text.ts` (MANUAL, screenshot shown in the session): SPEC-020-01-SC06 is proven on the
local `.env`; on the server it remains to do (T-611). **Learned:** `EMAIL_FROM` set to the bare address hides the
« DJAFAT » sender name (the default `DJAFAT <SMTP_USER>` only applies when it is empty); `.env.example` and the local
guide now say to leave it empty.

---

## 2026-11-22 — Sync S-036: the Gmail app password, first real send (FEAT-020, 0.24.1)

**Verified:** with the official Gmail address and its app password in the local `.env` (set by the user, never
displayed), a registration to DJAFAT's own address was accepted by Gmail's SMTP server (API log, RUN); arrival in
the inbox is for the user to confirm. **Learned:** an app password pasted with its spaces and no quotes breaks
`source .env` (the shell keeps nothing of it, the API refuses to start); `.env.example` and the local guide now say
"without spaces, or quoted".

---

## 2026-11-21 — Sync S-035: customer accounts by e-mail and password (FEAT-020), CORS fix (API-02)

**Changed (branch `feat/compte-email-password`, version 0.24.0, not on `main` yet):** at the user's request,
« Connexion » becomes « Compte »: registration with name, phone, e-mail and password, confirmed by an e-mail
code; login by password with a code on a device not remembered (30 days), or by a code alone; forgotten
password; « Mon profil » sets or changes the password and confirms the number. WhatsApp and SMS stay available
as code channels and show « Bientôt disponible » while switched off. E-mails go through the official Gmail account
(`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` — the app password is set by the user in `.env`, never in Git).
Migration 0040 (password hash, pending challenges, remembered devices, codes bound to their request).

**Verified:** `pnpm verify:fast` green; unit tests of every scenario; the three FEAT-020 integration scenarios and
the whole integration suite (13 files, 115 tests) on a fresh PostgreSQL database; a real browser run of the site
(registration, new device, remembered device, wrong password, reset, profile) with 13 screenshots
(`docs/features/FEAT-020-compte-email-mot-de-passe/progress.md`). Not verified: a real Gmail delivery (needs the
user's app password) and the app's screen (no Expo build, `MOB-01`).

**Reviewed (collaborator):** `origin/fix/login-method-icons` `628dce4` (kcerha, 0.23.6) — SVG icons instead of
emoji on the old login page; reused in FEAT-020's account screens, which replace that page (CODE + RUN in the
browser pass of 2026-11-22). The two branches conflict on `connexion/page.tsx`, `docs/ROADMAP.md`, `package.json`.

**Learned:** [`API-02`](../FINDINGS.md#api-02) — `@fastify/cors` allows only GET, HEAD and POST by default: browsers
refused every PUT, PATCH and DELETE from another origin, LIVE on `api.djafat.com` (profile name, cart quantities,
addresses, the restaurant console's edits). Fixed on the same branch.

---

## 2026-11-18 — Sync S-034: everything merged — `main` is DJAFAT 0.23.4

**Verified:** at the user's request, #17 to #24 were merged in order, each only after its five checks were green
and GitHub reported it mergeable (merge commits `0ab2644`, `e3f0d03`, `c1ea1e5`, `e78a6d8`, `83237aa`, `3e92261`,
`47370de`, `afaa7c2`). `main`'s tree is identical to the verified tip of #24. No pull request of ours is open.

**Status changes:** resolved on `main`: `TEST-05`, `ADM-01`, `ADM-02`, `ORD-01`, `PAY-04`, `ORD-02`, `ADM-03`,
`SEC-02`, `OPS-05`. `FE-02` is merged but stays open until a real browser session confirms it. `OPS-02` stays open:
the scripts are on `main`, not yet installed on the server. `OPS-06` (the trial server) waits for DJAFAT. Counts:
49 open (3 Critical, 11 High, 22 Medium, 13 Low), 21 resolved. T-204, T-205, T-206, T-213, T-302, T-303, T-610
done.

**Merging meant two decisions:** #17 went in without the owner's review, and #19 brought the refund split of
`docs/37` to `main`; both at the user's explicit request. Nothing is deployed: the server changes only when
someone runs `install.sh` there.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `UNMERGED_BRANCHES.md`, `tasks/BACKLOG.md`,
`history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`; outside `docs_2/`: `docs/ROADMAP.md`.

---

## 2026-11-18 — Sync S-033: a live server can start, without test accounts

**Verified:** on a fresh database (never the user's data): the reference run as a production server leaves no
user, no restaurant and only `cash` active; a second run changes no row count and keeps a setting edited on the
server and a provider switched on by hand, while `mock` is forced off again; the demo seed is refused in
production without `SEED_DEMO=1`; the first login gets the `customer` role; `create-super-admin.ts` grants the
role (audited), is idempotent, refuses a second one without `--another`, and the console then answers 200.
The old and the new demo seed give identical row counts in all 60 tables, identical settings and providers;
integration suite 112/112 on the new one. `pnpm verify:fast` all pass.

**Learned:** the old seed reset every platform setting and provider switch to its default at each run; the demo
server runs it at every `install.sh`, so a setting changed on the demo was undone by the next deploy (unchanged
for the demo; a live deploy no longer does it). A refusal of the new command first exited before Prisma
disconnected, leaving the binary query engine running with a database connection (seen as two lingering
sessions); fixed before the commit.

**Status changes:** `SEC-02` and `OPS-05` fixes present on `fix/live-bootstrap` (0.23.4). T-302 in progress.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `UNMERGED_BRANCHES.md`, `tasks/BACKLOG.md`,
`history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`; outside `docs_2/`: `infra/deploy/README.md`,
`docs/ROADMAP.md`.

---

## 2026-11-18 — Sync S-032: pull requests #13 to #16 merged into `main`

**Verified:** at the user's request, #13 to #16 were merged in order, each only after its five checks
(gitleaks, integration, lint/typecheck/test/build, local setup on Windows, `pnpm audit`) were green and
GitHub reported it mergeable. `main` is `034123a` (DJAFAT 0.21.7), and its tree is identical to the
verified tip of #16 (`ed35760`).

**Status changes:** `TEST-04` and `DOC-03` resolved on `main`; the favicon item of `FE-06` is on `main`
(the finding stays open for its other items). T-608 and T-609 done. Counts: 58 open (22 Medium), 12
resolved.

**Still open:** #17 (waits for the owner's review) to #22, and #23. The local `main` branch is checked
out in `/Users/mac/projects/djafat-latest` (the user's local app) and was not moved.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `UNMERGED_BRANCHES.md`, `tasks/BACKLOG.md`,
`history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`; outside `docs_2/`: `docs/ROADMAP.md`.

---

## 2026-11-18 — Report: the work of 18 November, pull requests #13 to #22 (sync S-031)

A tracking entry for everything done on 18 November (syncs S-021 to S-030), at the user's request: what is
where, what is verified, and what waits for whom. Nothing below is merged: `main` is still `96c36b9`
(DJAFAT 0.21.3).

### In one paragraph

Ten pull requests, twenty commits (one version commit and one audit-marker commit each), versions 0.21.4
to 0.23.1. They carry fixes for eleven findings (`TEST-04`, `DOC-03`, `TEST-05`, `ADM-01`, `ADM-02`,
`ORD-01`, `PAY-04`, `ORD-02`, `FE-02`, `ADM-03`, and the `FE-06` favicon follow-up), part of `OPS-02`, and
one new finding, `OPS-06`. Their CI (Linux and Windows) is green for #13 to #21; #22 was still running
when this was written. A passing `pnpm verify:fast` is recorded in the commit message of #14, #15 and #17
to #21, and was run before the #22 commit (all pass); the messages of #13 and #16 do not record one. The
API changes also passed the full integration suite on a fresh database (112/112 at the top of the stack).

### The stack

| PR  | Branch                    | Version | Findings                        | What it does                                                                                                          | Verified                                                                 | CI                                   |
| --- | ------------------------- | ------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------ |
| #13 | `docs/audit-s021`         | 0.21.4  | (audit)                         | The 21 open Critical/High findings re-checked against `main`                                                          | CODE/LIVE re-check, recorded per finding                                 | green                                |
| #14 | `fix/test-loopback`       | 0.21.5  | `TEST-04`                       | Integration tests listen on 127.0.0.1 (cause: port collision with Prisma's query engine on macOS)                     | Full suite 5 runs out of 5 green (3 of 12 failed before)                 | green                                |
| #15 | `fix/env-init`            | 0.21.6  | `DOC-03`                        | `pnpm env:init`: real random secrets in the local `.env`                                                              | 5 unit tests; a Windows CI step                                          | green                                |
| #16 | `fix/favicon-512`         | 0.21.7  | `FE-06` (follow-up)             | Favicon 512 px, 44 KB instead of 521 KB                                                                               | Image checked by eye; builds                                             | green                                |
| #17 | `fix/mobile-typed-routes` | 0.21.8  | `TEST-05`                       | Typed navigation in the mobile app; no known failure left                                                             | Type check with and without generated routes; `expo export` of both apps | green                                |
| #18 | `fix/admin-roles`         | 0.21.9  | `ADM-01`, `ADM-02` (part)       | Finance can enrol MFA; no status change on oneself or a superior; sessions revoked; refresh refuses inactive accounts | Integration 103/103 (6 new)                                              | green                                |
| #19 | `fix/order-cancel-refund` | 0.22.0  | `ORD-01`, `PAY-04`, `ORD-02`    | Customer and staff cancel; automatic refund and accrual reversal; hand-refund queue; confirmation timeout job         | Integration 111/111 (8 new); the worker job run against PostgreSQL       | green                                |
| #20 | `fix/token-refresh`       | 0.22.1  | `FE-02`                         | Session renewal in the SDK and the five apps; sockets renew and reconnect                                             | 9 SDK tests; live check against the API with 4-second tokens, 10/10      | green                                |
| #21 | `fix/admin-console-mfa`   | 0.23.0  | `ADM-03`, `ADM-02` (step-up)    | Console MFA page and code prompt; refunds page; order cancel button; finance access                                   | Integration 112/112; rendered in Chromium against the test API           | green                                |
| #22 | `fix/ops-monitoring`      | 0.23.1  | `OPS-02` (part), `OPS-06` (new) | Health check with phone alerts; weekly restore check; Oracle trial-end plan; external accounts checklist              | Restore drill on a real dump; scripts tested locally                     | running (3 of 5 passed when written) |

**Merge order: #13, then #14, and so on up to #22.** Each branch contains the ones before it, so merging out
of order brings unreviewed commits along. #17 touches the owner's area (the mobile app) and waits for their
review; everything after it waits too. If that review takes long, #18 to #22 can be re-stacked on #16.

### Waiting for a decision

| Decision                                                                                  | Who         | When                                                                    | Where        |
| ----------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------- | ------------ |
| The refund split: before cooking, full refund and accrual reversed; after, DJAFAT absorbs | DJAFAT      | Before merging #19                                                      | `docs/37` §2 |
| The confirmation timeout: 15 minutes by default (a setting, changeable without a deploy)  | DJAFAT      | Before merging #19                                                      | `docs/37` §3 |
| The Oracle trial: upgrade to Pay As You Go, or move the demo (`OPS-06`)                   | DJAFAT      | Before the trial ends (console date; around 16 Dec if opened on 16 Nov) | `docs/38` §3 |
| Open the SMS and Airtel/Moov merchant accounts (`AUTH-01`, `PAY-07`)                      | DJAFAT      | Before the pilot                                                        | `docs/39`    |
| Merge #13 to #22, in order                                                                | User, owner | When each one's checks are green                                        | GitHub       |

### Not verified yet

- Anything on the live server (no access from these sessions): its real shape and trial date, the
  monitoring and restore-check cron jobs, an off-server backup copy.
- The customer cancel button in a browser or on a phone; the session-renewal React hooks themselves (the
  live check reproduced their logic in Node); a finance account in the console; a real merchant-wallet
  refund; the worker, Redis stream and API chain in one run.

### What went wrong along the way (all caught before pushing)

- Twice a version commit was refused (subject over 100 characters) and the next command put everything into
  the audit-marker commit instead. Both were undone locally and redone; nothing wrong reached GitHub.
- A new unit test hard-coded the PSP fee (83) where the code rounds 1.5 % of 5500 to 82: the test now reads
  the fee from the accrual. A new integration test found a real bug: the open-refunds list showed no order
  code (`getPaymentContext` only answers for an order awaiting payment); fixed before the commit.
- A restore-check run reported exit 0 for a corrupt dump only because the test piped it through `tail`;
  re-run without the pipe: exit 1.
- The Docker daemon stopped twice during the day and was restarted; the test database containers were
  stopped again at the end, as the user had asked.

### Counts

60 open findings (3 Critical, 19 High, 24 Medium, 14 Low) and 10 resolved on `main`. A fix present on a
branch does not change a finding's count until its pull request is merged.

**Documents changed:** `history/CHANGELOG.md` (this entry), `UNMERGED_BRANCHES.md` (§2d),
`PROJECT_STATUS.md`, `history/SYNC_LOG.md`, `history/LAST_REVIEWED_COMMIT`; outside `docs_2/`:
`docs/ROADMAP.md`.

---

## 2026-11-18 — Sync S-030: monitoring, a tested restore, and the end of the Oracle trial

**Verified:** a restore drill on a real dump of the test database: the deploy guide's `pg_restore
--clean` and a restore into an empty database both reproduced every table's row count, a balanced
ledger, 39 migrations and a working PostGIS; Prisma reported the schema up to date. `restore-check.sh`
passed a good dump and failed a truncated one and a missing one (exit 1), dropping its scratch
database each time. `healthcheck.sh` alerted only on state changes against a fake ntfy receiver.

**Learned:** Oracle's current Always Free allowance for Ampere A1 is 2 OCPUs and 12 GB, half of what
the deploy guide said; and per the roadmap the demo runs on an x86 instance of the free trial, which
Oracle reclaims when the trial ends unless the account is upgraded (new `OPS-06`).

**Status changes:** `OPS-02` scripts on `fix/ops-monitoring` (0.23.1); new `OPS-06` (High). Counts: 60
open (19 High).

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `history/SYNC_LOG.md`,
`history/LAST_REVIEWED_COMMIT`; outside `docs_2/`: `docs/38` and `docs/39` (new), `infra/deploy/README.md`,
`docs/ROADMAP.md`.

---

## 2026-11-18 — Sync S-029: the admin console can pass a step-up

**Verified:** `pnpm verify:fast` all pass; API integration suite 112/112; 6 unit tests of the console's
step-up flow; the console built and rendered in Chromium against the test API (enrolment with a real TOTP
code, the code prompt on an order cancellation, the order cancelled in the database, the refunds page).

**Learned:** the console admitted only admin, super_admin and support, so `finance` could not use it even
with `ADM-01` fixed; it now reaches the Finance, Remboursements and Sécurité pages.

**Status changes:** `ADM-03` fix present on `fix/admin-console-mfa` (0.23.0); `ADM-02` complete across two
branches. T-214, T-303 in progress.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `history/SYNC_LOG.md`,
`history/LAST_REVIEWED_COMMIT`; outside `docs_2/`: `docs/37`, `docs/07`, `docs/ROADMAP.md`.

---

## 2026-11-18 — Sync S-028: sessions no longer end after 15 minutes

**Verified:** `pnpm verify:fast` all pass; 9 new SDK unit tests (single renewal for concurrent 401s, refused
renewal clears, network error keeps, no loop, cross-tab lock, another tab's token reused). Live: the built
API with 4-second access tokens, driven by the built SDK and a real socket.io client — all 10 checks passed.

**Learned:** the realtime gateway closes a socket whose token expired (sweep every 30 s), and socket.io never
reconnects after a server-side close, so a board went silent after 15 minutes even with a refresh. With
rotation and reuse detection, two tabs sharing `localStorage` must not renew at the same time: the API's
5-second grace absorbs a simultaneous double, not a late stale write.

**Status changes:** `FE-02` fix present on `fix/token-refresh` (0.22.1). T-207 in progress.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `history/SYNC_LOG.md`,
`history/LAST_REVIEWED_COMMIT`; outside `docs_2/`: `docs/ROADMAP.md`.

---

## 2026-11-18 — Sync S-027: cancelling an order, and the money that follows

**Verified:** `pnpm verify:fast` all pass; API integration suite 111/111 on a fresh database (8 new
scenarios in `order-cancellation.int.spec.ts`); the built worker job run against the test database.

**Learned:** the API design already specified both cancel routes and "refund auto si payé" (`docs/07`);
only the ledger split was undecided. A rejected order emits `order.cancelled` (there is no
`order.rejected` event), and the customer is already notified on it. `getPaymentContext` answers only
for an order awaiting payment (caught by the new test of the refund list).

**Status changes:** `ORD-01`, `PAY-04`, `ORD-02` fixes present on `fix/order-cancel-refund` (0.22.0).
T-204, T-205, T-206 in progress.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `history/SYNC_LOG.md`,
`history/LAST_REVIEWED_COMMIT`; outside `docs_2/`: `docs/37` (new), `docs/07`, `docs/36`, `docs/ROADMAP.md`.

---

## 2026-11-18 — Sync S-026: finance can unlock its step-up; staff cannot act on their superiors

**Verified:** `pnpm verify:fast` all pass; the API integration suite 103/103 on a fresh database (6 new
scenarios). A new unit test fails on the old `auth.controller.ts` ("PaymentsController.refund: finance
cannot enrol MFA") and passes after the fix.

**Learned:** `/auth/refresh` did not check the account status: a blocked user's refresh token kept
producing access tokens (each refused at use, but the session survived a reactivation). Fixed with
`ADM-02`.

**Status changes:** `ADM-01` fix present on `fix/admin-roles` (0.21.9); `ADM-02` partly (step-up still
missing, needs `ADM-03`). T-213 and T-303 in progress.

**Documents changed:** `FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `history/SYNC_LOG.md`,
`history/LAST_REVIEWED_COMMIT`.

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
