# Module: payments and ledger

`apps/api/src/modules/payments` and `modules/ledger`, with the payment state machine and ledger
validation in `packages/core`. Design intent: `docs/08-architecture-paiement.md`,
`docs/24-bloc-5-payment.md`, decisions A2–A5 in `docs/15`.

**State: Partially Completed, with the project's most serious defects.** The happy path of a
prepaid payment is correct and atomic. Around it: payment can be faked, cash does not work,
refunds crash, failures keep the money, and nobody can be paid out.

## 1. How it works

**Providers.** A `PaymentProvider` interface (initiate, status, webhook parsing, cancel, capture,
refund, declared capabilities) and a registry. Two implementations: `cash` (stays pending until
delivery) and `mock` (a test double whose outcome the request chooses). Rows in `payment_providers`
and `payment_provider_configs` describe which provider is enabled where, with amount bounds and a
fee rate.

**Creating a payment** (`POST /payments`, idempotent). The amount is read from the order, never
from the client. A `pending` row is inserted, the provider is called, and a synchronous success
goes through the same routine as a webhook would.

**Success** (`markSucceeded`) — one transaction: conditional update to `succeeded`; fee rate
resolved from configuration; a balanced `order_accrual` group posted; outbox event written. Then an
in-process event tells `orders` to place the order.

**Webhooks** (`POST /payments/webhook/:provider`): the raw body is preserved for signature
verification; the event is recorded once per provider and event id; the amount is compared with
the payment's and a mismatch sets `needs_review` without crediting anything.

**Refund** (`POST /payments/:id/refund`; staff, step-up, idempotent): checks state and remaining
amount, calls the provider, then in one transaction marks the refund succeeded, posts a `refund`
group, and sets the payment `partially_refunded` or `refunded`. A database trigger blocks
over-refund under concurrency.

**Ledger.** `LedgerService.postEntryGroup` validates that debits equal credits per currency
(`core/ledger`), then the repository writes the group, its entries and the wallet projection in
one transaction under the `djafat_ledger` role. Posting is idempotent on a key such as
`payment:<id>`. Accounts: platform-level (`PSP_CLEARING`, `PSP_FEE_EXPENSE`, `DJAFAT_REVENUE`,
`DJAFAT_BANK`, `COURIER_FEE_POOL`, `REFUNDS_PAYABLE`, …) and per-owner
(`RESTAURANT_PAYABLE/AVAILABLE`, `COURIER_PAYABLE/AVAILABLE`, `CASH_FLOAT`), created on first use.

**Balances.** `wallet_balances` holds `pending` (payable) and `available` per restaurant and
courier. Funds move from pending to available at delivery.

**Settlements.** A staff user can record what a provider paid out for a period; it posts a
`settlement` group and flags a discrepancy against the expected amount.

Tables: `payments`, `refunds`, `webhook_events`, `settlements`, `payment_methods`,
`payment_providers`, `payment_provider_configs`, `ledger_accounts`, `ledger_entry_groups`,
`ledger_entries`, `wallet_balances`.

## 2. Verified numbers

One 12 000 XAF order (subtotal 11 000, delivery 1 000, commission 20 %), paid with the test provider:

| Account                                                                  | Movement |
| ------------------------------------------------------------------------ | -------- |
| Provider clearing                                                        | +11 820  |
| Provider fee expense (1.5 %)                                             | +180     |
| Restaurant payable → available at delivery                               | 8 800    |
| Courier fee pool → courier payable at acceptance → available at delivery | 1 000    |
| DJAFAT revenue                                                           | 2 200    |

Every group balanced; the hourly assertion query returned no violation.

## 3. Features

| Feature                                                      | State                                  | Evidence                                                                                                                                                                                |
| ------------------------------------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discover payment methods for a context                       | Completed                              | LIVE                                                                                                                                                                                    |
| Create a prepaid payment; atomic success with ledger posting | Completed                              | LIVE                                                                                                                                                                                    |
| Idempotent create                                            | Completed                              | CODE + unit tests                                                                                                                                                                       |
| Order placed after payment                                   | Completed, fragile                     | LIVE; depends on an in-process event ([`ARCH-01`](../FINDINGS.md#arch-01))                                                                                                              |
| **Refuse a provider that is not enabled**                    | **Broken**                             | LIVE — [`PAY-01`](../FINDINGS.md#pay-01)                                                                                                                                                |
| **Cash on delivery**                                         | **Broken**                             | LIVE — [`PAY-02`](../FINDINGS.md#pay-02) ; trust rule on `feat/compte-email-password`: a verified e-mail counts like a confirmed number for level T1 _(updated 2026-11-22, sync S-039)_ |
| **Refund**                                                   | **Broken**                             | LIVE — HTTP 500 — [`PAY-03`](../FINDINGS.md#pay-03)                                                                                                                                     |
| Webhook: signature, single processing, amount check          | Partially Completed                    | LIVE — ordering defect [`PAY-05`](../FINDINGS.md#pay-05)                                                                                                                                |
| Cancel a pending payment                                     | Implemented                            | CODE; not exercised                                                                                                                                                                     |
| Expire a pending payment with its order                      | Completed                              | LIVE                                                                                                                                                                                    |
| Refund or reversal when an order fails                       | Not Implemented                        | LIVE — [`PAY-04`](../FINDINGS.md#pay-04)                                                                                                                                                |
| Real provider (Airtel, Moov)                                 | Not Implemented                        | [`PAY-07`](../FINDINGS.md#pay-07)                                                                                                                                                       |
| Reconcile pending payments with the provider                 | Not Implemented                        | No job                                                                                                                                                                                  |
| Asynchronous refunds                                         | Not Implemented                        | Noted in code                                                                                                                                                                           |
| Ledger posting, idempotency, balance projection              | Completed                              | LIVE                                                                                                                                                                                    |
| Append-only ledger                                           | Completed                              | LIVE (update rejected by trigger)                                                                                                                                                       |
| Single-writer rule enforced by the database                  | Not enforced                           | LIVE — [`SEC-07`](../FINDINGS.md#sec-07)                                                                                                                                                |
| Restaurant and courier balance views                         | Completed                              | LIVE                                                                                                                                                                                    |
| Platform finance view                                        | Completed                              | LIVE                                                                                                                                                                                    |
| Record a settlement                                          | Implemented, unreachable for `finance` | LIVE (428) — [`ADM-01`](../FINDINGS.md#adm-01); not exercised as super_admin                                                                                                            |
| Payouts                                                      | Not Implemented                        | [`PAY-06`](../FINDINGS.md#pay-06)                                                                                                                                                       |
| Statements (line-by-line history)                            | Not Implemented                        |                                                                                                                                                                                         |
| Courier cash float and remittance                            | Not Implemented                        | Account type and setting exist only                                                                                                                                                     |

## 4. The defects, in plain terms

1. **Paying is not gated by configuration.** The "enabled" rows decide what the customer is
   _shown_, not what the server _accepts_. The test provider is always present and lets the caller
   declare the payment successful.
2. **Cash orders vanish.** A cash payment is pending by nature; the order waits for a success that
   only delivery can produce; the kitchen never sees the order; the worker expires it.
3. **Refunds crash** on a number-type mismatch that only a real database reveals.
4. **A failed order keeps the customer's money and the partners' credit.** The refund design debits
   DJAFAT's revenue for the whole amount and leaves the restaurant's and courier's payables in
   place; and nothing triggers a refund automatically in any case.
5. **A forged, unsigned webhook can occupy the place of a genuine one.**
6. **Money can be credited but never paid out.**

## 5. Assessment

**Strong:** the double-entry design, idempotent posting, "payment succeeded implies a balanced
entry" in one transaction, server-side amounts, the over-refund trigger, and the provider
abstraction are all right. Adding a real provider is an isolated piece of work.

**Weak beyond the defects:**

- The ledger's protections against other writers are a convention ([`SEC-07`](../FINDINGS.md#sec-07)).
- An order can have several open payments; `attempt_no` never changes; the idempotency scope is
  global ([`PAY-09`](../FINDINGS.md#pay-09)).
- The cash path, once it exists, releases funds before accruing them ([`PAY-08`](../FINDINGS.md#pay-08)).
- Payment and refund actions are not written to the audit log.
- `payments.service.ts` is 883 lines.
- The unit tests for this module run on a fake that returned the wrong number type — the suite
  that protects money cannot see the database ([`TEST-02`](../FINDINGS.md#test-02)).

## 6. Decisions needed before the fixes

Refund policy by failure point; cash limits and courier cash handling; payout policy; provider
access. See [`../tasks/BLOCKED_TASKS.md`](../tasks/BLOCKED_TASKS.md).

## 7. Findings and tasks

`PAY-01` → T-102 · `PAY-03` → T-103 · `PAY-05` → T-107 · `PAY-02`, `PAY-08` → T-202 · `PAY-04` →
T-205 · `PAY-07` → T-215 · `PAY-06` → T-216 · `SEC-07` → T-309 · `PAY-09` → T-406 · tests → T-601.

Last updated: 2026-11-11 (evidence collected 2026-11-10)
