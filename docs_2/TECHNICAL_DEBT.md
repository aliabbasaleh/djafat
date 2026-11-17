# Technical debt

Debt is a shortcut taken knowingly, or a gap that accumulated. This page separates the two, because
they need different handling: accepted debt has an owner's reasoning that should be re-examined;
discovered debt has none yet.

Defects — things that are simply wrong — are in [`FINDINGS.md`](FINDINGS.md) and are not repeated
here unless they originate in a debt decision.

## 1. Debt the project accepted knowingly

Recorded in the French reports, mainly `docs/36-pilot-e2e-scenario.md` §6.3. For each: is the
original reasoning still sound?

| Debt                                                                                 | Original reasoning                                                                          | Assessment on 2026-11-10                                                                                                        | Finding / task                                                       |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Expo apps do not bundle                                                              | Fix needs a linker or Metro change with risk for the web apps; "not blocking for the pilot" | **No longer acceptable.** The courier app is the only courier interface; and this debt is what makes the root build and CI fail | [`MOB-01`](FINDINGS.md#mob-01) · T-106, T-210                        |
| Object storage is a stub                                                             | No upload needed for the pilot; MinIO image withdrawn upstream                              | Acceptable short term; but the withdrawn image also breaks `infra:up` for everyone                                              | [`STOR-01`](FINDINGS.md#stor-01), [`OPS-01`](FINDINGS.md#ops-01)     |
| No real mobile money; no automatic reconciliation; no asynchronous refunds           | Outside the pilot; "cash and mock are enough"                                               | **Premise was wrong**: cash does not work ([`PAY-02`](FINDINGS.md#pay-02)), so only a test double can pay                       | [`PAY-07`](FINDINGS.md#pay-07) · T-215                               |
| Notifications have no client and no real channel                                     | "New functional work"                                                                       | Acceptable, but the courier app needs push to be usable                                                                         | [`NOTIF-01`](FINDINGS.md#notif-01), [`COUR-01`](FINDINGS.md#cour-01) |
| Realtime fan-out across instances unproven                                           | Pilot ran one instance                                                                      | Still true                                                                                                                      | [`RT-01`](FINDINGS.md#rt-01) · T-606                                 |
| Monitoring variables validated, nothing installed                                    | "Gives the illusion of a pipeline" — acknowledged                                           | Still true; required before any real traffic                                                                                    | [`OBS-01`](FINDINGS.md#obs-01) · T-604                               |
| Suspend, block and reactivate without step-up; other MFA gaps                        | Console has no MFA screen; gating would break a working feature                             | The underlying cause is the missing screen, which also blocks role management                                                   | [`ADM-02`](FINDINGS.md#adm-02), [`ADM-03`](FINDINGS.md#adm-03)       |
| No database trigger for some delivery invariants                                     | Partial unique indexes plus service locking judged sufficient                               | Reasonable; the indexes exist and are a real backstop                                                                           | —                                                                    |
| A delivery code issued before the encryption change cannot be recovered; no re-issue | Cannot occur on a fresh database                                                            | The general need remains: support cannot re-issue or override                                                                   | [`DLV-02`](FINDINGS.md#dlv-02)                                       |
| Integration tests need `.env` exported by hand                                       | Configuration reads `process.env` by design                                                 | **Understated**: the suite does not run at all, with or without the variables                                                   | [`TEST-01`](FINDINGS.md#test-01)                                     |
| A realtime adapter test is flaky under parallel load                                 | Timing-sensitive test                                                                       | Passed in the audit run; keep an eye on it                                                                                      | —                                                                    |
| No time-out for a `placed` order nobody confirms                                     | Needs a product decision; "restaurant is present in the pilot"                              | Not acceptable with real customers                                                                                              | [`ORD-02`](FINDINGS.md#ord-02) · T-206                               |
| Worker run by hand with no supervision                                               | Deployment work, out of scope then                                                          | Cost a pilot run already                                                                                                        | [`OPS-02`](FINDINGS.md#ops-02), [`WRK-01`](FINDINGS.md#wrk-01)       |
| Flat delivery fee ("skeleton")                                                       | Zone pricing needs the geo module                                                           | Acceptable for a first pilot in one city if the fee is chosen deliberately                                                      | [`ORD-05`](FINDINGS.md#ord-05)                                       |
| MFA not required at administrator login                                              | Step-up on sensitive actions judged sufficient                                              | Weak while enrolment is optional; revisit                                                                                       | `SECURITY_AUDIT.md` §3.4                                             |
| Access tokens not checked against session state                                      | Fifteen-minute lifetime judged short enough                                                 | Reasonable for customers; weak for staff                                                                                        | [`SEC-08`](FINDINGS.md#sec-08)                                       |
| Web tokens in `localStorage`, no refresh                                             | "Smallest possible bridge" to reach the cart                                                | Outgrown: five apps now depend on it                                                                                            | [`SEC-05`](FINDINGS.md#sec-05), [`FE-02`](FINDINGS.md#fe-02)         |
| Order code collisions not retried                                                    | 40 bits of entropy                                                                          | Fine                                                                                                                            | —                                                                    |
| No currency conversion                                                               | Single currency at launch                                                                   | Fine                                                                                                                            | —                                                                    |

## 2. Debt discovered by the audit

Nobody decided these; they accumulated.

### Structure

| Debt                                                                               | Cost if left                                                | Task       |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------- |
| Business reactions on an in-memory event bus while a durable outbox sits beside it | Silent, permanent inconsistencies after any crash or deploy | T-301      |
| Dispatch implemented twice                                                         | Rules drift between API and worker                          | T-401      |
| Session and realtime client code copied into five apps                             | Every fix made five times                                   | with T-207 |
| Four services between 700 and 1 500 lines                                          | Slow, risky review                                          | T-403      |
| Raw SQL inline in services, typed by hand                                          | Errors invisible to the compiler and to the fakes           | T-601      |

### Testing

| Debt                                        | Cost if left                                           | Task  |
| ------------------------------------------- | ------------------------------------------------------ | ----- |
| ≈2 000 lines of hand-written database fakes | False confidence; each new query needs the fake taught | T-601 |
| No browser or device test                   | Front-end outages pass every check                     | T-602 |
| Coverage measured for one package           | Unknown blind spots                                    | T-601 |

### Configuration and tooling

| Debt                                                                      | Cost if left                                  | Task  |
| ------------------------------------------------------------------------- | --------------------------------------------- | ----- |
| A dozen environment variables validated and unused, some of them required | Misleads operators; blocks boot for no reason | T-404 |
| Seven declared queues without processors                                  | Suggests jobs that do not exist               | T-404 |
| Four local services nothing uses                                          | Slower, more fragile setup                    | T-110 |
| One seed for reference data and test fixtures                             | Cannot initialise a real environment safely   | T-302 |
| No loader for `.env`                                                      | Every newcomer trips on it                    | T-110 |
| Platform settings changeable only in SQL                                  | Operations depend on a developer              | later |

### Dependencies

| Debt                                                     | Cost if left                              | Task                |
| -------------------------------------------------------- | ----------------------------------------- | ------------------- |
| `next` 15.1.3, `fastify` 4.x, Nest 10, Prisma 6.2, Zod 3 | Known vulnerabilities; larger jumps later | T-105               |
| Hand-written JWT signing and TOTP                        | More to defend in a security review       | consider with T-308 |

### Data

| Debt                                                              | Cost if left         | Task  |
| ----------------------------------------------------------------- | -------------------- | ----- |
| No retention on token, key, event and log tables                  | Unbounded growth     | T-402 |
| Prisma schema covers part of the database and none of its indexes | Drift goes unnoticed | T-405 |
| `delivery_proofs.reference` reused for the encrypted code         | Misleading schema    | T-405 |

### Documentation

| Debt                                                                            | Cost if left                     | Task                                                                         |
| ------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| Code comments cite French reports by section number                             | References rot as reports change | gradual                                                                      |
| A 714 KB concatenated copy of the dossier and a zip of it committed at the root | Three copies to keep in step     | T-607                                                                        |
| Block reports state results that were not reproducible                          | Decisions made on wrong status   | [`DOC-02`](FINDINGS.md#doc-02) — this documentation replaces them for status |

## 3. Debt to leave alone for now

- Extraction of payments and ledger into separate services (the design anticipates it; nothing
  requires it at this size).
- A search engine (PostgreSQL full-text search is adequate).
- Arabic and right-to-left (planned for a later version).
- Read replicas, partitioning, multi-region.

## 4. Managing debt from here

- New debt is recorded here on the day it is taken, with its reason and the condition that makes
  it due ("before first external user", "before second API instance").
- Each review of [`PROJECT_STATUS.md`](PROJECT_STATUS.md) checks whether a condition has come due.
- An item leaves this page only when the corresponding task is in
  [`tasks/COMPLETED_TASKS.md`](tasks/COMPLETED_TASKS.md).

Last updated: 2026-11-11 (evidence collected 2026-11-10)
