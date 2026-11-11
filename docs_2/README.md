# DJAFAT living documentation (`docs_2/`)

The repository has two documentation folders. Read this page first to know which one answers your
question.

| Folder    | What it is                                                                                          | Language | Kept in step with the code?                 |
| --------- | --------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------- |
| `docs/`   | The original design dossier and one report per build block. **Not touched by the audit.**           | French   | No — it records intent and history          |
| `docs_2/` | This folder: the audit of 2026-11-10 and everything that keeps it current. Status, findings, tasks. | English  | **Yes — after every change and every pull** |

| You want to know…                                   | Read                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| What works, what is broken, what to do next         | [`PROJECT_STATUS.md`](PROJECT_STATUS.md) — the single source of truth                            |
| The evidence behind a status line                   | [`FINDINGS.md`](FINDINGS.md) — every finding, with how it was verified                           |
| What changed since the audit, pull by pull          | [`history/SYNC_LOG.md`](history/SYNC_LOG.md)                                                     |
| What the system is and how it fits together         | [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md), [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) |
| What to work on, in which order                     | [`tasks/PRIORITY_TASKS.md`](tasks/PRIORITY_TASKS.md)                                             |
| Why the system was designed the way it was (French) | [`../docs/`](../docs/README.md) and [`../docs/adr/`](../docs/adr/)                               |

## 1. What is in this folder

```text
docs_2/
├── README.md                         this page: map, rules, and the after-every-pull procedure
├── PROJECT_STATUS.md                 single source of truth: status, open work, next actions
├── FINDINGS.md                       master register of audit findings (IDs such as PAY-01)
├── PROJECT_OVERVIEW.md               purpose, users, scope, technology, overall state
├── SYSTEM_ARCHITECTURE.md            components, data flow, event flow (Mermaid diagrams)
├── APPLICATION_INVENTORY.md          every app and package: purpose, stack, state
├── DATABASE_AND_DATA_MODEL.md        schema, invariants, data-level findings
├── API_AND_INTEGRATIONS.md           all 95 routes with their access rules; integrations
├── SECURITY_AUDIT.md                 security posture and findings
├── CODE_QUALITY_AUDIT.md             architecture, maintainability, performance
├── UI_UX_AUDIT.md                    what the screens do, in a real browser
├── TESTING_AND_QUALITY_ASSURANCE.md  what is tested, what ran, what did not
├── DEPLOYMENT_AND_ENVIRONMENT.md     how to run it, CI, deployment readiness
├── TECHNICAL_DEBT.md                 accepted and discovered debt
├── RISKS_AND_RECOMMENDATIONS.md      ranked risks and what to do about them
├── UNMERGED_BRANCHES.md              the remote branches ahead of `main`
├── applications/                     one audit per application (8 files)
├── modules/                          one audit per backend domain (7 files)
├── tasks/                            BACKLOG · PRIORITY_TASKS · COMPLETED_TASKS · BLOCKED_TASKS
├── .gitattributes                    keeps the script runnable on Windows; merges the review marker
├── history/
│   ├── CHANGELOG.md                  what changed in the docs and the code, and what was verified
│   ├── SYNC_LOG.md                   one entry per pull or fetch reviewed against the audit
│   └── LAST_REVIEWED_COMMIT          the commits this documentation currently accounts for
└── tools/
    └── audit-sync-check.sh           tells Claude when the code has moved past those commits
```

### How the pieces relate

- A **finding** (`FINDINGS.md`) is a fact about the system, with an ID, a classification and its evidence.
- A **task** (`tasks/BACKLOG.md`) is work that resolves one or more findings. Tasks carry IDs `T-nnn`.
- A **sync** (`history/SYNC_LOG.md`) is one review of new commits against the findings. Syncs carry IDs `S-nnn`.
- **`PROJECT_STATUS.md`** summarises all three and links to them. It never restates details — it points.
- Application and module documents describe one area and list the finding IDs that affect it.

A detail lives in exactly one place. If two documents disagree, `FINDINGS.md` wins for facts and
`PROJECT_STATUS.md` wins for status.

### Classification vocabulary

| Status              | Meaning                                                       |
| ------------------- | ------------------------------------------------------------- |
| Completed           | Implemented and verified to work                              |
| Partially Completed | Implemented, but missing something important                  |
| Not Implemented     | Required functionality does not exist                         |
| Broken              | Exists, does not work correctly                               |
| Needs Improvement   | Works, but should be significantly better                     |
| Needs Verification  | Could not be conclusively evaluated with the evidence at hand |
| Not Applicable      | Out of the project's scope                                    |

### Evidence vocabulary

Every finding states how it was established. Never upgrade a level without redoing the work.

| Level      | Meaning                                                                              |
| ---------- | ------------------------------------------------------------------------------------ |
| **LIVE**   | Reproduced against the running system (API + worker + PostgreSQL + Redis, or Chrome) |
| **RUN**    | Established by executing a tool: build, test suite, audit, git, CI logs              |
| **CODE**   | Established by reading the code; not executed                                        |
| **BRANCH** | Read from an unmerged branch with `git show`; not checked out, not executed          |
| **DOC**    | Taken from an earlier project document; not re-verified                              |

## 2. Maintenance rules

1. **After every pull or fetch that brings new commits, run the incremental audit sync** (§3) before
   any other work. Two people work on this project; this is how the documentation stays true.
2. **After every meaningful change of our own**, update `PROJECT_STATUS.md`, the affected
   application/module document, the task's status, and add a line to `history/CHANGELOG.md`.
3. **A task is complete only when verified.** Record how: the command, the test, or the manual
   check, and its result. Code that was written but not run is "implemented, unverified".
4. **A finding is closed, never deleted.** Mark it `Resolved` with the commit and the verification,
   and keep the entry so the history stays readable.
5. **New problems found while doing something else** go into `FINDINGS.md` and `tasks/BACKLOG.md`
   immediately, even if they will not be fixed now.
6. **If a documented fact becomes wrong, correct it** and note the correction where it was made:
   `(updated YYYY-MM-DD, sync S-nnn)` or `(corrected YYYY-MM-DD)`, plus a changelog line.
7. **No secrets in documentation** — no keys, tokens, passwords or real `.env` values.
8. Update the "Last updated" line of every document you touch.
9. **Leave `docs/` alone.** It belongs to the design dossier and to whatever the other contributor
   adds there. Everything the audit produces lives here.

## 3. After every pull — the incremental audit sync

**Why.** The audit describes the code at specific commits. A collaborator pushes; a pull changes
the code under the documentation. Without a review, findings stay "open" after they were fixed, new
defects go unrecorded, and features appear that no document mentions.

**When.** Whenever `history/LAST_REVIEWED_COMMIT` no longer matches the repository — that is, after a
`git pull`, `merge`, `rebase`, branch switch, or a `git fetch` that moves a tracked remote branch.
`tools/audit-sync-check.sh` detects this and tells Claude at the next prompt or right after the pull (§4).

**What "reviewed" means.** Every new commit has been read, its effect on each finding decided, the
documents updated, and the result logged. Nothing is marked fixed on the strength of a commit
message.

### Procedure

1. **Establish the range.** For each line of `history/LAST_REVIEWED_COMMIT`, compare the recorded
   commit with the current one.

   ```bash
   git log --reverse --format='%h %ad %an | %s' --date=short <recorded>..<current>
   git diff --stat <recorded> <current>
   ```

   Note who wrote the commits. If the recorded commit is not an ancestor of the current one, the
   history was rewritten or the branch changed: say so in the log and review the whole difference.

2. **Read every commit** — the diff, not only the message.

3. **Sort what changed into four lists.**

   | List        | Means                                                           | Leads to                                                         |
   | ----------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
   | **Added**   | New feature, file, route, table, dependency, document           | Inventory, architecture, module pages; `Needs Verification`      |
   | **Removed** | Deleted code, route, table, document, dependency                | Remove or strike the statements that described it                |
   | **Fixed**   | A change that addresses a finding (name the finding ID)         | Finding status — see step 4                                      |
   | **Changed** | Behaviour altered without fixing a finding; possible regression | Re-check the statements about that area; new finding if it broke |

4. **Decide each affected finding's status honestly.**

   | Situation                                                             | Status to record                                     |
   | --------------------------------------------------------------------- | ---------------------------------------------------- |
   | Fix read in the diff, not run                                         | `Fix present, unverified` (evidence CODE or BRANCH)  |
   | Fix read and the finding's "Verify" step re-run successfully          | `Resolved` — with the commit and the check performed |
   | Area touched, finding still reproducible or still visible in the code | `Open` — add a dated note saying it was re-checked   |
   | Partly addressed                                                      | `Open (partly addressed)` — say what remains         |

   Re-run the "Verify" step whenever the environment allows; that is the only route to `Resolved`.

5. **Look for what the commits did not say.** New routes without guards, new SQL aggregates without
   `::bigint`, new required environment variables, migrations, dependency changes, test files
   deleted or skipped, edits under `docs/`. Record new problems as new findings.

6. **Update the documents**, leaving a visible note where a statement changed —
   `(updated YYYY-MM-DD, sync S-nnn)`:

   - `FINDINGS.md` — statuses, notes, new findings, the counts at the top
   - `PROJECT_STATUS.md` — overall status, lists, counts, next actions, "Last synced" line
   - the application and module pages the changes touch
   - `tasks/BACKLOG.md`, `tasks/COMPLETED_TASKS.md`, `tasks/BLOCKED_TASKS.md`
   - `UNMERGED_BRANCHES.md` when a remote branch moved, appeared or was merged
   - `API_AND_INTEGRATIONS.md`, `DATABASE_AND_DATA_MODEL.md`, `APPLICATION_INVENTORY.md` when routes,
     migrations or packages changed

7. **Log it.** Add an entry at the top of `history/SYNC_LOG.md` (template inside) and a line in
   `history/CHANGELOG.md`.

8. **Move the marker.** Set each line of `history/LAST_REVIEWED_COMMIT` to the commit just reviewed.
   Do this last: an interrupted sync must be detected again next time.

9. **Tell the user** what was added, removed and fixed, what is still open, and what could not be
   verified.

Our own commits count too: after committing work that the documents already describe, add a short
sync entry and move the marker, so the next reminder is about someone else's changes.

## 4. How the reminder works

`history/LAST_REVIEWED_COMMIT` lists, one per line, a commit and the ref it belongs to: `HEAD` for
the checked-out branch, then each remote branch being followed. Every commit reachable from any of
these lines counts as reviewed, so a pull that only brings commits already reviewed on another
branch stays silent. Commits that change only files under `docs_2/` are never reported — recording a
review is such a commit — and a merge is reported only if it changes code against every parent.

`tools/audit-sync-check.sh` compares those lines with the repository. If nothing is unreviewed it
prints nothing. Otherwise it prints a short instruction naming the commits, their authors and the
number of files. It only reads; it never fetches, pulls or writes.

### Shared with everyone who uses Claude Code in this repository

The script is wired into Claude Code by the **shared** project settings, `.claude/settings.json`,
which is versioned (the `.gitignore` keeps the rest of `.claude/` local). It runs:

| When                                                                                                               | Hook                 |
| ------------------------------------------------------------------------------------------------------------------ | -------------------- |
| Every time a prompt is submitted                                                                                   | `UserPromptSubmit`   |
| After a `git pull`, `fetch`, `merge`, `rebase`, `checkout`, `switch`, `reset`, `am` or `cherry-pick` run by Claude | `PostToolUse` (Bash) |

Not after `git commit`: one's own new commits are reported at the next prompt, and if the
documents already describe them a short sync entry is enough. The effect is that whoever's Claude
session sees new commits first is told to review them before doing anything else. Pulls made
outside Claude (terminal, editor) are caught at the next prompt.

Two people can record reviews on different branches. `docs_2/.gitattributes` gives
`LAST_REVIEWED_COMMIT` Git's `union` merge, so merging keeps every line from both sides instead of
stopping on a conflict; extra lines are harmless. Other documents merge normally — resolve them by
keeping both sides' notes.

**Requirements:** `bash` and `git` (on Windows, the Git Bash that Claude Code uses). Nothing else.

**To silence it** for one machine, open `/hooks` in Claude Code, or put
`{ "disableAllHooks": true }` in `.claude/settings.local.json` (that also disables any other
hooks). To remove it for everyone, delete the two entries from `.claude/settings.json`.

**When this folder reaches a branch that has its own `.claude/settings.json`** (the collaborator's
branch has one, with its pipeline hooks), Git reports a conflict on that file: keep both sets of
hooks — the `UserPromptSubmit` entry and the `PostToolUse` entry with `"matcher": "Bash"` from this
side, everything else from the other.

To check by hand:

```bash
docs_2/tools/audit-sync-check.sh            # prints the unreviewed commits, or nothing
```

To follow another remote branch, add a line `<commit> <ref>` to `LAST_REVIEWED_COMMIT`. A remote
branch that is not listed is reported as new.

## 5. The design dossier in `docs/`

The original architecture dossier and one implementation report per build block. It explains
**intent and reasoning**; it is not kept in sync with the code and several status statements in it
are out of date (see `FINDINGS.md` → `DOC-01`, `DOC-02`). The audit did not modify it.

| Files in `docs/`           | Content                                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                | Executive summary of the dossier, key decisions, assumptions. Its status paragraph still says development has not started                                         |
| `01` → `14`                | Architecture: general, stack, web, mobile, backend, schema, API, payments, delivery, design system, screens, offline/perf/security, repository structure, roadmap |
| `15`, `16`                 | Audit journal, locked decisions A1–A9, final validation checkpoint                                                                                                |
| `17` → `35`                | Implementation report for each block (0 → 12). There is no `26`.                                                                                                  |
| `36-bloc-13-hardening.md`  | Hardening pass                                                                                                                                                    |
| `36-pilot-e2e-scenario.md` | Pilot scenario, runbook and residual debt (second file numbered 36)                                                                                               |
| `adr/0001-…`               | ADR: logistics and vertical integration                                                                                                                           |

Code comments cite these files by number (`docs/25 §12`), so they keep their names and location.
The other contributor's branch adds files to `docs/` as well (a roadmap and a local-setup guide —
see [`UNMERGED_BRANCHES.md`](UNMERGED_BRANCHES.md)); that is one more reason the audit lives in its
own folder.

## 6. Where the truth lives for common questions

| Question                                 | Answer is in                                        |
| ---------------------------------------- | --------------------------------------------------- |
| Can I run this locally? How?             | `DEPLOYMENT_AND_ENVIRONMENT.md` §2                  |
| Which endpoints exist, who may call them | `API_AND_INTEGRATIONS.md` §2                        |
| Is feature X finished?                   | `PROJECT_STATUS.md` §4–§6, then the module document |
| Why is CI red?                           | `FINDINGS.md` → `CI-01`                             |
| What is on the other branches?           | `UNMERGED_BRANCHES.md`                              |
| What did the last pull change?           | `history/SYNC_LOG.md`, top entry                    |
| Why was X designed this way?             | `docs/`, starting with `15` and `16`                |

Last updated: 2026-11-11 (reminder shared through `.claude/settings.json`)
