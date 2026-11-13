---
name: feature-pr
description: Prepare local pull-request content (docs/features/FEAT-NNN-*/pr.md) for a reviewed DJAFAT feature — objective, before/after, specs and criteria covered, architecture changes, executed checks with honest classification, screenshots, pre-existing failures, risks and limitations. Use when the user asks to prepare a PR or after a clean review. Does not publish anything.
---

# PR preparation (local only)

## Steps

1. Preconditions: `review.md` without blocking finding for the current commit.
2. Re-run `node scripts/pipeline/verify.mjs --full --report docs/features/<dir>/verification.md`
   if anything changed since the last report (a stale report is not evidence).
3. Fill `pr.md` from `docs/features/_templates/pr.md`:
   - title as a conventional commit (`commitlint.config.cjs` scopes);
   - "Specs et critères": output of `node scripts/pipeline/check-specs.mjs --matrix FEAT-NNN`;
   - "Vérifications": the verify table verbatim — new / pre-existing /
     skipped / unavailable kept distinct; never "all green" otherwise;
   - architecture: layers touched, baseline entries added/removed (with reason);
   - screenshots: execution images vs. references, or "N/A — backend";
   - pre-existing failures from `scripts/pipeline/baselines/known-failures.json`;
   - risks, exceptions, migrations, rollback, limitations.
4. Commit only if the user asked. Publishing the PR (GitHub) is outside this
   skill: the user does it, or asks explicitly (see
   `docs/pipeline/draft-integrations.md`). Never push or open a PR on your own.

## Success

`pr.md` is self-contained, every claim in it is backed by an artifact in the
feature folder or a command output at the current commit.
