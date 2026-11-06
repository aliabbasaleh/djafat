---
name: feature-implement
description: Implement clarified DJAFAT specs following the execution brief, repository conventions and architecture policy — focused diff, existing abstractions first, validation scenarios defined before code, verify after each step. Use once specs are clarified and spec-derived tests exist, or when the user asks to implement a spec/feature.
---

# Implementation

## Preconditions

- Specs `clarified`, brief pinned to their current versions (`pnpm check:specs` passes).
- Spec-derived tests written first (`/feature-tests`); for a bug fix, the
  failure reproduced before the fix.

## Steps

1. Follow the brief's file table. Respect layers
   (`docs/pipeline/architecture-policy.md`):
   - pure rules → `packages/core` or a suffix-less module helper (no clock,
     randomness, env, I/O — inject them);
   - orchestration → `*.service.ts`; controllers only translate input, call
     the service, translate output; errors carry an explicit `code` mapped by
     `AllExceptionsFilter`;
   - frontends: business logic in `lib/`, components render; the backend is
     reached only through `@djafat/sdk`.
2. Reuse before adding (see the brief's abstractions list). No new interface,
   factory, repository or wrapper without a concrete second implementation or
   boundary that needs it.
3. Keep the diff focused on the specs: no unrelated refactor or reformat.
   Note any unrelated problem in `progress.md` instead.
4. After each meaningful step: `pnpm verify:fast` (the PostToolUse hook
   already checks each edited file). Fix new failures before moving on.
5. UI changes: run `/feature-visual` against the "attendu" references.
6. Never edit a spec to match the code. If implementation reveals the spec is
   wrong or incomplete → `/feature-grill-me` (version bump).
7. When done: spec `status: implemented`, `pnpm check:specs` (all scenarios
   mapped), `pnpm verify`, update `progress.md` with the verify report.

## Blocking

New failure outside the spec's scope; need for a DAG edge, migration or
new dependency not in the clarified spec; an architecture check failure that
would require a baseline entry (never baseline your own new violation).

## Success

All tests of the pinned spec versions pass, `pnpm verify` shows no new failure,
the diff touches only what the brief lists (or deviations are documented).
