# Application: `apps/worker`

The background process. It runs four repeating jobs on BullMQ and talks to PostgreSQL with
hand-written SQL through the `pg` driver. It has no HTTP surface and never calls the API.

|                 |                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| **State**       | Partially Completed                                                                                         |
| **Stack**       | BullMQ 5 · ioredis · `pg` · pino                                                                            |
| **Size**        | 14 files, ≈2 230 lines (≈1 180 of tests)                                                                    |
| **Tests**       | 36 unit tests pass · integration: 6 pass, 3 fail on a seeded database ([`TEST-03`](../FINDINGS.md#test-03)) |
| **Build / run** | ✅ `tsc`; started from `dist/` on 2026-11-10; relay and expiry observed doing their work                    |

**It is not optional.** Without it there is no dispatch retry, no realtime event, no notification
and no order expiry, while the API continues to look healthy.

## 1. Jobs

| Job              | Every | What it does                                                                                                                                                                                | State                                                                                                                                                                 |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outbox-relay`   | 2 s   | Takes up to 50 pending outbox rows (`FOR UPDATE SKIP LOCKED`), appends each to the Redis stream `djafat:domain-events`, marks it published; exponential back-off up to 5 minutes on failure | ✅ Verified — 40 of 40 rows published during the live run                                                                                                             |
| `order-expiry`   | 30 s  | Moves `awaiting_payment` orders past their deadline to `expired`, with history and outbox rows, and expires their open payments                                                             | ✅ Verified                                                                                                                                                           |
| `dispatch-retry` | 10 s  | Expires offers past their deadline and frees the courier; for deliveries still searching, runs another wave with a wider radius                                                             | Ran without error throughout the live run. The offer in that run came from the API's first wave, so the retry path was not isolated; it is covered by unit tests only |
| `ledger-assert`  | 1 h   | Checks every entry group balances and every wallet balance equals its ledger entries; logs an error if not                                                                                  | Runs; result only logged — Needs Improvement                                                                                                                          |

Design points that are sound: every job is a conditional update or a locked batch, so several
worker copies can run; nothing depends on in-memory state; shutdown closes queues and connections.

## 2. What is missing

All under [`WRK-01`](../FINDINGS.md#wrk-01) unless another finding is named.

| Missing job                                                                                  | Needed for                               |
| -------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Restaurant confirmation time-out                                                             | [`ORD-02`](../FINDINGS.md#ord-02)        |
| Reconciliation of pending payments with the provider                                         | [`PAY-07`](../FINDINGS.md#pay-07)        |
| Repair of stuck states: paid but not placed, ready but no delivery, delivered but order open | [`ARCH-01`](../FINDINGS.md#arch-01)      |
| Retention: one-time codes, sessions, idempotency keys, published outbox rows, webhook events | growth ([`DB-01`](../FINDINGS.md#db-01)) |
| Payouts                                                                                      | [`PAY-06`](../FINDINGS.md#pay-06)        |
| Notification delivery (push, SMS)                                                            | [`NOTIF-01`](../FINDINGS.md#notif-01)    |

`apps/api/src/infra/queue/queue.constants.ts` declares ten queue names; seven have no processor
(`dispatch`, `notifications`, `payments-reconcile`, `geocoding`, `images`, `analytics-rollup`,
`payouts`), and the worker's actual fourth queue, `dispatch-retry`, is not in that list.

## 3. Weaknesses

| Issue                                               | Detail                                                                                                                        | Finding                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Duplicate dispatch logic                            | `dispatch.processor.ts` re-implements the API's candidate search and claim in raw SQL, "mirrored 1:1"                         | [`ARCH-02`](../FINDINGS.md#arch-02)                                  |
| No health signal                                    | No heartbeat, no endpoint; a dead worker is invisible. It died unnoticed for 26 hours in October (`docs/36`)                  | [`WRK-01`](../FINDINGS.md#wrk-01), [`OPS-02`](../FINDINGS.md#ops-02) |
| Ledger violations only logged                       | `ledger-assert` raises no alert; its wallet check joins both sides, so a balance with no entries at all would not be reported | [`OBS-01`](../FINDINGS.md#obs-01)                                    |
| "Dead-letter" is not one                            | After ten failed attempts an outbox row is marked `failed` but still retried every five minutes, with no alert                | [`WRK-01`](../FINDINGS.md#wrk-01)                                    |
| Database transaction held while publishing to Redis | Up to 50 network calls inside one transaction                                                                                 | Low                                                                  |
| Integration tests                                   | Insert ledger accounts the seed already created; not part of CI                                                               | [`TEST-03`](../FINDINGS.md#test-03)                                  |

## 4. Outstanding tasks

T-206 (confirmation time-out) · T-301 (reconcilers) · T-401 (single dispatch) · T-402 (missing
jobs, retention, heartbeat) · T-605 (integration tests in CI) · T-604 (alerts).

Last updated: 2026-11-11 (evidence collected 2026-11-10)
