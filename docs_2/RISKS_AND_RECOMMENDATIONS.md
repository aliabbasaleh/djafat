# Risks and recommendations

The audit's conclusions for whoever decides what happens next. Evidence for every statement is in
[`FINDINGS.md`](FINDINGS.md); the work it implies is in [`tasks/`](tasks/).

## 1. The situation in five sentences

DJAFAT has a well-designed backend whose main path works and whose access controls hold. It has
never been usable by a real person: the web apps cannot reach the API from a browser, no customer
can pay, and the courier app cannot be built. The parts that move money are the least finished —
payments can be faked, cash does not work, refunds crash, and nothing returns money when an order
fails. The safety nets that should have shown all this — integration tests, CI, a browser check —
were themselves broken, so earlier reports concluded the project was ready when it was not.
Meanwhile development has moved to a branch that `main` has not received.

## 2. Ranked risks

Likelihood is the chance the risk materialises if nothing changes and the system is put in front of
users. Impact is on the business.

| #   | Risk                                                                                                                                                                                 | Likelihood         | Impact                                     | Findings                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | ------------------------------------------ | ---------------------------------------------------------- |
| 1   | **Launching on a false picture of readiness.** Status documents and green unit tests describe a product that does not work when used                                                 | Already happened   | Severe — wasted launch, lost partner trust | `DOC-02`, `TEST-01`, `TEST-02`, `SDK-01`                   |
| 2   | **Direct financial loss through the payment path**: free orders, unrefunded customers, partners credited for orders that failed                                                      | Certain if exposed | Severe                                     | `PAY-01`, `PAY-04`, `PAY-03`, `PAY-05`                     |
| 3   | **Compromise of the platform**: forged administrator tokens, seeded administrator accounts, exploitable framework versions                                                           | High               | Severe                                     | `SEC-01`, `SEC-02`, `DEP-01`                               |
| 4   | **Money and order state silently diverging** after a crash or deploy, with nothing to detect or repair it                                                                            | High over time     | High — manual reconciliation, disputes     | `ARCH-01`, `WRK-01`, `PAY-08`                              |
| 5   | **The market's payment methods are not available**: cash is broken, mobile money absent, both depend on outside decisions                                                            | Certain today      | Blocks launch                              | `PAY-02`, `PAY-07`, `AUTH-01`                              |
| 6   | **Deliveries cannot be carried out reliably in the field**: courier app unbuilt, foreground-only location, 30-second offers without push, no map, no coordinates for new restaurants | Certain today      | Blocks launch                              | `MOB-01`, `COUR-01`, `DLV-01`                              |
| 7   | **Divergent code lines**: fixes exist in three places; work gets duplicated or lost in merges                                                                                        | High               | Medium-high                                | `GOV-01`                                                   |
| 8   | **No operational capability**: no deployment, backup, monitoring or support tooling; staff cannot refund, cancel or intervene                                                        | Certain today      | High at first incident                     | `OPS-02`, `OBS-01`, `ADM-01`, `ADM-03`, `ORD-01`, `DLV-02` |
| 9   | **Feature growth outrunning verification**: about 31 600 lines added in five days on the other branch (updated 2026-11-11, sync S-001), on top of the defects found here             | High               | High                                       | `GOV-01`, `TEST-02`                                        |
| 10  | **Abuse at launch**: account lock-outs, no general rate limit, spoofable client address                                                                                              | Medium             | Medium                                     | `SEC-03`, `SEC-04`, `SEC-06`                               |
| 11  | **Staff sessions**: tokens in browser storage, valid after logout, optional MFA enrolment                                                                                            | Medium             | High                                       | `SEC-05`, `SEC-08`, `ADM-02`                               |
| 12  | **Usability in the target conditions unknown**: nothing measured on a low-end phone or slow network; sessions end every 15 minutes                                                   | High               | Medium                                     | `FE-02`, `QA-01`                                           |

## 3. What is good and should be protected

A critical audit can leave the impression that everything is poor. It is not.

- The **domain model** — money type, state machines, ledger, idempotency — is correct in design
  and well tested in its pure form.
- **Tenant isolation** was attacked from many angles and held every time.
- The **database carries real invariants**: one active delivery per courier, no over-refund,
  append-only ledger and audit log, one open cart, idempotent orders.
- **Module boundaries** are enforced by tooling, and provider interfaces are in place for SMS,
  payments, push and storage, so the missing integrations are additions, not rewrites.
- The code is **consistently formatted, typed and commented with its reasons**.
- The web interfaces are **coherent and pleasant**, and the design system is reusable.

**Recommendation: do not rewrite anything.** Close the gaps listed here in the order given.

## 4. Recommendations

### 4.1 Before any further feature work

1. **Unify the code line** (T-001). Recommended route in [`UNMERGED_BRANCHES.md`](UNMERGED_BRANCHES.md) §4.
2. **Make verification real** before trusting any status again: runnable integration tests
   (T-108), then tests that execute the SQL (T-601) and a browser (T-602). Treat a change as done
   only when such a test passes.
3. **Adopt one status page.** [`PROJECT_STATUS.md`](PROJECT_STATUS.md) replaces verdicts scattered
   across block reports. Update it with every change.

### 4.2 Stop the losses (Phase 1)

Fix, in this order: browser access to the API; payment enablement; refunds; webhook ordering;
secret validation; the local stack; the build; the vulnerable dependencies; CI. Most are small.
Several already exist on a branch.

### 4.3 Decisions needed from the business

These gate Phase 2 and no amount of engineering substitutes for them. Detail in
[`tasks/BLOCKED_TASKS.md`](tasks/BLOCKED_TASKS.md).

| Decision                                                                  | Blocks                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------ |
| Rules for cash on delivery (limits, who qualifies, courier cash handling) | Cash orders                                            |
| Refund policy for each way an order can fail                              | Automatic refunds, cancellation, confirmation time-out |
| SMS provider                                                              | Any real login                                         |
| Mobile-money provider access                                              | Any electronic payment                                 |
| Payout policy                                                             | Paying restaurants and couriers                        |
| Hosting                                                                   | Deployment, monitoring, proxy configuration            |
| Whether restaurants may self-register                                     | Onboarding flow                                        |

### 4.4 Sequence of milestones

| Milestone                        | Means                                                                                                                                | Roughly corresponds to                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| **M1 — Truthful baseline**       | One branch; CI green; integration and browser tests running; no known way to order for free or forge a token                         | Phase 0 + Phase 1                        |
| **M2 — Internal pilot**          | Staff and friendly restaurants complete real cash orders on real phones; every failure path returns the money; support can intervene | Phase 2 groups A–D, with T-301 and T-302 |
| **M3 — Controlled public pilot** | One zone, limited hours; deployed with backups and monitoring; abuse controls on; external security review passed                    | Phase 3 + T-603, T-604                   |
| **M4 — Launch**                  | Mobile money, payouts, notifications, measured performance on target devices                                                         | Remainder                                |

No dates are given: effort depends on team size and on how the branches are merged, neither of
which the audit can know.

### 4.5 Working practices

- **Verify against the real thing.** Database for SQL, browser or device for interfaces. The four
  critical defects found here all sat beneath passing unit tests.
- **Slow the feature pace until the safety net exists.** Each feature merged without it adds to
  what must be re-verified later.
- **Record debt when taking it**, with the condition that makes it due
  ([`TECHNICAL_DEBT.md`](TECHNICAL_DEBT.md) §4).
- **Give money paths a second pair of eyes**: any change to payments, ledger, refunds or cash
  should be reviewed by someone who did not write it, with a ledger assertion in its test.
- **Keep the pilot honest.** A pilot run counts only if a person completed it through the
  applications, and its report says exactly what was and was not exercised.

## 5. Open questions the audit could not answer

- Does the Docker image for the API start? (Not built; a likely defect is noted in
  [`DEPLOYMENT_AND_ENVIRONMENT.md`](DEPLOYMENT_AND_ENVIRONMENT.md) §5.)
- Do the Expo apps run on a device once they bundle?
- How does the system behave with two API instances, or two workers?
- How does it perform on a low-end Android phone over a slow connection?
- What does the larger branch actually do when run? Its 18 features are unverified here.
- Are the restaurant-creation rights of owners intended ([`ORD-04`](FINDINGS.md#ord-04))?

Last updated: 2026-11-11 (sync S-001)
