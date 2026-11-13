---
name: feature-review
description: Review a DJAFAT feature's diff against its specs, existing behaviour and the architecture policy, separating deterministic check results from reviewer judgment, and write review.md with severity, location, rationale and expected correction. Use after implementation, before PR preparation, or when the user asks for a review of feature work.
---

# Quality review

## Steps

1. Deterministic part — run and paste, do not paraphrase:
   `node scripts/pipeline/verify.mjs --full --report docs/features/<dir>/verification.md`
   and `node scripts/pipeline/check-specs.mjs --matrix FEAT-NNN`.
2. Judgment part — delegate to the **spec-reviewer** sub-agent (fresh
   context, read-only) with: the feature folder path, the base commit
   (`git merge-base HEAD origin/main`), and the list of changed files. If
   sub-agents are unavailable, do the same review yourself, re-reading the
   specs before the diff.
3. The review assesses: functional correctness vs. each scenario;
   regressions on existing behaviour; dependency direction and responsibility
   placement (things static checks cannot prove, e.g. business logic hidden in
   a controller or component); security/authorization/tenant isolation;
   whether tests assert the SPEC's outcome rather than mirror the code;
   unnecessary abstractions; visual and accessibility criteria.
4. Write `review.md` from `docs/features/_templates/review.md`: section 1 =
   tool output, section 2 = findings table (bloquant / majeur / mineur /
   note, `file:line`, rationale citing the spec/rule, expected correction),
   section 3 = verdict.
5. Blocking or major findings → back to `/feature-implement` (or
   `/feature-grill-me` if the spec is at fault), then review again.

## Success

`review.md` exists for the current commit, with no blocking finding left open,
and its tool section matches a fresh `verify` run.
