# Code quality and architecture audit

An assessment of how the code is built: structure, maintainability, duplication, performance and
scalability. Functional and security defects are in their own documents; this one is about the
shape of the code and what that shape costs or protects.

## 1. Summary

The codebase is disciplined in the small and uneven in the large. Individual functions are
careful, typed, commented with their reasons, and guarded against the races their authors thought
of. The weaknesses are structural: the modules talk to each other over a channel that can lose
messages, the largest services have grown past comfortable size, the frontends repeat themselves,
and the test strategy verifies the code against imitations of its dependencies.

| Dimension                 | Rating                  | One-line reason                                                                      |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| Separation of concerns    | Good                    | Clear module boundaries, enforced by lint; pure domain package                       |
| Naming and conventions    | Good                    | Consistent; conventional commits; formatter and linter clean                         |
| Type safety               | Good                    | Strict TypeScript; money as a branded `bigint` pair                                  |
| Error handling            | Good, with gaps         | One envelope, explicit codes; a few client errors fall through to 500                |
| Reliability under failure | Weak                    | Cross-module reactions are fire-and-forget                                           |
| Duplication               | Mixed                   | Backend low except dispatch; frontends high                                          |
| Testability as practised  | Weak                    | Heavy fakes; SQL and UI never executed by tests                                      |
| Readability               | Mixed                   | Excellent local comments; very long files; comments cite documents by section number |
| Performance               | Adequate for the target | No measurements; a few avoidable round-trips                                         |
| Scalability               | Adequate for the target | Single-instance assumptions in places; sequential courier offers                     |

## 2. What is done well

Keep these; new code should follow them.

- **A pure domain core.** `packages/core` holds the state machines, money arithmetic, ledger
  validation, pricing, availability and security policies with no I/O — 181 tests, complete
  statement coverage. The API calls it rather than re-deriving rules.
- **Boundaries that are checked.** `eslint-plugin-boundaries` rejects an import that crosses the
  module graph; ports and injection tokens are used where a lower module needs something from a
  higher one.
- **One vocabulary across the stack.** Roles, permissions, event names and error codes are defined
  once in `packages/types` and used by API, worker, SDK and clients.
- **Idempotency as a first-class service**, backed by a database key, used on every write that
  must not repeat.
- **Locking that is written down.** Delivery-then-courier lock order is stated and followed;
  status changes are conditional updates; the most important invariants are also unique indexes.
- **Comments that explain why.** Most non-obvious code says what bug or constraint produced it.
- **Server-authoritative amounts**, re-read live at order creation and frozen on the order.
- **Zero lint warnings, three `eslint-disable` comments, seven TODO markers** across the workspace.

## 3. Structural weaknesses

### 3.1 Two event channels, the weaker one for business state

Covered in [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) §5 and
[`ARCH-01`](FINDINGS.md#arch-01). It is the main architectural risk: the design invested in a
durable outbox and then routed only notifications through it.

### 3.2 Services that are too large

| File                               | Lines | Holds                                                                                              |
| ---------------------------------- | ----- | -------------------------------------------------------------------------------------------------- |
| `deliveries/deliveries.service.ts` | 1 474 | creation, dispatch, offers, pickup, proof, completion, cancellation, failure, reads, authorisation |
| `orders/orders.service.ts`         | 1 169 | creation, three listings, transitions, six event reactions, three port implementations             |
| `payments/payments.service.ts`     | 883   | creation, webhooks, success, cancel, refund, discovery                                             |
| `carts/carts.service.ts`           | 710   | cart mutation, validation, quoting                                                                 |

Each mixes several reasons to change. A large share of the length is explanatory comment, which
softens the problem but does not remove it: reviewing a change to dispatch means holding the whole
delivery lifecycle in view. Split by use case once integration tests exist to protect the change
(T-403).

### 3.3 Duplicated logic

- **Dispatch exists twice** — in the API (Prisma) and in the worker (raw `pg`), described in both
  places as "mirrored 1:1". They already drifted once ([`ARCH-02`](FINDINGS.md#arch-02)).
- **AES-GCM helpers exist twice** (`common/crypto/at-rest.ts` and `auth/crypto.util.ts`),
  deliberately, to keep keys apart; one function taking a key name would do the same.
- **Frontends repeat their scaffolding**: `auth-storage.ts` appears in five apps (57–86 lines
  each), the OTP login page in three (143 lines, near-identical), `DataTable` in two, `realtime.ts`
  in four, `ui-client.tsx` in three. A fix to session handling ([`FE-02`](FINDINGS.md#fe-02)) must
  currently be made five times. Move session and realtime handling into the SDK or a shared
  client package.

### 3.4 A test strategy that cannot see the database

Four `*-test-support.ts` files (about 2 000 lines) implement in-memory stand-ins for Prisma,
including pattern-matching on raw SQL text. The 811 API unit tests pass against them. They did not
catch a type error in a SQL aggregate ([`PAY-03`](FINDINGS.md#pay-03)), and the worker's fake once
ignored a `WHERE` clause entirely (`docs/36` §6.2). The suite that would have caught these cannot
run ([`TEST-01`](FINDINGS.md#test-01)). Detail in
[`TESTING_AND_QUALITY_ASSURANCE.md`](TESTING_AND_QUALITY_ASSURANCE.md).

### 3.5 Raw SQL spread through services

Raw queries are justified for locking, geography and the ledger, and they are parameterised
(tagged templates — no string concatenation was found). But they live inline in service methods,
are typed by hand-written result shapes, and are invisible to Prisma's type checking. A thin
repository layer per module would give them one home and one place to test.

### 3.6 Dead and misleading configuration

Validated at boot and read by no code (checked with a search of `apps/api/src` and
`apps/worker/src`): `API_RATE_LIMIT_WINDOW_MS`, `API_RATE_LIMIT_MAX`, `SMS_PROVIDER`,
`SMS_MOCK_URL`, `OTP_CHANNELS`, `PAYMENT_MOCK_URL`, `SENTRY_DSN`, `OTEL_*`, `APP_TIMEZONE`,
`LEDGER_DB_ROLE` (the role name is hard-coded in the ledger repository). Two of them —
`API_PUBLIC_URL` and `PAYMENT_WEBHOOK_BASE_URL` — are **required**: the API refuses to start
without values it never uses. The five `OBJECT_STORAGE_*` variables are also required and are read
only to print one log line. Seven of ten queue names in `queue.constants.ts` have no processor.
Four of seven Compose services are contacted by no code. Each suggests a capability that is not
there (T-404).

### 3.7 Documentation coupled to code by section number

Hundreds of comments cite the French reports as `docs/25 §12`. The reports are long and their
section numbers are not stable anchors; the references are useful history but will rot. Prefer a
one-line reason in the comment and a link to an ADR for decisions.

## 4. Performance

No profiling or load test was run. From reading and from the live run:

| Observation                                                                                        | Where                       | Weight                                                    |
| -------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------- |
| Platform settings fetched from the database on each use (≈5 per dispatch wave, ≈3 per OTP request) | `platform.service.ts`       | Low — cache for a few seconds                             |
| Ledger account resolved by an un-indexable expression, once per entry                              | `ledger.repository.ts`      | Low now, medium at scale                                  |
| Permissions and account status read on every request                                               | `actor-resolver.service.ts` | Low — two small queries; a deliberate freshness trade-off |
| `ledger-assert` loads every group ID to count them                                                 | worker                      | Low                                                       |
| Outbox relay holds a database transaction open while publishing up to 50 events to Redis           | worker                      | Low                                                       |
| Order creation inserts lines one by one                                                            | `orders.service.ts`         | Negligible (a handful of lines)                           |
| Offer and active-delivery lists fetch context per row                                              | `deliveries.service.ts`     | Negligible (one or two rows)                              |
| Web first-load JavaScript 105–143 kB per route                                                     | build output                | Reasonable; not measured on a slow network                |
| Seed images fail through the image optimiser                                                       | web                         | Cosmetic ([`FE-05`](FINDINGS.md#fe-05))                   |

Nothing here blocks the stated target of a few thousand orders a day.

## 5. Scalability

- **Horizontal scaling of the API** is designed for (stateless, stream consumer group, socket
  adapter) but unproven beyond one instance ([`RT-01`](FINDINGS.md#rt-01)). The in-process event
  bus means a reaction runs only in the instance that handled the request — correct, but it makes
  [`ARCH-01`](FINDINGS.md#arch-01) more likely as instances are added and restarted.
- **The worker** can run in several copies for the outbox relay (`SKIP LOCKED`) and dispatch
  (row locks plus unique indexes). Repeatable jobs are registered by each copy; BullMQ
  de-duplicates by key. Not tested with more than one.
- **Dispatch offers one courier at a time**, 30 seconds each, on a 10-second tick. With few
  couriers this adds minutes to a delivery; batching or broadcast is the usual next step.
- **Polling cadences** (2 s, 10 s, 30 s) set the latency floor for realtime and dispatch and a
  constant background load; fine at this size.
- **Database**: one primary behind PgBouncer; no read replica, partitioning or archiving planned.

## 6. Maintainability risks, ranked

1. Fire-and-forget business reactions ([`ARCH-01`](FINDINGS.md#arch-01)).
2. No executable check of SQL or UI behaviour ([`TEST-02`](FINDINGS.md#test-02)).
3. Two dispatch implementations ([`ARCH-02`](FINDINGS.md#arch-02)).
4. Five copies of client session handling.
5. Three diverging lines of development ([`GOV-01`](FINDINGS.md#gov-01)).
6. Services over a thousand lines.

## 7. Recommendations

- Do not rewrite. The module structure, the domain core and the invariants are sound; the work is
  to close specific gaps.
- Before refactoring anything large, get the integration suite running and add SQL-level tests
  for money and dispatch (T-108, T-601).
- Move the business reactions onto the durable channel or add reconcilers (T-301).
- Collapse dispatch to one implementation (T-401) and client session code to one (with T-207).
- Then split the large services by use case (T-403).

Last updated: 2026-11-11 (evidence collected 2026-11-10)
