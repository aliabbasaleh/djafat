# Changelog

What changed in the project and its documentation, newest first. One entry per meaningful change.
Code changes also appear in Git; this file records **what was verified** and **what was learned**,
which Git does not.

Format: date · what changed · affected areas · verification · newly discovered issues.

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
- Committed on the branch `docs/audit-sync` and proposed to `main` as a pull request.

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
