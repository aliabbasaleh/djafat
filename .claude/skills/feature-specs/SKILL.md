---
name: feature-specs
description: Generate one or more specs (docs/features/FEAT-NNN-*/specs/SPEC-NNN-NN.md) from a validated DJAFAT feature — observable behaviour, business rules, Given/When/Then scenarios with stable IDs, errors, API/data contracts, authorization, UI/accessibility, migrations, validation strategy. Use after feature intake, or when the user asks to write/update specs.
---

# Spec generation

## Inputs

`feature.md`, intake notes in `progress.md`, the code located during intake.

## Steps

1. Split by independent behaviour: one spec per behaviour that can be tested
   and reviewed on its own (e.g. backend rule vs. screen state). IDs
   `SPEC-NNN-01`, `-02`… never reused.
2. Copy `docs/features/_templates/spec.md`. Front matter: `status: draft`,
   `version: 1`, `covers:` the ACs this spec covers.
3. Describe CURRENT behaviour from code with `file:line` evidence. Describe
   new behaviour only as far as the feature states it. Never invent a route,
   field, error code, role or capability: if the feature needs one, propose
   it explicitly in "Contrats API et données" and mark it _nouveau_.
4. Scenarios `### SPEC-NNN-NN-SCnn — <title>` with `Critères : <AC ids>` and
   **Étant donné / Quand / Alors** steps. Cover nominal, error and boundary
   cases (idempotent replay, concurrency, tenant isolation → 404, money
   rounding, closed/paused states…) where the feature implies them.
5. Visual requirements: turn each "attendu" reference into explicit,
   checkable criteria (text, state, order, presence). Do NOT guess pixel
   sizes, breakpoints or colours the reference does not state — ask.
6. Fill every section; "N/A — <reason>" when it does not apply.
7. Put unknowns in "Hypothèses et questions ouvertes", split into technical
   assumptions vs. product questions.
8. `pnpm check:specs` must pass. Update `progress.md`.

## Output

`specs/SPEC-NNN-NN.md` files, status `draft`.

## Blocking

An AC that cannot be expressed as an observable scenario → back to the human.

## Success

Every AC appears in some spec's `covers`; every scenario names its ACs;
`pnpm check:specs` passes (warnings about unmapped tests are expected at this stage).
