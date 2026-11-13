---
name: feature-pipeline
description: Run the DJAFAT feature pipeline end to end on a manually written feature in docs/features/FEAT-NNN-*/feature.md — intake, specs, brief, grill-me, spec-derived tests, implementation, review, local PR content. Use when the user asks to "process", "implement" or "take" a feature (FEAT-NNN), or to run the whole pipeline.
---

# Feature pipeline (orchestration by instructions, not an engine)

You sequence the stage skills yourself, in this conversation. There is no
workflow state besides the artifacts in the feature folder and its
`progress.md`. Stop at any blocking condition and say why.

## Inputs

- A feature folder `docs/features/FEAT-NNN-<slug>/` with a human-written
  `feature.md` (template: `docs/features/_templates/feature.md`).
- If the user only describes a feature in chat, do NOT invent the feature
  document from your own product ideas: offer to transcribe THEIR text into the
  template, and have them confirm it (the feature is a human input).

## Stages

| #   | Skill                                             | Produces                                     | Gate to continue                                                        |
| --- | ------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | `/feature-intake`                                 | intake notes in `progress.md`                | feature valid (`pnpm check:specs`), assets readable or handoff recorded |
| 2   | `/feature-specs`                                  | `specs/SPEC-NNN-NN.md` (status draft)        | every AC covered by a spec                                              |
| 3   | `/feature-brief`                                  | `brief.md` (pins spec versions)              | brief references only existing files/abstractions                       |
| 4   | `/feature-grill-me`                               | `clarifications.md`, specs → clarified       | **no blocking question open** — otherwise STOP and ask the human        |
| 5   | `/feature-brief` again                            | brief regenerated for the clarified versions | `pnpm check:specs` passes                                               |
| 6   | `/feature-tests` then `/feature-implement` (loop) | tests citing scenario IDs, code              | tests written from the spec first; `pnpm verify:fast` no new failure    |
| 7   | `/feature-visual` (only if `ui: yes`)             | execution screenshots + comparison           | each visual criterion has evidence or is marked unverified              |
| 8   | `/feature-review`                                 | `review.md`                                  | no blocking finding (else back to 6)                                    |
| 9   | `/feature-pr`                                     | `pr.md`                                      | `pnpm verify` result recorded at the current commit                     |

After each stage: update `progress.md` (stage, date, decisions, blockers).

## Commands used

`pnpm check:specs` · `node scripts/pipeline/check-specs.mjs --matrix FEAT-NNN` ·
`pnpm verify:fast` · `pnpm verify` · `node scripts/pipeline/verify.mjs --full --report docs/features/<dir>/verification.md`

## Blocking conditions (stop and report)

- A blocking product question is open (scope, rule, price, delay, permission).
- A spec would require inventing an API/capability that does not exist.
- A new failure in `verify` you cannot fix within the spec's scope.
- A visual criterion depends on an image you cannot open (record the handoff).

## Success

All specs `implemented`, every scenario mapped to a passing test (or explicit
manual/review evidence), `review.md` without blocking finding, `pr.md` with a
current `verify` report that distinguishes new / pre-existing / unavailable.
