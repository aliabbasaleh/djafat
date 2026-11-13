---
name: feature-brief
description: Write or regenerate the execution brief (feature metaprompt) docs/features/FEAT-NNN-*/brief.md — pinned spec versions, files and abstractions to reuse, layer ownership of each change, spec-derived test plan, verification commands, completion criteria. Use after specs are generated and again after grill-me decisions change a spec.
---

# Execution brief

The brief is an artifact Claude Code reads before implementing; it is not a
model call. It must be regenerated whenever a pinned spec version changes
(`pnpm check:specs` rejects a stale brief).

## Steps

1. Copy `docs/features/_templates/brief.md`; set `specs: [SPEC-NNN-NN@<version>]`
   for every non-draft spec (draft specs may be pinned too before grill-me).
2. "Fichiers concernés": for each change, the existing file (`path:line`), its
   current role, the planned change and its **layer** from
   `docs/pipeline/architecture-policy.md` (domain / application / port /
   adapter / transport / composition / presentation / client-logic).
   Prefer existing abstractions: `@djafat/core` money/state machines,
   `IdempotencyService`, `LedgerPort`, `OrderAmountPort`, `PaymentProvider`
   registry, `@RequireAuth/@RequireRole/@RequireOwnership/@RequireStepUp`,
   `AllExceptionsFilter` codes, `@djafat/sdk`. Justify any new abstraction.
3. Check the plan against the module DAG
   (`packages/eslint-config/api-boundaries.js`) — a needed new edge is an
   architecture decision to raise in grill-me, not something to add silently.
4. "Stratégie de test": one row per scenario — test level, target file,
   and the oracle **quoted from the spec** (never from the code).
5. Commands: `pnpm verify:fast`, the focused test command, `pnpm verify`.
6. `pnpm check:specs` must pass.

## Blocking

The plan needs a forbidden dependency, a schema migration or a new module the
specs do not mention → raise it in `/feature-grill-me`.

## Success

Brief pins the current versions, names real files only, gives a layer for
every change and an oracle for every scenario.
