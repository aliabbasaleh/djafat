# Sync log

One entry per review of new commits against this documentation, newest first. The procedure is in
[`../README.md`](../README.md) §3; the commits each entry brought the documentation up to are in
[`LAST_REVIEWED_COMMIT`](LAST_REVIEWED_COMMIT). Documents changed by a sync carry a dated note
`(updated YYYY-MM-DD, sync S-nnn)` next to the statement that changed.

"Reviewed" is not "verified": every status below states its evidence level (vocabulary in
[`../README.md`](../README.md) §1).

---

## S-056 — 2026-11-28 — repository private again: PR #29 left open; `claude/compassionate-franklin-k23vcj` deleted

**Observed:** the repository is private again (`gh api repos/aliabbasaleh/djafat` gives `visibility=private`; it was
public on 2026-11-27), and GitHub refuses every job again (« recent account payments have failed or your spending
limit needs to be increased »): PR #29's second run (`3e8d441`, 2026-11-28 04:01 UTC) failed in 1-2 s without
starting. **Decided by the user:** #29 stays open until its checks can run (repository public again or billing
fixed) and merges once Linux and Windows are green; `claude/compassionate-franklin-k23vcj` is deleted (0 commits ahead
of `main`, merged with PR #1 on 2026-11-13); the owner's `fix/payment-reliability-backlog` stays for them to decide
([`../UNMERGED_BRANCHES.md`](../UNMERGED_BRANCHES.md) §2). **Removed:** that branch and its marker line. **Added /
Fixed / New findings:** none. The roadmap item on GitHub's checks, ticked in #29, is true again by the time #29 can
merge, since its merge needs the checks to run.

---

## S-055 — 2026-11-27/28 — the sign-up stack merged into `main` (PR #34); PR #29 brought up to date as 0.28.4

**Trigger:** the user said the repository is now public, so GitHub's checks run again, and asked to merge all the
branches. **PR #34** (`feat/connexion-integration` → `main`, opened by us on the teammate's branch with S-053, S-054
and 0.28.3 on top): five checks green (Linux lint, typecheck, test and build; integration on PostgreSQL + Redis;
local setup on Windows; gitleaks; pnpm audit); merged with a merge commit, `e93536b`. `main` is DJAFAT 0.28.3 and
holds FEAT-021, FEAT-022 parts 1 to 4 and FEAT-024; its own push runs (CI, Security) are green on `e93536b`.
**Pull requests:** GitHub marked #28 merged (its head is in `main`); #31, #32 and #33 are closed with a pointer to #34
(GitHub refuses to retarget a branch that has no new commits; #31 closed itself when its base branch was deleted);
the branches `feat/connexion-integration`, `feat/equipe-connexion-email`, `feat/inscription-par-type`,
`feat/inscription-ecrans` and `feat/inscription-restaurants` are deleted. **PR #29** (`ci/cheaper-runs`): `main`
merged in (`e245d2c`), version 0.28.4 (renumbered from 0.24.6), its S-042 records slotted under S-043, and the
roadmap item on GitHub's checks ticked. **Verified (RUN), before the merge, at `b12a118`:** `verify --full` on a
separate database (`djafat_auth1127`, Redis index 11, mock e-mail and SMS) — every check passes, the whole
integration suite included (87 s), except `build`, which failed only because `NODE_ENV=development` was exported
from `.env` (new [`TEST-07`](../FINDINGS.md#test-07)); rebuilt with `NODE_ENV=production`: 9/9. Then the sign-up and
sign-in of the four account types in headless Chrome against production builds: 31 checks of 31
([`../TESTING_AND_QUALITY_ASSURANCE.md`](../TESTING_AND_QUALITY_ASSURANCE.md) §5). The batched pre-commit hook ran on
a real 379-file merge (9 ESLint and 8 Prettier batches, 32 s, nothing changed), once the worktree had its packages
built and its dependencies installed. **Fixed:** [`CI-03`](../FINDINGS.md#ci-03), resolved on `main` since PR #1
(root `eslint` 9.17.0) and now verified by that commit, which needed no extra `PATH`; T-407 done. **New findings:**
`TEST-07`. **Not verified:** the customer mobile app on a phone (it has no web build); real e-mail delivery; the
deployment of 0.28.x to the server (not done yet). **CI on PR #29 (2026-11-28 note):** the first run failed only on the
known flake [`TEST-06`](../FINDINGS.md#test-06), with the same code and hash as when it was found; new task T-618;
the run is repeated, the test untouched.

---

## S-054 — 2026-11-27 — the teammate's integration branch checked out; three roadmap lines restored, version 0.28.3

**Trigger:** the user asked to commit and sync the teammate's work. **Range:** `origin/feat/connexion-integration`
unchanged at `c12e590` (kcerha, reviewed in S-053); `origin/fix/login-method-icons` gone from GitHub. The main
checkout now sits on a local `feat/connexion-integration` that tracks it. **Correction to S-053:** comparing
`c12e590` with Git's own merge of the same parents (`git merge-tree --write-tree c6e5ac1 dab6e0f`) shows that
resolving the `docs/ROADMAP.md` conflict also put back the pre-0.24.5 text of three lines that had merged cleanly
from `main`: « E-mail réel » and « Gmail officiel de DJAFAT » un-ticked, and the MinIO line without its 23 Nov
re-test of both registries. Every other file of the merge is Git's merge result exactly, apart from the batching
described in S-053, and the version is the stack's 0.28.2. **Our own commits** (local, not pushed): `e9a2c76`, the
S-053 record cherry-picked from the local `feat/whatsapp-gratuit`, where it was first committed (`f5417d5`); and
`a4cfd23`, version 0.28.3, which restores the three lines from `main` word for word and adds the 0.28.3 journal line.
**Removed:** `fix/login-method-icons` — PR #26 was closed unmerged on 2026-11-23 by the owner as superseded (its SVG
icons are in FEAT-020's `apps/web/src/components/account/ChannelIcons.tsx`); its marker line is dropped. **Added /
Fixed / New findings:** none. **Checked (RUN):** the batched pre-commit config on a real commit (`a4cfd23`, macOS):
lint-staged read `lint-staged.config.cjs` and ran one Prettier call on the two quoted paths; `verify:fast` at
`a4cfd23`: specs, hygiene, arch pass, the other four skipped (nothing uncommitted). **Not verified:** the ESLint
batches in a real commit (no TypeScript file staged); Windows.

---

## S-053 — 2026-11-26 — teammate merge of the PR #33 stack into `main` (`feat/connexion-integration`)

**New branch** `origin/feat/connexion-integration` by **kcerha**, one commit `c12e590` (2026-11-25): a merge
of `origin/feat/inscription-restaurants` (`dab6e0f`, the PR #33 stack, reviewed in S-045 to S-052) into
`main` (`c6e5ac1`, reviewed). No pull request yet. Against its two parents the merge brings four files.
**Added:** `lint-staged.config.cjs` — the pre-commit commands leave `package.json` for a config that runs
them in batches (Prettier 40 files, ESLint 25 per call), same commands and flags; written because a
375-file merge made the type-aware ESLint run out of memory and passed the Windows command-line limit.
**Changed:** `scripts/pipeline/hooks/stop.mjs` checks Prettier in batches of 40 (same flags and timeout per
batch, stops at the first failing batch); `docs/ROADMAP.md` conflict resolved — the stack's 0.25.0 to
0.28.2 rows with `main`'s 0.24.5 and 0.24.4 rows and their commits (`93252b8`, `631b433`), `main`'s
wording of the « Comptes clients » row, the stack's FEAT-021 row. **Removed:** the `lint-staged` block of
the root `package.json` (moved). **Fixed / New findings:** none (`CI-03` untouched by this commit).
**Checked (RUN):** the config's functions, called on 60 paths, give 2 Prettier and 3 ESLint commands with
quoted paths; one file gives the same two commands as before. **Not verified:** a real commit through the
batched hook; Windows.

---

## S-052 — 2026-11-25 — favicons from the new icon, FEAT-022 decisions confirmed, version 0.28.2

**Our own commit** `0a78bdc` on `feat/inscription-restaurants` (PR #33). **Changed:** the favicons of the site,
the admin console and the restaurant console (`apps/*/src/app/icon.png`) now come from the new DJAFAT icon
(orange « D » on white, 512 px, 9 KB); the user confirmed FEAT-022-Q18 to Q22 and Q25, recorded as decided
(`clarifications.md`, SPEC-022-05 v5). **Checked:** the three running sites serve the new file
(`/icon.png`, 9018 bytes); `verify:fast` clean. **Added / Removed / Fixed / New findings:** none.
**Not verified:** how browsers render the new favicon at 16–32 px (not looked at).

---

## S-051 — 2026-11-25 — new brand images (logo, icon), version 0.28.1

**Our own commit** `50a8469` on `feat/inscription-restaurants` (PR #33), the user's image changes in `djafat/`
committed at their request: `logo.png` replaced (2023×777), `icon.png` added (1254×1254), the four old « D »
icons and the five posters removed. **Checked:** no code or document uses the removed files (`git grep`); the
apps' favicons (`apps/*/src/app/icon.png`) are separate and unchanged; `check:hygiene` clean. **Added / Removed:**
the images above. **Fixed / Changed:** none. **New findings:** none. **Not verified:** nothing to run — images
only. The main checkout now sits on `feat/inscription-restaurants` (the top of the PR stack).

---

## S-050 — 2026-11-25 — FEAT-022 part 3 (restaurants: four steps, decisions, changes after approval), version 0.28.0

**Our own commits** `72d155d` to `4bebbc5` on `feat/inscription-restaurants` (above PR #32), described in
`docs/features/FEAT-022-inscription-par-type-de-compte` (`review.md`, `progress.md`, `verification.md`,
`pr.md`). **Added:** the restaurant console guides a signed-up restaurant in four steps (map point stored in
PostGIS, hours and menu, logo and cover uploaded from the device, RCCM or NIF and ID photos, Mobile Money),
then « Envoyer pour validation »; steps locked during the review except the menu; « Demandes à vérifier »
opens and decides restaurants (approval re-checks the four steps); after an approval a new Mobile Money
number or paper waits in `application_changes`, accepted with the step-up code; staff payouts read the
approved number through a new port (`COURIER_PAYOUT_ACCOUNT_PORT`, no new module edge); « Mes gains » and
« Mes papiers » in the courier app; admin « Quartiers » page; new dependency `leaflet` 1.9.4 in
`apps/restaurant` (the customer site's version); no migration. **Fixed before any push (independent review,
round 1):** two new findings — `SEC-09` (an owner could get another restaurant's public photo deleted) and
`SEC-10` (a restaurant's staff member who registered a restaurant could reach the first one's papers) — plus
dishes counted that customers never see, and « Papiers » withdrawing the other field's waiting change;
round 2 (5 minor): the status frozen during the review, one restaurant per account also through
`POST /restaurants` and admin role grants (`grantRole` now refuses a restaurant role at a second
restaurant — a change to Bloc 9 role management); round 3: ready for PR, one note fixed (`70733f3`).
**Verified:** `verify --full` at `70733f3` (see
`verification.md`), 33 integration tests of the feature on a fresh database (plus the catalog and admin-role
suites, 88 in all), a browser run (28 checks). **Not verified:** the map's tiles (no network access in the
test browser), real e-mail delivery. `STOR-01`: restaurant photos now uploaded on the branch.
**Merge condition:** after PR #32, together with it.

---

## S-049 — 2026-11-24 — FEAT-024 (checked inputs) and FEAT-022 part 4 (sign-up screens), version 0.27.0

**Our own commits** `be136f8` to `5a3cf4a` on `feat/inscription-ecrans` (above PR #31), described in
`docs/features/FEAT-024-saisies-verifiees` and `docs/features/FEAT-022-inscription-par-type-de-compte`
(`review.md`, `progress.md`, `verification.md`, `pr.md`). **Added:** SMS login codes go only to a Chad
mobile (a foreign number is offered WhatsApp when in service, or the e-mail; a fixed line 22… is
refused), checked at the single SMS sending point; foreign numbers stay accepted for accounts; the number
of an account cannot be a fixed line; Mobile Money is a Chad mobile; person names are letters only;
« Vouliez-vous dire … ? » for a mistyped e-mail provider; « +235 » in front of every phone field (five
apps). Sign-up by account type on the site and in the customer app (customer, courier, restaurant),
welcome e-mail, footer links, « Pas encore de compte ? » on the team logins, a provisional terms page,
« Devenir livreur » / « Inscrire mon restaurant » in « Mon profil » (`POST /me/roles/*`). **Fixed:** a
malformed phone with a valid password crashed the registration schema (500 instead of 422, new finding
AUTH-03, fixed on the branch); an admin can no longer decide their own courier application (403).
**Verified:** `verify --full` at `83c65db` (no new failure, E2E unavailable), 25 integration tests of the
features on a fresh database, a browser run (30 checks). Independent review in three rounds, ready for
PR. **Not verified:** the customer app's new screens (no web build of `apps/mobile`); real e-mail
delivery. **Merge condition:** together with FEAT-022 part 3 only (user's decision).

---

## S-048 — 2026-11-24 — FEAT-022 parts 1-2 reviewed, corrected, version 0.26.0; PR #29 becomes 0.24.6

**Our own commits** `ad01d05` to the reports commit on `wip/feat-022-part1` (pushed as
`feat/inscription-par-type`), described in `docs/features/FEAT-022-inscription-par-type-de-compte`
(`review.md`, `progress.md`, `verification.md`). Independent review in two rounds. **Fixed:** a signed-up
restaurant's owner could publish it without DJAFAT (blocking; now 409 `RESTAURANT_NOT_APPROVED`); photo
uploads read a body only on their routes and for a valid access token; a full disk answers 507
`STORAGE_FULL` without a leftover file; JPEGs lose what phones append after the image and keep only their
orientation; same-name restaurant sign-ups no longer collide (rare residue noted); private photo links stay
out of the logs; a switch to a bicycle asks before deleting vehicle photos. **Changed:** the nightly backup
writes the photos archive under a temporary name and reports a missing volume; `restore-check.sh` requires
every photo the restored database refers to (OPS-02 note). **Verified:** `verify --full` on the final code
commit (see `verification.md`), 16 integration tests of the feature on a fresh database, a browser run (23
checks, 15 screenshots). **Not verified:** a real phone (camera, gallery); `restore-check.sh` on the server.
The first full run at `230d5eb` hit a pre-existing flaky assertion outside the feature (new finding TEST-06);
the repeated run is the one reported.

**Our merge** `262b8cf` on `ci/cheaper-runs` (PR #29): `main` merged in, version 0.24.6 (0.24.5 was taken
by PR #30); documentation and version only. GitHub still refuses to start any job (billing).

---

## S-047 — 2026-11-23 — `main` 0.24.5 (FEAT-020 live, MinIO re-checked); FEAT-022 part 2 (local branch)

**`main`, a teammate's commit** `93252b8` (kcerha), merged as PR #30 (`c6e5ac1`, by the repository owner),
documentation only (`docs/ROADMAP.md`, `package.json`). **Changed:** version 0.24.5; the roadmap says FEAT-020
runs on djafat.com with DJAFAT's real Gmail (`EMAIL_PROVIDER=smtp`, a real code received), and the MinIO image is
still refused on quay.io and Docker Hub (re-tested 2026-11-23). Evidence: CLAIM for both; for the e-mail, our own
registration request to `api.djafat.com` was accepted earlier the same day (LIVE) and the user confirmed the
mailbox receives it — the receipt itself was not seen by us. Statuses: T-611 done in production (above
evidence); OPS-01 note added. **Consequence:** PR #29 (`ci/cheaper-runs`) also carries 0.24.5 and must take
0.24.6 before its merge; PR #28 and the FEAT-022 branch need `main` merged in (roadmap journal, version line).

**Our own commits** `9b246ba` to `08c1ae3` on `wip/feat-022-part1` (not pushed), described in
`docs/features/FEAT-022-inscription-par-type-de-compte/progress.md` (part 2). **Added:** the courier's
application (`/couriers/me/application`: form, photos sent as the request body, submit with the missing items),
the admin queue « Demandes à vérifier » (both tabs, courier detail, approve or refuse with a reason, decision
e-mails, 5-minute photo links for admins only), the courier app's « Avant votre première course », the console
pages. **Fixed on the way:** `AllExceptionsFilter` dropped an `HttpException`'s `details`; Helmet's same-origin
resource policy hid API images from the consoles; console sub-pages sent full admins to the first entry (since
0.23.0); the courier app's `BigButton` never said « disabled » in a browser. STOR-01 partly addressed (private
photos; logos in part 3; product photos not planned). **Verified:** unit tests, 15 integration tests of
`account-onboarding.int.spec.ts` on a fresh database, a browser run (18 checks). **Not verified:** the full
`verify` (running), a real phone (camera, gallery), the independent review (running).

---

## S-046 — 2026-11-23 — FEAT-022 part 1: neighbourhoods, photos on disk, typed sign-up (local branch)

Our own commits `dd1187c` to `5d68967` on `wip/feat-022-part1` (not pushed). **Added:** migration 0041
(neighbourhoods, courier and restaurant applications, changes awaiting an admin — additive; existing couriers and
restaurants get an approved application); `packages/core` onboarding rules (vehicles, 18-year minimum, checklists,
place-name key); `GET /geo/neighbourhoods`, `/admin/neighbourhoods`; `FilesystemObjectStorage` behind
`ObjectStoragePort`, `GET /files/:key` (private files only through a 5-minute HMAC link), an `uploads` volume in
production, archived nightly; `POST /auth/register` typed (courier, restaurant) creating the courier or restaurant in
the account's transaction through `common/ports`. **Changed:** a courier whose application is not approved cannot go
online (409 `COURIER_NOT_APPROVED`); team-created couriers are unaffected. **Verified:** `verify:fast` all pass;
integration on a fresh database 129/129 (7 new). **Not verified:** a real upload over HTTP (the upload routes come in
part 2), the backup of the volume on the server. No new finding.

---

## S-045 — 2026-11-23 — FEAT-022 specs adjusted (docs only)

Short entry (our own docs commits `8484208`, the next one): SPEC-022-01 v2 — the restaurant console and the courier app
login screens open the matching sign-up form (the user: one scenario everywhere); SPEC-022-04 v2 — photo metadata
stripped without re-encoding; SPEC-022-02 and 08 v2 — a taken phone number is said openly, as FEAT-020 does. No code,
no new finding.

---

## S-044 — 2026-11-23 — FEAT-022 specs on `feat/inscription-par-type`; two branches followed

Short entry (our own docs commits): `8a37b2e` (intake of FEAT-022: every criterion mapped to the code; nothing stores
files yet — `ObjectStoragePort`'s adapter is a placeholder) and `b792d43` (nine specs, the user's decisions Q01 to Q06,
the brief in four slices). No code. Branches now followed: `origin/feat/equipe-connexion-email` (`1ce673a`, PR #28,
reviewed in S-043) and `origin/ci/cheaper-runs` (`d5c6500`, PR #29, reviewed in S-042 on that branch). No new
finding.

---

## S-043 — 2026-11-23 — FEAT-020 on `main`; FEAT-021 team login, reviewed twice (0.25.0)

Our own commits on `feat/equipe-connexion-email`, rebased onto `main` `038c723` (PR #27, FEAT-020). The rebase gave
new hashes to commits already read: `d63658f` is the docs commit of S-038, `049a695` its sync; S-042 lives on the
parallel branch `ci/cheaper-runs`. Read: `1f87e5c` and `7cf482a` (team login by e-mail and password in the admin
console, the restaurant console and the courier app, through `packages/sdk/src/team-login.ts`; production may start
with `SMS_PROVIDER=disabled` when `EMAIL_PROVIDER=smtp`; the SMS cut-over procedure), `6ca5b97` (the consoles'
side margin at 390 px, a defect already on `main`), `d830024` and `3e3bc0d` (two independent reviews corrected:
one role check for every way in, phone-code SDK methods, the pre-cut check FEAT-021-Q11), `ae07a59` and `2bf457c`
(screenshots), `6ffb0d4` (0.25.0), and the PR content. Verified: `verify --full` on a fresh database, no new failure
(e2e unavailable); the pre-cut query run read-only on the local database lists 13 seeded team accounts and none of
the 5 with an e-mail and a password. No new finding; `AUTH-01` unchanged (no real SMS sender), but login no longer
depends on it once SMS is switched off.

---

## S-042 — 2026-11-23 — PR #27 merged into `main`; cheaper CI on `ci/cheaper-runs` (0.24.5)

Our own commits. `origin/main` moved to `038c723`, the merge of PR #27 (FEAT-020, 0.24.4), merged without GitHub's
checks (S-041); the remote branch `feat/compte-email-password` is deleted. On the new branch `ci/cheaper-runs`:
`3f5d5ad` adds a `scope` job to the CI and Windows workflows (`scripts/pipeline/ci-scope.mjs`, 7 tests) — nothing
heavy on a draft pull request, only the format and spec checks when the whole pull request is documentation — and
Security now cancels a pull-request run replaced by a newer push. Verified locally: `pnpm check:pipeline` 78/78,
`verify:fast` all pass, the three workflows parse with the intended jobs. Not verified: a real GitHub run (no job
starts until the owner fixes billing). No new finding.

---

## S-041 — 2026-11-23 — PR #27 merged without GitHub's checks (0.24.4)

Short entry (our own docs commit `631b433`): version 0.24.4 records in `docs/ROADMAP.md` that PR #27 (FEAT-020) is
merged at the user's request although GitHub started none of its jobs — the owner account's Actions minutes are used
up. Evidence kept: the local full verify on `4a785d0`, hosted Linux, integration, audit and gitleaks green on
`379db20`, and the four test files changed since then re-run locally. Not verified: the Windows job, and CI on
`main`. No new code finding; `PROJECT_STATUS.md` and the backlog say CI must run again on `main`.

---

## S-040 — 2026-11-23 — FEAT-020: Windows CI timeouts (0.24.3)

Short entry (our own commit): on PR #27 the Windows runner timed out two tests that hash real passwords
(5 s limit); the four such test files get 30 s, no assertion changed. Linux, integration, audit and secret
scanning had passed. No new finding.

---

## S-039 — 2026-11-22 — FEAT-020: independent review, corrections, ready for PR

(S-038 belongs to the branch `feat/equipe-connexion-email`, not merged yet.)

|                 |                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| **Trigger**     | The user chose « Ship it now »: independent review, then pull request                                         |
| **Range**       | `origin/main` unchanged (`96a88d3`, fetched); our branch `feat/compte-email-password`, `44d0fa4` to `610ca13` |
| **Size**        | 3 commits: auth, web, admin (phone orders), core (trust rule), types, SDK, docs                               |
| **Evidence**    | RUN — `verify --full` on `4a785d0`: no new failure, e2e unavailable; review 3 « prêt pour PR »                |
| **Reviewed by** | Claude, in the session that wrote FEAT-020; three rounds of the `spec-reviewer` sub-agent                     |

### Fixed (on the branch, before any merge)

- An open redirect after login (a tab, a newline or `/..//` in `?redirect=`), measured by the reviewer.
- A phone order confirmed a number only typed at an e-mail sign-up and filed the caller's order in that
  account; it is now refused, 409 `PHONE_NOT_CONFIRMED` (user's decision FEAT-020-Q27).
- Registration, « Mot de passe oublié ? » and e-mail code login told whether an address had an account
  (lock, budget, delivery error, timing); they now behave the same for any address.
- Changing the e-mail of an account with a password asked nothing: it now asks the current password,
  alerts the old address and forgets remembered devices; its codes are bound to the account (Q28).

### Changed

- Cash on delivery: a verified e-mail counts like a confirmed number for trust level T1 (Q26).

### Not verified

- The production server (no access from here); the « Mon profil » screen was checked by screenshot only.

---

## S-038 — 2026-11-22 — three features confirmed by the user (FEAT-021 to FEAT-023)

Short entry (our own docs commit on `feat/equipe-connexion-email`): the user's requests of 2026-11-22, transcribed and
confirmed — team login by e-mail and password with SMS off (T-614), sign-up by account type with validation (T-615),
free WhatsApp login (T-616). No code yet; no new finding.

---

## S-037 — 2026-11-22 — our docs commit on the FEAT-020 branch (0.24.2)

Short entry (our own commit `d6481b8`, already described): the user received the registration code in DJAFAT's
Gmail inbox (Inbox, not spam), so SPEC-020-01-SC06 is proven locally (MANUAL, screenshot shown in the session, not
versioned); a bare `EMAIL_FROM` replaces the « DJAFAT » sender name, so `.env.example` and the local guide now say to
leave it empty. No new finding; no change on GitHub besides our branch.

---

## S-036 — 2026-11-22 — our docs fix on the FEAT-020 branch (0.24.1)

Short entry (our own commit, already described): the app password must be pasted without spaces or quoted;
first real Gmail send accepted (RUN). No new finding; no change on GitHub besides our branch.

---

## S-035 — 2026-11-21/22 — the collaborator's `fix/login-method-icons`; our FEAT-020 branch

|                 |                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**     | The user asked to pull the collaborator's work, then to build customer accounts (FEAT-020)                                              |
| **Range**       | `origin/main` unchanged since S-034 (`96a88d3`); new `origin/fix/login-method-icons` `628dce4`; our branch `feat/compte-email-password` |
| **Size**        | 0 new commits on GitHub; our change: auth, users, migration 0040, SDK, web, mobile, docs                                                |
| **Evidence**    | RUN — `git fetch -v` up to date; FEAT-020 checks in its `progress.md`; API-02 LIVE preflight                                            |
| **Reviewed by** | Claude, in the session that wrote FEAT-020                                                                                              |

### Added

- `origin/fix/login-method-icons` (kcerha, 2026-11-21, version 0.23.6, not merged, no pull request seen):
  `628dce4` replaces the emoji of the login method tabs (`apps/web/src/app/connexion/page.tsx`) by three
  inline SVG icons (no dependency); roadmap line and version. Reviewed from the diff (CODE); our FEAT-020
  replaces that page by a redirect, so the icons were moved into `components/account/ChannelIcons.tsx`
  and shown in the account screens' channel buttons (RUN: browser pass of 2026-11-22). Merging both
  branches conflicts on `connexion/page.tsx`, `docs/ROADMAP.md` and `package.json` (resolution in the
  FEAT-020 `pr.md`).
- FEAT-020 on its branch (see `history/CHANGELOG.md`); tasks T-611 to T-613.

### Removed

- none

### Fixed

- On the branch: [`API-02`](../FINDINGS.md#api-02) (CORS methods).

### Changed

- The branch's version is 0.24.0; it carries migration 0040, so a server or a local copy updated to it must run its
  migrations.

### New findings

- [`API-02`](../FINDINGS.md#api-02) — Broken, High, LIVE.

---

## S-034 — 2026-11-18 — pull requests #17 to #24 merged

|                 |                                                                             |
| --------------- | --------------------------------------------------------------------------- |
| **Trigger**     | Merges at the user's request ("merge the prs"), then `git fetch`            |
| **Range**       | `origin/main` `034123a..afaa7c2` — 8 merge commits, no content of their own |
| **Size**        | the content of #17 to #24, already reviewed in syncs S-025 to S-033         |
| **Evidence**    | RUN — checks read before each merge; `git diff ac0ccca afaa7c2` empty       |
| **Reviewed by** | Claude, in the session that merged them                                     |

### Added

- none (merges)

### Removed

- The eight merged branches, on GitHub and locally.

### Fixed

- On `main`: `TEST-05`, `ADM-01`, `ADM-02`, `ORD-01`, `PAY-04`, `ORD-02`, `ADM-03`, `SEC-02`, `OPS-05`.

### Changed

- `main` moves from 0.21.7 to 0.23.4; it now carries migration 0039 (refunds), so a server or a local copy
  updated to it must run its migrations (`install.sh` and `./local.sh update` do).

### New findings

- none

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `UNMERGED_BRANCHES.md`, `tasks/BACKLOG.md`, `history/CHANGELOG.md`,
`history/LAST_REVIEWED_COMMIT` (the `HEAD` and `origin/main` lines).

### Not verified

- Nothing new was run: the merged code is the code verified on the branches (identical tree).

### Marker

`HEAD` → this sync's version commit; `origin/main` → `afaa7c2`.

---

## S-033 — 2026-11-18 — live-server bootstrap without test accounts

|                 |                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------- |
| **Trigger**     | Our own commit, at the user's request (next step agreed: SEC-02 + OPS-05)                   |
| **Range**       | `fix/live-bootstrap` (stacked on pull request #23)                                          |
| **Size**        | 1 commit: `apps/api/prisma` (split seed, guard, first-admin command), deploy compose, guide |
| **Evidence**    | RUN — fresh-database checks (37 assertions), integration suite 112/112, `verify:fast`       |
| **Reviewed by** | Claude, in the session that wrote the commit                                                |

### Added

- `prisma/reference-data.ts`, `prisma/seed-reference.ts`, `prisma/seed-guards.ts`, `prisma/create-super-admin.ts`;
  scripts `db:seed:reference`, `admin:create-super-admin`.

### Removed

- none (the reference part of `seed.ts` moved to `reference-data.ts`)

### Fixed

- `SEC-02`, `OPS-05` on the branch.

### Changed

- The deploy's `migrate` step runs the reference data in every mode; `seed.ts` refuses production without
  `SEED_DEMO=1`; the flat delivery fee setting moved from the fixtures to the reference data (same value).

### New findings

- none

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `UNMERGED_BRANCHES.md`, `tasks/BACKLOG.md`, `history/CHANGELOG.md`,
`history/LAST_REVIEWED_COMMIT`.

### Not verified

- On the live demo server (no access); a test payment on a live-style database (needs a restaurant created
  through the console first).

### Marker

`HEAD` → this sync's version commit.

---

## S-032 — 2026-11-18 — pull requests #13 to #16 merged

|                 |                                                                             |
| --------------- | --------------------------------------------------------------------------- |
| **Trigger**     | Merges at the user's request ("yeah merge them"), then `git fetch`          |
| **Range**       | `origin/main` `96c36b9..034123a` — 4 merge commits, no content of their own |
| **Size**        | the content of #13 to #16, already reviewed in syncs S-021 to S-024         |
| **Evidence**    | RUN — checks read before each merge; `git diff ed35760 034123a` empty       |
| **Reviewed by** | Claude, in the session that merged them                                     |

### Added

- none (merges)

### Removed

- The branches `docs/audit-s021`, `fix/test-loopback`, `fix/env-init`, `fix/favicon-512` on GitHub.

### Fixed

- On `main`: `TEST-04` (#14), `DOC-03` (#15); the favicon item of `FE-06` (#16).

### Changed

- `main` moves from 0.21.3 to 0.21.7.

### New findings

- none

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `UNMERGED_BRANCHES.md`, `tasks/BACKLOG.md`, `history/CHANGELOG.md`,
`history/LAST_REVIEWED_COMMIT` (both the `HEAD` and the `origin/main` lines).

### Not verified

- Nothing new was run: the merged code is the code verified on the branches (identical tree).

### Marker

`HEAD` → this sync's version commit; `origin/main` → `034123a`.

---

## S-031 — 2026-11-18 — tracking report of the day

|                 |                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------- |
| **Trigger**     | The user's request ("report on the changelog to track everything"), after a `git fetch`           |
| **Range**       | No new commit upstream: `origin/main` still `96c36b9`; our own report commit on `docs/audit-s031` |
| **Size**        | 1 commit, documentation only                                                                      |
| **Evidence**    | `git log origin/main..origin/fix/ops-monitoring` (20 commits); CI states read on GitHub           |
| **Reviewed by** | Claude, in the session that wrote the commit                                                      |

### Added

- The report entry at the top of `history/CHANGELOG.md`; `UNMERGED_BRANCHES.md` §2d (the open stack).

### Removed

- none

### Fixed

- none (no code)

### Changed

- `PROJECT_STATUS.md` points to the report and to the urgent `OPS-06`.

### New findings

- none

### Documents updated

`history/CHANGELOG.md`, `UNMERGED_BRANCHES.md`, `PROJECT_STATUS.md`, `history/LAST_REVIEWED_COMMIT`;
outside `docs_2/`: `docs/ROADMAP.md`.

### Not verified

- Nothing new was run; the report gathers what syncs S-021 to S-030 verified.

### Marker

`HEAD` → this sync's version commit.

---

## S-030 — 2026-11-18 — monitoring, tested restore, Oracle trial end, external accounts

|                 |                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------- |
| **Trigger**     | Our own commit, at the user's request ("fix those also")                                 |
| **Range**       | `fix/ops-monitoring` (stacked on pull request #21)                                       |
| **Size**        | 1 commit: `infra/deploy` (2 scripts, guide, env template), `docs/38`, `docs/39`, roadmap |
| **Evidence**    | RUN locally (restore drill, script tests); DOC (Oracle documentation, read 2026-11-18)   |
| **Reviewed by** | Claude, in the session that wrote the commit                                             |

### Added

- `infra/deploy/healthcheck.sh`, `infra/deploy/restore-check.sh`, `ALERT_NTFY_URL` in the generated
  `.env.prod`; `docs/38-exploitation-demo.md`, `docs/39-comptes-externes.md`.

### Removed

- none

### Fixed

- `OPS-02` partly (scripts present, tested locally, not installed on the server).

### Changed

- `infra/deploy/README.md`: Always Free is 2 OCPUs / 12 GB (was written 4 / 24); a monitoring section.

### New findings

- `OPS-06` (High): the demo server is paid by the trial credits and will be reclaimed at the end of the
  trial unless the account is upgraded.

### Documents updated

`FINDINGS.md` (index, counts, `OPS-02`, `OPS-06`, `AUTH-01`, `PAY-07`), `PROJECT_STATUS.md`,
`tasks/BACKLOG.md`, `history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

- Anything on the live server (no access): its real shape, the trial end date, the scripts under cron.

### Marker

`HEAD` → this sync's version commit.

---

## S-029 — 2026-11-18 — admin console: MFA, step-up prompt, refunds and order cancel

|                 |                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**     | Our own commit, at the user's request ("fix those also")                                                                           |
| **Range**       | `fix/admin-console-mfa` (stacked on pull request #20)                                                                              |
| **Size**        | 1 commit: admin console (layout, 2 new pages, orders, user page, step-up), API (MFA status, step-up on status changes), SDK, tests |
| **Evidence**    | RUN — unit tests, integration suite 112/112, console rendered in Chromium                                                          |
| **Reviewed by** | Claude, in the session that wrote the commit                                                                                       |

### Added

- `GET /v1/auth/mfa/status`; SDK `mfaStatus`/`mfaSetup`/`mfaVerify`; console pages `/admin/security`,
  `/admin/refunds`; `StepUpProvider`/`useStepUp`; order cancel button.

### Removed

- The unit test asserting `suspend`/`block`/`reactivate` are not step-up-gated (replaced, see Changed).

### Fixed

- `ADM-03` on the branch; `ADM-02` step-up part.

### Changed

- `suspend`/`block`/`reactivate` require a step-up; `finance` can log in to the console.

### New findings

- none (courier `suspend`/`reinstate` stay ungated: noted under `ADM-02`)

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `history/CHANGELOG.md`,
`history/LAST_REVIEWED_COMMIT`.

### Not verified

- A finance account in the browser; the step-up prompt on role and status changes (same code path as the
  order cancellation, rendered).

### Marker

`HEAD` → this sync's version commit.

---

## S-028 — 2026-11-18 — session renewal in the SDK and all five apps

|                 |                                                                              |
| --------------- | ---------------------------------------------------------------------------- |
| **Trigger**     | Our own commit, at the user's request ("fix those also")                     |
| **Range**       | `fix/token-refresh` (stacked on pull request #19)                            |
| **Size**        | 1 commit: SDK (`http.ts`, tests), session wiring and socket hooks in 5 apps  |
| **Evidence**    | RUN — SDK unit tests, `verify:fast`, live check against the API (4 s tokens) |
| **Reviewed by** | Claude, in the session that wrote the commit                                 |

### Added

- `ApiClientOptions.session` (`SessionRenewal`), `RenewedTokens`, `webLocksMutex`, `renewSession()` in the SDK;
  `updateTokens` / `updateStoredTokens` and renewal listeners in the apps.

### Removed

- `setApiAccessToken` in the Expo apps (replaced by `setApiSession`).

### Fixed

- `FE-02` on the branch (not yet merged).

### Changed

- Socket hooks read the token at each connection and renew after an expiry close.

### New findings

- none

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `history/CHANGELOG.md`,
`history/LAST_REVIEWED_COMMIT`.

### Not verified

- The React hooks in a browser or on a device (the live check reproduces their logic in Node); two real
  browser tabs renewing at once.

### Marker

`HEAD` → this sync's version commit.

---

## S-027 — 2026-11-18 — order cancellation, automatic refunds, confirmation timeout

|                 |                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**     | Our own commit, at the user's request ("fix those also")                                                                  |
| **Range**       | `fix/order-cancel-refund` (stacked on pull request #18)                                                                   |
| **Size**        | 1 commit: core, types, config, API (orders, payments, deliveries, ledger), worker, SDK, web, mobile, migration 0039, docs |
| **Evidence**    | RUN — unit tests, `verify:fast`, API integration suite 111/111, worker job against PostgreSQL                             |
| **Reviewed by** | Claude, in the session that wrote the commit                                                                              |

### Added

- Routes `POST /v1/orders/:id/cancel`, `POST /v1/admin/orders/:id/cancel`, `GET /v1/admin/refunds`,
  `POST /v1/admin/refunds/:id/complete`; `OrderRefundsService`; worker job `order-confirmation-timeout`;
  setting `order_confirmation_timeout_seconds` (900); migration `0039_refunds_for_ended_orders`; cancel
  buttons (web, mobile); `docs/37-annulations-remboursements.md`.

### Removed

- none

### Fixed

- `ORD-01`, `PAY-04`, `ORD-02` on the branch (not yet merged).

### Changed

- System transitions: order `placed → cancelled` (`confirmation_timeout`); delivery pre-pickup statuses →
  `cancelled` (`order_cancelled`). `refunds.requested_by` may be null (system refund).

### New findings

- none (limits listed in `docs/37` §6)

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `history/CHANGELOG.md`,
`history/LAST_REVIEWED_COMMIT`.

### Not verified

- The full chain worker → Redis stream → API in one run; the buttons in a browser or on a device; a real
  merchant-wallet refund.

### Marker

`HEAD` → this sync's version commit.

---

## S-026 — 2026-11-18 — finance can enrol MFA; staff hierarchy on account status

|                 |                                                                      |
| --------------- | -------------------------------------------------------------------- |
| **Trigger**     | Our own commit, at the user's request ("fix those also")             |
| **Range**       | `fix/admin-roles` (stacked on pull request #17)                      |
| **Size**        | 1 commit: auth, users, admin controller, types, tests, version files |
| **Evidence**    | RUN — unit tests, `verify:fast`, API integration suite 103/103       |
| **Reviewed by** | Claude, in the session that wrote the commit                         |

### Added

- `MFA_ENROLLABLE_ROLES` in `@djafat/types`; a unit test that checks every step-up route against the MFA
  routes; six integration scenarios in `admin-rbac.int.spec.ts`.

### Removed

- none

### Fixed

- `ADM-01` on the branch (not yet merged); `ADM-02` partly (hierarchy, self-protection, session
  revocation; step-up still missing).

### Changed

- `/auth/refresh` refuses a suspended, blocked or deleted account (403 `ACCOUNT_INACTIVE`) and revokes
  its sessions. Suspend and block revoke every session of the target.

### New findings

- none (the refresh gap is recorded under `ADM-02`)

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md` (T-213, T-303), `history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

- A refund of a real payment by a finance account, and a settlement; the admin console (no MFA screen
  yet, `ADM-03`).

### Marker

`HEAD` → this sync's version commit.

---

## S-025 — 2026-11-18 — the mobile type check honest again

|                 |                                                                                         |
| --------------- | --------------------------------------------------------------------------------------- |
| **Trigger**     | Our own commit, at the user's request (the owner's area: pull request for their review) |
| **Range**       | `fix/mobile-typed-routes` (stacked on pull request #16)                                 |
| **Size**        | 1 commit: 5 mobile screens, `known-failures.json`, version files                        |
| **Evidence**    | RUN — type check with and without generated routes; both Expo builds                    |
| **Reviewed by** | Claude, in the session that wrote the commit                                            |

### Added

- none

### Removed

- The three entries of `known-failures.json` (`@djafat/mobile#typecheck`, and the stale
  `@djafat/mobile#build` and `@djafat/courier#build`).

### Fixed

- `TEST-05` on the branch (not yet merged).

### Changed

- Nine navigation calls in the mobile app use typed-route objects; login follows only an in-app
  `redirect`.

### New findings

- none

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `history/CHANGELOG.md`,
`history/LAST_REVIEWED_COMMIT`.

### Not verified

- The navigation on a device.

### Marker

`HEAD` → this sync's version commit.

---

## S-024 — 2026-11-18 — lighter favicons

|                 |                                                 |
| --------------- | ----------------------------------------------- |
| **Trigger**     | Our own commit, at the user's request           |
| **Range**       | `fix/favicon-512` (stacked on pull request #15) |
| **Size**        | 1 commit: 3 images, version files               |
| **Evidence**    | RUN — image size and dimensions; looked at      |
| **Reviewed by** | Claude, in the session that wrote the commit    |

### Added

- none

### Removed

- none

### Fixed

- `FE-06`: the favicons' weight (512 px, 44 KB each).

### Changed

- `apps/{web,admin,restaurant}/src/app/icon.png`: same image, resized.

### New findings

- none

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

- The favicon in a browser tab (CI builds the apps).

### Marker

`HEAD` → this sync's version commit.

---

## S-023 — 2026-11-18 — real local secrets with `pnpm env:init`

|                 |                                                                                 |
| --------------- | ------------------------------------------------------------------------------- |
| **Trigger**     | Our own commit, at the user's request                                           |
| **Range**       | `fix/env-init` (stacked on pull request #14)                                    |
| **Size**        | 1 commit: a script, its test, the root command, the guide, the Windows workflow |
| **Evidence**    | RUN — tooling tests; production boot with a generated `.env`                    |
| **Reviewed by** | Claude, in the session that wrote the commit                                    |

### Added

- `scripts/env-init.mjs` (`pnpm env:init`) and `scripts/pipeline/test/env-init.test.mjs`.

### Removed

- none

### Fixed

- `DOC-03` on the branch (not yet merged).

### Changed

- `docs/TRAVAILLER-EN-LOCAL.md` step 2 and the Windows workflow use `pnpm env:init` instead of copying
  `.env.example`.

### New findings

- none

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `history/CHANGELOG.md`,
`history/LAST_REVIEWED_COMMIT`.

### Not verified

- A full delivery on a fresh clone; the Windows run (CI will do it).

### Marker

`HEAD` → this sync's version commit.

---

## S-022 — 2026-11-18 — the cause of `TEST-04`, and its fix

|                 |                                                              |
| --------------- | ------------------------------------------------------------ |
| **Trigger**     | Our own commit, at the user's request                        |
| **Range**       | `fix/test-loopback` (stacked on pull request #13)            |
| **Size**        | 1 commit: a test helper, 11 integration files, version files |
| **Evidence**    | RUN — reproduction script; 5 full integration runs           |
| **Reviewed by** | Claude, in the session that wrote the commit                 |

### Added

- `apps/api/test/listen-on-loopback.ts`: starts the test app on 127.0.0.1.

### Removed

- none

### Fixed

- `TEST-04` on the branch (verified locally; not yet merged).

### Changed

- All 11 integration files start their app through the helper; the two realtime files listen on
  127.0.0.1.

### New findings

- none

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `history/CHANGELOG.md`,
`history/LAST_REVIEWED_COMMIT`.

### Not verified

- 20 consecutive runs (5 done); CI on Linux was never affected.

### Marker

`HEAD` → this sync's version commit.

---

## S-021 — 2026-11-18 — the open Critical and High findings re-checked

|                 |                                                                            |
| --------------- | -------------------------------------------------------------------------- |
| **Trigger**     | The user asked for a re-check of the open findings against today's `main`  |
| **Range**       | no new commit; `main` at `8ceb437`                                         |
| **Size**        | 21 findings (3 Critical, 18 High)                                          |
| **Evidence**    | RUN where the Verify step could run here (audit, CI, demo); CODE otherwise |
| **Reviewed by** | Claude, in the audit session                                               |

### Added

- none

### Removed

- none

### Fixed

- none fully. Partly addressed since the audit: `AUTH-01` (code ready, waits for an SMS provider
  account), `MOB-01` (bundles; no device run), `PAY-06` (courier payouts), `PAY-07` (manual merchant
  wallets), `TEST-02` (SQL tested in CI), `OPS-02` (deployed with backups), `GOV-01` (only the
  owner's old branch left).

### Changed

- Statuses of the seven above; a dated re-check note on all 21.
- Unchanged after re-check: `PAY-04`, `ORD-01`, `ORD-02`, `FE-02`, `ARCH-01`, `OPS-01`, `SEC-02`,
  `ADM-01`, `ADM-02`, `ADM-03`, `DLV-01`, `COUR-01`, `OPS-05`, `DEP-01` (37 advisories, 1 critical).

### New findings

- none

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

Device steps (`MOB-01`, `COUR-01`), a real SMS handset (`AUTH-01`), a clean-machine install
(`OPS-01`), payouts and payments run end to end (`PAY-06`, `PAY-07`): code read only.

### Marker

`HEAD` → this sync's version commit.

---

## S-020 — 2026-11-18 — the owner's pull request #12: logo, favicons, `picomatch` baseline

|                 |                                                                           |
| --------------- | ------------------------------------------------------------------------- |
| **Trigger**     | The shared hook, at the user's prompt, after a fetch                      |
| **Range**       | `origin/main` `57120ed..8ceb437`                                          |
| **Size**        | 3 commits by `kcerha` and the merge of #12; 7 files                       |
| **Evidence**    | RUN — CI and Security on `8ceb437`, `pnpm audit --prod`; CODE — the diffs |
| **Reviewed by** | Claude, in the audit session                                              |

### Added

- Favicons: `apps/web`, `apps/admin`, `apps/restaurant` get `src/app/icon.png` (the 2048 px « D » icon,
  521 KB each).

### Removed

- The arrowhead at the end of the logo's curve (`djafat/logo.png`), judged too close to Amazon's
  trademarked smile-arrow. The branch `fix/logo-arrowhead-and-favicons`, deleted after its merge.

### Fixed

- `FE-06`, favicon part (CODE; not checked in a browser).

### Changed

- `DEP-01`: one more baseline entry, `GHSA-fc5q-39xc-vjpf|picomatch` (high, through Expo's CLI, no
  patched version published). Version 0.21.2 on `main`; our #11 renumbered 0.21.3.

### New findings

- none

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `UNMERGED_BRANCHES.md`, `history/CHANGELOG.md`,
`history/LAST_REVIEWED_COMMIT`.

### Not verified

The favicons and the edited logo in a browser.

### Marker

`origin/main` → `8ceb437`; `HEAD` → this sync's version commit.

---

## S-019 — 2026-11-17 — the owner's pull request #8 merged into `main`

|                 |                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------- |
| **Trigger**     | The shared hook, after a fetch                                                                 |
| **Range**       | `origin/main` `29d3d04..57120ed`                                                               |
| **Size**        | `7d2c5a2` (merge by `kcerha`, roadmap journal only) and the merge of #8 (no change of its own) |
| **Evidence**    | RUN — CI and Security on `57120ed`; CODE — combined diffs                                      |
| **Reviewed by** | Claude, in the audit session                                                                   |

### Added

- On `main`: the greeting (`<Greeting>` in `@djafat/ui`, the four apps), Windows quoting of every
  argument in `scripts/pipeline`, the roadmap updates (demo online, Tigo Cash and Moov Money in demo,
  the "100 % API" list), and `@djafat/mobile#typecheck` in `known-failures.json`. DJAFAT 0.21.0.

### Removed

- The branch `feat/welcome-greeting`, deleted after its merge.

### Fixed

- none

### Changed

- `TEST-05` applies to `main` now; evidence CODE.
- Our S-018 entry is renumbered 0.21.1 together with this one (pushed first as 0.20.17).

### New findings

- none

### Documents updated

`FINDINGS.md`, `PROJECT_STATUS.md`, `tasks/BACKLOG.md`, `UNMERGED_BRANCHES.md`,
`history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

The greeting in a browser.

### Marker

`origin/main` → `57120ed`; the line of `feat/welcome-greeting` removed; `HEAD` → this sync's
version commit.

---

## S-018 — 2026-11-17 — pull requests #9 and #10 on `main`; #8 brings in `main` again

|                 |                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------- |
| **Trigger**     | The shared hook, after the merges and a fetch                                            |
| **Range**       | `origin/main` `75db772..29d3d04`; `origin/feat/welcome-greeting` `6198a89..7cfeaa6`      |
| **Size**        | 2 merges on `main` (no changes of their own); 1 merge by `kcerha` (roadmap journal only) |
| **Evidence**    | RUN — the checks of #9 and #10; CODE — combined diffs                                    |
| **Reviewed by** | Claude, in the audit session                                                             |

### Added

- On `main`: the audit update (#9, 0.20.12–0.20.13) and the brand files (#10, 0.20.14–0.20.16).

### Removed

- The branches `docs/audit-s013` and `chore/brand-assets`, deleted after their merges.

### Fixed

- none

### Changed

- `feat/welcome-greeting` brings in `main` up to #9 (`7cfeaa6`); it conflicts again with `main`
  on the version and the journal until it brings in #10.

### New findings

- none

### Documents updated

`PROJECT_STATUS.md`, `UNMERGED_BRANCHES.md`, `history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

- Pull request #8's checks.

### Marker

`origin/main` → `29d3d04`; `origin/feat/welcome-greeting` → `7cfeaa6`; the line of
`chore/brand-assets` removed; `HEAD` → this sync's version commit.

---

## S-017 — 2026-11-17 — the logo file renamed

|                 |                                                                     |
| --------------- | ------------------------------------------------------------------- |
| **Trigger**     | Our own commit, at the user's request                               |
| **Range**       | `chore/brand-assets` (pull request #10), one commit after `3d2a55d` |
| **Size**        | 1 rename, version files                                             |
| **Evidence**    | CODE — same file content under the new name                         |
| **Reviewed by** | Claude, in the session that wrote the commit                        |

### Added

- none

### Removed

- none

### Fixed

- none

### Changed

- `djafat/ogo.png` renamed `djafat/logo.png` (version 0.20.16); S-016 names the file as it was then.

### New findings

- none

### Documents updated

`PROJECT_STATUS.md`, `history/CHANGELOG.md`, `history/LAST_REVIEWED_COMMIT`.

### Not verified

- nothing

### Marker

`HEAD` and `origin/chore/brand-assets` → this sync's version commit.

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
