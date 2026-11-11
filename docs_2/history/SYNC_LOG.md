# Sync log

One entry per review of new commits against this documentation, newest first. The procedure is in
[`../README.md`](../README.md) §3; the commits each entry brought the documentation up to are in
[`LAST_REVIEWED_COMMIT`](LAST_REVIEWED_COMMIT). Documents changed by a sync carry a dated note
`(updated YYYY-MM-DD, sync S-nnn)` next to the statement that changed.

"Reviewed" is not "verified": every status below states its evidence level (vocabulary in
[`../README.md`](../README.md) §1).

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
