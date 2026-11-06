---
name: feature-resume
description: Resume work on a DJAFAT feature from its existing artifacts (feature.md, specs, clarifications.md, brief.md, progress.md, review.md) in a new session — determine the current stage, re-validate, re-run stale verification, and continue with the right stage skill. Use when the user says "continue/reprendre FEAT-NNN" or a session starts on an in-progress feature.
---

# Resume from artifacts

There is no session database: the feature folder IS the state.

## Steps

1. `ls docs/features/` → pick the feature (ask if several are in progress).
2. Read `progress.md` first (stages, decisions, blockers, last verification
   and its commit), then the specs' `status`/`version`, `clarifications.md`,
   `brief.md` pins, `review.md`.
3. Re-validate: `pnpm check:specs` (catches a brief made stale by a spec bump,
   unmapped scenarios, broken references). `git log --oneline -10` and
   `git status` to see what changed since the last recorded verification.
4. Any change after the last recorded verify → that result is stale: run
   `pnpm verify:fast` (or `pnpm verify` before review/PR).
5. Decide the next stage:
   - open blocking question → report it, wait for the human;
   - specs draft → `/feature-grill-me`;
   - brief stale → `/feature-brief`;
   - scenarios unmapped → `/feature-tests`;
   - tests red / spec not implemented → `/feature-implement`;
   - no `review.md` for the current commit → `/feature-review`;
   - review clean → `/feature-pr`.
6. Tell the user in two lines where the feature stands and what you do next.
