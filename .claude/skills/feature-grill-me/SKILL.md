---
name: feature-grill-me
description: Challenge a DJAFAT feature's specs before implementation ("grill me") — ambiguities, conflicts, missing cases, unverifiable criteria, visual gaps, compatibility, authorization/security, migration/rollback, architectural fit, needless complexity — and record questions and decisions in clarifications.md. Use before implementing, or when the user says "grill me", "challenge", "clarify".
---

# Grill-me

## Steps

1. Read everything first: feature, specs, brief, intake notes, the code they
   cite, `README.md` rules and the module docs. Do not ask what the
   repository already answers — cite it instead.
2. Challenge, for each spec:
   - ambiguous/conflicting requirements, missing nominal/error/boundary cases;
   - criteria that cannot be verified;
   - visual gaps (state not shown, viewport unknown, current vs. expected);
   - compatibility with existing behaviour and clients (web/admin/restaurant/
     mobile/courier through `@djafat/sdk`);
   - authorization, tenant isolation, step-up MFA, idempotency, money, ledger;
   - migration and rollback when data or schema changes;
   - architectural fit (layers, DAG) and unnecessary complexity.
3. Classify every point:
   - **bloquant: oui** — product decision (scope, rule, amount, delay, who is
     notified, permission). Only a human settles it. Ask in chat, concisely,
     with options and a recommendation; record it `ouverte`.
   - **bloquant: non** — reasonable technical assumption; record it
     `hypothèse` with the assumption as decision.
4. Write `clarifications.md` (template `docs/features/_templates/clarifications.md`).
5. When the human answers: set `tranchée` + decision (who, date), update the
   spec(s) — `version: +1` if the spec was already clarified — then set the
   spec `status: clarified` once no blocking question concerns it.
6. Regenerate the brief (`/feature-brief`). `pnpm check:specs` must pass.

## Blocking

Any open blocking question: STOP the pipeline, list the questions, wait.
Never resolve a product question by assumption (`check:specs` rejects it).

## Success

Specs `clarified`, `clarifications.md` complete, brief pinned to the new versions.
