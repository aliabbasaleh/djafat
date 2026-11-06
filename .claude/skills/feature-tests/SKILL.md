---
name: feature-tests
description: Derive and write tests from a DJAFAT feature's clarified specs — read the specs first, derive nominal/error/boundary cases per scenario, pick the test level, reuse existing harnesses, tag each test with its scenario ID, run them and report missing evidence. Use before/alongside implementation, or when the user asks for tests for a spec or feature.
---

# Tests derived from specs

The SPEC is the oracle. Code may tell you where to set up and observe, never
what the expected business outcome is.

## Inputs

Clarified specs (`status: clarified|implemented`) at the version pinned in
`brief.md`. If a spec is `draft` or has an open blocking question → stop,
send it back to `/feature-grill-me`.

## Steps (per spec)

1. List its rules, criteria and scenarios.
2. For each scenario derive nominal, error and boundary cases.
3. Choose the level (existing frameworks only — vitest everywhere):
   - domain rule → `packages/core/src/**/*.spec.ts` (pure, no mocks);
   - use case → `apps/api/src/modules/<m>/*.spec.ts` with the module's
     existing fake (`*-test-support.ts`, e.g. `payments-test-support.ts`);
   - HTTP/guards/filters → existing spec patterns (`step-up-route-order.spec.ts`,
     `all-exceptions.filter.spec.ts`);
   - real integration → `apps/api/test/*.int.spec.ts` (Postgres/Redis; a
     fully mocked test is NOT integration evidence);
   - UI logic → `apps/*/src/lib/*.spec.ts`; components → `packages/ui` specs.
4. Search existing tests first (`Grep` the behaviour, not just the file name);
   extend them rather than duplicate.
5. Write the test so its title or a comment cites the scenario ID, e.g.
   `it('SPEC-001-01-SC02 — refuse une commande quand le restaurant est fermé', …)`.
   Expected values come from the spec text. For a bug fix, run the test
   against the unfixed code first and keep the failing output as evidence.
6. Run the focused tests, then `pnpm check:specs` (mapping) and
   `pnpm verify:fast`.
7. Report per scenario: test file, level, result, and any **missing
   evidence** (not testable here, needs Docker, needs a device).

## Never

Delete or weaken a test, loosen an assertion, or change an expected value to
make code pass. If the spec looks wrong, it goes back to grill-me.

## Success

Every scenario of the spec is cited by at least one test (or carries
`[evidence: manual|review]` with a reason), tests run, results reported honestly.
